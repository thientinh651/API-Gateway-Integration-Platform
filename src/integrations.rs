//! Salesforce & Zoho Projects OAuth connectors.
#![allow(dead_code)]

use axum::{
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Redirect, Response},
};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use std::time::{Duration, Instant};

use crate::admin_auth::{AdminCtx, write_audit, write_audit_failure};
use crate::crypto::{decrypt_integration_config, encrypt_integration_config};
use crate::db::{self, IntegrationPublic};
use crate::{STATE, json_error, json_error_fields};
use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use sha2::{Digest, Sha256};

const SF_PROVIDER: &str = "salesforce";
const ZOHO_PROVIDER: &str = "zoho_projects";
const FLOW_SALES_TO_DELIVERY: &str = "sales_to_delivery";
/// Catalog flow: Zoho báo dự án hoàn thành → cập nhật Opportunity trên Salesforce.
const FLOW_DELIVERY_TO_SALES: &str = "delivery_to_sales";
const OAUTH_STATE_TTL: Duration = Duration::from_secs(600);

/// Typed integration events — extensible catalog for pipeline observability.
#[derive(Clone, Copy, Debug)]
enum IntegrationEventType {
    PipelineStarted,
    PipelineCompleted,
    SnapshotSynced,
    DealFiltered,
    EntitySkipped,
    EntityPushed,
    EntityPushFailed,
    EntityLinkStale,
    UpstreamRetry,
}

impl IntegrationEventType {
    fn as_str(self) -> &'static str {
        match self {
            Self::PipelineStarted => "pipeline_started",
            Self::PipelineCompleted => "pipeline_completed",
            Self::SnapshotSynced => "snapshot_synced",
            Self::DealFiltered => "deal_filtered",
            Self::EntitySkipped => "entity_skipped",
            Self::EntityPushed => "entity_pushed",
            Self::EntityPushFailed => "entity_push_failed",
            Self::EntityLinkStale => "entity_link_stale",
            Self::UpstreamRetry => "upstream_retry",
        }
    }
}

#[derive(Clone, Default)]
struct SyncEventOpts<'a> {
    event_type: Option<IntegrationEventType>,
    flow_type: Option<&'static str>,
    source_provider: Option<&'static str>,
    target_provider: Option<&'static str>,
    correlation_id: Option<&'a str>,
    metadata_json: Option<String>,
}

impl<'a> SyncEventOpts<'a> {
    fn sales_to_delivery(correlation_id: Option<&'a str>) -> Self {
        Self {
            flow_type: Some(FLOW_SALES_TO_DELIVERY),
            source_provider: Some(SF_PROVIDER),
            target_provider: Some(ZOHO_PROVIDER),
            correlation_id,
            ..Default::default()
        }
    }

    fn delivery_to_sales(correlation_id: Option<&'a str>) -> Self {
        Self {
            flow_type: Some(FLOW_DELIVERY_TO_SALES),
            source_provider: Some(ZOHO_PROVIDER),
            target_provider: Some(SF_PROVIDER),
            correlation_id,
            ..Default::default()
        }
    }

    fn with_event(mut self, event_type: IntegrationEventType) -> Self {
        self.event_type = Some(event_type);
        self
    }

    fn with_metadata(mut self, metadata: serde_json::Value) -> Self {
        self.metadata_json = Some(metadata.to_string());
        self
    }
}

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

