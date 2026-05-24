//! Salesforce OAuth connector (Zoho stub in list API).

use axum::{
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Redirect, Response},
};
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use std::time::{Duration, Instant};

use crate::admin_auth::{write_audit, AdminCtx};
use crate::crypto::{decrypt_integration_config, encrypt_integration_config};
use crate::db::{self, IntegrationPublic};
use crate::{admin_auth, json_error, STATE};

const SF_PROVIDER: &str = "salesforce";
const ZOHO_PROVIDER: &str = "zoho_projects";
const OAUTH_STATE_TTL: Duration = Duration::from_secs(600);

#[derive(Clone)]
pub struct OAuthPending {
    pub tenant_id: i64,
    pub actor: String,
    pub role: String,
    pub valid_until: Instant,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SalesforceTokenConfig {
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub instance_url: String,
    pub token_type: Option<String>,
    pub issued_at: Option<String>,
}

pub struct SfEnv {
    pub client_id: String,
    pub client_secret: String,
    pub redirect_uri: String,
    pub login_url: String,
}

pub fn sf_env() -> Option<SfEnv> {
    let client_id = std::env::var("SF_CLIENT_ID").ok()?.trim().to_string();
    let client_secret = std::env::var("SF_CLIENT_SECRET").ok()?.trim().to_string();
    let redirect_uri = std::env::var("SF_REDIRECT_URI")
        .unwrap_or_else(|_| "http://127.0.0.1:3000/api/integrations/salesforce/callback".into())
        .trim()
        .to_string();
    let login_url = std::env::var("SF_LOGIN_URL")
        .unwrap_or_else(|_| "https://login.salesforce.com".into())
        .trim()
        .trim_end_matches('/')
        .to_string();
    if client_id.is_empty() || client_secret.is_empty() {
        return None;
    }
    Some(SfEnv {
        client_id,
        client_secret,
        redirect_uri,
        login_url,
    })
}

pub fn ui_redirect_base() -> String {
    std::env::var("INTEGRATIONS_UI_URL")
        .unwrap_or_else(|_| "/integrations".into())
        .trim()
        .trim_end_matches('/')
        .to_string()
}

fn api_version() -> &'static str {
    "v59.0"
}

pub async fn ensure_integration_rows(pool: &SqlitePool, tenant_id: i64) -> Result<(), sqlx::Error> {
    for provider in [SF_PROVIDER, ZOHO_PROVIDER] {
        sqlx::query(
            "INSERT OR IGNORE INTO integrations (tenant_id, provider, status) VALUES (?, ?, 'disconnected')",
        )
        .bind(tenant_id)
        .bind(provider)
        .execute(pool)
        .await?;
    }
    Ok(())
}

pub fn list_with_stubs(rows: Vec<IntegrationPublic>) -> Vec<IntegrationPublic> {
    let mut out = rows;
    let has_sf = out.iter().any(|r| r.provider == SF_PROVIDER);
    let has_zoho = out.iter().any(|r| r.provider == ZOHO_PROVIDER);
    if !has_sf {
        out.push(IntegrationPublic {
            id: 0,
            provider: SF_PROVIDER.into(),
            status: "disconnected".into(),
            last_sync_at: None,
            last_error: Some("Chưa cấu hình — cần SF_CLIENT_ID/SECRET".into()),
            updated_at: String::new(),
            label: "Salesforce".into(),
            available: sf_env().is_some(),
        });
    }
    if !has_zoho {
        out.push(IntegrationPublic {
            id: 0,
            provider: ZOHO_PROVIDER.into(),
            status: "disconnected".into(),
            last_sync_at: None,
            last_error: Some("Sắp có — tuần 2".into()),
            updated_at: String::new(),
            label: "Zoho Projects".into(),
            available: false,
        });
    }
    for r in &mut out {
        if r.provider == SF_PROVIDER {
            r.label = "Salesforce".into();
            r.available = sf_env().is_some();
        } else if r.provider == ZOHO_PROVIDER {
            r.label = "Zoho Projects".into();
            r.available = false;
        }
    }
    out.sort_by(|a, b| a.provider.cmp(&b.provider));
    out
}

pub async fn api_list_integrations(ctx: &AdminCtx) -> Response {
    let Some(st) = STATE.get() else {
        return json_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "internal_error",
            "state not initialized",
        );
    };
    match db::list_integrations(&st.pool, ctx.tenant_id).await {
        Ok(rows) => {
            let public: Vec<IntegrationPublic> = rows.into_iter().map(Into::into).collect();
            axum::Json(list_with_stubs(public)).into_response()
        }
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            axum::Json(serde_json::json!({ "error": format!("{e}") })),
        )
            .into_response(),
    }
}

