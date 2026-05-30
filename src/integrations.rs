//! Salesforce & Zoho Projects OAuth connectors.

use axum::{
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Redirect, Response},
};
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use std::time::{Duration, Instant};

use crate::admin_auth::{write_audit, write_audit_failure, AdminCtx};
use crate::crypto::{decrypt_integration_config, encrypt_integration_config};
use crate::db::{self, IntegrationPublic};
use crate::{json_error, json_error_fields, STATE};
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use sha2::{Digest, Sha256};

const SF_PROVIDER: &str = "salesforce";
const ZOHO_PROVIDER: &str = "zoho_projects";
const OAUTH_STATE_TTL: Duration = Duration::from_secs(600);

#[derive(Clone)]
pub struct OAuthPending {
    pub tenant_id: i64,
    pub actor: String,
    pub role: String,
    pub valid_until: Instant,
    /// PKCE code_verifier (Salesforce External Client App).
    pub pkce_verifier: Option<String>,
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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SalesforceProviderConfig {
    pub client_id: String,
    pub client_secret: String,
    pub redirect_uri: String,
    pub login_url: String,
}

async fn salesforce_provider_config(pool: &SqlitePool, tenant_id: i64) -> Option<SalesforceProviderConfig> {
    if let Ok(Some(row)) = db::fetch_integration_provider_config(pool, tenant_id, SF_PROVIDER).await {
        if let Ok(json) = decrypt_integration_config(&row.config_encrypted) {
            if let Ok(cfg) = serde_json::from_str::<SalesforceProviderConfig>(&json) {
                if !cfg.client_id.trim().is_empty() && !cfg.client_secret.trim().is_empty() {
                    return Some(cfg);
                }
            }
        }
    }
    let env = sf_env()?;
    Some(SalesforceProviderConfig {
        client_id: env.client_id,
        client_secret: env.client_secret,
        redirect_uri: env.redirect_uri,
        login_url: env.login_url,
    })
}

pub struct ZohoEnv {
    pub client_id: String,
    pub client_secret: String,
    pub redirect_uri: String,
    pub accounts_url: String,
    pub scopes: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ZohoProviderConfig {
    pub client_id: String,
    pub client_secret: String,
    pub redirect_uri: String,
    pub accounts_url: String,
    pub scopes: String,
}

fn mask_secret_for_ui(secret: &str) -> String {
    let s = secret.trim();
    if s.len() <= 6 {
        return "***".into();
    }
    let tail = &s[s.len() - 4..];
    format!("***{tail}")
}

async fn zoho_provider_config(pool: &SqlitePool, tenant_id: i64) -> Option<ZohoProviderConfig> {
    if let Ok(Some(row)) = db::fetch_integration_provider_config(pool, tenant_id, ZOHO_PROVIDER).await {
        if let Ok(json) = decrypt_integration_config(&row.config_encrypted) {
            if let Ok(cfg) = serde_json::from_str::<ZohoProviderConfig>(&json) {
                if !cfg.client_id.trim().is_empty() && !cfg.client_secret.trim().is_empty() {
                    return Some(cfg);
                }
            }
        }
    }
    let env = zoho_env()?;
    Some(ZohoProviderConfig {
        client_id: env.client_id,
        client_secret: env.client_secret,
        redirect_uri: env.redirect_uri,
        accounts_url: env.accounts_url,
        scopes: env.scopes,
    })
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ZohoTokenConfig {
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub api_domain: String,
    pub token_type: Option<String>,
    pub expires_in_sec: Option<i64>,
    pub portal_id: Option<String>,
}

/// Zoho Projects REST host (not OAuth `api_domain`, which points at CRM).
fn zoho_projects_api_base(accounts_url: &str) -> String {
    if let Ok(override_url) = std::env::var("ZOHO_PROJECTS_API_URL") {
        let u = override_url.trim().trim_end_matches('/').to_string();
        if !u.is_empty() {
            return u;
        }
    }
    let a = accounts_url.to_ascii_lowercase();
    if a.contains(".zoho.eu") {
        "https://projectsapi.zoho.eu".into()
    } else if a.contains(".zoho.in") {
        "https://projectsapi.zoho.in".into()
    } else if a.contains(".zoho.com.au") {
        "https://projectsapi.zoho.com.au".into()
    } else if a.contains(".zoho.jp") {
        "https://projectsapi.zoho.jp".into()
    } else {
        "https://projectsapi.zoho.com".into()
    }
}

fn compact_zoho_api_error(status: reqwest::StatusCode, body: &str) -> String {
    if body.trim_start().starts_with('<') {
        if let Some(start) = body.find("crmErrorPgErrText2") {
            if let Some(p) = body[start..].find('>') {
                let rest = &body[start + p + 1..];
                if let Some(end) = rest.find("</p>") {
                    let msg = rest[..end]
                        .replace("<span class='crmErrorUrl'>", "")
                        .replace("</span>", "");
                    return format!("Zoho Projects API {status}: {msg}");
                }
            }
        }
        return format!(
            "Zoho Projects API {status}: phản hồi HTML (sai host API — dùng projectsapi.zoho.*, không phải www.zohoapis.com)"
        );
    }
    let trimmed = body.chars().take(400).collect::<String>();
    format!("Zoho Projects API {status}: {trimmed}")
}

pub fn zoho_env() -> Option<ZohoEnv> {
    let client_id = std::env::var("ZOHO_CLIENT_ID").ok()?.trim().to_string();
    let client_secret = std::env::var("ZOHO_CLIENT_SECRET").ok()?.trim().to_string();
    let redirect_uri = std::env::var("ZOHO_REDIRECT_URI")
        .unwrap_or_else(|_| "http://127.0.0.1:3000/api/integrations/zoho/callback".into())
        .trim()
        .to_string();
    let accounts_url = std::env::var("ZOHO_ACCOUNTS_URL")
        .unwrap_or_else(|_| "https://accounts.zoho.com".into())
        .trim()
        .trim_end_matches('/')
        .to_string();
    let scopes = std::env::var("ZOHO_SCOPES")
        .unwrap_or_else(|_| {
            "ZohoProjects.portals.READ,ZohoProjects.projects.ALL,ZohoProjects.tasks.READ".into()
        })
        .trim()
        .to_string();
    if client_id.is_empty() || client_secret.is_empty() {
        return None;
    }
    Some(ZohoEnv {
        client_id,
        client_secret,
        redirect_uri,
        accounts_url,
        scopes,
    })
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
            last_error: Some("Chưa cấu hình — cần ZOHO_CLIENT_ID/SECRET".into()),
            updated_at: String::new(),
            label: "Zoho Projects".into(),
            available: zoho_env().is_some(),
        });
    }
    for r in &mut out {
        if r.provider == SF_PROVIDER {
            r.label = "Salesforce".into();
            r.available = sf_env().is_some();
        } else if r.provider == ZOHO_PROVIDER {
            r.label = "Zoho Projects".into();
            r.available = zoho_env().is_some();
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
            let mut out = list_with_stubs(public);
            let zoho_cfg = db::fetch_integration_provider_config(&st.pool, ctx.tenant_id, ZOHO_PROVIDER)
                .await
                .ok()
                .flatten()
                .is_some();
            let sf_cfg = db::fetch_integration_provider_config(&st.pool, ctx.tenant_id, SF_PROVIDER)
                .await
                .ok()
                .flatten()
                .is_some();
            for r in &mut out {
                if r.provider == ZOHO_PROVIDER {
                    r.available = r.available || zoho_cfg;
                    if !r.available && r.last_error.is_none() {
                        r.last_error = Some("Chưa cấu hình — cần client_id/secret".into());
                    }
                } else if r.provider == SF_PROVIDER {
                    r.available = r.available || sf_cfg;
                    if !r.available && r.last_error.is_none() {
                        r.last_error = Some("Chưa cấu hình — cần client_id/secret".into());
                    }
                }
            }
            axum::Json(out).into_response()
        }
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            axum::Json(serde_json::json!({ "error": format!("{e}") })),
        )
            .into_response(),
    }
}