async fn salesforce_provider_config(
    pool: &PgPool,
    tenant_id: i64,
) -> Option<SalesforceProviderConfig> {
    if let Ok(Some(row)) = db::fetch_integration_provider_config(pool, tenant_id, SF_PROVIDER).await
    {
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
    if let Ok(Some(row)) =
        db::fetch_integration_provider_config(pool, tenant_id, ZOHO_PROVIDER).await
    {
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
            let base = trimmed
                .trim_end_matches("/integrations")
                .trim_end_matches('/');
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
    for provider in [SF_PROVIDER, ZOHO_PROVIDER] {
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
    let mut out: Vec<IntegrationPublic> = rows
        .into_iter()
        .filter(|r| r.provider == SF_PROVIDER || r.provider == ZOHO_PROVIDER)
        .collect();
    let has_sf = out.iter().any(|r| r.provider == SF_PROVIDER);
    let has_zoho = out.iter().any(|r| r.provider == ZOHO_PROVIDER);
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
    for r in &mut out {
        if r.provider == SF_PROVIDER {
            r.label = "Salesforce".into();
        } else if r.provider == ZOHO_PROVIDER {
            r.label = "Zoho Projects".into();
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
            let zoho_cfg = zoho_provider_config(&st.pool, ctx.tenant_id)
                .await
                .is_some();
            let sf_cfg = salesforce_provider_config(&st.pool, ctx.tenant_id)
                .await
                .is_some();
            for r in &mut out {
                if r.provider == ZOHO_PROVIDER {
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
    if let Err(e) =
        db::set_integration_status(&st.pool, ctx.tenant_id, SF_PROVIDER, "pending", None).await
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
    let pending =
        match resolve_oauth_pending(&st.pool, &st.oauth_pending, &state, SF_PROVIDER).await {
            Some(p) => p,
            None => return redirect_ui_error("invalid_state", Some(SF_PROVIDER), None),
        };
    if pending.valid_until < Instant::now() {
        return redirect_ui_error("state_expired", Some(SF_PROVIDER), None);
    }
    let Some(sf) = salesforce_provider_config(&st.pool, pending.tenant_id).await else {
        return redirect_ui_error("not_configured", Some(SF_PROVIDER), None);
    };
    let mut token =
        match exchange_code(&st.http, &sf, &code, pending.pkce_verifier.as_deref()).await {
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
    let val: serde_json::Value = serde_json::from_str(&body).map_err(|e| format!("json: {e}"))?;
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
    Some(IntegrationProxyTarget { provider, api_path })
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
    let mut req = st
        .http
        .request(req_method, &url)
        .bearer_auth(&token.access_token);
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
                .request(
                    reqwest::Method::from_bytes(method.as_bytes()).unwrap(),
                    &url,
                )
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
    let mut token = ensure_zoho_token_fresh(pool, tenant_id).await?;
    let suffix = integration_suffix_safe(path)?;
    let base = zoho_projects_api_base(&zoho.accounts_url);
    let mut url = format!("{base}{suffix}");
    if let Some(q) = query.filter(|s| !s.is_empty()) {
        url = crate::route_match::append_query_to_upstream_url(&url, q);
    }
    let req_method = reqwest::Method::from_bytes(method.as_bytes())
        .map_err(|_| format!("unsupported method {method}"))?;
    let auth = format!("Zoho-oauthtoken {}", token.access_token);
    let mut req = st
        .http
        .request(req_method, &url)
        .header("Authorization", auth.clone());
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
            token = match refresh_zoho_access_token(&st.http, &zoho, &rt).await {
                Ok(t) => t,
                Err(e) => {
                    mark_zoho_token_error(pool, tenant_id, &e).await;
                    return Err(oauth_exchange_user_message("Zoho", &e));
                }
            };
            token.portal_id = portal_id;
            token.oauth_connected_at = oauth_connected_at;
            let json = serde_json::to_string(&token).map_err(|e| format!("serialize: {e}"))?;
            let enc = encrypt_integration_config(&json)?;
            db::upsert_integration_config(pool, tenant_id, ZOHO_PROVIDER, "connected", &enc, None)
                .await
                .map_err(|e| format!("db save refresh: {e}"))?;
            let mut req2 = st
                .http
                .request(
                    reqwest::Method::from_bytes(method.as_bytes()).unwrap(),
                    &url,
                )
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
    if status == reqwest::StatusCode::UNAUTHORIZED {
        let preview = String::from_utf8_lossy(&bytes);
        mark_zoho_token_error(pool, tenant_id, &preview).await;
    }
    Ok((status, bytes.to_vec(), ct))
}

fn integration_proxy_http_response(
    status: reqwest::StatusCode,
    body: Vec<u8>,
    content_type: Option<String>,
) -> Response {
    let axum_status = StatusCode::from_u16(status.as_u16()).unwrap_or(StatusCode::BAD_GATEWAY);
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
        Err(e) => json_error(StatusCode::BAD_GATEWAY, "integration_proxy_failed", &e),
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

fn map_sf_tasks(records: &[serde_json::Value]) -> Vec<serde_json::Value> {
    records
        .iter()
        .map(|r| {
            serde_json::json!({
                "id": sf_field_str(r, "Id"),
                "name": sf_field_str(r, "Subject"),
                "status": sf_field_str(r, "Status"),
                "due_date": sf_field_str(r, "ActivityDate"),
                "what_id": sf_field_str(r, "WhatId"),
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
                "status": extract_zoho_project_status_label(p),
                "owner": p.get("owner_name").and_then(|v| v.as_str()).unwrap_or(""),
            })
        })
        .collect()
}

/// Lấy nhãn trạng thái nghiệp vụ (vd «Đã hoàn tất»).
///
/// Zoho Projects API v3 thường trả `status` dạng object:
/// `{ "name": "Đã hoàn tất", "is_closed_type": true, ... }` — không phải chuỗi `active`.
fn extract_zoho_project_status_label(p: &serde_json::Value) -> String {
    if let Some(s) = p
        .get("custom_status_name")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        return s.to_string();
    }

    // API v3: status / custom_status là object có name + is_closed_type.
    for key in ["status", "custom_status", "project_status"] {
        if let Some(obj) = p.get(key).and_then(|v| v.as_object()) {
            for name_key in ["name", "status_name", "value"] {
                if let Some(s) = obj.get(name_key).and_then(|v| v.as_str()).map(str::trim) {
                    if !s.is_empty() && !is_zoho_lifecycle_status(s) {
                        return s.to_string();
                    }
                }
            }
            if obj.get("is_closed_type").and_then(|v| v.as_bool()) == Some(true)
                || obj.get("is_closed").and_then(|v| v.as_bool()) == Some(true)
            {
                return "completed".into();
            }
        }
    }

    for key in ["status_name", "project_status", "custom_status"] {
        if let Some(s) = p.get(key).and_then(|v| v.as_str()).map(str::trim) {
            if !s.is_empty() && !is_zoho_lifecycle_status(s) {
                return s.to_string();
            }
        }
    }
    if let Some(s) = p.get("status").and_then(|v| v.as_str()).map(str::trim) {
        if !s.is_empty() && !is_zoho_lifecycle_status(s) {
            return s.to_string();
        }
    }
    String::new()
}

fn is_zoho_lifecycle_status(status: &str) -> bool {
    matches!(
        status.trim().to_ascii_lowercase().as_str(),
        "active" | "archived" | "template" | "active_projects" | "archived_projects"
    )
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

pub async fn sync_salesforce_snapshots(
    pool: &PgPool,
    tenant_id: i64,
) -> Result<serde_json::Value, String> {
    if let Ok(token) = load_sf_token(pool, tenant_id).await {
        reject_integration_demo_token(token.demo)?;
    }
    ensure_integration_connected(pool, tenant_id, SF_PROVIDER).await?;
    let opp_soql = sf_opportunity_soql();
    let opp_q = urlencoding::encode(&opp_soql);
    let opp_raw =
        crate::sync_worker_gateway::sf_get_via_gateway(&format!("/query?q={opp_q}")).await?;
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
    let acc_raw =
        crate::sync_worker_gateway::sf_get_via_gateway(&format!("/query?q={acc_q}")).await?;
    let acc_records = acc_raw
        .get("records")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    let acc_mapped = map_sf_accounts(&acc_records);
    let acc_count = save_snapshot(pool, tenant_id, SF_PROVIDER, "account", &acc_mapped).await?;

    let task_q = urlencoding::encode(
        "SELECT Id,Subject,Status,ActivityDate,WhatId,CreatedDate,LastModifiedDate FROM Task WHERE WhatId != null LIMIT 200",
    );
    let task_raw =
        crate::sync_worker_gateway::sf_get_via_gateway(&format!("/query?q={task_q}")).await?;
    let task_records = task_raw
        .get("records")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    let task_mapped = map_sf_tasks(&task_records);
    let task_count = save_snapshot(pool, tenant_id, SF_PROVIDER, "task", &task_mapped).await?;

    db::touch_integration_last_sync(pool, tenant_id, SF_PROVIDER)
        .await
        .map_err(|e| format!("db touch sync: {e}"))?;
    let _ = db::set_integration_status(pool, tenant_id, SF_PROVIDER, "connected", None).await;

    Ok(serde_json::json!({
        "provider": SF_PROVIDER,
        "opportunity": opp_count,
        "account": acc_count,
        "task": task_count,
    }))
}

pub async fn sync_zoho_snapshots(
    pool: &PgPool,
    tenant_id: i64,
) -> Result<serde_json::Value, String> {
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
            task_count =
                save_snapshot(pool, tenant_id, ZOHO_PROVIDER, "task", &tasks_mapped).await?;
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
    let provider = query
        .provider
        .as_deref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty());
    match db::list_integration_snapshot_summaries(&st.pool, ctx.tenant_id, provider).await {
        Ok(rows) => (StatusCode::OK, axum::Json(rows)).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            axum::Json(serde_json::json!({ "error": format!("{e}") })),
        )
            .into_response(),
    }
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
            let _ =
                db::set_integration_status(&st.pool, ctx.tenant_id, SF_PROVIDER, "error", Some(&e))
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
        "{}/oauth/v2/auth?scope={}&client_id={}&response_type=code&access_type=offline&prompt=consent&redirect_uri={}&state={}",
        zoho.accounts_url, scope, zoho.client_id, redirect, state
    );
    if let Err(e) =
        db::set_integration_status(&st.pool, ctx.tenant_id, ZOHO_PROVIDER, "pending", None).await
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
    let pending =
        match resolve_oauth_pending(&st.pool, &st.oauth_pending, &state, ZOHO_PROVIDER).await {
            Some(p) => p,
            None => return redirect_ui_error("invalid_state", Some(ZOHO_PROVIDER), None),
        };
    if pending.valid_until < Instant::now() {
        return redirect_ui_error("state_expired", Some(ZOHO_PROVIDER), None);
    }
    let Some(zoho) = zoho_provider_config(&st.pool, pending.tenant_id).await else {
        return redirect_ui_error("not_configured", Some(ZOHO_PROVIDER), None);
    };
    let prior_token = load_zoho_token(&st.pool, pending.tenant_id).await.ok();
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
    if token.refresh_token.is_none() {
        token.refresh_token = prior_token.as_ref().and_then(|t| t.refresh_token.clone());
    }
    if token.portal_id.is_none() {
        token.portal_id = prior_token.as_ref().and_then(|t| t.portal_id.clone());
    }
    if token.refresh_token.is_none() {
        tracing::warn!(
            tenant_id = pending.tenant_id,
            "zoho oauth: missing refresh_token after exchange"
        );
    }
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

async fn persist_zoho_token(
    pool: &PgPool,
    tenant_id: i64,
    token: &ZohoTokenConfig,
) -> Result<(), String> {
    let json = serde_json::to_string(token).map_err(|e| format!("serialize: {e}"))?;
    let enc = encrypt_integration_config(&json)?;
    db::upsert_integration_config(pool, tenant_id, ZOHO_PROVIDER, "connected", &enc, None)
        .await
        .map_err(|e| format!("db: {e}"))?;
    Ok(())
}

async fn mark_zoho_token_error(pool: &PgPool, tenant_id: i64, detail: &str) {
    let msg = oauth_exchange_user_message("Zoho", detail);
    let _ = db::set_integration_status(pool, tenant_id, ZOHO_PROVIDER, "error", Some(&msg)).await;
}

/// Refresh access token trước khi hết hạn (~1h Zoho) — tránh 401 khi Sync Now.
async fn ensure_zoho_token_fresh(pool: &PgPool, tenant_id: i64) -> Result<ZohoTokenConfig, String> {
    let Some(st) = STATE.get() else {
        return Err("state not initialized".into());
    };
    let token = load_zoho_token(pool, tenant_id).await?;
    if token.demo {
        return Ok(token);
    }
    if !token_expires_soon(token.expires_at.as_deref()) {
        return Ok(token);
    }
    let Some(rt) = token.refresh_token.clone() else {
        let msg = "Zoho thiếu refresh_token — Ngắt kết nối → Kết nối lại Zoho.";
        mark_zoho_token_error(pool, tenant_id, "missing refresh_token").await;
        return Err(msg.into());
    };
    let zoho = zoho_provider_config(pool, tenant_id)
        .await
        .ok_or_else(|| "Zoho not configured".to_string())?;
    match refresh_zoho_access_token(&st.http, &zoho, &rt).await {
        Ok(mut fresh) => {
            fresh.portal_id = token.portal_id.clone();
            fresh.oauth_connected_at = token.oauth_connected_at.clone();
            persist_zoho_token(pool, tenant_id, &fresh).await?;
            let _ =
                db::set_integration_status(pool, tenant_id, ZOHO_PROVIDER, "connected", None).await;
            Ok(fresh)
        }
        Err(e) => {
            mark_zoho_token_error(pool, tenant_id, &e).await;
            Err(format!(
                "Zoho refresh thất bại: {}",
                oauth_exchange_user_message("Zoho", &e)
            ))
        }
    }
}

async fn ensure_sf_token_fresh(
    pool: &PgPool,
    tenant_id: i64,
) -> Result<SalesforceTokenConfig, String> {
    let Some(st) = STATE.get() else {
        return Err("state not initialized".into());
    };
    let token = load_sf_token(pool, tenant_id).await?;
    if token.demo {
        return Ok(token);
    }
    if !token_expires_soon(token.expires_at.as_deref()) {
        return Ok(token);
    }
    let Some(rt) = token.refresh_token.clone() else {
        return Err("Salesforce thiếu refresh_token — Ngắt kết nối → Kết nối lại.".into());
    };
    let sf = salesforce_provider_config(pool, tenant_id)
        .await
        .ok_or_else(|| "SF not configured".to_string())?;
    match refresh_access_token(&st.http, &sf, &rt).await {
        Ok(mut fresh) => {
            if fresh.instance_url.is_empty() {
                fresh.instance_url = token.instance_url.clone();
            }
            fresh.oauth_connected_at = token.oauth_connected_at.clone();
            let json = serde_json::to_string(&fresh).map_err(|e| format!("serialize: {e}"))?;
            let enc = encrypt_integration_config(&json)?;
            db::upsert_integration_config(pool, tenant_id, SF_PROVIDER, "connected", &enc, None)
                .await
                .map_err(|e| format!("db save refresh: {e}"))?;
            Ok(fresh)
        }
        Err(e) => Err(format!(
            "Salesforce refresh thất bại: {}",
            oauth_exchange_user_message("Salesforce", &e)
        )),
    }
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
    let portals = crate::sync_worker_gateway::zoho_get_via_gateway("/api/v3/portals", None).await?;
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
    let raw: serde_json::Value = serde_json::from_str(&body).map_err(|e| format!("json: {e}"))?;
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
    let raw: serde_json::Value = serde_json::from_str(&body).map_err(|e| format!("json: {e}"))?;
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
    let mut token = ensure_zoho_token_fresh(pool, tenant_id).await?;
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
            token = match refresh_zoho_access_token(&st.http, &zoho, &rt).await {
                Ok(t) => t,
                Err(e) => {
                    mark_zoho_token_error(pool, tenant_id, &e).await;
                    return Err(oauth_exchange_user_message("Zoho", &e));
                }
            };
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
                .header(
                    "Authorization",
                    format!("Zoho-oauthtoken {}", token.access_token),
                )
                .send()
                .await
                .map_err(|e| format!("http retry: {e}"))?;
        }
    }
    let status = res.status();
    let body = res.text().await.map_err(|e| format!("body: {e}"))?;
    if !status.is_success() {
        if status == reqwest::StatusCode::UNAUTHORIZED {
            mark_zoho_token_error(pool, tenant_id, &body).await;
        }
        return Err(compact_zoho_api_error(status, &body));
    }
    let val: serde_json::Value = serde_json::from_str(&body).map_err(|e| format!("json: {e}"))?;
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
    if let Ok(Some(row)) = db::fetch_integration_provider_config(pool, tenant_id, SF_PROVIDER).await
    {
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
    if let Ok(Some(row)) =
        db::fetch_integration_provider_config(pool, tenant_id, ZOHO_PROVIDER).await
    {
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
            serde_json::Value::String(
                "Redirect URI phải bắt đầu bằng http:// hoặc https://".into(),
            ),
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
            serde_json::Value::String(
                "Redirect URI phải bắt đầu bằng http:// hoặc https://".into(),
            ),
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
            serde_json::Value::String(
                "Accounts URL phải bắt đầu bằng http:// hoặc https://".into(),
            ),
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
        ZOHO_PROVIDER,
        &enc,
        &ctx.username,
    )
    .await
    {
        return json_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "db_failed",
            &format!("{e}"),
        );
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
        SF_PROVIDER,
        &enc,
        &ctx.username,
    )
    .await
    {
        return json_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "db_failed",
            &format!("{e}"),
        );
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
                axum::Json(
                    serde_json::json!({ "status": "disconnected", "provider": ZOHO_PROVIDER }),
                ),
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
                axum::Json(
                    serde_json::json!({ "status": "disconnected", "provider": SF_PROVIDER }),
                ),
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

async fn integration_connection_flags(pool: &PgPool, tenant_id: i64) -> (bool, bool, bool) {
    let rows = db::list_integrations(pool, tenant_id)
        .await
        .unwrap_or_default();
    let sf = rows
        .iter()
        .find(|r| r.provider == SF_PROVIDER)
        .map(|r| r.status.as_str() == "connected")
        .unwrap_or(false);
    let zoho = rows
        .iter()
        .find(|r| r.provider == ZOHO_PROVIDER)
        .map(|r| r.status.as_str() == "connected")
        .unwrap_or(false);
    (sf, zoho, sf && zoho)
}

async fn integration_both_connected(pool: &PgPool, tenant_id: i64) -> bool {
    integration_connection_flags(pool, tenant_id).await.2
}

fn bridge_field_str(v: &serde_json::Value, field: &str) -> Option<String> {
    v.get(field).and_then(|x| {
        x.as_str()
            .map(|s| s.to_string())
            .or_else(|| x.as_i64().map(|n| n.to_string()))
            .or_else(|| x.as_f64().map(|n| n.to_string()))
    })
}

const SYNC_LOG_RETAIN: i64 = 200;

fn default_true() -> bool {
    true
}

fn normalize_lines(lines: &[String]) -> Vec<String> {
    lines
        .iter()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .collect()
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
fn project_duration_days(amount: f64) -> i64 {
    if amount >= 100_000_000.0 { 60 } else { 30 }
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
                    SyncEventOpts::sales_to_delivery(None)
                        .with_event(IntegrationEventType::UpstreamRetry),
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
    opportunity_name.trim().to_string()
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
        .map(|p| {
            (
                zoho_id_str(p),
                p.get("name")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string(),
            )
        })
        .filter(|(_, name)| !name.is_empty())
        .collect())
}

/// Xóa entity link khi project Zoho đã bị xóa thủ công — tránh UI/sync hiển thị dữ liệu ma.
pub async fn reconcile_entity_links_with_zoho(
    pool: &PgPool,
    tenant_id: i64,
) -> Result<i64, String> {
    if !integration_both_connected(pool, tenant_id).await {
        return Ok(0);
    }
    let portal_id = ensure_zoho_portal_id_sync(pool, tenant_id).await?;
    let projects = list_zoho_project_names(pool, tenant_id, &portal_id).await?;
    let valid: std::collections::HashSet<String> = projects.into_iter().map(|(id, _)| id).collect();

    let links = db::list_entity_links(pool, tenant_id)
        .await
        .map_err(|e| format!("db list links: {e}"))?;
    let mut deleted = 0_i64;
    for link in links {
        if link.target_id.starts_with("DEMO-") {
            continue;
        }
        if valid.contains(&link.target_id) {
            continue;
        }
        db::delete_entity_link(
            pool,
            tenant_id,
            &link.flow_type,
            &link.source_provider,
            &link.source_entity_type,
            &link.source_id,
        )
        .await
        .map_err(|e| format!("db delete link: {e}"))?;
        log_sync(
            pool,
            tenant_id,
            "SKIPPED",
            &format!(
                "Đã xóa entity link cũ: {} → \"{}\" ({} id {} không còn trên portal)",
                link.source_id,
                link.target_name.as_deref().unwrap_or("—"),
                link.target_provider,
                link.target_id,
            ),
            None,
            SyncEventOpts::sales_to_delivery(None)
                .with_event(IntegrationEventType::EntityLinkStale),
        )
        .await;
        deleted += 1;
    }
    Ok(deleted)
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
    Err(format!(
        "Zoho create project: missing id in response: {raw}"
    ))
}

#[derive(Debug, Clone)]
struct SalesforceTaskItem {
    name: String,
    due_date: Option<String>,
}

async fn create_zoho_tasks_for_project(
    pool: &PgPool,
    tenant_id: i64,
    portal_id: &str,
    project_id: &str,
    tasks: &[SalesforceTaskItem],
) -> Result<i64, String> {
    let mut created = 0_i64;
    for task in tasks {
        let mut body = serde_json::Map::new();
        body.insert("name".into(), task.name.clone().into());
        if let Some(due_date) = task.due_date.as_deref() {
            body.insert("end_date".into(), due_date.into());
        }
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
    opts: SyncEventOpts<'_>,
) {
    let meta = db::SyncLogInsert {
        event_type: opts
            .event_type
            .map(IntegrationEventType::as_str)
            .map(str::to_string),
        flow_type: opts
            .flow_type
            .or(Some(FLOW_SALES_TO_DELIVERY))
            .map(str::to_string),
        source_provider: opts.source_provider.map(str::to_string),
        target_provider: opts.target_provider.map(str::to_string),
        correlation_id: opts.correlation_id.map(str::to_string),
        metadata_json: opts.metadata_json,
    };
    if let Err(e) = db::insert_sync_log(pool, tenant_id, status, message, error_detail, meta).await
    {
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
    tasks: Vec<SalesforceTaskItem>,
}

async fn collect_push_items(
    pool: &PgPool,
    tenant_id: i64,
    correlation_id: Option<&str>,
) -> Result<Vec<PushItem>, String> {
    let min_amount = min_deal_amount_vnd();
    let mut items = Vec::new();
    let event_base = || SyncEventOpts::sales_to_delivery(correlation_id);

    let opp_snap =
        db::fetch_latest_integration_snapshot(pool, tenant_id, SF_PROVIDER, "opportunity")
            .await
            .map_err(|e| format!("db: {e}"))?;
    let Some(snap) = opp_snap else {
        return Ok(items);
    };
    let opps: Vec<serde_json::Value> = serde_json::from_str(&snap.payload_json).unwrap_or_default();

    let task_snap = db::fetch_latest_integration_snapshot(pool, tenant_id, SF_PROVIDER, "task")
        .await
        .map_err(|e| format!("db: {e}"))?;
    let task_rows: Vec<serde_json::Value> = task_snap
        .as_ref()
        .and_then(|snap| serde_json::from_str(&snap.payload_json).ok())
        .unwrap_or_default();
    let mut tasks_by_opp: std::collections::HashMap<String, Vec<SalesforceTaskItem>> =
        std::collections::HashMap::new();
    for task in task_rows {
        let Some(what_id) = bridge_field_str(&task, "what_id").filter(|v| !v.is_empty()) else {
            continue;
        };
        let Some(name) = bridge_field_str(&task, "name").filter(|v| !v.trim().is_empty()) else {
            continue;
        };
        let due_date = bridge_field_str(&task, "due_date").filter(|v| !v.trim().is_empty());
        tasks_by_opp
            .entry(what_id)
            .or_default()
            .push(SalesforceTaskItem {
                name: name.trim().to_string(),
                due_date,
            });
    }

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
                &format!("Middleware router: {sf_id} — chưa Closed Won (Stage: {stage})"),
                None,
                event_base()
                    .with_event(IntegrationEventType::DealFiltered)
                    .with_metadata(serde_json::json!({ "sf_id": sf_id, "stage": stage })),
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
                event_base()
                    .with_event(IntegrationEventType::DealFiltered)
                    .with_metadata(serde_json::json!({
                        "sf_id": sf_id,
                        "amount": amount,
                        "min_amount": min_amount,
                    })),
            )
            .await;
            continue;
        }
        let close_date = bridge_field_str(&opp, "close_date");
        let account_id = bridge_field_str(&opp, "account_id");
        let product_type = bridge_field_str(&opp, "product_type").unwrap_or_default();
        let (start_date, end_date) = zoho_project_date_range(close_date.as_deref(), amount);
        let tasks = tasks_by_opp.remove(&sf_id).unwrap_or_default();
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
        });
    }

    Ok(items)
}

pub async fn push_salesforce_to_zoho(
    pool: &PgPool,
    tenant_id: i64,
    correlation_id: Option<&str>,
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
    let event_base = || SyncEventOpts::sales_to_delivery(correlation_id);
    let items = collect_push_items(pool, tenant_id, correlation_id).await?;
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
            event_base().with_event(IntegrationEventType::EntitySkipped),
        )
        .await;
        return Ok(serde_json::json!({
            "created": 0,
            "skipped": 0,
            "reason": "no_items",
            "correlation_id": correlation_id,
            "middleware": {
                "min_deal_amount_vnd": min_deal_amount_vnd(),
                "router": "closed_won_and_min_amount",
            },
        }));
    }

    let portal_id = ensure_zoho_portal_id_sync(pool, tenant_id).await?;

    let _ = reconcile_entity_links_with_zoho(pool, tenant_id).await;

    let existing = list_zoho_project_names(pool, tenant_id, &portal_id).await?;
    let live_zoho_ids: std::collections::HashSet<String> =
        existing.iter().map(|(id, _)| id.clone()).collect();
    let mut created = 0_i64;
    let mut skipped = 0_i64;
    let mut tasks_created = 0_i64;

    for item in items {
        if let Some(link) = db::fetch_entity_link(
            pool,
            tenant_id,
            FLOW_SALES_TO_DELIVERY,
            SF_PROVIDER,
            item.sf_entity_type,
            &item.sf_id,
        )
        .await
        .map_err(|e| format!("db: {e}"))?
        {
            let stale_demo = link.target_id.starts_with("DEMO-");
            let stale_missing = !live_zoho_ids.contains(&link.target_id);
            if stale_demo || stale_missing {
                let _ = db::delete_entity_link(
                    pool,
                    tenant_id,
                    FLOW_SALES_TO_DELIVERY,
                    SF_PROVIDER,
                    item.sf_entity_type,
                    &item.sf_id,
                )
                .await;
                if stale_missing && !stale_demo {
                    log_sync(
                        pool,
                        tenant_id,
                        "SKIPPED",
                        &format!(
                            "Entity link hết hạn: {} — Zoho id {} không tồn tại, sẽ đồng bộ lại",
                            item.sf_id, link.target_id
                        ),
                        None,
                        event_base()
                            .with_event(IntegrationEventType::EntityLinkStale)
                            .with_metadata(serde_json::json!({
                                "source_id": item.sf_id,
                                "target_id": link.target_id,
                            })),
                    )
                    .await;
                }
            } else {
                skipped += 1;
                log_sync(
                    pool,
                    tenant_id,
                    "SKIPPED",
                    &format!(
                        "Đã đồng bộ: {} → dự án \"{}\" (Zoho id {})",
                        item.sf_id, item.project_name, link.target_id
                    ),
                    None,
                    event_base()
                        .with_event(IntegrationEventType::EntitySkipped)
                        .with_metadata(serde_json::json!({
                            "source_id": item.sf_id,
                            "target_id": link.target_id,
                        })),
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
                        event_base()
                            .with_event(IntegrationEventType::EntityPushFailed)
                            .with_metadata(serde_json::json!({
                                "source_id": item.sf_id,
                                "project_name": item.project_name,
                            })),
                    )
                    .await;
                    continue;
                }
            }
        };

        let mut item_tasks = 0_i64;
        match create_zoho_tasks_for_project(pool, tenant_id, &portal_id, &project_id, &item.tasks)
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
            FLOW_SALES_TO_DELIVERY,
            SF_PROVIDER,
            item.sf_entity_type,
            &item.sf_id,
            ZOHO_PROVIDER,
            "project",
            &project_id,
            Some(&item.project_name),
        )
        .await
        .map_err(|e| format!("db link: {e}"))?;

        created += 1;
        log_sync(
            pool,
            tenant_id,
            "SUCCESS",
            &format!(
                "Middleware: \"{}\" → Zoho \"{}\" ({:.0} VNĐ, end {}) + {} task",
                item.sf_id,
                item.project_name,
                item.amount,
                item.end_date.as_deref().unwrap_or("—"),
                item_tasks
            ),
            None,
            event_base()
                .with_event(IntegrationEventType::EntityPushed)
                .with_metadata(serde_json::json!({
                    "source_id": item.sf_id,
                    "target_id": project_id,
                    "tasks_created": item_tasks,
                    "amount": item.amount,
                })),
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
        "portal_id": portal_id,
        "correlation_id": correlation_id,
        "flow_type": FLOW_SALES_TO_DELIVERY,
        "middleware": {
            "min_deal_amount_vnd": min_deal_amount_vnd(),
            "router": "closed_won_and_min_amount",
            "batch_delay_ms": zoho_push_delay_ms(),
            "retry_attempts": zoho_retry_attempts(),
        },
    }))
}