pub async fn api_salesforce_connect(ctx: &AdminCtx) -> Response {
    let Some(sf) = sf_env() else {
        return json_error(
            StatusCode::SERVICE_UNAVAILABLE,
            "not_configured",
            "Thiếu SF_CLIENT_ID / SF_CLIENT_SECRET trong env gateway",
        );
    };
    let Some(st) = STATE.get() else {
        return json_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "internal_error",
            "state not initialized",
        );
    };
    let state = uuid::Uuid::new_v4().to_string();
    st.oauth_pending.insert(
        state.clone(),
        OAuthPending {
            tenant_id: ctx.tenant_id,
            actor: ctx.username.clone(),
            role: ctx.role.clone(),
            valid_until: Instant::now() + OAUTH_STATE_TTL,
        },
    );
    let scope = urlencoding::encode("api refresh_token");
    let redirect = urlencoding::encode(&sf.redirect_uri);
    let url = format!(
        "{}/services/oauth2/authorize?response_type=code&client_id={}&redirect_uri={}&scope={}&state={}",
        sf.login_url, sf.client_id, redirect, scope, state
    );
    if let Err(e) = db::set_integration_status(
        &st.pool,
        ctx.tenant_id,
        SF_PROVIDER,
        "pending",
        None,
    )
    .await
    {
        tracing::warn!(error = %e, "set integration pending failed");
    }
    Redirect::temporary(&url).into_response()
}

pub async fn api_salesforce_callback(
    headers: HeaderMap,
    query: axum::extract::Query<SfCallbackQuery>,
) -> Response {
    let Some(st) = STATE.get() else {
        return redirect_ui_error("gateway_not_ready");
    };
    let code = match &query.0.code {
        Some(c) if !c.is_empty() => c.clone(),
        _ => return redirect_ui_error("missing_code"),
    };
    let state = match &query.0.state {
        Some(s) if !s.is_empty() => s.clone(),
        _ => return redirect_ui_error("missing_state"),
    };
    let pending = match st.oauth_pending.remove(&state) {
        Some((_, p)) => p,
        None => return redirect_ui_error("invalid_state"),
    };
    if pending.valid_until < Instant::now() {
        return redirect_ui_error("state_expired");
    }
    let Some(sf) = sf_env() else {
        return redirect_ui_error("not_configured");
    };
    let token = match exchange_code(&st.http, &sf, &code).await {
        Ok(t) => t,
        Err(e) => {
            let _ = db::set_integration_status(
                &st.pool,
                pending.tenant_id,
                SF_PROVIDER,
                "error",
                Some(&e),
            )
            .await;
            return redirect_ui_error("token_exchange_failed");
        }
    };
    let json = match serde_json::to_string(&token) {
        Ok(j) => j,
        Err(_) => return redirect_ui_error("serialize_failed"),
    };
    let enc = match encrypt_integration_config(&json) {
        Ok(e) => e,
        Err(e) => {
            tracing::error!(error = %e, "encrypt sf token");
            return redirect_ui_error("encrypt_failed");
        }
    };
    if let Err(e) = db::upsert_integration_config(
        &st.pool,
        pending.tenant_id,
        SF_PROVIDER,
        "connected",
        &enc,
        None,
    )
    .await
    {
        tracing::error!(error = %e, "save integration");
        return redirect_ui_error("db_failed");
    }
    let ctx = AdminCtx {
        user_id: 0,
        username: pending.actor.clone(),
        tenant_id: pending.tenant_id,
        role: pending.role.clone(),
        via_api_key: false,
    };
    write_audit(
        &st.pool,
        &ctx,
        "integration.connect",
        SF_PROVIDER,
        "success",
        crate::admin_auth::client_ip(&headers).as_deref(),
        Some(&token.instance_url),
    )
    .await;
    let base = ui_redirect_base();
    Redirect::temporary(&format!("{base}?ok=salesforce")).into_response()
}

#[derive(Debug, Deserialize)]
pub struct SfCallbackQuery {
    pub code: Option<String>,
    pub state: Option<String>,
    pub error: Option<String>,
}

fn redirect_ui_error(code: &str) -> Response {
    let base = ui_redirect_base();
    Redirect::temporary(&format!("{base}?error={code}")).into_response()
}

async fn exchange_code(
    http: &reqwest::Client,
    sf: &SfEnv,
    code: &str,
) -> Result<SalesforceTokenConfig, String> {
    let url = format!("{}/services/oauth2/token", sf.login_url);
    let res = http
        .post(&url)
        .form(&[
            ("grant_type", "authorization_code"),
            ("code", code),
            ("client_id", sf.client_id.as_str()),
            ("client_secret", sf.client_secret.as_str()),
            ("redirect_uri", sf.redirect_uri.as_str()),
        ])
        .send()
        .await
        .map_err(|e| format!("http: {e}"))?;
    let status = res.status();
    let body = res.text().await.map_err(|e| format!("body: {e}"))?;
    if !status.is_success() {
        return Err(format!("token HTTP {status}: {body}"));
    }
    serde_json::from_str(&body).map_err(|e| format!("json: {e}"))
}