pub async fn api_salesforce_connect(ctx: &AdminCtx) -> Response {
    let Some(st) = STATE.get() else {
        return json_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "internal_error",
            "state not initialized",
        );
    };
    let Some(sf) = salesforce_provider_config(&st.pool, ctx.tenant_id).await else {
        return json_error(
            StatusCode::SERVICE_UNAVAILABLE,
            "not_configured",
            "Chưa cấu hình Salesforce (client_id/secret). Vào Integrations → Salesforce → Cấu hình.",
        );
    };
    let state = uuid::Uuid::new_v4().to_string();
    let pkce_verifier = generate_pkce_verifier();
    let pkce_challenge = pkce_challenge(&pkce_verifier);
    let pending = OAuthPending {
        tenant_id: ctx.tenant_id,
        actor: ctx.username.clone(),
        role: ctx.role.clone(),
        valid_until: Instant::now() + OAUTH_STATE_TTL,
        pkce_verifier: Some(pkce_verifier),
    };
    store_oauth_pending(&st.pool, &st.oauth_pending, &state, pending, SF_PROVIDER).await;
    let scope = urlencoding::encode("api refresh_token");
    let redirect = urlencoding::encode(&sf.redirect_uri);
    let url = format!(
        "{}/services/oauth2/authorize?response_type=code&client_id={}&redirect_uri={}&scope={}&state={}&code_challenge={}&code_challenge_method=S256",
        sf.login_url, sf.client_id, redirect, scope, state, pkce_challenge
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
    let pending = match resolve_oauth_pending(&st.pool, &st.oauth_pending, &state, SF_PROVIDER).await {
        Some(p) => p,
        None => return redirect_ui_error("invalid_state"),
    };
    if pending.valid_until < Instant::now() {
        return redirect_ui_error("state_expired");
    }
    let Some(sf) = salesforce_provider_config(&st.pool, pending.tenant_id).await else {
        return redirect_ui_error("not_configured");
    };
    let token = match exchange_code(&st.http, &sf, &code, pending.pkce_verifier.as_deref()).await {
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

fn generate_pkce_verifier() -> String {
    use rand::RngCore;
    let mut bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    URL_SAFE_NO_PAD.encode(bytes)
}

fn pkce_challenge(verifier: &str) -> String {
    let hash = Sha256::digest(verifier.as_bytes());
    URL_SAFE_NO_PAD.encode(hash)
}

async fn store_oauth_pending(
    pool: &SqlitePool,
    memory: &std::sync::Arc<dashmap::DashMap<String, OAuthPending>>,
    state: &str,
    pending: OAuthPending,
    provider: &str,
) {
    memory.insert(state.to_string(), pending.clone());
    let ttl = OAUTH_STATE_TTL.as_secs() as i64;
    if let Err(e) = db::insert_oauth_pending(
        pool,
        state,
        pending.tenant_id,
        provider,
        &pending.actor,
        &pending.role,
        pending.pkce_verifier.as_deref(),
        ttl,
    )
    .await
    {
        tracing::warn!(error = %e, provider, "persist oauth pending failed");
    }
}

async fn resolve_oauth_pending(
    pool: &SqlitePool,
    memory: &std::sync::Arc<dashmap::DashMap<String, OAuthPending>>,
    state: &str,
    provider: &str,
) -> Option<OAuthPending> {
    if let Some((_, p)) = memory.remove(state) {
        let _ = db::delete_oauth_pending(pool, state, provider).await;
        return Some(p);
    }
    db::take_oauth_pending(pool, state, provider)
        .await
        .ok()
        .flatten()
        .map(|r| OAuthPending {
            tenant_id: r.tenant_id,
            actor: r.actor,
            role: r.role,
            valid_until: Instant::now() + OAUTH_STATE_TTL,
            pkce_verifier: r.pkce_verifier,
        })
}

async fn exchange_code(
    http: &reqwest::Client,
    sf: &SalesforceProviderConfig,
    code: &str,
    pkce_verifier: Option<&str>,
) -> Result<SalesforceTokenConfig, String> {
    let url = format!("{}/services/oauth2/token", sf.login_url);
    let mut form = vec![
        ("grant_type", "authorization_code".to_string()),
        ("code", code.to_string()),
        ("client_id", sf.client_id.clone()),
        ("client_secret", sf.client_secret.clone()),
        ("redirect_uri", sf.redirect_uri.clone()),
    ];
    if let Some(v) = pkce_verifier.filter(|s| !s.is_empty()) {
        form.push(("code_verifier", v.to_string()));
    }
    let refs: Vec<(&str, &str)> = form.iter().map(|(k, v)| (*k, v.as_str())).collect();
    let res = http
        .post(&url)
        .form(&refs)
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
    if row.status != "connected" && row.status != "error" {
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
    sf: &SalesforceProviderConfig,
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
    let sf = salesforce_provider_config(pool, tenant_id)
        .await
        .ok_or_else(|| "SF not configured".to_string())?;
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

fn integration_suffix_safe(path: &str) -> Result<String, String> {
    let p = path.trim();
    if p.is_empty() {
        return Ok("/".into());
    }
    if p.contains("..") {
        return Err("invalid path".into());
    }
    if p.starts_with('/') {
        Ok(p.to_string())
    } else {
        Ok(format!("/{p}"))
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IntegrationProxyProvider {
    Salesforce,
    Zoho,
}

pub struct IntegrationProxyTarget {
    pub provider: IntegrationProxyProvider,
    pub api_path: String,
}

/// Data-plane paths `{prefix}/sf/...` and `{prefix}/zoho/...` proxy to connected OAuth APIs.
pub fn parse_integration_proxy_path(
    data_plane_prefix: &str,
    path: &str,
) -> Option<IntegrationProxyTarget> {
    let prefix = data_plane_prefix.trim_end_matches('/');
    if prefix.is_empty() {
        return None;
    }
    let sf_base = format!("{prefix}/sf");
    let zoho_base = format!("{prefix}/zoho");
    let (provider, rest) = if path == sf_base || path.starts_with(&format!("{sf_base}/")) {
        (
            IntegrationProxyProvider::Salesforce,
            path.strip_prefix(&sf_base).unwrap_or(""),
        )
    } else if path == zoho_base || path.starts_with(&format!("{zoho_base}/")) {
        (
            IntegrationProxyProvider::Zoho,
            path.strip_prefix(&zoho_base).unwrap_or(""),
        )
    } else {
        return None;
    };
    let api_path = integration_suffix_safe(rest).ok()?;
    Some(IntegrationProxyTarget {
        provider,
        api_path,
    })
}

async fn ensure_integration_connected(
    pool: &SqlitePool,
    tenant_id: i64,
    provider: &str,
) -> Result<(), String> {
    let row = db::fetch_integration(pool, tenant_id, provider)
        .await
        .map_err(|e| format!("db: {e}"))?
        .ok_or_else(|| format!("{provider} not configured"))?;
    if row.status != "connected" {
        return Err(format!("{provider} not connected (status={})", row.status));
    }
    Ok(())
}

pub async fn sf_request_raw_with_refresh(
    pool: &SqlitePool,
    tenant_id: i64,
    method: &str,
    path: &str,
    query: Option<&str>,
    body: Option<&[u8]>,
    content_type: Option<&str>,
) -> Result<(reqwest::StatusCode, Vec<u8>, Option<String>), String> {
    ensure_integration_connected(pool, tenant_id, SF_PROVIDER).await?;
    let Some(st) = STATE.get() else {
        return Err("state not initialized".into());
    };
    let sf = salesforce_provider_config(pool, tenant_id)
        .await
        .ok_or_else(|| "SF not configured".to_string())?;
    let mut token = load_sf_token(pool, tenant_id).await?;
    let suffix = integration_suffix_safe(path)?;
    let mut url = format!(
        "{}/services/data/{}{}",
        token.instance_url.trim_end_matches('/'),
        api_version(),
        suffix
    );
    if let Some(q) = query.filter(|s| !s.is_empty()) {
        url.push('?');
        url.push_str(q);
    }
    let req_method = reqwest::Method::from_bytes(method.as_bytes())
        .map_err(|_| format!("unsupported method {method}"))?;
    let mut req = st.http.request(req_method, &url).bearer_auth(&token.access_token);
    if let Some(ct) = content_type {
        req = req.header(axum::http::header::CONTENT_TYPE, ct);
    }
    if let Some(b) = body.filter(|b| !b.is_empty()) {
        req = req.body(b.to_vec());
    }
    let mut res = req.send().await.map_err(|e| format!("http: {e}"))?;
    if res.status() == reqwest::StatusCode::UNAUTHORIZED {
        if let Some(rt) = token.refresh_token.clone() {
            token = refresh_access_token(&st.http, &sf, &rt).await?;
            let json = serde_json::to_string(&token).map_err(|e| format!("serialize: {e}"))?;
            let enc = encrypt_integration_config(&json)?;
            db::upsert_integration_config(pool, tenant_id, SF_PROVIDER, "connected", &enc, None)
                .await
                .map_err(|e| format!("db save refresh: {e}"))?;
            let mut req2 = st
                .http
                .request(reqwest::Method::from_bytes(method.as_bytes()).unwrap(), &url)
                .bearer_auth(&token.access_token);
            if let Some(ct) = content_type {
                req2 = req2.header(axum::http::header::CONTENT_TYPE, ct);
            }
            if let Some(b) = body.filter(|b| !b.is_empty()) {
                req2 = req2.body(b.to_vec());
            }
            res = req2.send().await.map_err(|e| format!("http retry: {e}"))?;
        }
    }
    let status = res.status();
    let ct = res
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());
    let bytes = res.bytes().await.map_err(|e| format!("body: {e}"))?;
    Ok((status, bytes.to_vec(), ct))
}

pub async fn zoho_request_raw_with_refresh(
    pool: &SqlitePool,
    tenant_id: i64,
    method: &str,
    path: &str,
    query: Option<&str>,
    body: Option<&[u8]>,
    content_type: Option<&str>,
) -> Result<(reqwest::StatusCode, Vec<u8>, Option<String>), String> {
    ensure_integration_connected(pool, tenant_id, ZOHO_PROVIDER).await?;
    let Some(st) = STATE.get() else {
        return Err("state not initialized".into());
    };
    let zoho = zoho_provider_config(pool, tenant_id)
        .await
        .ok_or_else(|| "Zoho not configured".to_string())?;
    let mut token = load_zoho_token(pool, tenant_id).await?;
    let suffix = integration_suffix_safe(path)?;
    let base = zoho_projects_api_base(&zoho.accounts_url);
    let mut url = format!("{base}{suffix}");
    if let Some(q) = query.filter(|s| !s.is_empty()) {
        url.push('?');
        url.push_str(q);
    }
    let req_method = reqwest::Method::from_bytes(method.as_bytes())
        .map_err(|_| format!("unsupported method {method}"))?;
    let auth = format!("Zoho-oauthtoken {}", token.access_token);
    let mut req = st.http.request(req_method, &url).header("Authorization", auth.clone());
    if let Some(ct) = content_type {
        req = req.header(axum::http::header::CONTENT_TYPE, ct);
    }
    if let Some(b) = body.filter(|b| !b.is_empty()) {
        req = req.body(b.to_vec());
    }
    let mut res = req.send().await.map_err(|e| format!("http: {e}"))?;
    if res.status() == reqwest::StatusCode::UNAUTHORIZED {
        if let Some(rt) = token.refresh_token.clone() {
            let portal_id = token.portal_id.clone();
            token = refresh_zoho_access_token(&st.http, &zoho, &rt).await?;
            token.portal_id = portal_id;
            let json = serde_json::to_string(&token).map_err(|e| format!("serialize: {e}"))?;
            let enc = encrypt_integration_config(&json)?;
            db::upsert_integration_config(pool, tenant_id, ZOHO_PROVIDER, "connected", &enc, None)
                .await
                .map_err(|e| format!("db save refresh: {e}"))?;
            let mut req2 = st
                .http
                .request(reqwest::Method::from_bytes(method.as_bytes()).unwrap(), &url)
                .header(
                    "Authorization",
                    format!("Zoho-oauthtoken {}", token.access_token),
                );
            if let Some(ct) = content_type {
                req2 = req2.header(axum::http::header::CONTENT_TYPE, ct);
            }
            if let Some(b) = body.filter(|b| !b.is_empty()) {
                req2 = req2.body(b.to_vec());
            }
            res = req2.send().await.map_err(|e| format!("http retry: {e}"))?;
        }
    }
    let status = res.status();
    let ct = res
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());
    let bytes = res.bytes().await.map_err(|e| format!("body: {e}"))?;
    Ok((status, bytes.to_vec(), ct))
}

fn integration_proxy_http_response(
    status: reqwest::StatusCode,
    body: Vec<u8>,
    content_type: Option<String>,
) -> Response {
    let axum_status =
        StatusCode::from_u16(status.as_u16()).unwrap_or(StatusCode::BAD_GATEWAY);
    let mut builder = axum::http::Response::builder().status(axum_status);
    if let Some(ct) = content_type {
        builder = builder.header(axum::http::header::CONTENT_TYPE, ct);
    } else if body.first() == Some(&b'{') || body.first() == Some(&b'[') {
        builder = builder.header(axum::http::header::CONTENT_TYPE, "application/json");
    }
    builder
        .body(axum::body::Body::from(body))
        .unwrap_or_else(|_| {
            json_error(
                StatusCode::INTERNAL_SERVER_ERROR,
                "internal_error",
                "failed to build proxy response",
            )
        })
}

pub async fn integration_data_plane_proxy(
    tenant_id: i64,
    method: &str,
    path: &str,
    query: Option<&str>,
    body: &[u8],
    content_type: Option<&str>,
    data_plane_prefix: &str,
) -> Response {
    let Some(target) = parse_integration_proxy_path(data_plane_prefix, path) else {
        return json_error(
            StatusCode::NOT_FOUND,
            "not_found",
            "Unknown integration proxy path",
        );
    };
    let Some(st) = STATE.get() else {
        return json_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "internal_error",
            "state not initialized",
        );
    };
    let body_opt = if body.is_empty() { None } else { Some(body) };
    let result = match target.provider {
        IntegrationProxyProvider::Salesforce => {
            sf_request_raw_with_refresh(
                &st.pool,
                tenant_id,
                method,
                &target.api_path,
                query,
                body_opt,
                content_type,
            )
            .await
        }
        IntegrationProxyProvider::Zoho => {
            zoho_request_raw_with_refresh(
                &st.pool,
                tenant_id,
                method,
                &target.api_path,
                query,
                body_opt,
                content_type,
            )
            .await
        }
    };
    match result {
        Ok((status, bytes, ct)) => integration_proxy_http_response(status, bytes, ct),
        Err(e) => json_error(
            StatusCode::BAD_GATEWAY,
            "integration_proxy_failed",
            &e,
        ),
    }
}

const SNAPSHOT_RETAIN: i64 = 30;

fn sf_field_str(v: &serde_json::Value, key: &str) -> String {
    v.get(key)
        .and_then(|x| x.as_str())
        .unwrap_or("")
        .to_string()
}

fn map_sf_opportunities(records: &[serde_json::Value]) -> Vec<serde_json::Value> {
    records
        .iter()
        .map(|r| {
            serde_json::json!({
                "id": sf_field_str(r, "Id"),
                "name": sf_field_str(r, "Name"),
                "stage": sf_field_str(r, "StageName"),
                "amount": r.get("Amount").cloned().unwrap_or(serde_json::Value::Null),
                "close_date": sf_field_str(r, "CloseDate"),
            })
        })
        .collect()
}

fn map_sf_accounts(records: &[serde_json::Value]) -> Vec<serde_json::Value> {
    records
        .iter()
        .map(|r| {
            serde_json::json!({
                "id": sf_field_str(r, "Id"),
                "name": sf_field_str(r, "Name"),
                "industry": sf_field_str(r, "Industry"),
            })
        })
        .collect()
}

fn zoho_id_str(v: &serde_json::Value) -> String {
    v.get("id_string")
        .or_else(|| v.get("id"))
        .or_else(|| v.get("project_id"))
        .map(|x| {
            x.as_str()
                .map(|s| s.to_string())
                .unwrap_or_else(|| x.as_i64().unwrap_or(0).to_string())
        })
        .unwrap_or_default()
}

fn extract_zoho_array(val: &serde_json::Value, keys: &[&str]) -> Vec<serde_json::Value> {
    if let Some(arr) = val.as_array() {
        return arr.clone();
    }
    for k in keys {
        if let Some(arr) = val.get(*k).and_then(|v| v.as_array()) {
            return arr.clone();
        }
    }
    vec![]
}

fn map_zoho_projects(items: &[serde_json::Value]) -> Vec<serde_json::Value> {
    items
        .iter()
        .map(|p| {
            serde_json::json!({
                "id": zoho_id_str(p),
                "name": p.get("name").and_then(|v| v.as_str()).unwrap_or(""),
                "status": p.get("status").or_else(|| p.get("project_status")).and_then(|v| v.as_str()).unwrap_or(""),
                "owner": p.get("owner_name").and_then(|v| v.as_str()).unwrap_or(""),
            })
        })
        .collect()
}

fn map_zoho_tasks(items: &[serde_json::Value], project_id: &str) -> Vec<serde_json::Value> {
    items
        .iter()
        .map(|t| {
            serde_json::json!({
                "id": zoho_id_str(t),
                "name": t.get("name").and_then(|v| v.as_str()).unwrap_or(""),
                "status": t.get("status").and_then(|v| v.as_str()).unwrap_or(""),
                "due_date": t.get("end_date").or_else(|| t.get("due_date")).and_then(|v| v.as_str()).unwrap_or(""),
                "project_id": project_id,
            })
        })
        .collect()
}

async fn save_snapshot(
    pool: &SqlitePool,
    tenant_id: i64,
    provider: &str,
    entity_type: &str,
    rows: &[serde_json::Value],
) -> Result<i64, String> {
    let payload = serde_json::to_string(rows).map_err(|e| format!("serialize: {e}"))?;
    let count = rows.len() as i64;
    db::insert_integration_snapshot(pool, tenant_id, provider, entity_type, &payload, count)
        .await
        .map_err(|e| format!("db insert snapshot: {e}"))?;
    db::prune_integration_snapshots(pool, tenant_id, provider, entity_type, SNAPSHOT_RETAIN)
        .await
        .map_err(|e| format!("db prune snapshot: {e}"))?;
    Ok(count)
}

pub async fn sync_salesforce_snapshots(pool: &SqlitePool, tenant_id: i64) -> Result<serde_json::Value, String> {
    ensure_integration_connected(pool, tenant_id, SF_PROVIDER).await?;
    let opp_q = urlencoding::encode(
        "SELECT Id,Name,StageName,Amount,CloseDate FROM Opportunity LIMIT 200",
    );
    let (opp_raw, _) = sf_get_with_refresh(pool, tenant_id, &format!("/query?q={opp_q}")).await?;
    let opp_records = opp_raw
        .get("records")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    let opp_mapped = map_sf_opportunities(&opp_records);
    let opp_count = save_snapshot(pool, tenant_id, SF_PROVIDER, "opportunity", &opp_mapped).await?;

    let acc_q = urlencoding::encode("SELECT Id,Name,Industry FROM Account LIMIT 200");
    let (acc_raw, _) = sf_get_with_refresh(pool, tenant_id, &format!("/query?q={acc_q}")).await?;
    let acc_records = acc_raw
        .get("records")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    let acc_mapped = map_sf_accounts(&acc_records);
    let acc_count = save_snapshot(pool, tenant_id, SF_PROVIDER, "account", &acc_mapped).await?;

    db::touch_integration_last_sync(pool, tenant_id, SF_PROVIDER)
        .await
        .map_err(|e| format!("db touch sync: {e}"))?;
    let _ = db::set_integration_status(pool, tenant_id, SF_PROVIDER, "connected", None).await;

    Ok(serde_json::json!({
        "provider": SF_PROVIDER,
        "opportunity": opp_count,
        "account": acc_count,
    }))
}

pub async fn sync_zoho_snapshots(pool: &SqlitePool, tenant_id: i64) -> Result<serde_json::Value, String> {
    ensure_integration_connected(pool, tenant_id, ZOHO_PROVIDER).await?;
    let token = load_zoho_token(pool, tenant_id).await?;
    let portal_id = token
        .portal_id
        .clone()
        .ok_or_else(|| "missing portal_id — run Test portals first".to_string())?;

    let (projects_raw, _) =
        zoho_get_with_refresh(pool, tenant_id, &format!("/api/v3/portal/{portal_id}/projects")).await?;
    let project_items = extract_zoho_array(&projects_raw, &["projects"]);
    let projects_mapped = map_zoho_projects(&project_items);
    let project_count =
        save_snapshot(pool, tenant_id, ZOHO_PROVIDER, "project", &projects_mapped).await?;

    let mut task_count = 0_i64;
    if let Some(first) = project_items.first() {
        let project_id = zoho_id_str(first);
        if !project_id.is_empty() {
            let (tasks_raw, _) = zoho_get_with_refresh(
                pool,
                tenant_id,
                &format!("/api/v3/portal/{portal_id}/projects/{project_id}/tasks"),
            )
            .await?;
            let task_items = extract_zoho_array(&tasks_raw, &["tasks"]);
            let tasks_mapped = map_zoho_tasks(&task_items, &project_id);
            task_count = save_snapshot(pool, tenant_id, ZOHO_PROVIDER, "task", &tasks_mapped).await?;
        }
    }

    db::touch_integration_last_sync(pool, tenant_id, ZOHO_PROVIDER)
        .await
        .map_err(|e| format!("db touch sync: {e}"))?;
    let _ = db::set_integration_status(pool, tenant_id, ZOHO_PROVIDER, "connected", None).await;

    Ok(serde_json::json!({
        "provider": ZOHO_PROVIDER,
        "portal_id": portal_id,
        "project": project_count,
        "task": task_count,
    }))
}

pub async fn api_salesforce_sync(ctx: &AdminCtx) -> Response {
    let Some(st) = STATE.get() else {
        return json_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "internal_error",
            "state not initialized",
        );
    };
    match sync_salesforce_snapshots(&st.pool, ctx.tenant_id).await {
        Ok(summary) => {
            write_audit(
                &st.pool,
                ctx,
                "integration.sync",
                SF_PROVIDER,
                "success",
                None,
                Some("snapshot"),
            )
            .await;
            (
                StatusCode::OK,
                axum::Json(serde_json::json!({ "status": "ok", "summary": summary })),
            )
                .into_response()
        }
        Err(e) => {
            write_audit_failure(
                &st.pool,
                ctx,
                "integration.sync",
                SF_PROVIDER,
                None,
                Some(&e),
            )
            .await;
            (
                StatusCode::BAD_GATEWAY,
                axum::Json(serde_json::json!({ "error": "sync_failed", "message": e })),
            )
                .into_response()
        }
    }
}

pub async fn api_zoho_sync(ctx: &AdminCtx) -> Response {
    let Some(st) = STATE.get() else {
        return json_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "internal_error",
            "state not initialized",
        );
    };
    match sync_zoho_snapshots(&st.pool, ctx.tenant_id).await {
        Ok(summary) => {
            write_audit(
                &st.pool,
                ctx,
                "integration.sync",
                ZOHO_PROVIDER,
                "success",
                None,
                Some("snapshot"),
            )
            .await;
            (
                StatusCode::OK,
                axum::Json(serde_json::json!({ "status": "ok", "summary": summary })),
            )
                .into_response()
        }
        Err(e) => {
            write_audit_failure(
                &st.pool,
                ctx,
                "integration.sync",
                ZOHO_PROVIDER,
                None,
                Some(&e),
            )
            .await;
            (
                StatusCode::BAD_GATEWAY,
                axum::Json(serde_json::json!({ "error": "sync_failed", "message": e })),
            )
                .into_response()
        }
    }
}

#[derive(Debug, Deserialize)]
pub struct SnapshotsQuery {
    pub provider: Option<String>,
}

pub async fn api_list_snapshots(ctx: &AdminCtx, query: SnapshotsQuery) -> Response {
    let Some(st) = STATE.get() else {
        return json_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "internal_error",
            "state not initialized",
        );
    };
    let provider = query.provider.as_deref().map(|s| s.trim()).filter(|s| !s.is_empty());
    match db::list_integration_snapshot_summaries(&st.pool, ctx.tenant_id, provider).await {
        Ok(rows) => (StatusCode::OK, axum::Json(rows)).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            axum::Json(serde_json::json!({ "error": format!("{e}") })),
        )
            .into_response(),
    }
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
            write_audit_failure(
                &st.pool,
                ctx,
                "integration.test",
                SF_PROVIDER,
                None,
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

pub async fn api_zoho_connect(ctx: &AdminCtx) -> Response {
    let Some(st) = STATE.get() else {
        return json_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "internal_error",
            "state not initialized",
        );
    };
    let Some(zoho) = zoho_provider_config(&st.pool, ctx.tenant_id).await else {
        return json_error(
            StatusCode::SERVICE_UNAVAILABLE,
            "not_configured",
            "Chưa cấu hình Zoho (client_id/secret). Vào Integrations → Zoho → Cấu hình.",
        );
    };
    let state = uuid::Uuid::new_v4().to_string();
    let pending = OAuthPending {
        tenant_id: ctx.tenant_id,
        actor: ctx.username.clone(),
        role: ctx.role.clone(),
        valid_until: Instant::now() + OAUTH_STATE_TTL,
        pkce_verifier: None,
    };
    store_oauth_pending(&st.pool, &st.oauth_pending, &state, pending, ZOHO_PROVIDER).await;
    let scope = urlencoding::encode(&zoho.scopes);
    let redirect = urlencoding::encode(&zoho.redirect_uri);
    let url = format!(
        "{}/oauth/v2/auth?scope={}&client_id={}&response_type=code&access_type=offline&redirect_uri={}&state={}",
        zoho.accounts_url, scope, zoho.client_id, redirect, state
    );
    if let Err(e) = db::set_integration_status(
        &st.pool,
        ctx.tenant_id,
        ZOHO_PROVIDER,
        "pending",
        None,
    )
    .await
    {
        tracing::warn!(error = %e, "set zoho integration pending failed");
    }
    Redirect::temporary(&url).into_response()
}