/// Full pipeline: refresh tokens → pull SF → lọc Closed Won → push Zoho →
/// rồi poll Zoho status hoàn thành → cập nhật Opportunity (định kỳ).
pub async fn run_full_sync_pipeline(
    pool: &PgPool,
    tenant_id: i64,
) -> Result<serde_json::Value, String> {
    let correlation_id = uuid::Uuid::new_v4().to_string();
    log_sync(
        pool,
        tenant_id,
        "SUCCESS",
        "Pipeline started: sales_to_delivery",
        None,
        SyncEventOpts::sales_to_delivery(Some(&correlation_id))
            .with_event(IntegrationEventType::PipelineStarted),
    )
    .await;

    refresh_integration_tokens_if_needed(pool, tenant_id).await;
    let sf = sync_salesforce_snapshots(pool, tenant_id).await?;
    if !integration_both_connected(pool, tenant_id).await {
        return Ok(serde_json::json!({
            "status": "ok",
            "correlation_id": correlation_id,
            "flow_type": FLOW_SALES_TO_DELIVERY,
            "salesforce": sf,
            "push": {
                "status": "skipped",
                "reason": "need_both_connected",
                "message": "Cần kết nối cả Salesforce và Zoho Projects",
            },
        }));
    }
    let push = push_salesforce_to_zoho(pool, tenant_id, Some(&correlation_id)).await?;
    let delivery = pull_zoho_completions_to_salesforce(pool, tenant_id, Some(&correlation_id))
        .await
        .unwrap_or_else(|e| {
            serde_json::json!({
                "status": "error",
                "message": e,
                "updated": 0,
                "checked": 0,
            })
        });
    log_sync(
        pool,
        tenant_id,
        "SUCCESS",
        "Pipeline completed: sales_to_delivery + delivery_to_sales",
        None,
        SyncEventOpts::sales_to_delivery(Some(&correlation_id))
            .with_event(IntegrationEventType::PipelineCompleted)
            .with_metadata(serde_json::json!({ "push": push, "delivery": delivery })),
    )
    .await;
    Ok(serde_json::json!({
        "status": "ok",
        "correlation_id": correlation_id,
        "flow_type": FLOW_SALES_TO_DELIVERY,
        "salesforce": sf,
        "push": push,
        "delivery": delivery,
    }))
}

