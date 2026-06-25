//! Salesforce & Zoho Projects OAuth connectors.

use axum::{
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Redirect, Response},
};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use std::time::{Duration, Instant};

use crate::admin_auth::{write_audit, write_audit_failure, AdminCtx};
use crate::crypto::{decrypt_integration_config, encrypt_integration_config};
use crate::db::{self, IntegrationPublic};
use crate::{json_error, json_error_fields, STATE};
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use sha2::{Digest, Sha256};

use crate::integration_office::{
    document_download_url, generate_contract_for_deal, office_integration_configured,
    DealDocumentContext, ZOHO_OFFICE_PROVIDER,
};

const SF_PROVIDER: &str = "salesforce";
const ZOHO_PROVIDER: &str = "zoho_projects";
const BRIDGE_PROVIDER: &str = "bridge";
const OPP_TEMPLATE_PROVIDER: &str = "sales_to_delivery_templates";
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
    /// ISO8601 — dùng refresh job trước khi hết hạn.
    #[serde(default)]
    pub expires_at: Option<String>,
    #[serde(default)]
    pub demo: bool,
    /// Chỉ push bản ghi SF tạo/sửa sau thời điểm OAuth connect.
    #[serde(default)]
    pub oauth_connected_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SalesforceProviderConfig {
    pub client_id: String,
    pub client_secret: String,
    pub redirect_uri: String,
    pub login_url: String,
}