pub async fn api_zoho_callback(
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
    let pending = match resolve_oauth_pending(&st.pool, &st.oauth_pending, &state, ZOHO_PROVIDER).await {
        Some(p) => p,
        None => return redirect_ui_error("invalid_state"),
    };
    if pending.valid_until < Instant::now() {
        return redirect_ui_error("state_expired");
    }
    let Some(zoho) = zoho_provider_config(&st.pool, pending.tenant_id).await else {
        return redirect_ui_error("not_configured");
    };
    let token = match exchange_zoho_code(&st.http, &zoho, &code).await {
        Ok(t) => t,
        Err(e) => {
            let _ = db::set_integration_status(
                &st.pool,
                pending.tenant_id,
                ZOHO_PROVIDER,
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
            tracing::error!(error = %e, "encrypt zoho token");
            return redirect_ui_error("encrypt_failed");
        }
    };
    if let Err(e) = db::upsert_integration_config(
        &st.pool,
        pending.tenant_id,
        ZOHO_PROVIDER,
        "connected",
        &enc,
        None,
    )
    .await
    {
        tracing::error!(error = %e, "save zoho integration");
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
        ZOHO_PROVIDER,
        "success",
        crate::admin_auth::client_ip(&headers).as_deref(),
        Some(token.api_domain.as_str()),
    )
    .await;
    let base = ui_redirect_base();
    Redirect::temporary(&format!("{base}?ok=zoho")).into_response()
}

async fn exchange_zoho_code(
    http: &reqwest::Client,
    zoho: &ZohoProviderConfig,
    code: &str,
) -> Result<ZohoTokenConfig, String> {
    let url = format!("{}/oauth/v2/token", zoho.accounts_url);
    let res = http
        .post(&url)
        .form(&[
            ("grant_type", "authorization_code"),
            ("code", code),
            ("client_id", zoho.client_id.as_str()),
            ("client_secret", zoho.client_secret.as_str()),
            ("redirect_uri", zoho.redirect_uri.as_str()),
        ])
        .send()
        .await
        .map_err(|e| format!("http: {e}"))?;
    let status = res.status();
    let body = res.text().await.map_err(|e| format!("body: {e}"))?;
    if !status.is_success() {
        return Err(format!("token HTTP {status}: {body}"));
    }
    let raw: serde_json::Value =
        serde_json::from_str(&body).map_err(|e| format!("json: {e}"))?;
    let access_token = raw
        .get("access_token")
        .and_then(|v| v.as_str())
        .ok_or_else(|| format!("missing access_token: {body}"))?
        .to_string();
    let api_domain = raw
        .get("api_domain")
        .and_then(|v| v.as_str())
        .unwrap_or("https://www.zohoapis.com")
        .trim_end_matches('/')
        .to_string();
    Ok(ZohoTokenConfig {
        access_token,
        refresh_token: raw
            .get("refresh_token")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        api_domain,
        token_type: raw
            .get("token_type")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        expires_in_sec: raw.get("expires_in").and_then(|v| v.as_i64()),
        portal_id: None,
    })
}

pub async fn load_zoho_token(pool: &SqlitePool, tenant_id: i64) -> Result<ZohoTokenConfig, String> {
    let row = db::fetch_integration(pool, tenant_id, ZOHO_PROVIDER)
        .await
        .map_err(|e| format!("db: {e}"))?
        .ok_or_else(|| "zoho not connected".to_string())?;
    if row.status != "connected" && row.status != "error" {
        return Err(format!("status is {}", row.status));
    }
    let enc = row
        .config_encrypted
        .ok_or_else(|| "no encrypted config".to_string())?;
    let json = decrypt_integration_config(&enc)?;
    serde_json::from_str(&json).map_err(|e| format!("parse token json: {e}"))
}

async fn refresh_zoho_access_token(
    http: &reqwest::Client,
    zoho: &ZohoProviderConfig,
    refresh_token: &str,
) -> Result<ZohoTokenConfig, String> {
    let url = format!("{}/oauth/v2/token", zoho.accounts_url);
    let res = http
        .post(&url)
        .form(&[
            ("grant_type", "refresh_token"),
            ("refresh_token", refresh_token),
            ("client_id", zoho.client_id.as_str()),
            ("client_secret", zoho.client_secret.as_str()),
        ])
        .send()
        .await
        .map_err(|e| format!("http: {e}"))?;
    let status = res.status();
    let body = res.text().await.map_err(|e| format!("body: {e}"))?;
    if !status.is_success() {
        return Err(format!("refresh HTTP {status}: {body}"));
    }
    let raw: serde_json::Value =
        serde_json::from_str(&body).map_err(|e| format!("json: {e}"))?;
    let access_token = raw
        .get("access_token")
        .and_then(|v| v.as_str())
        .ok_or_else(|| format!("missing access_token: {body}"))?
        .to_string();
    let api_domain = raw
        .get("api_domain")
        .and_then(|v| v.as_str())
        .unwrap_or("https://www.zohoapis.com")
        .trim_end_matches('/')
        .to_string();
    Ok(ZohoTokenConfig {
        access_token,
        refresh_token: Some(refresh_token.to_string()),
        api_domain,
        token_type: raw
            .get("token_type")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        expires_in_sec: raw.get("expires_in").and_then(|v| v.as_i64()),
        portal_id: None,
    })
}

pub async fn zoho_get_with_refresh(
    pool: &SqlitePool,
    tenant_id: i64,
    path: &str,
) -> Result<(serde_json::Value, ZohoTokenConfig), String> {
    let Some(st) = STATE.get() else {
        return Err("state not initialized".into());
    };
    let zoho = zoho_provider_config(pool, tenant_id)
        .await
        .ok_or_else(|| "Zoho not configured".to_string())?;
    let mut token = load_zoho_token(pool, tenant_id).await?;
    let base = zoho_projects_api_base(&zoho.accounts_url);
    let url = format!("{base}{}", path);
    let auth = format!("Zoho-oauthtoken {}", token.access_token);
    let mut res = st
        .http
        .get(&url)
        .header("Authorization", auth.clone())
        .send()
        .await
        .map_err(|e| format!("http: {e}"))?;
    if res.status() == reqwest::StatusCode::UNAUTHORIZED {
        if let Some(rt) = token.refresh_token.clone() {
            let portal_id = token.portal_id.clone();
            token = refresh_zoho_access_token(&st.http, &zoho, &rt).await?;
            token.portal_id = portal_id;
            let json = serde_json::to_string(&token).map_err(|e| format!("serialize: {e}"))?;
            let enc = encrypt_integration_config(&json)?;
            db::upsert_integration_config(pool, tenant_id, ZOHO_PROVIDER, "connected", &enc, None)
                .await
                .map_err(|e| format!("db save refresh: {e}"))?;
            res = st
                .http
                .get(&url)
                .header("Authorization", format!("Zoho-oauthtoken {}", token.access_token))
                .send()
                .await
                .map_err(|e| format!("http retry: {e}"))?;
        }
    }
    let status = res.status();
    let body = res.text().await.map_err(|e| format!("body: {e}"))?;
    if !status.is_success() {
        return Err(compact_zoho_api_error(status, &body));
    }
    let val: serde_json::Value =
        serde_json::from_str(&body).map_err(|e| format!("json: {e}"))?;
    Ok((val, token))
}

pub async fn api_zoho_test(ctx: &AdminCtx) -> Response {
    let Some(st) = STATE.get() else {
        return json_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "internal_error",
            "state not initialized",
        );
    };
    match zoho_get_with_refresh(&st.pool, ctx.tenant_id, "/api/v3/portals").await {
        Ok((portals, mut token)) => {
            if token.portal_id.is_none() {
                let list = portals
                    .as_array()
                    .cloned()
                    .or_else(|| {
                        portals
                            .get("portals")
                            .and_then(|v| v.as_array())
                            .cloned()
                    });
                if let Some(first) = list.and_then(|a| a.into_iter().next()) {
                    let id = first
                        .get("id")
                        .or_else(|| first.get("id_string"))
                        .or_else(|| first.get("portal_id"))
                        .and_then(|v| {
                            v.as_str()
                                .map(|s| s.to_string())
                                .or_else(|| v.as_i64().map(|n| n.to_string()))
                        });
                    if let Some(portal_id) = id {
                        token.portal_id = Some(portal_id);
                        if let Ok(json) = serde_json::to_string(&token) {
                            if let Ok(enc) = encrypt_integration_config(&json) {
                                let _ = db::upsert_integration_config(
                                    &st.pool,
                                    ctx.tenant_id,
                                    ZOHO_PROVIDER,
                                    "connected",
                                    &enc,
                                    None,
                                )
                                .await;
                            }
                        }
                    }
                }
            }
            let _ = db::set_integration_status(
                &st.pool,
                ctx.tenant_id,
                ZOHO_PROVIDER,
                "connected",
                None,
            )
            .await;
            write_audit(
                &st.pool,
                ctx,
                "integration.test",
                ZOHO_PROVIDER,
                "success",
                None,
                token.portal_id.as_deref(),
            )
            .await;
            (
                StatusCode::OK,
                axum::Json(serde_json::json!({
                    "status": "ok",
                    "provider": ZOHO_PROVIDER,
                    "portals": portals,
                    "portal_id": token.portal_id
                })),
            )
                .into_response()
        }
        Err(e) => {
            let hint = if e.contains("INVALID_OAUTHSCOPE") {
                "Thiếu scope OAuth. Bật ZohoProjects.portals.READ + ZohoProjects.projects.ALL + ZohoProjects.tasks.READ, cập nhật scopes trong UI (Zoho config) hoặc env, rồi Ngắt kết nối → Kết nối lại."
            } else {
                ""
            };
            let msg = if hint.is_empty() {
                e.clone()
            } else {
                format!("{e} — {hint}")
            };
            let _ = db::set_integration_status(
                &st.pool,
                ctx.tenant_id,
                ZOHO_PROVIDER,
                "error",
                Some(&msg),
            )
            .await;
            write_audit_failure(
                &st.pool,
                ctx,
                "integration.test",
                ZOHO_PROVIDER,
                None,
                Some(&msg),
            )
            .await;
            (
                StatusCode::BAD_GATEWAY,
                axum::Json(serde_json::json!({
                    "error": "zoho_api_failed",
                    "message": msg,
                    "hint": hint
                })),
            )
                .into_response()
        }
    }
}