/// Đọc trạng thái project Zoho đã link; nếu «Đã hoàn tất» thì đánh dấu Opportunity trên Salesforce.
///
/// Chạy trong Sync Now / worker định kỳ — phía Zoho chỉ cần đổi Trạng Thái.
pub async fn pull_zoho_completions_to_salesforce(
    pool: &PgPool,
    tenant_id: i64,
    correlation_id: Option<&str>,
) -> Result<serde_json::Value, String> {
    let event_base = || SyncEventOpts::delivery_to_sales(correlation_id);
    if !integration_both_connected(pool, tenant_id).await {
        return Ok(serde_json::json!({
            "status": "skipped",
            "reason": "need_both_connected",
            "updated": 0,
            "checked": 0,
        }));
    }
    if let Ok(token) = load_sf_token(pool, tenant_id).await {
        reject_integration_demo_token(token.demo)?;
    }
    if let Ok(token) = load_zoho_token(pool, tenant_id).await {
        reject_integration_demo_token(token.demo)?;
    }

    let pending = db::list_entity_links_pending_delivery(pool, tenant_id, FLOW_SALES_TO_DELIVERY)
        .await
        .map_err(|e| format!("db pending links: {e}"))?;
    if pending.is_empty() {
        return Ok(serde_json::json!({
            "status": "ok",
            "updated": 0,
            "checked": 0,
            "reason": "no_pending_links",
            "correlation_id": correlation_id,
        }));
    }

    let portal_id = ensure_zoho_portal_id_sync(pool, tenant_id).await?;
    // Lấy cả active và archived — project «Đã hoàn tất» đôi khi chuyển sang archived.
    let mut status_by_id: std::collections::HashMap<String, String> =
        std::collections::HashMap::new();
    for lifecycle in ["active", "archived"] {
        let raw = crate::sync_worker_gateway::zoho_get_via_gateway(
            &format!("/api/v3/portal/{portal_id}/projects"),
            Some(&format!("status={lifecycle}")),
        )
        .await
        .unwrap_or_else(|_| serde_json::json!({}));
        let items = extract_zoho_array(&raw, &["projects"]);
        for p in &items {
            let id = zoho_id_str(p);
            if id.is_empty() {
                continue;
            }
            let label = extract_zoho_project_status_label(p);
            if !label.is_empty() || !status_by_id.contains_key(&id) {
                status_by_id.insert(id, label);
            }
        }
    }
    // Fallback: list không lọc status (một số portal bỏ qua query status).
    if status_by_id.is_empty() {
        let raw = crate::sync_worker_gateway::zoho_get_via_gateway(
            &format!("/api/v3/portal/{portal_id}/projects"),
            None,
        )
        .await?;
        for p in extract_zoho_array(&raw, &["projects"]) {
            let id = zoho_id_str(&p);
            if id.is_empty() {
                continue;
            }
            status_by_id.insert(id, extract_zoho_project_status_label(&p));
        }
    }

    // Project nằm trong link nhưng thiếu/không rõ status trên list → GET chi tiết từng cái.
    for link in &pending {
        let need_detail = match status_by_id.get(&link.target_id) {
            None => true,
            Some(s) if s.is_empty() || is_zoho_lifecycle_status(s) => true,
            Some(_) => false,
        };
        if !need_detail {
            continue;
        }
        let path = format!(
            "/api/v3/portal/{portal_id}/projects/{}",
            link.target_id
        );
        if let Ok(detail) = crate::sync_worker_gateway::zoho_get_via_gateway(&path, None).await {
            let project_val = detail
                .get("projects")
                .and_then(|v| v.as_array())
                .and_then(|a| a.first())
                .cloned()
                .or_else(|| detail.get("project").cloned())
                .unwrap_or(detail);
            let label = extract_zoho_project_status_label(&project_val);
            if !label.is_empty() {
                status_by_id.insert(link.target_id.clone(), label);
            }
        }
    }

    let mut updated = 0_i64;
    let mut skipped = 0_i64;
    let checked = pending.len() as i64;

    for link in pending {
        let status_label = status_by_id
            .get(&link.target_id)
            .cloned()
            .unwrap_or_default();
        if !is_zoho_project_completed(&status_label) {
            skipped += 1;
            log_sync(
                pool,
                tenant_id,
                "SKIPPED",
                &format!(
                    "Đồng bộ hoàn thành: project {} chưa đủ điều kiện (status={})",
                    link.target_id,
                    if status_label.is_empty() {
                        "(trống)"
                    } else {
                        status_label.as_str()
                    }
                ),
                None,
                event_base()
                    .with_event(IntegrationEventType::DealFiltered)
                    .with_metadata(serde_json::json!({
                        "project_id": link.target_id,
                        "opportunity_id": link.source_id,
                        "zoho_status": status_label,
                    })),
            )
            .await;
            continue;
        }

        if let Err(e) =
            patch_sf_opportunity_delivery_completed(pool, tenant_id, &link.source_id).await
        {
            log_sync(
                pool,
                tenant_id,
                "FAILED",
                &format!(
                    "Đồng bộ hoàn thành: cập nhật Opportunity {} thất bại (Zoho project {})",
                    link.source_id, link.target_id
                ),
                Some(&e),
                event_base()
                    .with_event(IntegrationEventType::EntityPushFailed)
                    .with_metadata(serde_json::json!({
                        "project_id": link.target_id,
                        "opportunity_id": link.source_id,
                        "zoho_status": status_label,
                    })),
            )
            .await;
            continue;
        }

        let _ = db::mark_entity_link_delivery_notified(
            pool,
            tenant_id,
            FLOW_SALES_TO_DELIVERY,
            SF_PROVIDER,
            &link.source_entity_type,
            &link.source_id,
        )
        .await;

        updated += 1;
        let field = sf_delivery_completed_field();
        log_sync(
            pool,
            tenant_id,
            "SUCCESS",
            &format!(
                "Đồng bộ hoàn thành: Zoho project {} ({status_label}) → Opportunity {}.{field}=true",
                link.target_id, link.source_id
            ),
            None,
            event_base()
                .with_event(IntegrationEventType::EntityPushed)
                .with_metadata(serde_json::json!({
                    "project_id": link.target_id,
                    "opportunity_id": link.source_id,
                    "zoho_status": status_label,
                    "field": field,
                    "source": "periodic_poll",
                })),
        )
        .await;

        match create_sf_invoice_for_completed_project(
            pool,
            tenant_id,
            &link.source_id,
            &link.target_id,
            link.target_name.as_deref(),
        )
        .await
        {
            Ok(Some(invoice_id)) => {
                let _ = db::mark_entity_link_invoice_created(
                    pool,
                    tenant_id,
                    FLOW_SALES_TO_DELIVERY,
                    SF_PROVIDER,
                    &link.source_entity_type,
                    &link.source_id,
                    &invoice_id,
                )
                .await;
                log_sync(
                    pool,
                    tenant_id,
                    "SUCCESS",
                    &format!(
                        "Xuất hóa đơn: Opportunity {} → {} id {}",
                        link.source_id,
                        sf_invoice_object(),
                        invoice_id
                    ),
                    None,
                    event_base()
                        .with_event(IntegrationEventType::EntityPushed)
                        .with_metadata(serde_json::json!({
                            "opportunity_id": link.source_id,
                            "project_id": link.target_id,
                            "invoice_id": invoice_id,
                            "object": sf_invoice_object(),
                        })),
                )
                .await;
            }
            Ok(None) => {}
            Err(e) => {
                log_sync(
                    pool,
                    tenant_id,
                    "FAILED",
                    &format!(
                        "Xuất hóa đơn thất bại cho Opportunity {} (project {})",
                        link.source_id, link.target_id
                    ),
                    Some(&e),
                    event_base()
                        .with_event(IntegrationEventType::EntityPushFailed)
                        .with_metadata(serde_json::json!({
                            "opportunity_id": link.source_id,
                            "project_id": link.target_id,
                            "object": sf_invoice_object(),
                        })),
                )
                .await;
            }
        }

        tokio::time::sleep(Duration::from_millis(zoho_push_delay_ms())).await;
    }

    let invoices = issue_pending_salesforce_invoices(pool, tenant_id, correlation_id)
        .await
        .unwrap_or_else(|e| {
            serde_json::json!({ "status": "error", "message": e, "created": 0 })
        });

    Ok(serde_json::json!({
        "status": "ok",
        "flow_type": FLOW_DELIVERY_TO_SALES,
        "checked": checked,
        "updated": updated,
        "skipped_not_completed": skipped,
        "invoices": invoices,
        "correlation_id": correlation_id,
    }))
}