async fn salesforce_provider_config(pool: &PgPool, tenant_id: i64) -> Option<SalesforceProviderConfig> {
    if let Ok(Some(row)) = db::fetch_integration_provider_config(pool, tenant_id, SF_PROVIDER).await {
        if let Ok(json) = decrypt_integration_config(&row.config_encrypted) {
            if let Ok(cfg) = serde_json::from_str::<SalesforceProviderConfig>(&json) {
                if !cfg.client_id.trim().is_empty() && !cfg.client_secret.trim().is_empty() {
                    return Some(cfg);
                }
            }
        }
    }
    None
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ZohoProviderConfig {
    pub client_id: String,
    pub client_secret: String,
    pub redirect_uri: String,
    pub accounts_url: String,
    pub scopes: String,
}

pub(crate) fn mask_secret_for_ui(secret: &str) -> String {
    let s = secret.trim();
    if s.len() <= 6 {
        return "***".into();
    }
    let tail = &s[s.len() - 4..];
    format!("***{tail}")
}

async fn zoho_provider_config(pool: &PgPool, tenant_id: i64) -> Option<ZohoProviderConfig> {
    if let Ok(Some(row)) = db::fetch_integration_provider_config(pool, tenant_id, ZOHO_PROVIDER).await {
        if let Ok(json) = decrypt_integration_config(&row.config_encrypted) {
            if let Ok(cfg) = serde_json::from_str::<ZohoProviderConfig>(&json) {
                if !cfg.client_id.trim().is_empty() && !cfg.client_secret.trim().is_empty() {
                    return Some(cfg);
                }
            }
        }
    }
    None
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ZohoTokenConfig {
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub api_domain: String,
    pub token_type: Option<String>,
    pub expires_in_sec: Option<i64>,
    /// ISO8601 — dùng refresh job trước khi hết hạn.
    #[serde(default)]
    pub expires_at: Option<String>,
    pub portal_id: Option<String>,
    #[serde(default)]
    pub demo: bool,
    #[serde(default)]
    pub oauth_connected_at: Option<String>,
}

fn token_expires_at_from_secs(expires_in_sec: Option<i64>) -> Option<String> {
    let secs = expires_in_sec.unwrap_or(3600);
    let skew = 300_i64;
    let at = std::time::SystemTime::now()
        .checked_add(Duration::from_secs((secs - skew).max(60) as u64))?;
    let datetime: chrono::DateTime<chrono::Utc> = at.into();
    Some(datetime.to_rfc3339())
}

fn token_expires_soon(expires_at: Option<&str>) -> bool {
    let Some(raw) = expires_at else {
        return true;
    };
    let Ok(dt) = chrono::DateTime::parse_from_rfc3339(raw) else {
        return true;
    };
    dt.with_timezone(&chrono::Utc) <= chrono::Utc::now()
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

pub(crate) fn compact_zoho_api_error(status: reqwest::StatusCode, body: &str) -> String {
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

const INTEGRATION_CONFIG_HINT: &str =
    "Chưa cấu hình — admin nhập Client ID/Secret trên Dashboard → Integrations";

pub fn ui_redirect_base() -> String {
    std::env::var("INTEGRATIONS_UI_URL")
        .unwrap_or_else(|_| "/integrations".into())
        .trim()
        .trim_end_matches('/')
        .to_string()
}

pub fn gateway_public_base_url() -> Option<String> {
    if let Ok(raw) = std::env::var("GATEWAY_PUBLIC_URL") {
        let trimmed = raw.trim().trim_end_matches('/').to_string();
        if !trimmed.is_empty() {
            return Some(trimmed);
        }
    }
    std::env::var("INTEGRATIONS_UI_URL").ok().and_then(|raw| {
        let trimmed = raw.trim().trim_end_matches('/');
        if trimmed.ends_with("/integrations") {
            let base = trimmed.trim_end_matches("/integrations").trim_end_matches('/');
            if base.starts_with("http://") || base.starts_with("https://") {
                return Some(base.to_string());
            }
        } else if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
            return Some(trimmed.to_string());
        }
        None
    })
}

pub fn gateway_public_ip() -> Option<String> {
    std::env::var("GATEWAY_PUBLIC_IP")
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

#[derive(Debug, Serialize)]
pub struct IntegrationSetupHints {
    pub gateway_public_ip: Option<String>,
    pub gateway_public_base_url: Option<String>,
    pub salesforce_callback_url: String,
    pub zoho_callback_url: String,
}

pub async fn api_integrations_setup_hints(_ctx: &AdminCtx) -> Response {
    let base = gateway_public_base_url();
    let salesforce_callback_url = base
        .as_ref()
        .map(|b| format!("{b}/api/integrations/salesforce/callback"))
        .unwrap_or_else(|| "/api/integrations/salesforce/callback".into());
    let zoho_callback_url = base
        .as_ref()
        .map(|b| format!("{b}/api/integrations/zoho/callback"))
        .unwrap_or_else(|| "/api/integrations/zoho/callback".into());
    (
        StatusCode::OK,
        axum::Json(IntegrationSetupHints {
            gateway_public_ip: gateway_public_ip(),
            gateway_public_base_url: base,
            salesforce_callback_url,
            zoho_callback_url,
        }),
    )
        .into_response()
}

fn oauth_exchange_user_message(provider: &str, raw: &str) -> String {
    let lower = raw.to_lowercase();
    if lower.contains("ip restricted") {
        if let Some(ip) = gateway_public_ip() {
            return format!(
                "Salesforce chặn IP server. Thêm {ip} vào Setup → Security → Network Access (hoặc Connected App → Relax IP restrictions)."
            );
        }
        return "Salesforce chặn IP server gateway. Thêm IP public VPS vào Setup → Security → Network Access.".into();
    }
    if lower.contains("invalid_client") || lower.contains("invalid client") {
        return format!(
            "{provider}: Consumer Key/Secret sai hoặc Connected App chưa active — kiểm tra lại trên Salesforce."
        );
    }
    if lower.contains("redirect_uri_mismatch") || lower.contains("redirect uri") {
        return format!(
            "{provider}: Redirect URI không khớp Connected App — copy đúng Callback URL trong hướng dẫn bên dưới."
        );
    }
    if lower.contains("invalid_grant") {
        return format!(
            "{provider}: Authorization code hết hạn hoặc đã dùng — bấm Kết nối lại (không refresh trang giữa chừng)."
        );
    }
    if lower.contains("invalid_oauthtoken") || lower.contains("invalid oauth") {
        return format!("{provider}: OAuth token không hợp lệ — Ngắt kết nối rồi Kết nối lại.");
    }
    if lower.contains("missing access_token") {
        return format!(
            "{provider}: Zoho không trả access_token — kiểm tra Client Secret, Redirect URI và Accounts URL (.com / .com.vn / .eu)."
        );
    }
    let compact: String = raw.chars().take(180).collect();
    format!("{provider}: {compact}")
}

fn redirect_ui_error(code: &str, provider: Option<&str>, detail: Option<&str>) -> Response {
    let base = ui_redirect_base();
    let mut qs = vec![format!("error={}", urlencoding::encode(code))];
    if let Some(p) = provider.filter(|s| !s.is_empty()) {
        qs.push(format!("provider={}", urlencoding::encode(p)));
    }
    if let Some(d) = detail.filter(|s| !s.is_empty()) {
        let truncated: String = d.chars().take(220).collect();
        qs.push(format!("detail={}", urlencoding::encode(&truncated)));
    }
    Redirect::temporary(&format!("{base}?{}", qs.join("&"))).into_response()
}

fn api_version() -> &'static str {
    "v59.0"
}

pub async fn ensure_integration_rows(pool: &PgPool, tenant_id: i64) -> Result<(), sqlx::Error> {
    for provider in [SF_PROVIDER, ZOHO_PROVIDER, ZOHO_OFFICE_PROVIDER] {
        sqlx::query(
            "INSERT INTO integrations (tenant_id, provider, status) VALUES ($1, $2, 'disconnected') ON CONFLICT (tenant_id, provider) DO NOTHING",
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
    let has_office = out.iter().any(|r| r.provider == ZOHO_OFFICE_PROVIDER);
    if !has_sf {
        out.push(IntegrationPublic {
            id: 0,
            provider: SF_PROVIDER.into(),
            status: "disconnected".into(),
            last_sync_at: None,
            last_error: Some(INTEGRATION_CONFIG_HINT.into()),
            updated_at: String::new(),
            label: "Salesforce".into(),
            available: false,
            is_demo: false,
        });
    }
    if !has_zoho {
        out.push(IntegrationPublic {
            id: 0,
            provider: ZOHO_PROVIDER.into(),
            status: "disconnected".into(),
            last_sync_at: None,
            last_error: Some(INTEGRATION_CONFIG_HINT.into()),
            updated_at: String::new(),
            label: "Zoho Projects".into(),
            available: false,
            is_demo: false,
        });
    }
    if !has_office {
        out.push(IntegrationPublic {
            id: 0,
            provider: ZOHO_OFFICE_PROVIDER.into(),
            status: "disconnected".into(),
            last_sync_at: None,
            last_error: Some(
                "Chưa cấu hình — nhập API key Zoho Office Integrator trên Dashboard".into(),
            ),
            updated_at: String::new(),
            label: "Zoho Office Integrator".into(),
            available: false,
            is_demo: false,
        });
    }
    for r in &mut out {
        if r.provider == SF_PROVIDER {
            r.label = "Salesforce".into();
        } else if r.provider == ZOHO_PROVIDER {
            r.label = "Zoho Projects".into();
        } else if r.provider == ZOHO_OFFICE_PROVIDER {
            r.label = "Zoho Office Integrator".into();
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
            let zoho_cfg = zoho_provider_config(&st.pool, ctx.tenant_id).await.is_some();
            let sf_cfg = salesforce_provider_config(&st.pool, ctx.tenant_id).await.is_some();
            let office_cfg = office_integration_configured(&st.pool, ctx.tenant_id).await;
            for r in &mut out {
                if r.provider == ZOHO_OFFICE_PROVIDER {
                    r.available = office_cfg;
                    if !r.available {
                        r.last_error = Some(
                            "Nhập API key tại Zoho Office Integrator — merge hợp đồng PDF".into(),
                        );
                    } else if r.status == "disconnected" {
                        r.status = "connected".into();
                    }
                } else if r.provider == ZOHO_PROVIDER {
                    r.available = zoho_cfg;
                    r.is_demo = load_zoho_token(&st.pool, ctx.tenant_id)
                        .await
                        .map(|t| t.demo)
                        .unwrap_or(false);
                    if !r.available {
                        r.last_error = Some(INTEGRATION_CONFIG_HINT.into());
                    } else if r.status == "connected" && r.is_demo {
                        r.last_error = Some(DEMO_TOKEN_REJECTED.into());
                    }
                } else if r.provider == SF_PROVIDER {
                    r.available = sf_cfg;
                    r.is_demo = load_sf_token(&st.pool, ctx.tenant_id)
                        .await
                        .map(|t| t.demo)
                        .unwrap_or(false);
                    if !r.available {
                        r.last_error = Some(INTEGRATION_CONFIG_HINT.into());
                    } else if r.status == "connected" && r.is_demo {
                        r.last_error = Some(DEMO_TOKEN_REJECTED.into());
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
        return redirect_ui_error("gateway_not_ready", Some(SF_PROVIDER), None);
    };
    let code = match &query.0.code {
        Some(c) if !c.is_empty() => c.clone(),
        _ => return redirect_ui_error("missing_code", Some(SF_PROVIDER), None),
    };
    let state = match &query.0.state {
        Some(s) if !s.is_empty() => s.clone(),
        _ => return redirect_ui_error("missing_state", Some(SF_PROVIDER), None),
    };
    let pending = match resolve_oauth_pending(&st.pool, &st.oauth_pending, &state, SF_PROVIDER).await {
        Some(p) => p,
        None => return redirect_ui_error("invalid_state", Some(SF_PROVIDER), None),
    };
    if pending.valid_until < Instant::now() {
        return redirect_ui_error("state_expired", Some(SF_PROVIDER), None);
    }
    let Some(sf) = salesforce_provider_config(&st.pool, pending.tenant_id).await else {
        return redirect_ui_error("not_configured", Some(SF_PROVIDER), None);
    };
    let mut token = match exchange_code(&st.http, &sf, &code, pending.pkce_verifier.as_deref()).await {
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
            let msg = oauth_exchange_user_message("Salesforce", &e);
            return redirect_ui_error("token_exchange_failed", Some(SF_PROVIDER), Some(&msg));
        }
    };
    token.oauth_connected_at = Some(chrono::Utc::now().to_rfc3339());
    let json = match serde_json::to_string(&token) {
        Ok(j) => j,
        Err(_) => return redirect_ui_error("serialize_failed", Some(SF_PROVIDER), None),
        };
    let enc = match encrypt_integration_config(&json) {
        Ok(e) => e,
        Err(e) => {
            tracing::error!(error = %e, "encrypt sf token");
            return redirect_ui_error("encrypt_failed", Some(SF_PROVIDER), None);
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
        return redirect_ui_error("db_failed", Some(SF_PROVIDER), None);
    }
    let ctx = AdminCtx {
        user_id: 0,
        username: pending.actor.clone(),
        home_tenant_id: pending.tenant_id,
        tenant_id: pending.tenant_id,
        role: pending.role.clone(),
        via_api_key: false,
        client_ip: crate::admin_auth::client_ip(&headers),
    };
    write_audit(
        &st.pool,
        &ctx,
        "integration.connect",
        SF_PROVIDER,
        "success",
        None,
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
    pool: &PgPool,
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
    pool: &PgPool,
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
    let mut token: SalesforceTokenConfig =
        serde_json::from_str(&body).map_err(|e| format!("json: {e}"))?;
    if token.expires_at.is_none() {
        token.expires_at = token_expires_at_from_secs(Some(7200));
    }
    Ok(token)
}

pub async fn load_sf_token(pool: &PgPool, tenant_id: i64) -> Result<SalesforceTokenConfig, String> {
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
    let mut token: SalesforceTokenConfig =
        serde_json::from_str(&body).map_err(|e| format!("json: {e}"))?;
    token.refresh_token = Some(refresh_token.to_string());
    if token.expires_at.is_none() {
        token.expires_at = token_expires_at_from_secs(Some(7200));
    }
    Ok(token)
}

pub async fn sf_get_with_refresh(
    pool: &PgPool,
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
            let oauth_connected_at = token.oauth_connected_at.clone();
            token = refresh_access_token(&st.http, &sf, &rt).await?;
            token.oauth_connected_at = oauth_connected_at;
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
    pool: &PgPool,
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
    pool: &PgPool,
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
        url = crate::route_match::append_query_to_upstream_url(&url, q);
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
            let oauth_connected_at = token.oauth_connected_at.clone();
            token = refresh_access_token(&st.http, &sf, &rt).await?;
            token.oauth_connected_at = oauth_connected_at;
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
    pool: &PgPool,
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
        url = crate::route_match::append_query_to_upstream_url(&url, q);
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
            let oauth_connected_at = token.oauth_connected_at.clone();
            token = refresh_zoho_access_token(&st.http, &zoho, &rt).await?;
            token.portal_id = portal_id;
            token.oauth_connected_at = oauth_connected_at;
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

/// Custom Opportunity field (vd `Product_Type__c`) — override env `INTEGRATION_SF_PRODUCT_FIELD`.
fn sf_product_type_custom_field() -> Option<String> {
    std::env::var("INTEGRATION_SF_PRODUCT_FIELD")
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty() && s.chars().all(|c| c.is_alphanumeric() || c == '_'))
}

fn sf_opportunity_soql() -> String {
    let mut fields = vec![
        "Id".to_string(),
        "Name".to_string(),
        "StageName".to_string(),
        "Amount".to_string(),
        "CloseDate".to_string(),
        "Description".to_string(),
        "Type".to_string(),
        "AccountId".to_string(),
        "CreatedDate".to_string(),
        "LastModifiedDate".to_string(),
    ];
    if let Some(custom) = sf_product_type_custom_field() {
        fields.push(custom);
    }
    format!(
        "SELECT {} , (SELECT Product2.Name FROM OpportunityLineItems LIMIT 5) FROM Opportunity LIMIT 200",
        fields.join(", ")
    )
}

/// Ưu tiên: custom field → Product2 từ line item → Opportunity.Type.
fn extract_sf_product_type(r: &serde_json::Value) -> String {
    if let Some(custom) = sf_product_type_custom_field() {
        let v = sf_field_str(r, &custom);
        if !v.is_empty() {
            return v;
        }
    }
    if let Some(records) = r
        .get("OpportunityLineItems")
        .and_then(|x| x.get("records"))
        .and_then(|x| x.as_array())
    {
        for item in records {
            if let Some(name) = item
                .get("Product2")
                .and_then(|p| p.get("Name"))
                .and_then(|n| n.as_str())
            {
                if !name.is_empty() {
                    return name.to_string();
                }
            }
        }
    }
    sf_field_str(r, "Type")
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
                "description": sf_field_str(r, "Description"),
                "product_type": extract_sf_product_type(r),
                "opportunity_type": sf_field_str(r, "Type"),
                "account_id": sf_field_str(r, "AccountId"),
                "created_date": sf_field_str(r, "CreatedDate"),
                "last_modified_date": sf_field_str(r, "LastModifiedDate"),
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
                "created_date": sf_field_str(r, "CreatedDate"),
                "last_modified_date": sf_field_str(r, "LastModifiedDate"),
            })
        })
        .collect()
}

fn map_sf_contacts(records: &[serde_json::Value]) -> Vec<serde_json::Value> {
    records
        .iter()
        .map(|r| {
            serde_json::json!({
                "id": sf_field_str(r, "Id"),
                "name": sf_field_str(r, "Name"),
                "email": sf_field_str(r, "Email"),
                "account_id": sf_field_str(r, "AccountId"),
                "created_date": sf_field_str(r, "CreatedDate"),
                "last_modified_date": sf_field_str(r, "LastModifiedDate"),
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
    pool: &PgPool,
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

const DEMO_TOKEN_REJECTED: &str =
    "Token demo không hỗ trợ — ngắt kết nối và OAuth thật để lấy dữ liệu từ Salesforce/Zoho";

fn reject_integration_demo_token(demo: bool) -> Result<(), String> {
    if demo {
        Err(DEMO_TOKEN_REJECTED.into())
    } else {
        Ok(())
    }
}

pub async fn sync_salesforce_snapshots(pool: &PgPool, tenant_id: i64) -> Result<serde_json::Value, String> {
    if let Ok(token) = load_sf_token(pool, tenant_id).await {
        reject_integration_demo_token(token.demo)?;
    }
    ensure_integration_connected(pool, tenant_id, SF_PROVIDER).await?;
    let opp_soql = sf_opportunity_soql();
    let opp_q = urlencoding::encode(&opp_soql);
    let opp_raw = crate::sync_worker_gateway::sf_get_via_gateway(&format!("/query?q={opp_q}")).await?;
    let opp_records = opp_raw
        .get("records")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    let opp_mapped = map_sf_opportunities(&opp_records);
    let opp_count = save_snapshot(pool, tenant_id, SF_PROVIDER, "opportunity", &opp_mapped).await?;

    let acc_q = urlencoding::encode(
        "SELECT Id,Name,Industry,CreatedDate,LastModifiedDate FROM Account LIMIT 200",
    );
    let acc_raw = crate::sync_worker_gateway::sf_get_via_gateway(&format!("/query?q={acc_q}")).await?;
    let acc_records = acc_raw
        .get("records")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    let acc_mapped = map_sf_accounts(&acc_records);
    let acc_count = save_snapshot(pool, tenant_id, SF_PROVIDER, "account", &acc_mapped).await?;

    let contact_q = urlencoding::encode(
        "SELECT Id,Name,Email,AccountId,CreatedDate,LastModifiedDate FROM Contact LIMIT 200",
    );
    let contact_raw =
        crate::sync_worker_gateway::sf_get_via_gateway(&format!("/query?q={contact_q}")).await?;
    let contact_records = contact_raw
        .get("records")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    let contact_mapped = map_sf_contacts(&contact_records);
    let contact_count =
        save_snapshot(pool, tenant_id, SF_PROVIDER, "contact", &contact_mapped).await?;

    db::touch_integration_last_sync(pool, tenant_id, SF_PROVIDER)
        .await
        .map_err(|e| format!("db touch sync: {e}"))?;
    let _ = db::set_integration_status(pool, tenant_id, SF_PROVIDER, "connected", None).await;

    Ok(serde_json::json!({
        "provider": SF_PROVIDER,
        "opportunity": opp_count,
        "account": acc_count,
        "contact": contact_count,
    }))
}

pub async fn sync_zoho_snapshots(pool: &PgPool, tenant_id: i64) -> Result<serde_json::Value, String> {
    if let Ok(token) = load_zoho_token(pool, tenant_id).await {
        reject_integration_demo_token(token.demo)?;
    }
    ensure_integration_connected(pool, tenant_id, ZOHO_PROVIDER).await?;
    let portal_id = ensure_zoho_portal_id_sync(pool, tenant_id).await?;

    let projects_raw = crate::sync_worker_gateway::zoho_get_via_gateway(
        &format!("/api/v3/portal/{portal_id}/projects"),
        None,
    )
    .await?;
    let project_items = extract_zoho_array(&projects_raw, &["projects"]);
    let projects_mapped = map_zoho_projects(&project_items);
    let project_count =
        save_snapshot(pool, tenant_id, ZOHO_PROVIDER, "project", &projects_mapped).await?;

    let mut task_count = 0_i64;
    if let Some(first) = project_items.first() {
        let project_id = zoho_id_str(first);
        if !project_id.is_empty() {
            let tasks_raw = crate::sync_worker_gateway::zoho_get_via_gateway(
                &format!("/api/v3/portal/{portal_id}/projects/{project_id}/tasks"),
                None,
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
            let bridge = try_run_integration_bridge(&st.pool, ctx.tenant_id).await;
            (
                StatusCode::OK,
                axum::Json(serde_json::json!({ "status": "ok", "summary": summary, "bridge": bridge })),
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
            let bridge = try_run_integration_bridge(&st.pool, ctx.tenant_id).await;
            (
                StatusCode::OK,
                axum::Json(serde_json::json!({ "status": "ok", "summary": summary, "bridge": bridge })),
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

#[derive(Debug, Deserialize)]
pub struct SnapshotRecordsQuery {
    pub provider: Option<String>,
    pub entity_type: Option<String>,
    #[serde(default = "snapshot_records_default_limit")]
    pub limit: usize,
}

fn snapshot_records_default_limit() -> usize {
    50
}

fn salesforce_contact_record_url(instance_url: &str, contact_id: &str) -> String {
    let base = instance_url.trim_end_matches('/');
    if base.is_empty() {
        return "https://login.salesforce.com".to_string();
    }
    let lightning = base.replace(".my.salesforce.com", ".lightning.force.com");
    format!("{lightning}/lightning/r/Contact/{contact_id}/view")
}

pub async fn api_list_snapshot_records(ctx: &AdminCtx, query: SnapshotRecordsQuery) -> Response {
    let Some(st) = STATE.get() else {
        return json_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "internal_error",
            "state not initialized",
        );
    };
    let provider = query
        .provider
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or(SF_PROVIDER);
    let entity_type = query
        .entity_type
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or("contact");
    let limit = query.limit.clamp(1, 200);

    let snap = match db::fetch_latest_integration_snapshot(
        &st.pool,
        ctx.tenant_id,
        provider,
        entity_type,
    )
    .await
    {
        Ok(Some(row)) => row,
        Ok(None) => {
            return (
                StatusCode::OK,
                axum::Json(serde_json::json!({
                    "provider": provider,
                    "entity_type": entity_type,
                    "fetched_at": null,
                    "record_count": 0,
                    "records": [],
                    "hint": "Chưa có snapshot — trên card Salesforce bấm «Đồng bộ snapshot» trước.",
                })),
            )
                .into_response();
        }
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                axum::Json(serde_json::json!({ "error": format!("{e}") })),
            )
                .into_response();
        }
    };

    let records: Vec<serde_json::Value> =
        serde_json::from_str(&snap.payload_json).unwrap_or_default();
    let sf_instance = if provider == SF_PROVIDER {
        load_sf_token(&st.pool, ctx.tenant_id)
            .await
            .ok()
            .map(|t| t.instance_url)
            .unwrap_or_default()
    } else {
        String::new()
    };

    let mut out = Vec::new();
    for r in records.into_iter().take(limit) {
        let id = r
            .get("id")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string();
        if id.is_empty() {
            continue;
        }
        let mut row = r.clone();
        if provider == SF_PROVIDER && entity_type == "contact" && !sf_instance.is_empty() {
            if let Some(obj) = row.as_object_mut() {
                obj.insert(
                    "url".into(),
                    serde_json::Value::String(salesforce_contact_record_url(&sf_instance, &id)),
                );
            }
        }
        out.push(row);
    }

    (
        StatusCode::OK,
        axum::Json(serde_json::json!({
            "provider": provider,
            "entity_type": entity_type,
            "fetched_at": snap.fetched_at,
            "record_count": out.len(),
            "records": out,
        })),
    )
        .into_response()
}

pub async fn api_salesforce_test(ctx: &AdminCtx) -> Response {
    let Some(st) = STATE.get() else {
        return json_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "internal_error",
            "state not initialized",
        );
    };
    if let Ok(token) = load_sf_token(&st.pool, ctx.tenant_id).await {
        if token.demo {
            return json_error(
                StatusCode::SERVICE_UNAVAILABLE,
                "demo_token_rejected",
                DEMO_TOKEN_REJECTED,
            );
        }
    }
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
        return redirect_ui_error("gateway_not_ready", Some(ZOHO_PROVIDER), None);
    };
    let code = match &query.0.code {
        Some(c) if !c.is_empty() => c.clone(),
        _ => return redirect_ui_error("missing_code", Some(ZOHO_PROVIDER), None),
    };
    let state = match &query.0.state {
        Some(s) if !s.is_empty() => s.clone(),
        _ => return redirect_ui_error("missing_state", Some(ZOHO_PROVIDER), None),
    };
    let pending = match resolve_oauth_pending(&st.pool, &st.oauth_pending, &state, ZOHO_PROVIDER).await {
        Some(p) => p,
        None => return redirect_ui_error("invalid_state", Some(ZOHO_PROVIDER), None),
    };
    if pending.valid_until < Instant::now() {
        return redirect_ui_error("state_expired", Some(ZOHO_PROVIDER), None);
    }
    let Some(zoho) = zoho_provider_config(&st.pool, pending.tenant_id).await else {
        return redirect_ui_error("not_configured", Some(ZOHO_PROVIDER), None);
    };
    let mut token = match exchange_zoho_code(&st.http, &zoho, &code).await {
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
            let msg = oauth_exchange_user_message("Zoho", &e);
            return redirect_ui_error("token_exchange_failed", Some(ZOHO_PROVIDER), Some(&msg));
        }
    };
    token.oauth_connected_at = Some(chrono::Utc::now().to_rfc3339());
    let json = match serde_json::to_string(&token) {
        Ok(j) => j,
        Err(_) => return redirect_ui_error("serialize_failed", Some(ZOHO_PROVIDER), None),
        };
    let enc = match encrypt_integration_config(&json) {
        Ok(e) => e,
        Err(e) => {
            tracing::error!(error = %e, "encrypt zoho token");
            return redirect_ui_error("encrypt_failed", Some(ZOHO_PROVIDER), None);
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
        return redirect_ui_error("db_failed", Some(ZOHO_PROVIDER), None);
    }
    let ctx = AdminCtx {
        user_id: 0,
        username: pending.actor.clone(),
        home_tenant_id: pending.tenant_id,
        tenant_id: pending.tenant_id,
        role: pending.role.clone(),
        via_api_key: false,
        client_ip: crate::admin_auth::client_ip(&headers),
    };
    write_audit(
        &st.pool,
        &ctx,
        "integration.connect",
        ZOHO_PROVIDER,
        "success",
        None,
        Some(token.api_domain.as_str()),
    )
    .await;
    if let Err(e) = ensure_zoho_portal_id(&st.pool, pending.tenant_id).await {
        tracing::warn!(error = %e, "auto portal_id after zoho oauth failed");
    }
    let base = ui_redirect_base();
    Redirect::temporary(&format!("{base}?ok=zoho")).into_response()
}

fn extract_first_zoho_portal_id(portals: &serde_json::Value) -> Option<String> {
    let list = portals
        .as_array()
        .cloned()
        .or_else(|| portals.get("portals").and_then(|v| v.as_array()).cloned())?;
    let first = list.first()?;
    first
        .get("id")
        .or_else(|| first.get("id_string"))
        .or_else(|| first.get("portal_id"))
        .and_then(|v| {
            v.as_str()
                .map(|s| s.to_string())
                .or_else(|| v.as_i64().map(|n| n.to_string()))
        })
        .filter(|s| !s.is_empty())
}

async fn persist_zoho_token(pool: &PgPool, tenant_id: i64, token: &ZohoTokenConfig) -> Result<(), String> {
    let json = serde_json::to_string(token).map_err(|e| format!("serialize: {e}"))?;
    let enc = encrypt_integration_config(&json)?;
    db::upsert_integration_config(pool, tenant_id, ZOHO_PROVIDER, "connected", &enc, None)
        .await
        .map_err(|e| format!("db: {e}"))?;
    Ok(())
}

/// Tự chọn portal đầu tiên — không cần bấm Test portals thủ công.
async fn ensure_zoho_portal_id(pool: &PgPool, tenant_id: i64) -> Result<String, String> {
    let mut token = load_zoho_token(pool, tenant_id).await?;
    if let Some(pid) = token.portal_id.as_ref().filter(|s| !s.is_empty()) {
        return Ok(pid.clone());
    }
    let (portals, refreshed) = zoho_get_with_refresh(pool, tenant_id, "/api/v3/portals").await?;
    token = refreshed;
    let portal_id = extract_first_zoho_portal_id(&portals)
        .ok_or_else(|| "Không tìm thấy portal Zoho Projects trong tài khoản".to_string())?;
    token.portal_id = Some(portal_id.clone());
    persist_zoho_token(pool, tenant_id, &token).await?;
    Ok(portal_id)
}

/// Portal id cho sync/push — list portals qua gateway loopback.
async fn ensure_zoho_portal_id_sync(pool: &PgPool, tenant_id: i64) -> Result<String, String> {
    let mut token = load_zoho_token(pool, tenant_id).await?;
    if let Some(pid) = token.portal_id.as_ref().filter(|s| !s.is_empty()) {
        return Ok(pid.clone());
    }
    let portals =
        crate::sync_worker_gateway::zoho_get_via_gateway("/api/v3/portals", None).await?;
    let portal_id = extract_first_zoho_portal_id(&portals)
        .ok_or_else(|| "Không tìm thấy portal Zoho Projects trong tài khoản".to_string())?;
    token.portal_id = Some(portal_id.clone());
    persist_zoho_token(pool, tenant_id, &token).await?;
    Ok(portal_id)
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
    let expires_in_sec = raw.get("expires_in").and_then(|v| v.as_i64());
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
        expires_in_sec,
        expires_at: token_expires_at_from_secs(expires_in_sec),
        portal_id: None,
        demo: false,
        oauth_connected_at: None,
    })
}

pub async fn load_zoho_token(pool: &PgPool, tenant_id: i64) -> Result<ZohoTokenConfig, String> {
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
    let expires_in_sec = raw.get("expires_in").and_then(|v| v.as_i64());
    Ok(ZohoTokenConfig {
        access_token,
        refresh_token: Some(refresh_token.to_string()),
        api_domain,
        token_type: raw
            .get("token_type")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        expires_in_sec,
        expires_at: token_expires_at_from_secs(expires_in_sec),
        portal_id: None,
        demo: false,
        oauth_connected_at: None,
    })
}

pub async fn zoho_get_with_refresh(
    pool: &PgPool,
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
            let oauth_connected_at = token.oauth_connected_at.clone();
            token = refresh_zoho_access_token(&st.http, &zoho, &rt).await?;
            token.portal_id = portal_id;
            token.oauth_connected_at = oauth_connected_at;
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
    if let Ok(token) = load_zoho_token(&st.pool, ctx.tenant_id).await {
        if token.demo {
            return json_error(
                StatusCode::SERVICE_UNAVAILABLE,
                "demo_token_rejected",
                DEMO_TOKEN_REJECTED,
            );
        }
    }
    match zoho_get_with_refresh(&st.pool, ctx.tenant_id, "/api/v3/portals").await {
        Ok((portals, token)) => {
            let portal_id = if token.portal_id.is_some() {
                token.portal_id.clone()
            } else {
                ensure_zoho_portal_id(&st.pool, ctx.tenant_id).await.ok()
            };
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
                portal_id.as_deref(),
            )
            .await;
            (
                StatusCode::OK,
                axum::Json(serde_json::json!({
                    "status": "ok",
                    "provider": ZOHO_PROVIDER,
                    "portals": portals,
                    "portal_id": portal_id
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

async fn existing_sf_provider_secret(pool: &PgPool, tenant_id: i64) -> Option<String> {
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
    None
}

async fn existing_zoho_provider_secret(pool: &PgPool, tenant_id: i64) -> Option<String> {
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
    None
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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BridgeFieldMapping {
    pub id: String,
    pub source_entity: String,
    pub source_field: String,
    pub target_entity: String,
    pub target_field: String,
    pub enabled: bool,
    pub label: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IntegrationBridgePublic {
    pub enabled: bool,
    pub direction: String,
    pub mappings: Vec<BridgeFieldMapping>,
    pub both_connected: bool,
}

#[derive(Debug, Deserialize)]
pub struct IntegrationBridgeWrite {
    pub enabled: bool,
    pub direction: String,
    pub mappings: Vec<BridgeFieldMapping>,
}

pub fn default_bridge_mappings() -> Vec<BridgeFieldMapping> {
    vec![
        BridgeFieldMapping {
            id: "opp_name".into(),
            source_entity: "opportunity".into(),
            source_field: "name".into(),
            target_entity: "project".into(),
            target_field: "name".into(),
            enabled: true,
            label: "Tên Opportunity (CRM) → tên Project (PM)".into(),
        },
        BridgeFieldMapping {
            id: "stage_status".into(),
            source_entity: "opportunity".into(),
            source_field: "stage".into(),
            target_entity: "project".into(),
            target_field: "status".into(),
            enabled: false,
            label: "Giai đoạn bán (Stage) → trạng thái dự án (tắt — Zoho cần object, không nhận chuỗi SF)".into(),
        },
        BridgeFieldMapping {
            id: "close_due".into(),
            source_entity: "opportunity".into(),
            source_field: "close_date".into(),
            target_entity: "task".into(),
            target_field: "due_date".into(),
            enabled: true,
            label: "Ngày chốt deal → deadline task giao hàng".into(),
        },
        BridgeFieldMapping {
            id: "account_owner".into(),
            source_entity: "account".into(),
            source_field: "name".into(),
            target_entity: "project".into(),
            target_field: "owner".into(),
            enabled: false,
            label: "Tên Account (khách) → owner/context dự án".into(),
        },
    ]
}

async fn integration_both_connected(pool: &PgPool, tenant_id: i64) -> bool {
    let rows = db::list_integrations(pool, tenant_id).await.unwrap_or_default();
    let sf = rows.iter().find(|r| r.provider == SF_PROVIDER);
    let zoho = rows.iter().find(|r| r.provider == ZOHO_PROVIDER);
    sf.map(|r| r.status.as_str()) == Some("connected")
        && zoho.map(|r| r.status.as_str()) == Some("connected")
}

pub async fn api_get_integration_bridge(ctx: &AdminCtx) -> Response {
    let Some(st) = STATE.get() else {
        return json_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "internal_error",
            "state not initialized",
        );
    };
    let both = integration_both_connected(&st.pool, ctx.tenant_id).await;
    let row = db::fetch_integration_bridge(&st.pool, ctx.tenant_id)
        .await
        .ok()
        .flatten();
    let (enabled, direction, mappings) = match row {
        Some(r) => {
            let mappings: Vec<BridgeFieldMapping> =
                serde_json::from_str(&r.mappings_json).unwrap_or_else(|_| default_bridge_mappings());
            (r.enabled != 0, r.direction, mappings)
        }
        None => (false, "salesforce_to_zoho".to_string(), default_bridge_mappings()),
    };
    (
        StatusCode::OK,
        axum::Json(IntegrationBridgePublic {
            enabled,
            direction,
            mappings,
            both_connected: both,
        }),
    )
        .into_response()
}

pub async fn api_put_integration_bridge(ctx: &AdminCtx, body: IntegrationBridgeWrite) -> Response {
    let Some(st) = STATE.get() else {
        return json_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "internal_error",
            "state not initialized",
        );
    };
    let direction = if body.direction.is_empty() {
        "salesforce_to_zoho".to_string()
    } else {
        body.direction.clone()
    };
    let mappings_json = match serde_json::to_string(&body.mappings) {
        Ok(j) => j,
        Err(e) => {
            return json_error(
                StatusCode::BAD_REQUEST,
                "bad_request",
                &format!("invalid mappings: {e}"),
            );
        }
    };
    match db::upsert_integration_bridge(
        &st.pool,
        ctx.tenant_id,
        body.enabled,
        &direction,
        &mappings_json,
    )
    .await
    {
        Ok(_) => {
            write_audit(
                &st.pool,
                ctx,
                "integration.bridge.update",
                "salesforce↔zoho",
                "success",
                None,
                Some(&format!("enabled={} mappings={}", body.enabled, body.mappings.len())),
            )
            .await;
            api_get_integration_bridge(ctx).await
        }
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            axum::Json(serde_json::json!({ "error": format!("{e}") })),
        )
            .into_response(),
    }
}

fn bridge_field_str(v: &serde_json::Value, field: &str) -> Option<String> {
    v.get(field).and_then(|x| {
        x.as_str()
            .map(|s| s.to_string())
            .or_else(|| x.as_i64().map(|n| n.to_string()))
            .or_else(|| x.as_f64().map(|n| n.to_string()))
    })
}

fn apply_bridge_mappings_for_opp(
    opp: &serde_json::Value,
    account: Option<&serde_json::Value>,
    mappings: &[BridgeFieldMapping],
) -> serde_json::Value {
    let mut project = serde_json::Map::new();
    let mut task = serde_json::Map::new();
    let mut mapping_ids = Vec::new();
    for m in mappings.iter().filter(|m| m.enabled) {
        let source = match m.source_entity.as_str() {
            "account" => account,
            "opportunity" => Some(opp),
            _ => None,
        };
        let Some(src) = source else { continue };
        let Some(val) = bridge_field_str(src, &m.source_field) else {
            continue;
        };
        mapping_ids.push(m.id.clone());
        match m.target_entity.as_str() {
            "project" => {
                project.insert(m.target_field.clone(), serde_json::Value::String(val));
            }
            "task" => {
                task.insert(m.target_field.clone(), serde_json::Value::String(val));
            }
            _ => {}
        }
    }
    serde_json::json!({
        "sf_opportunity_id": opp.get("id").cloned().unwrap_or(serde_json::Value::Null),
        "sf_opportunity_name": opp.get("name").cloned().unwrap_or(serde_json::Value::Null),
        "mapped_project": serde_json::Value::Object(project),
        "mapped_task": serde_json::Value::Object(task),
        "mapping_ids": mapping_ids,
    })
}

pub async fn run_integration_bridge(pool: &PgPool, tenant_id: i64) -> Result<serde_json::Value, String> {
    if !integration_both_connected(pool, tenant_id).await {
        return Err("Cần connected cả Salesforce và Zoho".into());
    }
    let row = db::fetch_integration_bridge(pool, tenant_id)
        .await
        .map_err(|e| format!("db: {e}"))?
        .ok_or_else(|| "Chưa lưu cấu hình bridge".to_string())?;
    if row.enabled == 0 {
        return Err("Bridge chưa bật — tick \"Bật bridge\" rồi Lưu".into());
    }
    let mappings: Vec<BridgeFieldMapping> =
        serde_json::from_str(&row.mappings_json).unwrap_or_else(|_| default_bridge_mappings());
    let enabled_count = mappings.iter().filter(|m| m.enabled).count();
    if enabled_count == 0 {
        return Err("Chưa chọn field map nào".into());
    }

    let opp_snap = db::fetch_latest_integration_snapshot(pool, tenant_id, SF_PROVIDER, "opportunity")
        .await
        .map_err(|e| format!("db: {e}"))?
        .ok_or_else(|| "Chưa có snapshot Opportunity — Đồng bộ snapshot Salesforce trước".to_string())?;
    let opps: Vec<serde_json::Value> = serde_json::from_str(&opp_snap.payload_json)
        .map_err(|e| format!("parse opportunity snapshot: {e}"))?;
    if opps.is_empty() {
        return Err("Snapshot Opportunity rỗng".into());
    }

    let acc_snap = db::fetch_latest_integration_snapshot(pool, tenant_id, SF_PROVIDER, "account")
        .await
        .ok()
        .flatten();
    let accounts: Vec<serde_json::Value> = acc_snap
        .as_ref()
        .and_then(|s| serde_json::from_str(&s.payload_json).ok())
        .unwrap_or_default();
    let default_acc = accounts.first();

    let mapped: Vec<serde_json::Value> = opps
        .iter()
        .map(|opp| apply_bridge_mappings_for_opp(opp, default_acc, &mappings))
        .collect();
    let count = save_snapshot(pool, tenant_id, BRIDGE_PROVIDER, "mapped_deals", &mapped).await?;

    Ok(serde_json::json!({
        "status": "ok",
        "provider": BRIDGE_PROVIDER,
        "entity_type": "mapped_deals",
        "records": count,
        "sf_opportunities": count,
        "direction": row.direction,
        "mappings_enabled": enabled_count,
        "note": "Đếm Opportunity trong snapshot Salesforce — không phải số dự án Zoho",
    }))
}

async fn try_run_integration_bridge(pool: &PgPool, tenant_id: i64) -> serde_json::Value {
    match run_integration_bridge(pool, tenant_id).await {
        Ok(v) => v,
        Err(e) => serde_json::json!({ "status": "skipped", "reason": e }),
    }
}

pub async fn api_run_integration_bridge(ctx: &AdminCtx) -> Response {
    let Some(st) = STATE.get() else {
        return json_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "internal_error",
            "state not initialized",
        );
    };
    match run_integration_bridge(&st.pool, ctx.tenant_id).await {
        Ok(summary) => {
            write_audit(
                &st.pool,
                ctx,
                "integration.bridge.run",
                "salesforce↔zoho",
                "success",
                None,
                Some(&format!(
                    "records={}",
                    summary.get("records").and_then(|v| v.as_i64()).unwrap_or(0)
                )),
            )
            .await;
            (StatusCode::OK, axum::Json(summary)).into_response()
        }
        Err(e) => {
            write_audit_failure(
                &st.pool,
                ctx,
                "integration.bridge.run",
                "salesforce↔zoho",
                None,
                Some(&e),
            )
            .await;
            (
                StatusCode::BAD_REQUEST,
                axum::Json(serde_json::json!({ "error": "bridge_failed", "message": e })),
            )
                .into_response()
        }
    }
}

const DEFAULT_ZOHO_ONBOARDING_TASKS: &[&str] = &["Họp triển khai", "Khai báo hạ tầng"];
const TASK_TEMPLATE_MOBILE: &[&str] = &[
    "Thiết kế UI/UX App",
    "Code Flutter",
    "Đẩy lên App Store",
];
const TASK_TEMPLATE_WEB: &[&str] = &[
    "Thiết kế Database",
    "Cấu hình Docker/Droplet",
    "Cài đặt SSL thientinh.io.vn",
];
const SYNC_LOG_RETAIN: i64 = 200;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OpportunityTemplateRule {
    pub id: String,
    pub label: String,
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default)]
    pub keywords: Vec<String>,
    #[serde(default)]
    pub tasks: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct OpportunityTemplateConfigStore {
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default)]
    pub rules: Vec<OpportunityTemplateRule>,
    #[serde(default)]
    pub fallback_tasks: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OpportunityTemplateConfigPublic {
    pub enabled: bool,
    pub rules: Vec<OpportunityTemplateRule>,
    pub fallback_tasks: Vec<String>,
    pub updated_by: Option<String>,
    pub updated_at: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct OpportunityTemplateConfigWriteBody {
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default)]
    pub rules: Vec<OpportunityTemplateRule>,
    #[serde(default)]
    pub fallback_tasks: Vec<String>,
}

fn default_true() -> bool {
    true
}

fn default_opportunity_template_config() -> OpportunityTemplateConfigStore {
    OpportunityTemplateConfigStore {
        enabled: true,
        rules: vec![
            OpportunityTemplateRule {
                id: "website_development".into(),
                label: "Website Development".into(),
                enabled: true,
                keywords: vec![
                    "website".into(),
                    "web".into(),
                    "frontend".into(),
                    "backend".into(),
                ],
                tasks: vec![
                    "Analysis".into(),
                    "Design".into(),
                    "Frontend".into(),
                    "Backend".into(),
                    "Testing".into(),
                    "Deployment".into(),
                ],
            },
            OpportunityTemplateRule {
                id: "erp_consulting".into(),
                label: "ERP Consulting".into(),
                enabled: true,
                keywords: vec!["erp".into(), "consulting".into(), "tư vấn".into()],
                tasks: vec![
                    "Kickoff".into(),
                    "Requirement".into(),
                    "Training".into(),
                    "Go-live".into(),
                ],
            },
        ],
        fallback_tasks: DEFAULT_ZOHO_ONBOARDING_TASKS
            .iter()
            .map(|s| (*s).to_string())
            .collect(),
    }
}

fn normalize_lines(lines: &[String]) -> Vec<String> {
    lines
        .iter()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .collect()
}

fn normalize_template_store(mut raw: OpportunityTemplateConfigStore) -> OpportunityTemplateConfigStore {
    raw.rules = raw
        .rules
        .into_iter()
        .enumerate()
        .filter_map(|(idx, mut r)| {
            let fallback_id = format!("rule_{}", idx + 1);
            r.id = if r.id.trim().is_empty() {
                fallback_id
            } else {
                r.id.trim().to_string()
            };
            r.label = if r.label.trim().is_empty() {
                format!("Rule {}", idx + 1)
            } else {
                r.label.trim().to_string()
            };
            r.keywords = normalize_lines(&r.keywords)
                .into_iter()
                .map(|s| s.to_ascii_lowercase())
                .collect();
            r.tasks = normalize_lines(&r.tasks);
            if r.tasks.is_empty() || r.keywords.is_empty() {
                return None;
            }
            Some(r)
        })
        .collect();
    raw.fallback_tasks = normalize_lines(&raw.fallback_tasks);
    if raw.fallback_tasks.is_empty() {
        raw.fallback_tasks = DEFAULT_ZOHO_ONBOARDING_TASKS
            .iter()
            .map(|s| (*s).to_string())
            .collect();
    }
    raw
}

async fn load_opportunity_template_config(
    pool: &PgPool,
    tenant_id: i64,
) -> OpportunityTemplateConfigStore {
    let default_cfg = default_opportunity_template_config();
    let row = db::fetch_integration_provider_config(pool, tenant_id, OPP_TEMPLATE_PROVIDER)
        .await
        .ok()
        .flatten();
    let Some(r) = row else {
        return default_cfg;
    };
    let Ok(json) = decrypt_integration_config(&r.config_encrypted) else {
        return default_cfg;
    };
    let Ok(raw) = serde_json::from_str::<OpportunityTemplateConfigStore>(&json) else {
        return default_cfg;
    };
    normalize_template_store(raw)
}

fn min_deal_amount_vnd() -> f64 {
    std::env::var("INTEGRATION_MIN_DEAL_AMOUNT")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(50_000_000.0)
}

fn zoho_push_delay_ms() -> u64 {
    std::env::var("INTEGRATION_PUSH_DELAY_MS")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(350)
}

fn zoho_retry_attempts() -> u32 {
    std::env::var("INTEGRATION_ZOHO_RETRY_ATTEMPTS")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(3)
}

fn zoho_retry_delay_secs() -> u64 {
    std::env::var("INTEGRATION_ZOHO_RETRY_DELAY_SECS")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(5)
}

fn json_number_field(v: &serde_json::Value, key: &str) -> Option<f64> {
    v.get(key).and_then(|x| {
        x.as_f64()
            .or_else(|| x.as_i64().map(|n| n as f64))
            .or_else(|| x.as_str().and_then(|s| s.replace(',', "").parse().ok()))
    })
}

fn strip_salesforce_name_noise(raw: &str) -> String {
    let mut s = raw.trim().to_string();
    for junk in [
        " - chốt",
        " - CHỐT",
        "-CHỐT",
        " CHỐT",
        " chốt",
        " - CHOT",
        " CHOT",
        "- CHOT",
    ] {
        let lower = s.to_ascii_lowercase();
        let needle = junk.to_ascii_lowercase();
        if let Some(pos) = lower.find(&needle) {
            s.truncate(pos);
        }
    }
    s.trim().trim_matches('-').trim().to_string()
}

fn title_case_token(token: &str) -> String {
    let lower = token.to_ascii_lowercase();
    match lower.as_str() {
        "cty" => "Công ty".into(),
        "tnhh" => "TNHH".into(),
        "" => String::new(),
        _ => {
            let mut chars = lower.chars();
            match chars.next() {
                None => String::new(),
                Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
            }
        }
    }
}

/// Chuẩn hóa tên khách hàng Salesforce trước khi map sang Zoho Projects.
fn normalize_sf_customer_name(raw: &str) -> String {
    let cleaned = strip_salesforce_name_noise(raw);
    if cleaned.is_empty() {
        return String::new();
    }
    cleaned
        .split_whitespace()
        .map(title_case_token)
        .filter(|w| !w.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
}

fn project_duration_days(amount: f64) -> i64 {
    if amount >= 100_000_000.0 {
        60
    } else {
        30
    }
}

fn add_days_to_sf_date(close_date: &str, days: i64) -> Option<String> {
    let parsed = chrono::NaiveDate::parse_from_str(close_date, "%Y-%m-%d").ok()?;
    Some(
        (parsed + chrono::Duration::days(days))
            .format("%Y-%m-%d")
            .to_string(),
    )
}

/// start/end cho Zoho — deal SF dev org có CloseDate cũ → anchor từ hôm nay.
fn zoho_project_date_range(close_date: Option<&str>, amount: f64) -> (String, String) {
    let duration = project_duration_days(amount);
    let today = chrono::Utc::now().date_naive();
    let start = close_date
        .and_then(|d| chrono::NaiveDate::parse_from_str(d, "%Y-%m-%d").ok())
        .filter(|d| *d >= today)
        .unwrap_or(today);
    let end = start + chrono::Duration::days(duration);
    (
        start.format("%Y-%m-%d").to_string(),
        end.format("%Y-%m-%d").to_string(),
    )
}

fn infer_task_template(
    name: &str,
    description: &str,
    product_type: &str,
    cfg: &OpportunityTemplateConfigStore,
) -> Vec<String> {
    if cfg.enabled {
        let hay = format!("{name} {description} {product_type}").to_ascii_lowercase();
        for rule in cfg.rules.iter().filter(|r| r.enabled) {
            if rule
                .keywords
                .iter()
                .any(|kw| !kw.is_empty() && hay.contains(kw))
            {
                return rule.tasks.clone();
            }
        }
        return cfg.fallback_tasks.clone();
    }
    let hay = format!("{name} {description} {product_type}").to_ascii_lowercase();
    let template = if hay.contains("mobile")
        || hay.contains("flutter")
        || hay.contains("app store")
        || hay.contains("ios")
        || hay.contains("android")
        || hay.contains("di động")
        || hay.contains("di dong")
    {
        TASK_TEMPLATE_MOBILE
    } else if hay.contains("web")
        || hay.contains("website")
        || hay.contains("hạ tầng")
        || hay.contains("ha tang")
        || hay.contains("infrastructure")
        || hay.contains("backend")
        || hay.contains("api")
        || hay.contains("docker")
        || hay.contains("droplet")
        || hay.contains("ssl")
    {
        TASK_TEMPLATE_WEB
    } else {
        DEFAULT_ZOHO_ONBOARDING_TASKS
    };
    template.iter().map(|s| (*s).to_string()).collect()
}

fn zoho_error_retryable(err: &str) -> bool {
    let e = err.to_ascii_lowercase();
    e.contains("429")
        || e.contains("502")
        || e.contains("503")
        || e.contains("504")
        || e.contains("timeout")
        || e.contains("connection")
        || e.contains("temporarily")
}

async fn zoho_post_json(
    pool: &PgPool,
    tenant_id: i64,
    path: &str,
    body: &serde_json::Value,
) -> Result<serde_json::Value, String> {
    let _ = (pool, tenant_id);
    crate::sync_worker_gateway::zoho_post_via_gateway(path, body).await
}

async fn zoho_put_json(
    pool: &PgPool,
    tenant_id: i64,
    path: &str,
    body: &serde_json::Value,
) -> Result<serde_json::Value, String> {
    let _ = (pool, tenant_id);
    crate::sync_worker_gateway::zoho_put_via_gateway(path, body).await
}

async fn zoho_post_json_with_retry(
    pool: &PgPool,
    tenant_id: i64,
    path: &str,
    body: &serde_json::Value,
) -> Result<serde_json::Value, String> {
    let attempts = zoho_retry_attempts();
    let delay_secs = zoho_retry_delay_secs();
    let mut last_err = String::new();
    for attempt in 1..=attempts {
        match zoho_post_json(pool, tenant_id, path, body).await {
            Ok(v) => return Ok(v),
            Err(e) => {
                last_err = e.clone();
                if !zoho_error_retryable(&e) || attempt == attempts {
                    return Err(e);
                }
                tracing::warn!(attempt, error = %e, "zoho POST retry scheduled");
                log_sync(
                    pool,
                    tenant_id,
                    "RETRY",
                    &format!("Zoho API lỗi tạm thời — thử lại sau {delay_secs}s (lần {attempt}/{attempts})"),
                    Some(&e),
                )
                .await;
                tokio::time::sleep(Duration::from_secs(delay_secs)).await;
            }
        }
    }
    Err(last_err)
}

/// Tên project Zoho = tên Opportunity trên Salesforce (không thêm prefix marketing).
fn zoho_project_name_from_opportunity(opportunity_name: &str) -> String {
    let trimmed = opportunity_name.trim();
    if trimmed.is_empty() {
        return "Dự án mới".into();
    }
    trimmed.to_string()
}

fn is_closed_won_stage(stage: &str) -> bool {
    let s = stage.to_ascii_lowercase();
    s.contains("closed won") || s == "closedwon" || s.contains("đã ký") || s.contains("chốt")
}

async fn list_zoho_project_names(
    pool: &PgPool,
    tenant_id: i64,
    portal_id: &str,
) -> Result<Vec<(String, String)>, String> {
    let _ = (pool, tenant_id);
    let raw = crate::sync_worker_gateway::zoho_get_via_gateway(
        &format!("/api/v3/portal/{portal_id}/projects"),
        None,
    )
    .await?;
    let items = extract_zoho_array(&raw, &["projects"]);
    Ok(items
        .iter()
        .map(|p| (zoho_id_str(p), p.get("name").and_then(|v| v.as_str()).unwrap_or("").to_string()))
        .filter(|(_, name)| !name.is_empty())
        .collect())
}

async fn create_zoho_project(
    pool: &PgPool,
    tenant_id: i64,
    portal_id: &str,
    name: &str,
    start_date: &str,
    end_date: &str,
    sf_opportunity_id: &str,
    amount_vnd: f64,
    bridge_project: &serde_json::Map<String, serde_json::Value>,
) -> Result<String, String> {
    let mut body = serde_json::Map::new();
    body.insert("name".into(), name.into());
    body.insert(
        "description".into(),
        format!(
            "Đồng bộ từ Salesforce CRM\nOpportunity ID: {sf_opportunity_id}\nGiá trị: {amount_vnd:.0} VNĐ"
        )
        .into(),
    );
    body.insert("start_date".into(), start_date.into());
    body.insert("end_date".into(), end_date.into());
    // Zoho owner/status cần object — bỏ qua string từ bridge SF.
    merge_bridge_fields(&mut body, bridge_project, &["name", "owner", "status"]);
    let raw = zoho_post_json_with_retry(
        pool,
        tenant_id,
        &format!("/api/v3/portal/{portal_id}/projects"),
        &serde_json::Value::Object(body),
    )
    .await?;
    let items = extract_zoho_array(&raw, &["projects", "project"]);
    if let Some(first) = items.first() {
        let id = zoho_id_str(first);
        if !id.is_empty() {
            return Ok(id);
        }
    }
    if let Some(id) = raw.get("id").or_else(|| raw.get("project_id")) {
        let s = id
            .as_str()
            .map(|x| x.to_string())
            .unwrap_or_else(|| id.as_i64().unwrap_or(0).to_string());
        if !s.is_empty() && s != "0" {
            return Ok(s);
        }
    }
    Err(format!("Zoho create project: missing id in response: {raw}"))
}

async fn create_zoho_tasks_for_project(
    pool: &PgPool,
    tenant_id: i64,
    portal_id: &str,
    project_id: &str,
    task_names: &[String],
    end_date: Option<&str>,
    bridge_task: &serde_json::Map<String, serde_json::Value>,
) -> Result<i64, String> {
    let mut created = 0_i64;
    for name in task_names {
        let mut body = serde_json::Map::new();
        body.insert("name".into(), name.clone().into());
        if let Some(ed) = end_date {
            body.insert("end_date".into(), ed.into());
        }
        merge_bridge_fields(&mut body, bridge_task, &["name", "status", "owner"]);
        zoho_post_json_with_retry(
            pool,
            tenant_id,
            &format!("/api/v3/portal/{portal_id}/projects/{project_id}/tasks"),
            &serde_json::Value::Object(body),
        )
        .await?;
        created += 1;
        tokio::time::sleep(Duration::from_millis(zoho_push_delay_ms())).await;
    }
    Ok(created)
}

async fn log_sync(
    pool: &PgPool,
    tenant_id: i64,
    status: &str,
    message: &str,
    error_detail: Option<&str>,
) {
    if let Err(e) = db::insert_sync_log(pool, tenant_id, status, message, error_detail).await {
        tracing::warn!(error = %e, "insert sync_log failed");
    }
    let _ = db::prune_sync_logs(pool, tenant_id, SYNC_LOG_RETAIN).await;
}

struct PushItem {
    sf_entity_type: &'static str,
    sf_id: String,
    opportunity_name: String,
    project_name: String,
    account_id: Option<String>,
    product_type: String,
    amount: f64,
    close_date: Option<String>,
    start_date: Option<String>,
    end_date: Option<String>,
    tasks: Vec<String>,
    bridge_project: serde_json::Map<String, serde_json::Value>,
    bridge_task: serde_json::Map<String, serde_json::Value>,
}

async fn load_snapshot_rows(
    pool: &PgPool,
    tenant_id: i64,
    entity_type: &str,
) -> Vec<serde_json::Value> {
    let Ok(Some(snap)) =
        db::fetch_latest_integration_snapshot(pool, tenant_id, SF_PROVIDER, entity_type).await
    else {
        return vec![];
    };
    serde_json::from_str(&snap.payload_json).unwrap_or_default()
}

async fn build_deal_document_context(
    pool: &PgPool,
    tenant_id: i64,
    item: &PushItem,
    zoho_project_id: &str,
) -> DealDocumentContext {
    let opps = load_snapshot_rows(pool, tenant_id, "opportunity").await;
    let accounts = load_snapshot_rows(pool, tenant_id, "account").await;
    let contacts = load_snapshot_rows(pool, tenant_id, "contact").await;

    let account_id = item.account_id.clone().or_else(|| {
        opps.iter()
            .find(|o| bridge_field_str(o, "id").as_deref() == Some(item.sf_id.as_str()))
            .and_then(|o| bridge_field_str(o, "account_id"))
    });

    let account = account_id.as_ref().and_then(|aid| {
        accounts
            .iter()
            .find(|a| bridge_field_str(a, "id").as_deref() == Some(aid.as_str()))
    });

    let contact = account_id.as_ref().and_then(|aid| {
        contacts.iter().find(|c| {
            bridge_field_str(c, "account_id").as_deref() == Some(aid.as_str())
        })
    });

    let customer_name = account
        .and_then(|a| bridge_field_str(a, "name"))
        .map(|n| normalize_sf_customer_name(&n))
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| item.opportunity_name.clone());

    DealDocumentContext {
        sf_id: item.sf_id.clone(),
        opportunity_name: item.opportunity_name.clone(),
        customer_name,
        amount: item.amount,
        close_date: item.close_date.clone(),
        contact_name: contact
            .and_then(|c| bridge_field_str(c, "name"))
            .unwrap_or_default(),
        contact_email: contact
            .and_then(|c| bridge_field_str(c, "email"))
            .unwrap_or_default(),
        industry: account
            .and_then(|a| bridge_field_str(a, "industry"))
            .unwrap_or_default(),
        product_type: item.product_type.clone(),
        zoho_project_id: zoho_project_id.to_string(),
    }
}

async fn attach_document_to_zoho_project(
    pool: &PgPool,
    tenant_id: i64,
    portal_id: &str,
    project_id: &str,
    project_name: &str,
    doc_id: i64,
) {
    let doc_url = document_download_url(doc_id);
    let description = format!(
        "Đồng bộ từ Salesforce CRM\n\nHợp đồng PDF: {doc_url}"
    );
    let body = serde_json::json!({
        "name": project_name,
        "description": description,
    });
    if let Err(e) = zoho_put_json(
        pool,
        tenant_id,
        &format!("/api/v3/portal/{portal_id}/projects/{project_id}"),
        &body,
    )
    .await
    {
        tracing::warn!(project_id, error = %e, "zoho project description update failed");
    }
}

async fn load_bridge_mapped_by_opp_id(
    pool: &PgPool,
    tenant_id: i64,
) -> Result<std::collections::HashMap<String, (serde_json::Map<String, serde_json::Value>, serde_json::Map<String, serde_json::Value>)>, String> {
    let mut out = std::collections::HashMap::new();
    let snap = db::fetch_latest_integration_snapshot(pool, tenant_id, BRIDGE_PROVIDER, "mapped_deals")
        .await
        .map_err(|e| format!("db: {e}"))?;
    let Some(snap) = snap else {
        return Ok(out);
    };
    let deals: Vec<serde_json::Value> =
        serde_json::from_str(&snap.payload_json).unwrap_or_default();
    for deal in deals {
        let sf_id = deal
            .get("sf_opportunity_id")
            .and_then(|v| v.as_str().map(String::from).or_else(|| v.as_i64().map(|n| n.to_string())))
            .unwrap_or_default();
        if sf_id.is_empty() {
            continue;
        }
        let project = deal
            .get("mapped_project")
            .and_then(|v| v.as_object())
            .cloned()
            .unwrap_or_default();
        let task = deal
            .get("mapped_task")
            .and_then(|v| v.as_object())
            .cloned()
            .unwrap_or_default();
        out.insert(sf_id, (project, task));
    }
    Ok(out)
}

fn merge_bridge_fields(
    body: &mut serde_json::Map<String, serde_json::Value>,
    bridge: &serde_json::Map<String, serde_json::Value>,
    skip: &[&str],
) {
    for (k, v) in bridge {
        if skip.contains(&k.as_str()) {
            continue;
        }
        if v.is_null() {
            continue;
        }
        if v.as_str().is_some_and(|s| s.is_empty()) {
            continue;
        }
        body.insert(k.clone(), v.clone());
    }
}

async fn collect_push_items(pool: &PgPool, tenant_id: i64) -> Result<Vec<PushItem>, String> {
    let min_amount = min_deal_amount_vnd();
    let mut items = Vec::new();
    let bridge_mapped = load_bridge_mapped_by_opp_id(pool, tenant_id).await.unwrap_or_default();
    let template_cfg = load_opportunity_template_config(pool, tenant_id).await;

    let opp_snap = db::fetch_latest_integration_snapshot(pool, tenant_id, SF_PROVIDER, "opportunity")
        .await
        .map_err(|e| format!("db: {e}"))?;
    let Some(snap) = opp_snap else {
        return Ok(items);
    };
    let opps: Vec<serde_json::Value> =
        serde_json::from_str(&snap.payload_json).unwrap_or_default();
    for opp in opps {
        let sf_id = bridge_field_str(&opp, "id").unwrap_or_default();
        let name = bridge_field_str(&opp, "name").unwrap_or_default();
        if sf_id.is_empty() || name.is_empty() {
            continue;
        }
        let stage = bridge_field_str(&opp, "stage").unwrap_or_default();
        if !is_closed_won_stage(&stage) {
            log_sync(
                pool,
                tenant_id,
                "SKIPPED",
                &format!(
                    "Middleware router: {sf_id} — chưa Closed Won (Stage: {stage})"
                ),
                None,
            )
            .await;
            continue;
        }
        let amount = json_number_field(&opp, "amount").unwrap_or(0.0);
        if amount < min_amount {
            log_sync(
                pool,
                tenant_id,
                "SKIPPED",
                &format!(
                    "Middleware router: {sf_id} — không đủ điều kiện giá trị (Amount {amount:.0} < {min_amount:.0} VNĐ)"
                ),
                None,
            )
            .await;
            continue;
        }
        let close_date = bridge_field_str(&opp, "close_date");
        let account_id = bridge_field_str(&opp, "account_id");
        let description = bridge_field_str(&opp, "description").unwrap_or_default();
        let product_type = bridge_field_str(&opp, "product_type").unwrap_or_default();
        let (start_date, end_date) = zoho_project_date_range(close_date.as_deref(), amount);
        let tasks = infer_task_template(&name, &description, &product_type, &template_cfg);
        let (bridge_project, bridge_task) = bridge_mapped
            .get(&sf_id)
            .cloned()
            .unwrap_or_default();
        items.push(PushItem {
            sf_entity_type: "opportunity",
            sf_id,
            opportunity_name: name.clone(),
            project_name: zoho_project_name_from_opportunity(&name),
            account_id,
            product_type: product_type.clone(),
            amount,
            close_date,
            start_date: Some(start_date),
            end_date: Some(end_date),
            tasks,
            bridge_project,
            bridge_task,
        });
    }

    Ok(items)
}

pub async fn push_salesforce_to_zoho(
    pool: &PgPool,
    tenant_id: i64,
) -> Result<serde_json::Value, String> {
    if !integration_both_connected(pool, tenant_id).await {
        return Err("Cần connected cả Salesforce và Zoho".into());
    }
    if let Ok(token) = load_sf_token(pool, tenant_id).await {
        reject_integration_demo_token(token.demo)?;
    }
    if let Ok(token) = load_zoho_token(pool, tenant_id).await {
        reject_integration_demo_token(token.demo)?;
    }
    let items = collect_push_items(pool, tenant_id).await?;
    if items.is_empty() {
        log_sync(
            pool,
            tenant_id,
            "SKIPPED",
            &format!(
                "Middleware: không có Opportunity Closed Won ≥ {:.0} VNĐ trong snapshot Salesforce",
                min_deal_amount_vnd()
            ),
            None,
        )
        .await;
        return Ok(serde_json::json!({
            "created": 0,
            "skipped": 0,
            "reason": "no_items",
            "middleware": {
                "min_deal_amount_vnd": min_deal_amount_vnd(),
                "router": "closed_won_and_min_amount",
            },
        }));
    }

    let portal_id = ensure_zoho_portal_id_sync(pool, tenant_id).await?;

    let existing = list_zoho_project_names(pool, tenant_id, &portal_id).await?;
    let mut created = 0_i64;
    let mut skipped = 0_i64;
    let mut tasks_created = 0_i64;
    let mut documents_created = 0_i64;
    let office_on = office_integration_configured(pool, tenant_id).await;

    for item in items {
        if let Some(link) = db::fetch_entity_link(pool, tenant_id, item.sf_entity_type, &item.sf_id)
            .await
            .map_err(|e| format!("db: {e}"))?
        {
            let stale_demo = link.zoho_id.starts_with("DEMO-");
            if !stale_demo {
                skipped += 1;
                log_sync(
                    pool,
                    tenant_id,
                    "SKIPPED",
                    &format!(
                        "Đã đồng bộ: {} → dự án \"{}\" (Zoho id {})",
                        item.sf_id, item.project_name, link.zoho_id
                    ),
                    None,
                )
                .await;
                continue;
            }
        }

        let project_id = if let Some((id, _)) = existing
            .iter()
            .find(|(_, n)| n.eq_ignore_ascii_case(&item.project_name))
        {
            id.clone()
        } else {
            let (sd, ed) = match (item.start_date.as_deref(), item.end_date.as_deref()) {
                (Some(s), Some(e)) => (s, e),
                _ => continue,
            };
            match create_zoho_project(
                pool,
                tenant_id,
                &portal_id,
                &item.project_name,
                sd,
                ed,
                &item.sf_id,
                item.amount,
                &item.bridge_project,
            )
            .await
            {
                Ok(id) => id,
                Err(e) => {
                    log_sync(
                        pool,
                        tenant_id,
                        "FAILED",
                        &format!("Tạo dự án \"{}\" thất bại sau retry", item.project_name),
                        Some(&e),
                    )
                    .await;
                    continue;
                }
            }
        };

        let mut item_tasks = 0_i64;
        match create_zoho_tasks_for_project(
            pool,
            tenant_id,
            &portal_id,
            &project_id,
            &item.tasks,
            item.end_date.as_deref(),
            &item.bridge_task,
        )
        .await
        {
            Ok(n) => {
                item_tasks = n;
                tasks_created += n;
            }
            Err(e) => {
                tracing::warn!(
                    project = %item.project_name,
                    error = %e,
                    "zoho task create skipped"
                );
            }
        }

        db::upsert_entity_link(
            pool,
            tenant_id,
            item.sf_entity_type,
            &item.sf_id,
            &project_id,
            Some(&item.project_name),
        )
        .await
        .map_err(|e| format!("db link: {e}"))?;

        let mut doc_note = String::new();
        if office_on {
            let doc_ctx = build_deal_document_context(pool, tenant_id, &item, &project_id).await;
            match generate_contract_for_deal(pool, tenant_id, &doc_ctx).await {
                Ok(doc_id) => {
                    documents_created += 1;
                    attach_document_to_zoho_project(
                        pool,
                        tenant_id,
                        &portal_id,
                        &project_id,
                        &item.project_name,
                        doc_id,
                    )
                    .await;
                    doc_note = format!(" + PDF #{doc_id}");
                    log_sync(
                        pool,
                        tenant_id,
                        "SUCCESS",
                        &format!(
                            "Document merge: Opp {} → hợp đồng PDF (#{doc_id})",
                            item.sf_id
                        ),
                        None,
                    )
                    .await;
                }
                Err(e) => {
                    log_sync(
                        pool,
                        tenant_id,
                        "FAILED",
                        &format!("Document merge Opp {} thất bại", item.sf_id),
                        Some(&e),
                    )
                    .await;
                }
            }
        }

        created += 1;
        log_sync(
            pool,
            tenant_id,
            "SUCCESS",
            &format!(
                "Middleware: \"{}\" → Zoho \"{}\" (SP: {}, {:.0} VNĐ, end {}) + {} task{doc_note}",
                item.sf_id,
                item.project_name,
                if item.product_type.is_empty() {
                    "—".to_string()
                } else {
                    item.product_type.clone()
                },
                item.amount,
                item.end_date.as_deref().unwrap_or("—"),
                item_tasks
            ),
            None,
        )
        .await;
        tokio::time::sleep(Duration::from_millis(zoho_push_delay_ms())).await;
    }

    db::touch_integration_last_sync(pool, tenant_id, ZOHO_PROVIDER)
        .await
        .map_err(|e| format!("db touch: {e}"))?;

    Ok(serde_json::json!({
        "created": created,
        "skipped": skipped,
        "tasks_created": tasks_created,
        "documents_created": documents_created,
        "office_integrator": office_on,
        "portal_id": portal_id,
        "middleware": {
            "min_deal_amount_vnd": min_deal_amount_vnd(),
            "router": "closed_won_and_min_amount",
            "batch_delay_ms": zoho_push_delay_ms(),
            "retry_attempts": zoho_retry_attempts(),
        },
    }))
}

/// Full pipeline: pull SF → bridge map → push Zoho Projects + tasks.
pub async fn run_full_sync_pipeline(pool: &PgPool, tenant_id: i64) -> Result<serde_json::Value, String> {
    let sf = sync_salesforce_snapshots(pool, tenant_id).await?;
    let bridge = try_run_integration_bridge(pool, tenant_id).await;
    if !integration_both_connected(pool, tenant_id).await {
        return Ok(serde_json::json!({
            "status": "ok",
            "salesforce": sf,
            "bridge": bridge,
            "push": {
                "status": "skipped",
                "reason": "need_both_connected",
                "message": "Cần kết nối cả Salesforce và Zoho Projects",
            },
        }));
    }
    let push = push_salesforce_to_zoho(pool, tenant_id).await?;
    Ok(serde_json::json!({
        "status": "ok",
        "salesforce": sf,
        "bridge": bridge,
        "push": push,
    }))
}

pub async fn api_sync_now(ctx: &AdminCtx) -> Response {
    let Some(st) = STATE.get() else {
        return json_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "internal_error",
            "state not initialized",
        );
    };
    match run_full_sync_pipeline(&st.pool, ctx.tenant_id).await {
        Ok(summary) => {
            write_audit(
                &st.pool,
                ctx,
                "integration.sync_now",
                "salesforce→zoho",
                "success",
                None,
                Some("full pipeline"),
            )
            .await;
            (StatusCode::OK, axum::Json(summary)).into_response()
        }
        Err(e) => {
            write_audit_failure(
                &st.pool,
                ctx,
                "integration.sync_now",
                "salesforce→zoho",
                None,
                Some(&e),
            )
            .await;
            (
                StatusCode::BAD_GATEWAY,
                axum::Json(serde_json::json!({ "error": "sync_now_failed", "message": e })),
            )
                .into_response()
        }
    }
}

pub async fn api_reset_integration_sync(ctx: &AdminCtx) -> Response {
    let Some(st) = STATE.get() else {
        return json_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "internal_error",
            "state not initialized",
        );
    };
    match db::delete_integration_entity_links(&st.pool, ctx.tenant_id).await {
        Ok(deleted) => {
            let docs_deleted =
                crate::integration_office::delete_tenant_documents(&st.pool, ctx.tenant_id)
                    .await
                    .unwrap_or(0);
            write_audit(
                &st.pool,
                ctx,
                "integration.sync.reset",
                "entity_links",
                "success",
                None,
                Some(&format!("deleted={deleted}, docs={docs_deleted}")),
            )
            .await;
            (
                StatusCode::OK,
                axum::Json(serde_json::json!({
                    "status": "ok",
                    "entity_links_deleted": deleted,
                    "documents_deleted": docs_deleted,
                })),
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

pub async fn api_list_sync_logs(ctx: &AdminCtx) -> Response {
    let Some(st) = STATE.get() else {
        return json_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "internal_error",
            "state not initialized",
        );
    };
    match db::list_sync_logs(&st.pool, ctx.tenant_id, 50).await {
        Ok(rows) => (StatusCode::OK, axum::Json(rows)).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            axum::Json(serde_json::json!({ "error": format!("{e}") })),
        )
            .into_response(),
    }
}

async fn maybe_refresh_integration_tokens(pool: &PgPool, tenant_id: i64) {
    let Some(st) = STATE.get() else { return };
    if let Ok(token) = load_zoho_token(pool, tenant_id).await {
        if !token.demo && token_expires_soon(token.expires_at.as_deref()) {
            if let Some(rt) = token.refresh_token.as_deref() {
                if let Some(zoho) = zoho_provider_config(pool, tenant_id).await {
                    if let Ok(mut fresh) = refresh_zoho_access_token(&st.http, &zoho, rt).await {
                        fresh.portal_id = token.portal_id;
                        if let Ok(json) = serde_json::to_string(&fresh) {
                            if let Ok(enc) = encrypt_integration_config(&json) {
                                let _ = db::upsert_integration_config(
                                    pool,
                                    tenant_id,
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
        }
    }
    if let Ok(token) = load_sf_token(pool, tenant_id).await {
        if !token.demo && token_expires_soon(token.expires_at.as_deref()) {
            if let Some(rt) = token.refresh_token.as_deref() {
                if let Some(sf) = salesforce_provider_config(pool, tenant_id).await {
                    if let Ok(mut fresh) = refresh_access_token(&st.http, &sf, rt).await {
                        if fresh.instance_url.is_empty() {
                            fresh.instance_url = token.instance_url.clone();
                        }
                        if let Ok(json) = serde_json::to_string(&fresh) {
                            if let Ok(enc) = encrypt_integration_config(&json) {
                                let _ = db::upsert_integration_config(
                                    pool,
                                    tenant_id,
                                    SF_PROVIDER,
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
        }
    }
}

// --- Transformation Engine (Integration Platform) ---

pub async fn list_zoho_tasks_as_canonical_contacts(
    pool: &PgPool,
    tenant_id: i64,
) -> Result<Vec<u8>, String> {
    ensure_integration_connected(pool, tenant_id, ZOHO_PROVIDER).await?;
    let portal_id = ensure_zoho_portal_id(pool, tenant_id).await?;
    let (projects_raw, _) =
        zoho_get_with_refresh(pool, tenant_id, &format!("/api/v3/portal/{portal_id}/projects")).await?;
    let projects = extract_zoho_array(&projects_raw, &["projects"]);
    let project_id = projects
        .first()
        .map(|p| zoho_id_str(p))
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "Chưa có project Zoho — tạo project trước".to_string())?;
    let (tasks_raw, _) = zoho_get_with_refresh(
        pool,
        tenant_id,
        &format!("/api/v3/portal/{portal_id}/projects/{project_id}/tasks"),
    )
    .await?;
    let tasks = extract_zoho_array(&tasks_raw, &["tasks"]);
    let contacts: Vec<serde_json::Value> = tasks
        .iter()
        .map(|t| crate::transform::zoho_projects_to_canonical_contact(t))
        .collect();
    serde_json::to_vec(&serde_json::json!({
        "entity": "contact",
        "format": "canonical",
        "target": "zoho_projects",
        "project_id": project_id,
        "count": contacts.len(),
        "data": contacts
    }))
    .map_err(|e| format!("serialize: {e}"))
}

pub async fn create_zoho_task_from_canonical_contact(
    pool: &PgPool,
    tenant_id: i64,
    canonical: &serde_json::Value,
) -> Result<Vec<u8>, String> {
    ensure_integration_connected(pool, tenant_id, ZOHO_PROVIDER).await?;
    let portal_id = ensure_zoho_portal_id(pool, tenant_id).await?;
    let (projects_raw, _) =
        zoho_get_with_refresh(pool, tenant_id, &format!("/api/v3/portal/{portal_id}/projects")).await?;
    let projects = extract_zoho_array(&projects_raw, &["projects"]);
    let project_id = projects
        .first()
        .map(|p| zoho_id_str(p))
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "Chưa có project Zoho".to_string())?;
    let body = crate::transform::canonical_to_zoho_projects_task(canonical);
    let created = zoho_post_json(
        pool,
        tenant_id,
        &format!("/api/v3/portal/{portal_id}/projects/{project_id}/tasks"),
        &body,
    )
    .await?;
    let canonical_out = crate::transform::zoho_projects_to_canonical_contact(&created);
    serde_json::to_vec(&serde_json::json!({
        "entity": "contact",
        "format": "canonical",
        "target": "zoho_projects",
        "project_id": project_id,
        "zoho_payload": body,
        "data": canonical_out
    }))
    .map_err(|e| format!("serialize: {e}"))
}

/// Salesforce Contact → canonical → Zoho Projects task (demo câu hỏi hội đồng).
pub async fn sync_salesforce_contact_to_zoho(
    pool: &PgPool,
    tenant_id: i64,
    salesforce_contact_id: &str,
    zoho_project_id: Option<&str>,
) -> Result<serde_json::Value, String> {
    if !integration_both_connected(pool, tenant_id).await {
        return Err("Cần Salesforce + Zoho connected".into());
    }
    let contact_id = salesforce_contact_id.trim();
    if !contact_id.starts_with("003") {
        return Err("Salesforce Contact Id phải bắt đầu bằng 003".into());
    }
    let sf_path = format!("/sobjects/Contact/{contact_id}");
    let (sf_status, bytes, _) = sf_request_raw_with_refresh(pool, tenant_id, "GET", &sf_path, None, None, None)
        .await?;
    let sf_record: serde_json::Value =
        serde_json::from_slice(&bytes).map_err(|e| format!("parse sf contact: {e}"))?;
    if !sf_status.is_success() {
        let code = sf_record
            .get(0)
            .and_then(|v| v.get("errorCode"))
            .and_then(|v| v.as_str())
            .unwrap_or("SF_ERROR");
        let message = sf_record
            .get(0)
            .and_then(|v| v.get("message"))
            .and_then(|v| v.as_str())
            .unwrap_or("Salesforce API failed");
        return Err(format!("{code}: {message}"));
    }
    let canonical = crate::transform::salesforce_to_canonical_contact(&sf_record);
    let zoho_body = crate::transform::canonical_to_zoho_projects_task(&canonical);

    let portal_id = ensure_zoho_portal_id(pool, tenant_id).await?;
    let project_id = if let Some(pid) = zoho_project_id.filter(|s| !s.is_empty()) {
        pid.to_string()
    } else {
        let (projects_raw, _) = zoho_get_with_refresh(
            pool,
            tenant_id,
            &format!("/api/v3/portal/{portal_id}/projects"),
        )
        .await?;
        let projects = extract_zoho_array(&projects_raw, &["projects"]);
        projects
            .first()
            .map(|p| zoho_id_str(p))
            .filter(|s| !s.is_empty())
            .ok_or_else(|| "Chưa có project Zoho — chỉ định zoho_project_id".to_string())?
    };

    let zoho_resp = zoho_post_json(
        pool,
        tenant_id,
        &format!("/api/v3/portal/{portal_id}/projects/{project_id}/tasks"),
        &zoho_body,
    )
    .await?;

    Ok(serde_json::json!({
        "status": "synced",
        "pipeline": ["salesforce_contact", "canonical", "zoho_projects_task"],
        "salesforce": {
            "id": salesforce_contact_id,
            "raw": sf_record
        },
        "canonical": canonical,
        "zoho": {
            "project_id": project_id,
            "request": zoho_body,
            "response": zoho_resp
        }
    }))
}

#[derive(Debug, Deserialize)]
pub struct TransformPreviewBody {
    pub provider: String,
    pub entity: String,
    pub payload: serde_json::Value,
}

pub async fn api_get_transform_profile(_ctx: &AdminCtx) -> Response {
    (
        StatusCode::OK,
        axum::Json(crate::transform::transform_profile()),
    )
        .into_response()
}

pub async fn api_post_transform_preview(
    _ctx: &AdminCtx,
    body: TransformPreviewBody,
) -> Response {
    let provider = match body.provider.to_ascii_lowercase().as_str() {
        "sf" | "salesforce" => crate::transform::TransformProvider::Salesforce,
        "zoho" | "zoho_projects" => crate::transform::TransformProvider::ZohoProjects,
        _ => {
            return json_error(
                StatusCode::BAD_REQUEST,
                "bad_request",
                "provider must be salesforce or zoho_projects",
            );
        }
    };
    let entity = match body.entity.to_ascii_lowercase().as_str() {
        "contact" | "contacts" => crate::transform::TransformEntity::Contact,
        _ => {
            return json_error(
                StatusCode::BAD_REQUEST,
                "bad_request",
                "entity must be contact",
            );
        }
    };
    match crate::transform::preview_transform(provider, entity, &body.payload) {
        Ok(canonical) => (
            StatusCode::OK,
            axum::Json(serde_json::json!({
                "canonical": canonical,
                "profile": crate::transform::transform_profile()
            })),
        )
            .into_response(),
        Err(e) => json_error(StatusCode::BAD_REQUEST, "transform_failed", &e),
    }
}

#[derive(Debug, Deserialize)]
pub struct SyncContactBody {
    pub salesforce_contact_id: String,
    pub zoho_project_id: Option<String>,
}

pub async fn api_sync_contact_sf_to_zoho(ctx: &AdminCtx, body: SyncContactBody) -> Response {
    let Some(st) = STATE.get() else {
        return json_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "internal_error",
            "state not initialized",
        );
    };
    if body.salesforce_contact_id.trim().is_empty() {
        return json_error(
            StatusCode::BAD_REQUEST,
            "bad_request",
            "salesforce_contact_id required",
        );
    }
    match sync_salesforce_contact_to_zoho(
        &st.pool,
        ctx.tenant_id,
        body.salesforce_contact_id.trim(),
        body.zoho_project_id.as_deref(),
    )
    .await
    {
        Ok(result) => {
            write_audit(
                &st.pool,
                ctx,
                "integration.transform.sync_contact",
                &body.salesforce_contact_id,
                "success",
                None,
                Some("sf→canonical→zoho"),
            )
            .await;
            (StatusCode::OK, axum::Json(result)).into_response()
        }
        Err(e) => {
            write_audit_failure(
                &st.pool,
                ctx,
                "integration.transform.sync_contact",
                &body.salesforce_contact_id,
                None,
                Some(&e),
            )
            .await;
            json_error(StatusCode::BAD_GATEWAY, "sync_failed", &e)
        }
    }
}

fn template_config_public(
    cfg: OpportunityTemplateConfigStore,
    updated_by: Option<String>,
    updated_at: Option<String>,
) -> OpportunityTemplateConfigPublic {
    OpportunityTemplateConfigPublic {
        enabled: cfg.enabled,
        rules: cfg.rules,
        fallback_tasks: cfg.fallback_tasks,
        updated_by,
        updated_at,
    }
}

pub async fn api_get_opportunity_templates(ctx: &AdminCtx) -> Response {
    let Some(st) = STATE.get() else {
        return json_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "internal_error",
            "state not initialized",
        );
    };
    let row = db::fetch_integration_provider_config(&st.pool, ctx.tenant_id, OPP_TEMPLATE_PROVIDER)
        .await
        .ok()
        .flatten();
    let cfg = load_opportunity_template_config(&st.pool, ctx.tenant_id).await;
    let (updated_by, updated_at) = row
        .map(|r| (Some(r.updated_by), Some(r.updated_at)))
        .unwrap_or((None, None));
    (StatusCode::OK, axum::Json(template_config_public(cfg, updated_by, updated_at))).into_response()
}

fn template_validation_fields(body: &OpportunityTemplateConfigWriteBody) -> serde_json::Map<String, serde_json::Value> {
    let mut fields = serde_json::Map::new();
    if body.rules.is_empty() {
        fields.insert(
            "rules".into(),
            serde_json::Value::String("Cần ít nhất 1 project template".into()),
        );
    }
    for (idx, rule) in body.rules.iter().enumerate() {
        if normalize_lines(&rule.keywords).is_empty() {
            fields.insert(
                format!("rules.{idx}.keywords"),
                serde_json::Value::String("Thiếu từ khóa match".into()),
            );
        }
        if normalize_lines(&rule.tasks).is_empty() {
            fields.insert(
                format!("rules.{idx}.tasks"),
                serde_json::Value::String("Thiếu danh sách task".into()),
            );
        }
    }
    if normalize_lines(&body.fallback_tasks).is_empty() {
        fields.insert(
            "fallback_tasks".into(),
            serde_json::Value::String("Thiếu task fallback".into()),
        );
    }
    fields
}

pub async fn api_put_opportunity_templates(
    ctx: &AdminCtx,
    body: OpportunityTemplateConfigWriteBody,
) -> Response {
    let Some(st) = STATE.get() else {
        return json_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "internal_error",
            "state not initialized",
        );
    };
    let fields = template_validation_fields(&body);
    if !fields.is_empty() {
        return json_error_fields(
            StatusCode::BAD_REQUEST,
            "validation_failed",
            "Kiểm tra template được đánh dấu",
            fields,
        );
    }
    let store = normalize_template_store(OpportunityTemplateConfigStore {
        enabled: body.enabled,
        rules: body.rules,
        fallback_tasks: body.fallback_tasks,
    });
    let json = match serde_json::to_string(&store) {
        Ok(j) => j,
        Err(e) => {
            return json_error(
                StatusCode::INTERNAL_SERVER_ERROR,
                "serialize_failed",
                &format!("{e}"),
            );
        }
    };
    let enc = match encrypt_integration_config(&json) {
        Ok(e) => e,
        Err(e) => {
            return json_error(
                StatusCode::INTERNAL_SERVER_ERROR,
                "encrypt_failed",
                &format!("{e}"),
            );
        }
    };
    if let Err(e) = db::upsert_integration_provider_config(
        &st.pool,
        ctx.tenant_id,
        OPP_TEMPLATE_PROVIDER,
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
        "integration.opportunity_templates.update",
        OPP_TEMPLATE_PROVIDER,
        "success",
        None,
        Some("template_config"),
    )
    .await;
    api_get_opportunity_templates(ctx).await
}

/// Background worker: refresh tokens + full sync every N minutes (default 15).
pub fn spawn_integration_sync_worker(pool: PgPool) {
    let interval_mins: u64 = std::env::var("INTEGRATION_SYNC_INTERVAL_MINS")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(15);
    if interval_mins == 0 {
        tracing::info!("integration background sync disabled (INTEGRATION_SYNC_INTERVAL_MINS=0)");
        return;
    }
    tokio::spawn(async move {
        let period = Duration::from_secs(interval_mins * 60);
        let mut ticker = tokio::time::interval(period);
        ticker.tick().await;
        loop {
            ticker.tick().await;
            let tenants = db::list_tenant_ids(&pool).await.unwrap_or_else(|e| {
                tracing::warn!(error = %e, "list tenants for sync worker failed");
                vec![1]
            });
            for tenant_id in tenants {
                if !integration_both_connected(&pool, tenant_id).await {
                    continue;
                }
                maybe_refresh_integration_tokens(&pool, tenant_id).await;
                match run_full_sync_pipeline(&pool, tenant_id).await {
                    Ok(summary) => {
                        tracing::info!(
                            tenant_id,
                            push_created = summary
                                .get("push")
                                .and_then(|p| p.get("created"))
                                .and_then(|v| v.as_i64())
                                .unwrap_or(0),
                            "background integration sync ok"
                        );
                    }
                    Err(e) => {
                        tracing::warn!(tenant_id, error = %e, "background integration sync failed");
                    }
                }
            }
        }
    });
    tracing::info!(
        interval_mins,
        "integration background sync worker started"
    );
}

#[cfg(test)]
mod middleware_tests {
    use super::*;

    #[test]
    fn normalize_strips_chot_and_title_cases() {
        let s = normalize_sf_customer_name("cty tnhh nguyen van a - CHOT");
        assert!(s.contains("Công ty"));
        assert!(s.contains("TNHH"));
        assert!(!s.to_ascii_lowercase().contains("chốt"));
    }

    #[test]
    fn project_name_uses_opportunity_name() {
        let name = zoho_project_name_from_opportunity(
            "Triển khai giải pháp ERP cho Công ty ABC",
        );
        assert_eq!(name, "Triển khai giải pháp ERP cho Công ty ABC");
        assert!(!name.contains("VIP"));
    }

    #[test]
    fn task_template_mobile_from_product_type() {
        let cfg = OpportunityTemplateConfigStore {
            enabled: false,
            rules: vec![],
            fallback_tasks: vec![],
        };
        let tasks = infer_task_template("", "", "Gói Mobile App Flutter", &cfg);
        assert_eq!(tasks.len(), TASK_TEMPLATE_MOBILE.len());
        assert!(tasks[0].contains("UI/UX"));
    }

    #[test]
    fn task_template_web_from_product_type() {
        let cfg = OpportunityTemplateConfigStore {
            enabled: false,
            rules: vec![],
            fallback_tasks: vec![],
        };
        let tasks = infer_task_template("", "", "Website / Hạ tầng", &cfg);
        assert_eq!(tasks.len(), TASK_TEMPLATE_WEB.len());
        assert!(tasks.iter().any(|t| t.contains("Docker")));
    }
}