fn zoho_require_portal_id(token: &ZohoTokenConfig) -> Result<&str, Response> {
    token.portal_id.as_deref().ok_or_else(|| {
        json_error(
            StatusCode::BAD_REQUEST,
            "missing_portal_id",
            "Chưa có portal_id. Bấm Test portals API trước để gateway tự chọn portal mặc định.",
        )
    })
}

pub async fn api_zoho_projects(ctx: &AdminCtx) -> Response {
    let Some(st) = STATE.get() else {
        return json_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "internal_error",
            "state not initialized",
        );
    };
    let token = match load_zoho_token(&st.pool, ctx.tenant_id).await {
        Ok(t) => t,
        Err(e) => {
            return json_error(StatusCode::BAD_REQUEST, "not_connected", &format!("{e}"));
        }
    };
    let portal_id = match zoho_require_portal_id(&token) {
        Ok(p) => p,
        Err(r) => return r,
    };
    let path = format!("/api/v3/portal/{portal_id}/projects");
    match zoho_get_with_refresh(&st.pool, ctx.tenant_id, &path).await {
        Ok((projects, _)) => (
            StatusCode::OK,
            axum::Json(serde_json::json!({
                "status": "ok",
                "provider": ZOHO_PROVIDER,
                "portal_id": portal_id,
                "projects": projects
            })),
        )
            .into_response(),
        Err(e) => (
            StatusCode::BAD_GATEWAY,
            axum::Json(serde_json::json!({ "error": "zoho_api_failed", "message": e })),
        )
            .into_response(),
    }
}