/// Object hóa đơn trên Salesforce (custom). Ghi đè bằng env nếu org dùng API name khác.
fn sf_invoice_object() -> String {
    std::env::var("INTEGRATION_SF_INVOICE_OBJECT")
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "Invoice__c".into())
}

fn sf_today_iso_date() -> String {
    // YYYY-MM-DD UTC — đủ cho field Date Salesforce.
    chrono::Utc::now().format("%Y-%m-%d").to_string()
}

async fn fetch_sf_opportunity_for_invoice(
    pool: &PgPool,
    tenant_id: i64,
    opportunity_id: &str,
) -> Result<serde_json::Value, String> {
    let path = format!(
        "/sobjects/Opportunity/{opportunity_id}?fields=Id,Name,Amount,AccountId,StageName"
    );
    let (status, resp, _) =
        sf_request_raw_with_refresh(pool, tenant_id, "GET", &path, None, None, None).await?;
    if !status.is_success() {
        let detail = String::from_utf8_lossy(&resp);
        return Err(format!("GET Opportunity {status}: {detail}"));
    }
    serde_json::from_slice(&resp).map_err(|e| format!("parse Opportunity: {e}"))
}

/// Tạo bản ghi hóa đơn trên Salesforce từ Opportunity đã hoàn thành giao hàng.
///
/// Trả về `Ok(None)` khi tắt bằng env `INTEGRATION_SF_INVOICE_ENABLED=0`.
async fn create_sf_invoice_for_completed_project(
    pool: &PgPool,
    tenant_id: i64,
    opportunity_id: &str,
    zoho_project_id: &str,
    project_name: Option<&str>,
) -> Result<Option<String>, String> {
    let enabled = std::env::var("INTEGRATION_SF_INVOICE_ENABLED")
        .ok()
        .map(|s| {
            let t = s.trim().to_ascii_lowercase();
            !(t == "0" || t == "false" || t == "off" || t == "no")
        })
        .unwrap_or(true);
    if !enabled {
        return Ok(None);
    }

    let opp = fetch_sf_opportunity_for_invoice(pool, tenant_id, opportunity_id).await?;
    let opp_name = opp
        .get("Name")
        .and_then(|v| v.as_str())
        .unwrap_or("Opportunity")
        .trim();
    let amount = opp.get("Amount").and_then(|v| v.as_f64()).unwrap_or(0.0);
    let account_id = opp
        .get("AccountId")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty());

    let today = sf_today_iso_date();
    let label = project_name
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or(opp_name);
    let mut name = format!("INV-{label}-{today}");
    if name.len() > 80 {
        name = format!("INV-{}-{today}", &opportunity_id[..opportunity_id.len().min(15)]);
    }

    let object = sf_invoice_object();
    let mut body = serde_json::json!({
        "Name": name,
        "Opportunity__c": opportunity_id,
        "Amount__c": amount,
        "Status__c": "Issued",
        "Issued_Date__c": today,
        "Zoho_Project_Id__c": zoho_project_id,
    });
    if let Some(acc) = account_id {
        body["Account__c"] = serde_json::json!(acc);
    }

    let bytes = serde_json::to_vec(&body).map_err(|e| format!("serialize invoice: {e}"))?;
    let path = format!("/sobjects/{object}");
    let (status, resp, _) = sf_request_raw_with_refresh(
        pool,
        tenant_id,
        "POST",
        &path,
        None,
        Some(&bytes),
        Some("application/json"),
    )
    .await?;
    if !status.is_success() {
        let detail = String::from_utf8_lossy(&resp);
        return Err(format!(
            "POST {object} {status}: {detail}. Kiểm tra object/field Invoice__c trên Salesforce (xem docs/TICH_HOP_ZOHO_DELIVERY.md)."
        ));
    }
    let created: serde_json::Value =
        serde_json::from_slice(&resp).map_err(|e| format!("parse create invoice: {e}"))?;
    let id = created
        .get("id")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "Salesforce không trả id hóa đơn".to_string())?;
    Ok(Some(id.to_string()))
}