pub async fn load_sf_token(pool: &SqlitePool, tenant_id: i64) -> Result<SalesforceTokenConfig, String> {
    let row = db::fetch_integration(pool, tenant_id, SF_PROVIDER)
        .await
        .map_err(|e| format!("db: {e}"))?
        .ok_or_else(|| "salesforce not connected".to_string())?;
    if row.status != "connected" {
        return Err(format!("status is {}", row.status));
    }
    let enc = row
        .config_encrypted
        .ok_or_else(|| "no encrypted config".to_string())?;
    let json = decrypt_integration_config(&enc)?;
    serde_json::from_str(&json).map_err(|e| format!("parse token json: {e}"))
}

async fn refresh_access_token(
    http: &reqwest::Client,
    sf: &SfEnv,
    refresh_token: &str,
) -> Result<SalesforceTokenConfig, String> {
    let url = format!("{}/services/oauth2/token", sf.login_url);
    let res = http
        .post(&url)
        .form(&[
            ("grant_type", "refresh_token"),
            ("refresh_token", refresh_token),
            ("client_id", sf.client_id.as_str()),
            ("client_secret", sf.client_secret.as_str()),
        ])
        .send()
        .await
        .map_err(|e| format!("http: {e}"))?;
    let status = res.status();
    let body = res.text().await.map_err(|e| format!("body: {e}"))?;
    if !status.is_success() {
        return Err(format!("refresh HTTP {status}: {body}"));
    }
    serde_json::from_str(&body).map_err(|e| format!("json: {e}"))
}

pub async fn sf_get_with_refresh(
    pool: &SqlitePool,
    tenant_id: i64,
    path: &str,
) -> Result<(serde_json::Value, SalesforceTokenConfig), String> {
    let Some(st) = STATE.get() else {
        return Err("state not initialized".into());
    };
    let sf = sf_env().ok_or_else(|| "SF not configured".to_string())?;
    let mut token = load_sf_token(pool, tenant_id).await?;
    let url = format!(
        "{}/services/data/{}{}",
        token.instance_url.trim_end_matches('/'),
        api_version(),
        path
    );
    let mut res = st
        .http
        .get(&url)
        .bearer_auth(&token.access_token)
        .send()
        .await
        .map_err(|e| format!("http: {e}"))?;
    if res.status() == reqwest::StatusCode::UNAUTHORIZED {
        if let Some(rt) = token.refresh_token.clone() {
            token = refresh_access_token(&st.http, &sf, &rt).await?;
            let json = serde_json::to_string(&token).map_err(|e| format!("serialize: {e}"))?;
            let enc = encrypt_integration_config(&json)?;
            db::upsert_integration_config(pool, tenant_id, SF_PROVIDER, "connected", &enc, None)
                .await
                .map_err(|e| format!("db save refresh: {e}"))?;
            res = st
                .http
                .get(&url)
                .bearer_auth(&token.access_token)
                .send()
                .await
                .map_err(|e| format!("http retry: {e}"))?;
        }
    }
    let status = res.status();
    let body = res.text().await.map_err(|e| format!("body: {e}"))?;
    if !status.is_success() {
        return Err(format!("SF API {status}: {body}"));
    }
    let val: serde_json::Value =
        serde_json::from_str(&body).map_err(|e| format!("json: {e}"))?;
    Ok((val, token))
}

pub async fn api_salesforce_test(ctx: &AdminCtx) -> Response {
    let Some(st) = STATE.get() else {
        return json_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "internal_error",
            "state not initialized",
        );
    };
    match sf_get_with_refresh(&st.pool, ctx.tenant_id, "/limits").await {
        Ok((limits, _)) => {
            write_audit(
                &st.pool,
                ctx,
                "integration.test",
                SF_PROVIDER,
                "success",
                None,
                None,
            )
            .await;
            (
                StatusCode::OK,
                axum::Json(serde_json::json!({
                    "status": "ok",
                    "provider": SF_PROVIDER,
                    "limits": limits
                })),
            )
                .into_response()
        }
        Err(e) => {
            let _ = db::set_integration_status(
                &st.pool,
                ctx.tenant_id,
                SF_PROVIDER,
                "error",
                Some(&e),
            )
            .await;
            (
                StatusCode::BAD_GATEWAY,
                axum::Json(serde_json::json!({
                    "error": "salesforce_api_failed",
                    "message": e
                })),
            )
                .into_response()
        }
    }
}

pub async fn api_salesforce_disconnect(ctx: &AdminCtx) -> Response {
    let Some(st) = STATE.get() else {
        return json_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "internal_error",
            "state not initialized",
        );
    };
    match db::clear_integration(&st.pool, ctx.tenant_id, SF_PROVIDER).await {
        Ok(_) => {
            write_audit(
                &st.pool,
                ctx,
                "integration.disconnect",
                SF_PROVIDER,
                "success",
                None,
                None,
            )
            .await;
            (
                StatusCode::OK,
                axum::Json(serde_json::json!({ "status": "disconnected", "provider": SF_PROVIDER })),
            )
                .into_response()
        }
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            axum::Json(serde_json::json!({ "error": format!("{e}") })),
        )
            .into_response(),
    }
}