#[derive(Debug, Serialize)]
pub struct ZohoProviderConfigPublic {
    pub client_id: String,
    pub redirect_uri: String,
    pub accounts_url: String,
    pub scopes: String,
    pub has_secret: bool,
    pub secret_masked: Option<String>,
    pub updated_by: Option<String>,
    pub updated_at: Option<String>,
}

pub async fn api_zoho_config_get(ctx: &AdminCtx) -> Response {
    let Some(st) = STATE.get() else {
        return json_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "internal_error",
            "state not initialized",
        );
    };
    let row = db::fetch_integration_provider_config(&st.pool, ctx.tenant_id, ZOHO_PROVIDER)
        .await
        .ok()
        .flatten();
    if let Some(r) = row {
        if let Ok(json) = decrypt_integration_config(&r.config_encrypted) {
            if let Ok(cfg) = serde_json::from_str::<ZohoProviderConfig>(&json) {
                let masked = mask_secret_for_ui(&cfg.client_secret);
                return (
                    StatusCode::OK,
                    axum::Json(ZohoProviderConfigPublic {
                        client_id: cfg.client_id,
                        redirect_uri: cfg.redirect_uri,
                        accounts_url: cfg.accounts_url,
                        scopes: cfg.scopes,
                        has_secret: !cfg.client_secret.trim().is_empty(),
                        secret_masked: Some(masked),
                        updated_by: Some(r.updated_by),
                        updated_at: Some(r.updated_at),
                    }),
                )
                    .into_response();
            }
        }
    }
    // fallback env (masked)
    if let Some(env) = zoho_env() {
        return (
            StatusCode::OK,
            axum::Json(ZohoProviderConfigPublic {
                client_id: env.client_id,
                redirect_uri: env.redirect_uri,
                accounts_url: env.accounts_url,
                scopes: env.scopes,
                has_secret: !env.client_secret.trim().is_empty(),
                secret_masked: Some(mask_secret_for_ui(&env.client_secret)),
                updated_by: None,
                updated_at: None,
            }),
        )
            .into_response();
    }
    (
        StatusCode::OK,
        axum::Json(ZohoProviderConfigPublic {
            client_id: String::new(),
            redirect_uri: String::new(),
            accounts_url: String::new(),
            scopes: String::new(),
            has_secret: false,
            secret_masked: None,
            updated_by: None,
            updated_at: None,
        }),
    )
        .into_response()
}