/// Bù hóa đơn cho link đã đánh dấu hoàn thành trước khi bật tính năng xuất hóa đơn.
async fn issue_pending_salesforce_invoices(
    pool: &PgPool,
    tenant_id: i64,
    correlation_id: Option<&str>,
) -> Result<serde_json::Value, String> {
    let event_base = || SyncEventOpts::delivery_to_sales(correlation_id);
    let pending = db::list_entity_links_pending_invoice(pool, tenant_id, FLOW_SALES_TO_DELIVERY)
        .await
        .map_err(|e| format!("db pending invoice: {e}"))?;
    let mut created = 0_i64;
    let mut failed = 0_i64;
    for link in pending {
        match create_sf_invoice_for_completed_project(
            pool,
            tenant_id,
            &link.source_id,
            &link.target_id,
            link.target_name.as_deref(),
        )
        .await
        {
            Ok(Some(invoice_id)) => {
                let _ = db::mark_entity_link_invoice_created(
                    pool,
                    tenant_id,
                    FLOW_SALES_TO_DELIVERY,
                    SF_PROVIDER,
                    &link.source_entity_type,
                    &link.source_id,
                    &invoice_id,
                )
                .await;
                created += 1;
                log_sync(
                    pool,
                    tenant_id,
                    "SUCCESS",
                    &format!(
                        "Xuất hóa đơn: Opportunity {} → {} id {}",
                        link.source_id,
                        sf_invoice_object(),
                        invoice_id
                    ),
                    None,
                    event_base()
                        .with_event(IntegrationEventType::EntityPushed)
                        .with_metadata(serde_json::json!({
                            "opportunity_id": link.source_id,
                            "invoice_id": invoice_id,
                            "source": "pending_backfill",
                        })),
                )
                .await;
            }
            Ok(None) => {}
            Err(e) => {
                failed += 1;
                log_sync(
                    pool,
                    tenant_id,
                    "FAILED",
                    &format!(
                        "Xuất hóa đơn thất bại cho Opportunity {}",
                        link.source_id
                    ),
                    Some(&e),
                    event_base()
                        .with_event(IntegrationEventType::EntityPushFailed)
                        .with_metadata(serde_json::json!({
                            "opportunity_id": link.source_id,
                        })),
                )
                .await;
            }
        }
        tokio::time::sleep(Duration::from_millis(zoho_push_delay_ms())).await;
    }
    Ok(serde_json::json!({
        "created": created,
        "failed": failed,
        "object": sf_invoice_object(),
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
        Ok(mut summary) => {
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
            let logs = db::list_sync_logs(&st.pool, ctx.tenant_id, 50)
                .await
                .unwrap_or_default();
            let (sf_connected, zoho_connected, both_connected) =
                integration_connection_flags(&st.pool, ctx.tenant_id).await;
            let steps = build_pipeline_from_run(&summary, &logs);
            if let serde_json::Value::Object(ref mut map) = summary {
                map.insert(
                    "pipeline".to_string(),
                    serde_json::json!({
                        "sf_connected": sf_connected,
                        "zoho_connected": zoho_connected,
                        "both_connected": both_connected,
                        "steps": steps,
                    }),
                );
            }
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
            write_audit(
                &st.pool,
                ctx,
                "integration.sync.reset",
                "entity_links",
                "success",
                None,
                Some(&format!("deleted={deleted}")),
            )
            .await;
            (
                StatusCode::OK,
                axum::Json(serde_json::json!({
                    "status": "ok",
                    "entity_links_deleted": deleted,
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

/// Trường Opportunity nhận tín hiệu hoàn thành (checkbox). Ghi đè bằng env nếu cần.
fn sf_delivery_completed_field() -> String {
    std::env::var("INTEGRATION_SF_DELIVERY_FIELD")
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "Project_Completed__c".into())
}

/// Trạng thái được coi là hoàn thành (portal VN: «Đã hoàn tất»).
fn is_zoho_project_completed(status: &str) -> bool {
    let n = status.trim().to_lowercase();
    if n.is_empty() {
        return false;
    }
    let defaults = [
        "đã hoàn tất",
        "da hoan tat",
        "đã lập hóa đơn",
        "da lap hoa don",
        "completed",
        "complete",
        "closed",
        "hoàn thành",
        "hoan thanh",
    ];
    if defaults.iter().any(|d| n == *d || n.contains(d)) {
        return true;
    }
    if let Ok(extra) = std::env::var("INTEGRATION_ZOHO_COMPLETED_STATUS") {
        for part in extra.split(',') {
            let p = part.trim().to_lowercase();
            if !p.is_empty() && (n == p || n.contains(&p)) {
                return true;
            }
        }
    }
    false
}

async fn patch_sf_opportunity_delivery_completed(
    pool: &PgPool,
    tenant_id: i64,
    opportunity_id: &str,
) -> Result<(), String> {
    let field = sf_delivery_completed_field();
    let path = format!("/sobjects/Opportunity/{opportunity_id}");
    let body = serde_json::json!({ field: true });
    let bytes = serde_json::to_vec(&body).map_err(|e| format!("serialize patch: {e}"))?;
    let (status, resp, _) = sf_request_raw_with_refresh(
        pool,
        tenant_id,
        "PATCH",
        &path,
        None,
        Some(&bytes),
        Some("application/json"),
    )
    .await?;
    if status.is_success() || status.as_u16() == 204 {
        return Ok(());
    }
    let detail = String::from_utf8_lossy(&resp);
    Err(format!("Salesforce PATCH {status}: {detail}"))
}

#[cfg(test)]
mod delivery_sync_tests {
    use super::{extract_zoho_project_status_label, is_zoho_project_completed};

    #[test]
    fn completed_status_vietnamese_and_english() {
        assert!(is_zoho_project_completed("Đã hoàn tất"));
        assert!(is_zoho_project_completed("completed"));
        assert!(is_zoho_project_completed("Completed"));
        assert!(!is_zoho_project_completed("Có hiệu lực"));
        assert!(!is_zoho_project_completed(""));
    }

    #[test]
    fn extract_status_from_custom_status_object() {
        let p = serde_json::json!({
            "id": "1",
            "custom_status": { "name": "Đã hoàn tất", "is_closed": true }
        });
        assert_eq!(extract_zoho_project_status_label(&p), "Đã hoàn tất");
    }

    #[test]
    fn extract_status_object_v3_api() {
        let p = serde_json::json!({
            "id": "2682758000000171003",
            "name": "Đơn hàng abc",
            "status": {
                "id": "2682758000000020116",
                "name": "Đã hoàn tất",
                "is_closed_type": true,
                "color": "#4fd3e5"
            }
        });
        assert_eq!(extract_zoho_project_status_label(&p), "Đã hoàn tất");
        assert!(is_zoho_project_completed(&extract_zoho_project_status_label(&p)));
    }

    #[test]
    fn extract_ignores_lifecycle_active_when_custom_present() {
        let p = serde_json::json!({
            "id": "1",
            "status": "active",
            "custom_status": { "name": "Đã hoàn tất", "is_closed": true }
        });
        assert_eq!(extract_zoho_project_status_label(&p), "Đã hoàn tất");
        assert!(is_zoho_project_completed(&extract_zoho_project_status_label(&p)));
    }

    #[test]
    fn lifecycle_active_alone_is_not_completed() {
        let p = serde_json::json!({ "id": "1", "status": "active" });
        let label = extract_zoho_project_status_label(&p);
        assert!(label.is_empty() || !is_zoho_project_completed(&label));
    }

    #[test]
    fn active_status_object_not_completed() {
        let p = serde_json::json!({
            "id": "1",
            "status": { "name": "Có hiệu lực", "is_closed_type": false }
        });
        let label = extract_zoho_project_status_label(&p);
        assert_eq!(label, "Có hiệu lực");
        assert!(!is_zoho_project_completed(&label));
    }
}

pub async fn api_integration_catalog(ctx: &AdminCtx) -> Response {
    let Some(st) = STATE.get() else {
        return json_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "internal_error",
            "state not initialized",
        );
    };
    let providers = db::list_integration_providers(&st.pool)
        .await
        .unwrap_or_default();
    let flows = db::list_integration_flow_types(&st.pool)
        .await
        .unwrap_or_default();
    (
        StatusCode::OK,
        axum::Json(serde_json::json!({
            "tenant_id": ctx.tenant_id,
            "providers": providers,
            "flow_types": flows,
        })),
    )
        .into_response()
}

pub async fn api_list_entity_links(ctx: &AdminCtx) -> Response {
    let Some(st) = STATE.get() else {
        return json_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "internal_error",
            "state not initialized",
        );
    };
    // Không reconcile/gọi Zoho ở GET — chỉ đọc DB. Reconcile nằm trong pipeline sync.
    match db::list_entity_links_public(&st.pool, ctx.tenant_id).await {
        Ok(rows) => (StatusCode::OK, axum::Json(rows)).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            axum::Json(serde_json::json!({ "error": format!("{e}") })),
        )
            .into_response(),
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct IntegrationPipelineStep {
    pub key: String,
    pub label: String,
    pub status: String,
    pub summary: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct IntegrationPipelineStatus {
    pub sf_connected: bool,
    pub zoho_connected: bool,
    pub both_connected: bool,
    pub steps: Vec<IntegrationPipelineStep>,
}

fn count_sync_logs_status(logs: &[db::SyncLogRow], status: &str) -> usize {
    logs.iter().filter(|l| l.status == status).count()
}

fn count_sync_logs_msg(logs: &[db::SyncLogRow], status: &str, needle: &str) -> usize {
    logs.iter()
        .filter(|l| l.status == status && l.message.contains(needle))
        .count()
}

fn build_step_sync_log(logs: &[db::SyncLogRow], empty_summary: &str) -> IntegrationPipelineStep {
    let success = count_sync_logs_status(logs, "SUCCESS");
    let skipped = count_sync_logs_status(logs, "SKIPPED");
    let failed = count_sync_logs_status(logs, "FAILED");
    let summary = if logs.is_empty() {
        empty_summary.to_string()
    } else {
        format!("{success} OK · {skipped} SKIPPED · {failed} FAILED")
    };
    IntegrationPipelineStep {
        key: "log".into(),
        label: "Sync Log".into(),
        status: if logs.is_empty() {
            "idle".into()
        } else {
            "ok".into()
        },
        summary,
    }
}

fn build_pipeline_from_run(
    summary: &serde_json::Value,
    logs: &[db::SyncLogRow],
) -> Vec<IntegrationPipelineStep> {
    let sf = summary.get("salesforce").and_then(|v| v.as_object());
    let opp = sf
        .and_then(|o| o.get("opportunity"))
        .and_then(|v| v.as_i64())
        .unwrap_or(0);
    let push = summary.get("push").and_then(|v| v.as_object());
    let reason = push
        .and_then(|p| p.get("reason"))
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let created = push
        .and_then(|p| p.get("created"))
        .and_then(|v| v.as_i64())
        .unwrap_or(0);
    let skipped_push = push
        .and_then(|p| p.get("skipped"))
        .and_then(|v| v.as_i64())
        .unwrap_or(0);
    let tasks_created = push
        .and_then(|p| p.get("tasks_created"))
        .and_then(|v| v.as_i64())
        .unwrap_or(0);

    let step1 = IntegrationPipelineStep {
        key: "snapshot".into(),
        label: "Snapshot SF".into(),
        status: if opp > 0 { "ok" } else { "skipped" }.into(),
        summary: if opp > 0 {
            format!("{opp} Opportunity — pull qua gateway loopback")
        } else {
            "Snapshot rỗng — kiểm tra kết nối Salesforce".into()
        },
    };

    let (filter_status, filter_summary) = match reason {
        "no_items" => (
            "skipped",
            "Không có deal đạt điều kiện — xem Sync Log (SKIPPED)".to_string(),
        ),
        "need_both_connected" => (
            "skipped",
            "Chỉ pull SF — chưa kết nối Zoho để push".to_string(),
        ),
        _ => {
            let sum =
                format!("Sau lọc: {created} đẩy mới · {skipped_push} bỏ qua (đã link / không đạt)");
            let st = if created == 0 && skipped_push == 0 {
                "skipped"
            } else {
                "ok"
            };
            (st, sum)
        }
    };
    let step2 = IntegrationPipelineStep {
        key: "filter".into(),
        label: "Lọc Closed Won".into(),
        status: filter_status.into(),
        summary: filter_summary,
    };

    let failed = count_sync_logs_status(logs, "FAILED");
    let (push_status, push_summary) = match reason {
        "need_both_connected" => ("skipped", "Bỏ qua — cần Zoho connected".to_string()),
        "no_items" => ("skipped", "Không có deal để đẩy".to_string()),
        _ if failed > 0 && created == 0 => {
            ("failed", format!("{failed} deal FAILED — xem Sync Log"))
        }
        _ if created > 0 => ("ok", format!("Tạo {created} dự án · {tasks_created} task")),
        _ if skipped_push > 0 => (
            "skipped",
            format!("{skipped_push} deal đã đồng bộ trước đó (idempotent)"),
        ),
        _ => ("ok", "Push hoàn tất — không có deal mới".to_string()),
    };
    let step3 = IntegrationPipelineStep {
        key: "push".into(),
        label: "Push Zoho".into(),
        status: push_status.into(),
        summary: push_summary,
    };

    vec![
        step1,
        step2,
        step3,
        build_step_sync_log(logs, "Chưa có log — chạy Sync Now"),
    ]
}

fn build_pipeline_from_db(
    opp_count: i64,
    logs: &[db::SyncLogRow],
    sf_connected: bool,
    zoho_connected: bool,
) -> Vec<IntegrationPipelineStep> {
    let step1 = IntegrationPipelineStep {
        key: "snapshot".into(),
        label: "Snapshot SF".into(),
        status: if !sf_connected {
            "idle".into()
        } else if opp_count > 0 {
            "ok".into()
        } else {
            "skipped".into()
        },
        summary: if !sf_connected {
            "Kết nối Salesforce trước".into()
        } else if opp_count > 0 {
            format!("{opp_count} Opportunity trong snapshot mới nhất")
        } else {
            "Chưa có snapshot — bấm Sync Now".into()
        },
    };

    let router_skipped = count_sync_logs_msg(logs, "SKIPPED", "Middleware router");
    let amount_skipped = count_sync_logs_msg(logs, "SKIPPED", "Amount");
    let success_push = count_sync_logs_msg(logs, "SUCCESS", "→ Zoho");
    let idempotent_skipped = count_sync_logs_msg(logs, "SKIPPED", "Đã đồng bộ");
    let failed_push = count_sync_logs_status(logs, "FAILED");

    let (filter_status, filter_summary) = if logs.is_empty() {
        ("idle", "Chờ pipeline chạy".to_string())
    } else if success_push > 0 || idempotent_skipped > 0 || failed_push > 0 {
        (
            "ok",
            format!(
                "Đã lọc — {} deal bị loại trước push",
                router_skipped + amount_skipped
            ),
        )
    } else if router_skipped > 0 || amount_skipped > 0 {
        (
            "skipped",
            format!(
                "{} deal SKIPPED (stage/amount)",
                router_skipped + amount_skipped
            ),
        )
    } else {
        (
            "skipped",
            "Chưa có deal đạt Closed Won + ngưỡng".to_string(),
        )
    };
    let step2 = IntegrationPipelineStep {
        key: "filter".into(),
        label: "Lọc Closed Won".into(),
        status: filter_status.into(),
        summary: filter_summary,
    };

    let (push_status, push_summary) = if !zoho_connected {
        ("idle", "Kết nối Zoho Projects".to_string())
    } else if logs.is_empty() {
        ("idle", "Chờ Sync Now".to_string())
    } else if failed_push > 0 && success_push == 0 {
        ("failed", format!("{failed_push} deal FAILED"))
    } else if success_push > 0 {
        ("ok", format!("{success_push} deal đã push lên Zoho"))
    } else if idempotent_skipped > 0 {
        (
            "skipped",
            format!("{idempotent_skipped} deal đã có entity link"),
        )
    } else {
        ("skipped", "Chưa push deal mới".to_string())
    };
    let step3 = IntegrationPipelineStep {
        key: "push".into(),
        label: "Push Zoho".into(),
        status: push_status.into(),
        summary: push_summary,
    };

    vec![
        step1,
        step2,
        step3,
        build_step_sync_log(logs, "Chưa có bản ghi"),
    ]
}

async fn fetch_integration_pipeline_status(
    pool: &PgPool,
    tenant_id: i64,
) -> IntegrationPipelineStatus {
    let (sf_connected, zoho_connected, both_connected) =
        integration_connection_flags(pool, tenant_id).await;
    let opp_count =
        db::fetch_latest_integration_snapshot(pool, tenant_id, SF_PROVIDER, "opportunity")
            .await
            .ok()
            .flatten()
            .map(|r| r.record_count)
            .unwrap_or(0);
    let logs = db::list_sync_logs(pool, tenant_id, 50)
        .await
        .unwrap_or_default();
    let steps = build_pipeline_from_db(opp_count, &logs, sf_connected, zoho_connected);
    IntegrationPipelineStatus {
        sf_connected,
        zoho_connected,
        both_connected,
        steps,
    }
}

pub async fn api_integration_pipeline_status(ctx: &AdminCtx) -> Response {
    let Some(st) = STATE.get() else {
        return json_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "internal_error",
            "state not initialized",
        );
    };
    let status = fetch_integration_pipeline_status(&st.pool, ctx.tenant_id).await;
    (StatusCode::OK, axum::Json(status)).into_response()
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

async fn refresh_integration_tokens_if_needed(pool: &PgPool, tenant_id: i64) {
    let _ = ensure_zoho_token_fresh(pool, tenant_id).await;
    let _ = ensure_sf_token_fresh(pool, tenant_id).await;
}

// --- Transformation Engine (canonical data plane proxy) ---

pub async fn list_zoho_tasks_as_canonical_contacts(
    pool: &PgPool,
    tenant_id: i64,
) -> Result<Vec<u8>, String> {
    ensure_integration_connected(pool, tenant_id, ZOHO_PROVIDER).await?;
    let portal_id = ensure_zoho_portal_id(pool, tenant_id).await?;
    let (projects_raw, _) = zoho_get_with_refresh(
        pool,
        tenant_id,
        &format!("/api/v3/portal/{portal_id}/projects"),
    )
    .await?;
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
    let (projects_raw, _) = zoho_get_with_refresh(
        pool,
        tenant_id,
        &format!("/api/v3/portal/{portal_id}/projects"),
    )
    .await?;
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

pub const INTEGRATION_SYNC_INTERVAL_SETTING: &str = "integration_sync_interval_mins";
const SYNC_INTERVAL_POLL_SECS: u64 = 60;
pub const SYNC_INTERVAL_MINS_MIN: u64 = 1;
pub const SYNC_INTERVAL_MINS_MAX: u64 = 7 * 24 * 60; // 1 tuần
/// Giờ lịch daily theo UTC+7 (Asia/Ho_Chi_Minh).
const SCHEDULE_TZ_OFFSET_SECS: i32 = 7 * 3600;

pub fn default_integration_sync_interval_mins() -> u64 {
    std::env::var("INTEGRATION_SYNC_INTERVAL_MINS")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(15)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SyncScheduleMode {
    Off,
    Interval,
    Daily,
}

impl SyncScheduleMode {
    fn parse(raw: &str) -> Option<Self> {
        match raw.trim().to_ascii_lowercase().as_str() {
            "off" | "disabled" | "0" => Some(Self::Off),
            "interval" | "every" | "mins" | "minutes" => Some(Self::Interval),
            "daily" | "day" | "everyday" => Some(Self::Daily),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SyncScheduleConfig {
    pub mode: SyncScheduleMode,
    #[serde(default = "default_schedule_interval_mins")]
    pub interval_mins: u64,
    #[serde(default)]
    pub daily_hour: u8,
    #[serde(default)]
    pub daily_minute: u8,
}

fn default_schedule_interval_mins() -> u64 {
    15
}

impl SyncScheduleConfig {
    pub fn off() -> Self {
        Self {
            mode: SyncScheduleMode::Off,
            interval_mins: 0,
            daily_hour: 7,
            daily_minute: 0,
        }
    }

    pub fn interval(mins: u64) -> Self {
        Self {
            mode: if mins == 0 {
                SyncScheduleMode::Off
            } else {
                SyncScheduleMode::Interval
            },
            interval_mins: mins,
            daily_hour: 7,
            daily_minute: 0,
        }
    }

    pub fn daily(hour: u8, minute: u8) -> Self {
        Self {
            mode: SyncScheduleMode::Daily,
            interval_mins: 0,
            daily_hour: hour,
            daily_minute: minute,
        }
    }

    pub fn from_env_default() -> Self {
        Self::interval(default_integration_sync_interval_mins())
    }

    pub fn enabled(&self) -> bool {
        !matches!(self.mode, SyncScheduleMode::Off)
    }

    pub fn validate(&self) -> Result<(), String> {
        match self.mode {
            SyncScheduleMode::Off => Ok(()),
            SyncScheduleMode::Interval => {
                if self.interval_mins < SYNC_INTERVAL_MINS_MIN
                    || self.interval_mins > SYNC_INTERVAL_MINS_MAX
                {
                    return Err(format!(
                        "interval_mins phải từ {SYNC_INTERVAL_MINS_MIN}–{SYNC_INTERVAL_MINS_MAX} phút"
                    ));
                }
                Ok(())
            }
            SyncScheduleMode::Daily => {
                if self.daily_hour > 23 {
                    return Err("daily_hour phải từ 0–23".into());
                }
                if self.daily_minute > 59 {
                    return Err("daily_minute phải từ 0–59".into());
                }
                Ok(())
            }
        }
    }

    pub fn to_setting_value(&self) -> String {
        match self.mode {
            // Giữ số thuần cho off/interval — tương thích bản cũ đọc plain int.
            SyncScheduleMode::Off => "0".into(),
            SyncScheduleMode::Interval => self.interval_mins.to_string(),
            SyncScheduleMode::Daily => serde_json::to_string(self).unwrap_or_else(|_| {
                r#"{"mode":"daily","interval_mins":0,"daily_hour":7,"daily_minute":0}"#.into()
            }),
        }
    }
}

pub fn parse_sync_schedule_setting(raw: &str) -> SyncScheduleConfig {
    let t = raw.trim();
    if t.is_empty() {
        return SyncScheduleConfig::from_env_default();
    }
    if let Ok(n) = t.parse::<u64>() {
        return SyncScheduleConfig::interval(n);
    }
    match serde_json::from_str::<SyncScheduleConfig>(t) {
        Ok(cfg) => cfg,
        Err(_) => SyncScheduleConfig::from_env_default(),
    }
}

pub async fn ensure_integration_sync_setting(pool: &PgPool) -> Result<(), sqlx::Error> {
    if db::load_setting(pool, INTEGRATION_SYNC_INTERVAL_SETTING)
        .await?
        .is_none()
    {
        let default = SyncScheduleConfig::from_env_default();
        db::upsert_setting(
            pool,
            INTEGRATION_SYNC_INTERVAL_SETTING,
            &default.to_setting_value(),
        )
        .await?;
    }
    Ok(())
}

pub async fn resolve_integration_sync_schedule(pool: &PgPool) -> SyncScheduleConfig {
    match db::load_setting(pool, INTEGRATION_SYNC_INTERVAL_SETTING).await {
        Ok(Some(v)) => parse_sync_schedule_setting(&v),
        _ => SyncScheduleConfig::from_env_default(),
    }
}

/// Compat: phút chu kỳ (0 = tắt). Daily trả 0 cho caller cũ chỉ quan tâm interval.
pub async fn resolve_integration_sync_interval_mins(pool: &PgPool) -> u64 {
    let cfg = resolve_integration_sync_schedule(pool).await;
    match cfg.mode {
        SyncScheduleMode::Off => 0,
        SyncScheduleMode::Interval => cfg.interval_mins,
        SyncScheduleMode::Daily => 0,
    }
}

pub async fn set_integration_sync_schedule(
    pool: &PgPool,
    cfg: &SyncScheduleConfig,
) -> Result<(), String> {
    cfg.validate()?;
    db::upsert_setting(
        pool,
        INTEGRATION_SYNC_INTERVAL_SETTING,
        &cfg.to_setting_value(),
    )
    .await
    .map_err(|e| format!("db: {e}"))
}

fn last_auto_sync_setting_key(tenant_id: i64) -> String {
    format!("integration_last_auto_sync_at:{tenant_id}")
}

async fn touch_last_auto_sync(pool: &PgPool, tenant_id: i64) {
    let key = last_auto_sync_setting_key(tenant_id);
    let now = chrono::Utc::now().to_rfc3339();
    if let Err(e) = db::upsert_setting(pool, &key, &now).await {
        tracing::warn!(tenant_id, error = %e, "touch last auto sync failed");
    }
}

async fn load_last_auto_sync_at(pool: &PgPool, tenant_id: i64) -> Option<String> {
    let key = last_auto_sync_setting_key(tenant_id);
    db::load_setting(pool, &key).await.ok().flatten()
}

fn schedule_tz() -> chrono::FixedOffset {
    chrono::FixedOffset::east_opt(SCHEDULE_TZ_OFFSET_SECS).expect("UTC+7 offset")
}

/// Đã qua giờ daily hôm nay (UTC+7) và chưa sync sau mốc đó.
/// Lần đầu (chưa có last_auto_sync): chỉ chạy trong cửa sổ 2 phút sau giờ hẹn —
/// tránh bật lịch lúc chiều rồi sync ngay.
fn should_run_daily(cfg: &SyncScheduleConfig, last_auto_sync_at: Option<&str>) -> bool {
    use chrono::{Datelike, TimeZone};
    let tz = schedule_tz();
    let now = chrono::Utc::now().with_timezone(&tz);
    let Some(target) = tz
        .with_ymd_and_hms(
            now.year(),
            now.month(),
            now.day(),
            u32::from(cfg.daily_hour),
            u32::from(cfg.daily_minute),
            0,
        )
        .single()
    else {
        return false;
    };
    if now < target {
        return false;
    }
    match last_auto_sync_at.and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok()) {
        Some(last) => last.with_timezone(&tz) < target,
        None => {
            let window_end = target + chrono::Duration::minutes(2);
            now < window_end
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct IntegrationSyncSchedule {
    pub enabled: bool,
    pub mode: SyncScheduleMode,
    pub interval_mins: u64,
    pub daily_hour: u8,
    pub daily_minute: u8,
    pub timezone: &'static str,
    pub interval_mins_min: u64,
    pub interval_mins_max: u64,
    /// Legacy — UI mới không phụ thuộc list cố định.
    pub allowed_intervals: Vec<u64>,
    pub env_default_mins: u64,
    pub sf_connected: bool,
    pub zoho_connected: bool,
    pub both_connected: bool,
    pub last_pipeline_sync_at: Option<String>,
    pub last_auto_sync_at: Option<String>,
}

pub async fn fetch_integration_sync_schedule(
    pool: &PgPool,
    tenant_id: i64,
) -> IntegrationSyncSchedule {
    let cfg = resolve_integration_sync_schedule(pool).await;
    let (sf_connected, zoho_connected, both_connected) =
        integration_connection_flags(pool, tenant_id).await;
    let last_pipeline_sync_at = db::latest_pipeline_sync_at(pool, tenant_id)
        .await
        .ok()
        .flatten();
    let last_auto_sync_at = load_last_auto_sync_at(pool, tenant_id).await;
    IntegrationSyncSchedule {
        enabled: cfg.enabled(),
        mode: cfg.mode,
        interval_mins: cfg.interval_mins,
        daily_hour: cfg.daily_hour,
        daily_minute: cfg.daily_minute,
        timezone: "Asia/Ho_Chi_Minh",
        interval_mins_min: SYNC_INTERVAL_MINS_MIN,
        interval_mins_max: SYNC_INTERVAL_MINS_MAX,
        allowed_intervals: vec![],
        env_default_mins: default_integration_sync_interval_mins(),
        sf_connected,
        zoho_connected,
        both_connected,
        last_pipeline_sync_at,
        last_auto_sync_at,
    }
}

#[derive(Debug, Deserialize)]
pub struct UpdateIntegrationSyncScheduleBody {
    /// `off` | `interval` | `daily`. Thiếu → suy từ `interval_mins` (API cũ).
    pub mode: Option<String>,
    pub interval_mins: Option<u64>,
    pub daily_hour: Option<u8>,
    pub daily_minute: Option<u8>,
}

fn sync_schedule_from_update_body(
    body: &UpdateIntegrationSyncScheduleBody,
) -> Result<SyncScheduleConfig, String> {
    if let Some(ref mode_raw) = body.mode {
        let mode = SyncScheduleMode::parse(mode_raw)
            .ok_or_else(|| "mode phải là off, interval hoặc daily".to_string())?;
        let cfg = match mode {
            SyncScheduleMode::Off => SyncScheduleConfig::off(),
            SyncScheduleMode::Interval => {
                let mins = body
                    .interval_mins
                    .ok_or_else(|| "interval mode cần interval_mins (số phút)".to_string())?;
                if mins == 0 {
                    return Err(
                        "interval mode cần interval_mins ≥ 1 (tắt thì dùng mode=off)".into(),
                    );
                }
                SyncScheduleConfig::interval(mins)
            }
            SyncScheduleMode::Daily => SyncScheduleConfig::daily(
                body.daily_hour.unwrap_or(7),
                body.daily_minute.unwrap_or(0),
            ),
        };
        cfg.validate()?;
        return Ok(cfg);
    }
    // API cũ: chỉ gửi interval_mins (0 = tắt).
    let mins = body
        .interval_mins
        .ok_or_else(|| "Cần mode hoặc interval_mins".to_string())?;
    let cfg = SyncScheduleConfig::interval(mins);
    cfg.validate()?;
    Ok(cfg)
}

pub async fn api_get_integration_sync_schedule(ctx: &AdminCtx) -> Response {
    let Some(st) = STATE.get() else {
        return json_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "internal_error",
            "state not initialized",
        );
    };
    let schedule = fetch_integration_sync_schedule(&st.pool, ctx.tenant_id).await;
    (StatusCode::OK, axum::Json(schedule)).into_response()
}

pub async fn api_update_integration_sync_schedule(
    ctx: &AdminCtx,
    body: UpdateIntegrationSyncScheduleBody,
) -> Response {
    let Some(st) = STATE.get() else {
        return json_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "internal_error",
            "state not initialized",
        );
    };
    let cfg = match sync_schedule_from_update_body(&body) {
        Ok(c) => c,
        Err(msg) => {
            return json_error(StatusCode::BAD_REQUEST, "invalid_schedule", &msg);
        }
    };
    if let Err(e) = set_integration_sync_schedule(&st.pool, &cfg).await {
        return json_error(StatusCode::INTERNAL_SERVER_ERROR, "save_failed", &e);
    }
    let detail = match cfg.mode {
        SyncScheduleMode::Off => "mode=off".to_string(),
        SyncScheduleMode::Interval => format!("mode=interval,interval_mins={}", cfg.interval_mins),
        SyncScheduleMode::Daily => format!(
            "mode=daily,time={:02}:{:02}+07",
            cfg.daily_hour, cfg.daily_minute
        ),
    };
    write_audit(
        &st.pool,
        ctx,
        "integration.sync_schedule",
        "gateway_settings",
        "success",
        None,
        Some(&detail),
    )
    .await;
    let schedule = fetch_integration_sync_schedule(&st.pool, ctx.tenant_id).await;
    (StatusCode::OK, axum::Json(schedule)).into_response()
}

async fn run_background_integration_sync(pool: &PgPool, schedule: &SyncScheduleConfig) {
    let tenants = db::list_tenant_ids(pool).await.unwrap_or_else(|e| {
        tracing::warn!(error = %e, "list tenants for sync worker failed");
        vec![1]
    });
    for tenant_id in tenants {
        let (sf_connected, zoho_connected, both_connected) =
            integration_connection_flags(pool, tenant_id).await;
        if sf_connected || zoho_connected {
            refresh_integration_tokens_if_needed(pool, tenant_id).await;
        }
        if !both_connected {
            continue;
        }
        if matches!(schedule.mode, SyncScheduleMode::Daily) {
            let last = load_last_auto_sync_at(pool, tenant_id).await;
            if !should_run_daily(schedule, last.as_deref()) {
                continue;
            }
        }
        match run_full_sync_pipeline(pool, tenant_id).await {
            Ok(summary) => {
                touch_last_auto_sync(pool, tenant_id).await;
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

/// Background worker: interval (N phút) hoặc daily (giờ cố định UTC+7).
pub fn spawn_integration_sync_worker(pool: PgPool) {
    tokio::spawn(async move {
        let mut elapsed_since_sync = Duration::ZERO;
        let mut last_mode = SyncScheduleMode::Off;
        loop {
            let cfg = resolve_integration_sync_schedule(&pool).await;
            if cfg.mode != last_mode {
                elapsed_since_sync = Duration::ZERO;
                last_mode = cfg.mode;
            }
            match cfg.mode {
                SyncScheduleMode::Off => {
                    if elapsed_since_sync > Duration::ZERO {
                        tracing::info!("integration background sync disabled");
                        elapsed_since_sync = Duration::ZERO;
                    }
                    tokio::time::sleep(Duration::from_secs(SYNC_INTERVAL_POLL_SECS)).await;
                }
                SyncScheduleMode::Interval => {
                    let period = Duration::from_secs(cfg.interval_mins.saturating_mul(60));
                    if elapsed_since_sync >= period {
                        run_background_integration_sync(&pool, &cfg).await;
                        elapsed_since_sync = Duration::ZERO;
                    }
                    let sleep_for = if elapsed_since_sync.is_zero() {
                        period
                    } else {
                        period.saturating_sub(elapsed_since_sync)
                    };
                    let step = sleep_for.min(Duration::from_secs(SYNC_INTERVAL_POLL_SECS));
                    tokio::time::sleep(step).await;
                    elapsed_since_sync += step;
                }
                SyncScheduleMode::Daily => {
                    run_background_integration_sync(&pool, &cfg).await;
                    tokio::time::sleep(Duration::from_secs(SYNC_INTERVAL_POLL_SECS)).await;
                }
            }
        }
    });
    tracing::info!("integration background sync worker started");
}

#[cfg(test)]
mod middleware_tests {
    use super::*;

    #[test]
    fn parse_sync_schedule_plain_and_json() {
        assert_eq!(parse_sync_schedule_setting("0").mode, SyncScheduleMode::Off);
        assert_eq!(
            parse_sync_schedule_setting("20").mode,
            SyncScheduleMode::Interval
        );
        assert_eq!(parse_sync_schedule_setting("20").interval_mins, 20);
        let daily = parse_sync_schedule_setting(
            r#"{"mode":"daily","interval_mins":0,"daily_hour":7,"daily_minute":30}"#,
        );
        assert_eq!(daily.mode, SyncScheduleMode::Daily);
        assert_eq!(daily.daily_hour, 7);
        assert_eq!(daily.daily_minute, 30);
    }

    #[test]
    fn interval_validate_bounds() {
        assert!(SyncScheduleConfig::interval(1).validate().is_ok());
        assert!(SyncScheduleConfig::interval(10080).validate().is_ok());
        assert!(SyncScheduleConfig::interval(10081).validate().is_err());
        assert!(SyncScheduleConfig::daily(7, 0).validate().is_ok());
        assert!(SyncScheduleConfig::daily(24, 0).validate().is_err());
    }

    #[test]
    fn token_expires_soon_flags_missing_or_past() {
        assert!(token_expires_soon(None));
        let past = (chrono::Utc::now() - chrono::Duration::minutes(1)).to_rfc3339();
        assert!(token_expires_soon(Some(&past)));
        let future = (chrono::Utc::now() + chrono::Duration::hours(2)).to_rfc3339();
        assert!(!token_expires_soon(Some(&future)));
    }
}