#[derive(Debug, Deserialize)]
pub struct ZohoProviderConfigWriteBody {
    pub client_id: String,
    pub client_secret: String,
    pub redirect_uri: String,
    pub accounts_url: String,
    pub scopes: String,
}

async fn existing_sf_provider_secret(pool: &SqlitePool, tenant_id: i64) -> Option<String> {
    if let Ok(Some(row)) = db::fetch_integration_provider_config(pool, tenant_id, SF_PROVIDER).await {
        if let Ok(json) = decrypt_integration_config(&row.config_encrypted) {
            if let Ok(cfg) = serde_json::from_str::<SalesforceProviderConfig>(&json) {
                let s = cfg.client_secret.trim().to_string();
                if !s.is_empty() {
                    return Some(s);
                }
            }
        }
    }
    sf_env().map(|e| e.client_secret).filter(|s| !s.trim().is_empty())
}

async fn existing_zoho_provider_secret(pool: &SqlitePool, tenant_id: i64) -> Option<String> {
    if let Ok(Some(row)) = db::fetch_integration_provider_config(pool, tenant_id, ZOHO_PROVIDER).await {
        if let Ok(json) = decrypt_integration_config(&row.config_encrypted) {
            if let Ok(cfg) = serde_json::from_str::<ZohoProviderConfig>(&json) {
                let s = cfg.client_secret.trim().to_string();
                if !s.is_empty() {
                    return Some(s);
                }
            }
        }
    }
    zoho_env().map(|e| e.client_secret).filter(|s| !s.trim().is_empty())
}

fn sf_config_validation_fields(
    body: &SalesforceProviderConfigWriteBody,
    has_existing_secret: bool,
) -> serde_json::Map<String, serde_json::Value> {
    let mut fields = serde_json::Map::new();
    if body.client_id.trim().is_empty() {
        fields.insert(
            "client_id".into(),
            serde_json::Value::String("Nhập Consumer Key (Client ID)".into()),
        );
    }
    if body.client_secret.trim().is_empty() && !has_existing_secret {
        fields.insert(
            "client_secret".into(),
            serde_json::Value::String(
                "Nhập Consumer Secret (lần đầu bắt buộc; đã lưu thì để trống nếu không đổi)".into(),
            ),
        );
    }
    if body.redirect_uri.trim().is_empty() {
        fields.insert(
            "redirect_uri".into(),
            serde_json::Value::String("Nhập Redirect URI (Callback URL)".into()),
        );
    } else if !body.redirect_uri.trim().starts_with("http://")
        && !body.redirect_uri.trim().starts_with("https://")
    {
        fields.insert(
            "redirect_uri".into(),
            serde_json::Value::String("Redirect URI phải bắt đầu bằng http:// hoặc https://".into()),
        );
    }
    if body.login_url.trim().is_empty() {
        fields.insert(
            "login_url".into(),
            serde_json::Value::String("Nhập Login URL (vd https://login.salesforce.com)".into()),
        );
    } else if !body.login_url.trim().starts_with("http://")
        && !body.login_url.trim().starts_with("https://")
    {
        fields.insert(
            "login_url".into(),
            serde_json::Value::String("Login URL phải bắt đầu bằng http:// hoặc https://".into()),
        );
    }
    fields
}

fn zoho_config_validation_fields(
    body: &ZohoProviderConfigWriteBody,
    has_existing_secret: bool,
) -> serde_json::Map<String, serde_json::Value> {
    let mut fields = serde_json::Map::new();
    if body.client_id.trim().is_empty() {
        fields.insert(
            "client_id".into(),
            serde_json::Value::String("Nhập Client ID".into()),
        );
    }
    if body.client_secret.trim().is_empty() && !has_existing_secret {
        fields.insert(
            "client_secret".into(),
            serde_json::Value::String(
                "Nhập Client Secret (lần đầu bắt buộc; đã lưu thì để trống nếu không đổi)".into(),
            ),
        );
    }
    if body.redirect_uri.trim().is_empty() {
        fields.insert(
            "redirect_uri".into(),
            serde_json::Value::String("Nhập Redirect URI".into()),
        );
    } else if !body.redirect_uri.trim().starts_with("http://")
        && !body.redirect_uri.trim().starts_with("https://")
    {
        fields.insert(
            "redirect_uri".into(),
            serde_json::Value::String("Redirect URI phải bắt đầu bằng http:// hoặc https://".into()),
        );
    }
    if body.accounts_url.trim().is_empty() {
        fields.insert(
            "accounts_url".into(),
            serde_json::Value::String("Nhập Accounts URL (vd https://accounts.zoho.com)".into()),
        );
    } else if !body.accounts_url.trim().starts_with("http://")
        && !body.accounts_url.trim().starts_with("https://")
    {
        fields.insert(
            "accounts_url".into(),
            serde_json::Value::String("Accounts URL phải bắt đầu bằng http:// hoặc https://".into()),
        );
    }
    if body.scopes.trim().is_empty() {
        fields.insert(
            "scopes".into(),
            serde_json::Value::String("Nhập scopes OAuth Zoho Projects".into()),
        );
    }
    fields
}

pub async fn api_zoho_config_put(ctx: &AdminCtx, body: ZohoProviderConfigWriteBody) -> Response {
    let Some(st) = STATE.get() else {
        return json_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "internal_error",
            "state not initialized",
        );
    };
    let existing_secret = existing_zoho_provider_secret(&st.pool, ctx.tenant_id).await;
    let has_existing_secret = existing_secret.is_some();
    let fields = zoho_config_validation_fields(&body, has_existing_secret);
    if !fields.is_empty() {
        return json_error_fields(
            StatusCode::BAD_REQUEST,
            "validation_failed",
            "Kiểm tra các trường được đánh dấu",
            fields,
        );
    }
    let client_secret = if body.client_secret.trim().is_empty() {
        existing_secret.unwrap_or_default()
    } else {
        body.client_secret.trim().to_string()
    };
    let cfg = ZohoProviderConfig {
        client_id: body.client_id.trim().to_string(),
        client_secret,
        redirect_uri: body.redirect_uri.trim().to_string(),
        accounts_url: body.accounts_url.trim().trim_end_matches('/').to_string(),
        scopes: body.scopes.trim().to_string(),
    };
    let json = match serde_json::to_string(&cfg) {
        Ok(j) => j,
        Err(_) => return json_error(StatusCode::INTERNAL_SERVER_ERROR, "serialize_failed", "cannot serialize config"),
    };
    let enc = match encrypt_integration_config(&json) {
        Ok(e) => e,
        Err(e) => return json_error(StatusCode::INTERNAL_SERVER_ERROR, "encrypt_failed", &format!("{e}")),
    };
    if let Err(e) = db::upsert_integration_provider_config(
        &st.pool,
        ctx.tenant_id,
        ZOHO_PROVIDER,
        &enc,
        &ctx.username,
    )
    .await
    {
        return json_error(StatusCode::INTERNAL_SERVER_ERROR, "db_failed", &format!("{e}"));
    }
    write_audit(
        &st.pool,
        ctx,
        "integration.config.update",
        ZOHO_PROVIDER,
        "success",
        None,
        Some("provider_config"),
    )
    .await;
    api_zoho_config_get(ctx).await
}

#[derive(Debug, Serialize)]
pub struct SalesforceProviderConfigPublic {
    pub client_id: String,
    pub redirect_uri: String,
    pub login_url: String,
    pub has_secret: bool,
    pub secret_masked: Option<String>,
    pub updated_by: Option<String>,
    pub updated_at: Option<String>,
}

pub async fn api_salesforce_config_get(ctx: &AdminCtx) -> Response {
    let Some(st) = STATE.get() else {
        return json_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "internal_error",
            "state not initialized",
        );
    };
    let row = db::fetch_integration_provider_config(&st.pool, ctx.tenant_id, SF_PROVIDER)
        .await
        .ok()
        .flatten();
    if let Some(r) = row {
        if let Ok(json) = decrypt_integration_config(&r.config_encrypted) {
            if let Ok(cfg) = serde_json::from_str::<SalesforceProviderConfig>(&json) {
                let masked = mask_secret_for_ui(&cfg.client_secret);
                return (
                    StatusCode::OK,
                    axum::Json(SalesforceProviderConfigPublic {
                        client_id: cfg.client_id,
                        redirect_uri: cfg.redirect_uri,
                        login_url: cfg.login_url,
                        has_secret: !cfg.client_secret.trim().is_empty(),
                        secret_masked: Some(masked),
                        updated_by: Some(r.updated_by),
                        updated_at: Some(r.updated_at),
                    }),
                )
                    .into_response();
            }
        }
    }
    if let Some(env) = sf_env() {
        return (
            StatusCode::OK,
            axum::Json(SalesforceProviderConfigPublic {
                client_id: env.client_id,
                redirect_uri: env.redirect_uri,
                login_url: env.login_url,
                has_secret: !env.client_secret.trim().is_empty(),
                secret_masked: Some(mask_secret_for_ui(&env.client_secret)),
                updated_by: None,
                updated_at: None,
            }),
        )
            .into_response();
    }
    (
        StatusCode::OK,
        axum::Json(SalesforceProviderConfigPublic {
            client_id: String::new(),
            redirect_uri: String::new(),
            login_url: String::new(),
            has_secret: false,
            secret_masked: None,
            updated_by: None,
            updated_at: None,
        }),
    )
        .into_response()
}

#[derive(Debug, Deserialize)]
pub struct SalesforceProviderConfigWriteBody {
    pub client_id: String,
    pub client_secret: String,
    pub redirect_uri: String,
    pub login_url: String,
}

pub async fn api_salesforce_config_put(
    ctx: &AdminCtx,
    body: SalesforceProviderConfigWriteBody,
) -> Response {
    let Some(st) = STATE.get() else {
        return json_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "internal_error",
            "state not initialized",
        );
    };
    let existing_secret = existing_sf_provider_secret(&st.pool, ctx.tenant_id).await;
    let has_existing_secret = existing_secret.is_some();
    let fields = sf_config_validation_fields(&body, has_existing_secret);
    if !fields.is_empty() {
        return json_error_fields(
            StatusCode::BAD_REQUEST,
            "validation_failed",
            "Kiểm tra các trường được đánh dấu",
            fields,
        );
    }
    let client_secret = if body.client_secret.trim().is_empty() {
        existing_secret.unwrap_or_default()
    } else {
        body.client_secret.trim().to_string()
    };
    let cfg = SalesforceProviderConfig {
        client_id: body.client_id.trim().to_string(),
        client_secret,
        redirect_uri: body.redirect_uri.trim().to_string(),
        login_url: body.login_url.trim().trim_end_matches('/').to_string(),
    };
    let json = match serde_json::to_string(&cfg) {
        Ok(j) => j,
        Err(_) => {
            return json_error(
                StatusCode::INTERNAL_SERVER_ERROR,
                "serialize_failed",
                "cannot serialize config",
            );
        }
    };
    let enc = match encrypt_integration_config(&json) {
        Ok(e) => e,
        Err(e) => {
            return json_error(StatusCode::INTERNAL_SERVER_ERROR, "encrypt_failed", &format!("{e}"));
        }
    };
    if let Err(e) = db::upsert_integration_provider_config(
        &st.pool,
        ctx.tenant_id,
        SF_PROVIDER,
        &enc,
        &ctx.username,
    )
    .await
    {
        return json_error(StatusCode::INTERNAL_SERVER_ERROR, "db_failed", &format!("{e}"));
    }
    write_audit(
        &st.pool,
        ctx,
        "integration.config.update",
        SF_PROVIDER,
        "success",
        None,
        Some("provider_config"),
    )
    .await;
    api_salesforce_config_get(ctx).await
}

#[derive(Debug, Deserialize)]
pub struct ZohoTasksQuery {
    pub project_id: Option<String>,
}

pub async fn api_zoho_tasks(ctx: &AdminCtx, query: ZohoTasksQuery) -> Response {
    let Some(st) = STATE.get() else {
        return json_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "internal_error",
            "state not initialized",
        );
    };
    let token = match load_zoho_token(&st.pool, ctx.tenant_id).await {
        Ok(t) => t,
        Err(e) => {
            return json_error(StatusCode::BAD_REQUEST, "not_connected", &format!("{e}"));
        }
    };
    let portal_id = match zoho_require_portal_id(&token) {
        Ok(p) => p,
        Err(r) => return r,
    };
    let Some(project_id) = query.project_id.as_deref().filter(|s| !s.trim().is_empty()) else {
        return json_error(
            StatusCode::BAD_REQUEST,
            "missing_project_id",
            "Thiếu project_id (query param). Hãy test projects trước rồi chọn một project.",
        );
    };
    let path = format!("/api/v3/portal/{portal_id}/projects/{project_id}/tasks");
    match zoho_get_with_refresh(&st.pool, ctx.tenant_id, &path).await {
        Ok((tasks, _)) => (
            StatusCode::OK,
            axum::Json(serde_json::json!({
                "status": "ok",
                "provider": ZOHO_PROVIDER,
                "portal_id": portal_id,
                "project_id": project_id,
                "tasks": tasks
            })),
        )
            .into_response(),
        Err(e) => (
            StatusCode::BAD_GATEWAY,
            axum::Json(serde_json::json!({ "error": "zoho_api_failed", "message": e })),
        )
            .into_response(),
    }
}

pub async fn api_zoho_disconnect(ctx: &AdminCtx) -> Response {
    let Some(st) = STATE.get() else {
        return json_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "internal_error",
            "state not initialized",
        );
    };
    match db::clear_integration(&st.pool, ctx.tenant_id, ZOHO_PROVIDER).await {
        Ok(_) => {
            write_audit(
                &st.pool,
                ctx,
                "integration.disconnect",
                ZOHO_PROVIDER,
                "success",
                None,
                None,
            )
            .await;
            (
                StatusCode::OK,
                axum::Json(serde_json::json!({ "status": "disconnected", "provider": ZOHO_PROVIDER })),
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
