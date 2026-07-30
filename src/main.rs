mod admin_auth;
mod canonical_api;
mod crypto;
mod dashboard;
mod db;
mod gateway_rsa;
mod identity;
mod integrations;
mod jwt_auth;
mod metrics;
mod mock_api;
mod oauth_authorize;
mod oauth_handlers;
mod oauth_tokens;
mod password_reset;
mod pkce;
mod proxy_ext;
mod rate_limit;
mod route_match;
mod session;
mod sync_worker_gateway;
mod transform;

use admin_auth::{
    AdminCtx, session_unavailable_response, write_audit, write_audit_event, write_audit_failure,
};
use axum::{
    Router,
    body::Body,
    extract::connect_info::ConnectInfo,
    extract::{Extension, Form, Json, Path, Query},
    http::{
        HeaderMap, HeaderValue, Method, Request, StatusCode, Uri,
        header::{AUTHORIZATION, CONTENT_TYPE, COOKIE, RETRY_AFTER, SET_COOKIE},
    },
    middleware::{self, Next},
    response::IntoResponse,
    response::Response,
    routing::{delete, get, post, put},
};
use dashmap::DashMap;
use integrations::OAuthPending;
use jwt_auth::VerifiedClient;
use serde::{Deserialize, Serialize};
use session::{SessionRecord, SessionStore, SessionStoreStatus};
use sqlx::PgPool;
use std::{
    io::ErrorKind,
    net::SocketAddr,
    sync::{Arc, OnceLock},
    time::{Duration, Instant},
};
use tokio::sync::RwLock;
use tower::ServiceExt;
use tower_http::catch_panic::CatchPanicLayer;
use tower_http::cors::{AllowOrigin, CorsLayer};
use tower_http::normalize_path::NormalizePathLayer;
use tower_http::services::{ServeDir, ServeFile};
use tracing::info;

/// Origins được phép gọi admin API (cookie + credentials). Thêm domain production qua biến môi trường.
fn cors_allowed_origins() -> Vec<HeaderValue> {
    let mut out = vec![
        HeaderValue::from_static("http://localhost:5173"),
        HeaderValue::from_static("http://127.0.0.1:5173"),
    ];
    if let Ok(raw) = std::env::var("CORS_ALLOWED_ORIGINS") {
        for part in raw.split(',').map(str::trim).filter(|p| !p.is_empty()) {
            match part.parse::<HeaderValue>() {
                Ok(h) => out.push(h),
                Err(_) => {
                    eprintln!("⚠️ CORS_ALLOWED_ORIGINS: bỏ qua giá trị không hợp lệ: {part:?}")
                }
            }
        }
    }
    out
}

/// One route row from SQLite (admin API + runtime routing).
#[derive(Debug, Clone, Deserialize, Serialize, sqlx::FromRow)]
pub struct RouteRow {
    pub id: i64,
    pub path: String,
    pub target: String,
    pub timeout_secs: i32,
    pub rate_limit_per_min: i32,
    pub tenant_id: i64,
    #[serde(default = "default_json_obj")]
    pub transform_add_headers: String,
    #[serde(default = "default_json_arr")]
    pub transform_remove_headers: String,
    #[serde(default)]
    pub retry_max: i32,
    #[serde(default = "route_match::default_retry_status_codes")]
    pub retry_on_status: Vec<i32>,
    #[serde(default = "default_one")]
    pub retry_on_timeout: i32,
    #[serde(default)]
    pub queue_on_failure: i32,
    #[serde(default = "route_match::default_allowed_methods_list")]
    pub allowed_methods: Vec<String>,
}

fn default_json_obj() -> String {
    "{}".into()
}

fn default_json_arr() -> String {
    "[]".into()
}

fn default_one() -> i32 {
    1
}

/// `path` / `target` pair in `config.yaml` bootstrap.
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct RouteSeed {
    pub path: String,
    pub target: String,
}

/// Fields read from `config.yaml` (operational toggles + optional bootstrap seed).
#[allow(dead_code)]
#[derive(Debug, Clone, Deserialize)]
pub struct YamlBootstrap {
    #[serde(default)]
    routes: Vec<RouteSeed>,
    #[serde(default)]
    api_keys: Vec<String>,
    #[serde(default)]
    rate_limit: RateLimitConfig,
    #[serde(default)]
    transform: FeatureToggle,
    #[serde(default)]
    retry: FeatureToggle,
    #[serde(default)]
    queue: FeatureToggle,
}

impl Default for YamlBootstrap {
    fn default() -> Self {
        Self {
            routes: Vec::new(),
            api_keys: vec![],
            rate_limit: RateLimitConfig::default(),
            transform: FeatureToggle::default(),
            retry: FeatureToggle::default(),
            queue: FeatureToggle::default(),
        }
    }
}

/// Runtime config: routes + client credentials loaded from SQLite; rate limit from YAML.
#[derive(Debug, Clone)]
struct AppConfig {
    routes: Vec<RouteRow>,
    client_credentials: db::ClientCredentials,
    admin_api_key_sha256: String,
    settings: RuntimeSettings,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
struct FeatureToggle {
    #[serde(default)]
    enabled: bool,
}

impl Default for FeatureToggle {
    fn default() -> Self {
        Self { enabled: false }
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
struct RateLimitConfig {
    #[serde(default = "default_rl_enabled")]
    enabled: bool,
    #[serde(default = "default_rl_burst_enabled")]
    burst_enabled: bool,
    #[serde(default = "default_rl_rps")]
    rps: u32,
    #[serde(default = "default_rl_burst")]
    burst: u32,
}

impl Default for RateLimitConfig {
    fn default() -> Self {
        Self {
            enabled: default_rl_enabled(),
            burst_enabled: default_rl_burst_enabled(),
            rps: default_rl_rps(),
            burst: default_rl_burst(),
        }
    }
}

fn default_rl_enabled() -> bool {
    false
}
fn default_rl_burst_enabled() -> bool {
    true
}
fn default_rl_rps() -> u32 {
    10
}
fn default_rl_burst() -> u32 {
    20
}

#[derive(Debug, Clone)]
struct RuntimeSettings {
    rate_limit: RateLimitConfig,
    enable_metrics: bool,
    enable_health_check: bool,
    extensions: proxy_ext::ExtensionToggles,
    /// Dashboard: giây chờ hoàn tác sau khi bấm xóa (0 = xóa ngay).
    undo_delete_seconds: u32,
}

impl Default for RuntimeSettings {
    fn default() -> Self {
        Self {
            rate_limit: RateLimitConfig::default(),
            enable_metrics: true,
            enable_health_check: true,
            extensions: proxy_ext::ExtensionToggles::default(),
            undo_delete_seconds: default_undo_delete_seconds(),
        }
    }
}

fn default_undo_delete_seconds() -> u32 {
    10
}

#[derive(Debug, Serialize)]
struct SettingsSystemInfo {
    version: &'static str,
    runtime: &'static str,
    database: &'static str,
    bind_port: u16,
    log_format: &'static str,
    has_admin_api_key: bool,
    deployment_mode: &'static str,
}

#[derive(Debug, Serialize)]
struct SettingsResponse {
    rate_limit_enabled: bool,
    rate_limit_burst_enabled: bool,
    rate_limit_rps: u32,
    rate_limit_burst: u32,
    enable_metrics: bool,
    enable_health_check: bool,
    transform_enabled: bool,
    retry_enabled: bool,
    queue_enabled: bool,
    undo_delete_seconds: u32,
    system_info: SettingsSystemInfo,
}

#[derive(Debug, Deserialize)]
struct UpdateSettingsBody {
    rate_limit_enabled: bool,
    #[serde(default = "default_rl_burst_enabled")]
    rate_limit_burst_enabled: bool,
    rate_limit_rps: u32,
    rate_limit_burst: u32,
    enable_metrics: bool,
    enable_health_check: bool,
    #[serde(default)]
    transform_enabled: bool,
    #[serde(default)]
    retry_enabled: bool,
    #[serde(default)]
    queue_enabled: bool,
    #[serde(default = "default_undo_delete_seconds")]
    undo_delete_seconds: u32,
}

#[derive(Clone)]
pub(crate) struct AppState {
    pool: PgPool,
    config: Arc<RwLock<AppConfig>>,
    http: reqwest::Client,
    rate_limiter: Arc<rate_limit::RateLimiter>,
    /// Admin browser sessions — Redis (module `session`).
    session_store: Arc<SessionStore>,
    /// OAuth CSRF cache (SF/Zoho upstream connect).
    oauth_pending: Arc<DashMap<String, OAuthPending>>,
    proxy_queue: proxy_ext::ProxyQueue,
    gateway_metrics: Arc<metrics::GatewayMetrics>,
    /// JWT loopback cho integration sync worker (`avaso_cid_sync_worker`).
    worker_jwt: Arc<RwLock<sync_worker_gateway::WorkerJwtState>>,
}

static STATE: OnceLock<AppState> = OnceLock::new();

/// Prefix data plane (SRS): mọi path dưới đây bắt buộc `Authorization: Bearer` JWT; không route → 404 JSON (không SPA).
/// `DATA_PLANE_PREFIX=` rỗng → tắt nhánh này.
static DATA_PLANE_PREFIX: OnceLock<&'static str> = OnceLock::new();

fn data_plane_prefix() -> &'static str {
    *DATA_PLANE_PREFIX.get_or_init(|| match std::env::var("DATA_PLANE_PREFIX") {
        Ok(s) if !s.is_empty() => Box::leak(s.into_boxed_str()),
        Ok(_) => "",
        Err(_) => "/v1/api",
    })
}

fn path_is_under_data_plane(path: &str) -> bool {
    let p = data_plane_prefix();
    if p.is_empty() {
        return false;
    }
    path == p || path.starts_with(&format!("{p}/"))
}

/// Typo sát prefix data-plane (vd `/v1/api123`) — không phải `/prefix` hay `/prefix/...`.
fn path_is_data_plane_typo(path: &str) -> bool {
    let p = data_plane_prefix();
    if p.is_empty() {
        return false;
    }
    path.starts_with(p) && !path_is_under_data_plane(path)
}

/// Namespace API (cha của prefix, vd `/v1` khi prefix là `/v1/api`) — không trả SPA.
fn path_is_api_namespace(path: &str) -> bool {
    let p = data_plane_prefix();
    if p.is_empty() {
        return false;
    }
    let Some(i) = p.rfind('/') else {
        return false;
    };
    let ns = &p[..i];
    if ns.is_empty() {
        return false;
    }
    path == ns || path.starts_with(&format!("{ns}/"))
}

fn reject_non_api_path(path: &str) -> Response {
    let p = data_plane_prefix();
    if path_is_data_plane_typo(path) {
        return json_error(
            StatusCode::NOT_FOUND,
            "not_found",
            &format!("Invalid path; use {p} or {p}/<segment> (typo: missing '/' after prefix?)"),
        );
    }
    json_error(
        StatusCode::NOT_FOUND,
        "not_found",
        &format!("No route configured; client API paths use prefix {p}"),
    )
}

fn json_error(status: StatusCode, error: &str, message: &str) -> Response {
    (
        status,
        [(CONTENT_TYPE, HeaderValue::from_static("application/json"))],
        Json(serde_json::json!({ "error": error, "message": message })),
    )
        .into_response()
}

pub(crate) fn json_error_fields(
    status: StatusCode,
    error: &str,
    message: &str,
    fields: serde_json::Map<String, serde_json::Value>,
) -> Response {
    (
        status,
        [(CONTENT_TYPE, HeaderValue::from_static("application/json"))],
        Json(serde_json::json!({
            "error": error,
            "message": message,
            "fields": fields,
        })),
    )
        .into_response()
}

/// Kiểm tra path/target trước khi ghi DB. Trả về response lỗi nếu không hợp lệ.
/// Rate limit: client registry → route → global settings.
#[derive(Debug, Clone, Copy)]
struct ResolvedRateLimit {
    active: bool,
    rps: f64,
    burst: u32,
    /// Giá trị hiển thị header `X-RateLimit-Limit`.
    limit_header: u32,
}

fn resolve_rate_limit(
    client: &VerifiedClient,
    route: Option<&RouteRow>,
    settings: &RuntimeSettings,
) -> ResolvedRateLimit {
    let burst_enabled = settings.rate_limit.burst_enabled;
    if client.rate_limit_per_min > 0 {
        let (rps, calculated) = rate_limit::per_min_to_bucket(client.rate_limit_per_min);
        return ResolvedRateLimit {
            active: true,
            rps,
            burst: rate_limit::effective_burst(calculated, burst_enabled),
            limit_header: client.rate_limit_per_min as u32,
        };
    }
    if let Some(r) = route.filter(|r| r.rate_limit_per_min > 0) {
        let (rps, calculated) = rate_limit::per_min_to_bucket(r.rate_limit_per_min);
        return ResolvedRateLimit {
            active: true,
            rps,
            burst: rate_limit::effective_burst(calculated, burst_enabled),
            limit_header: r.rate_limit_per_min as u32,
        };
    }
    if settings.rate_limit.enabled {
        ResolvedRateLimit {
            active: true,
            rps: settings.rate_limit.rps as f64,
            burst: rate_limit::effective_burst(settings.rate_limit.burst, burst_enabled),
            limit_header: settings.rate_limit.rps,
        }
    } else {
        ResolvedRateLimit {
            active: false,
            rps: 0.0,
            burst: 0,
            limit_header: 0,
        }
    }
}

fn rate_limit_header_triple(
    info: &rate_limit::RateLimitInfo,
) -> [(HeaderValue, HeaderValue, HeaderValue); 1] {
    let limit =
        HeaderValue::from_str(&info.limit.to_string()).unwrap_or(HeaderValue::from_static("0"));
    let remaining =
        HeaderValue::from_str(&info.remaining.to_string()).unwrap_or(HeaderValue::from_static("0"));
    let reset = HeaderValue::from_str(&info.reset_unix.to_string())
        .unwrap_or(HeaderValue::from_static("0"));
    [(limit, remaining, reset)]
}

fn apply_rate_limit_headers(res: &mut Response, info: &rate_limit::RateLimitInfo) {
    let [(limit, remaining, reset)] = rate_limit_header_triple(info);
    res.headers_mut().insert("X-RateLimit-Limit", limit);
    res.headers_mut().insert("X-RateLimit-Remaining", remaining);
    res.headers_mut().insert("X-RateLimit-Reset", reset);
}

fn rate_limit_response(info: &rate_limit::RateLimitInfo, retry_after_secs: u64) -> Response {
    let mut res = json_error(
        StatusCode::TOO_MANY_REQUESTS,
        "too_many_requests",
        "Rate limit exceeded",
    );
    if let Ok(hv) = HeaderValue::from_str(&retry_after_secs.max(1).to_string()) {
        res.headers_mut().insert(RETRY_AFTER, hv);
    }
    apply_rate_limit_headers(&mut res, info);
    res
}

async fn consume_data_plane_rate_limit(
    limiter: &rate_limit::RateLimiter,
    rl: ResolvedRateLimit,
    rl_key: &str,
) -> Result<Option<rate_limit::RateLimitInfo>, (rate_limit::RateLimitInfo, u64)> {
    if !rl.active {
        return Ok(None);
    }
    match limiter
        .try_consume(rl_key, rl.rps, rl.burst, rl.limit_header)
        .await
    {
        rate_limit::ConsumeOutcome::Allowed(info) => Ok(Some(info)),
        rate_limit::ConsumeOutcome::Denied {
            info,
            retry_after_secs,
        } => Err((info, retry_after_secs)),
    }
}

fn append_rate_limit_to_builder(
    mut builder: axum::http::response::Builder,
    info: Option<&rate_limit::RateLimitInfo>,
) -> axum::http::response::Builder {
    if let Some(info) = info {
        let [(limit, remaining, reset)] = rate_limit_header_triple(info);
        builder = builder
            .header("X-RateLimit-Limit", limit)
            .header("X-RateLimit-Remaining", remaining)
            .header("X-RateLimit-Reset", reset);
    }
    builder
}

fn validate_route_write(
    path: &str,
    target: &str,
    timeout_secs: i32,
    rate_limit_per_min: i32,
) -> Option<Response> {
    let mut fields = serde_json::Map::new();
    let dp = data_plane_prefix();
    if path.is_empty() {
        fields.insert(
            "path".into(),
            serde_json::Value::String(format!(
                "Nhập path data plane (vd: {}/phuluc)",
                if dp.is_empty() { "/v1/api" } else { dp }
            )),
        );
    } else if !path.starts_with('/') {
        fields.insert(
            "path".into(),
            serde_json::Value::String("Path phải bắt đầu bằng /".into()),
        );
    } else if path.contains(' ') {
        fields.insert(
            "path".into(),
            serde_json::Value::String("Path không được chứa khoảng trắng".into()),
        );
    } else if !dp.is_empty() && !path_is_under_data_plane(path) {
        fields.insert(
            "path".into(),
            serde_json::Value::String(format!(
                "Path phải nằm dưới data plane {dp}/… (vd: {dp}/phuluc). Gọi /phuluc thuần không vào proxy JWT."
            )),
        );
    }
    if target.is_empty() {
        fields.insert(
            "target".into(),
            serde_json::Value::String("Nhập upstream URL (vd: https://httpbin.org)".into()),
        );
    } else if !target.starts_with("http://") && !target.starts_with("https://") {
        fields.insert(
            "target".into(),
            serde_json::Value::String("Upstream phải là URL http:// hoặc https://".into()),
        );
    }
    if timeout_secs < 1 || timeout_secs > 3600 {
        fields.insert(
            "timeout_secs".into(),
            serde_json::Value::String("Timeout phải từ 1 đến 3600 giây".into()),
        );
    }
    if rate_limit_per_min < 0 || rate_limit_per_min > 1_000_000 {
        fields.insert(
            "rate_limit_per_min".into(),
            serde_json::Value::String(
                "Rate limit phải từ 0 (không giới hạn theo route) đến 1.000.000 req/min".into(),
            ),
        );
    }
    if fields.is_empty() {
        return None;
    }
    Some(json_error_fields(
        StatusCode::BAD_REQUEST,
        "validation_failed",
        "Dữ liệu route không hợp lệ",
        fields,
    ))
}

fn status_to_json_error(status: StatusCode) -> Response {
    let (error, message): (&str, &str) = match status {
        StatusCode::UNAUTHORIZED => ("unauthorized", "Missing or invalid Bearer token"),
        StatusCode::TOO_MANY_REQUESTS => ("too_many_requests", "Rate limit exceeded"),
        StatusCode::BAD_GATEWAY => ("bad_gateway", "Upstream request failed"),
        StatusCode::BAD_REQUEST => ("bad_request", "Invalid request body"),
        _ => ("error", "Request failed"),
    };
    json_error(status, error, message)
}

const MAX_DATA_PLANE_BODY: usize = 1024 * 1024;

async fn verify_data_plane_auth(
    state: &AppState,
    cfg: &AppConfig,
    headers: &HeaderMap,
) -> Result<VerifiedClient, jwt_auth::TokenAuthFail> {
    let token =
        jwt_auth::bearer_from_headers(headers).ok_or(jwt_auth::TokenAuthFail::MissingToken)?;
    let store = oauth_tokens::TokenRevocationStore::from_session(&state.session_store);
    jwt_auth::verify_bearer(&cfg.client_credentials, &store, &token).await
}

fn oauth_handler_state(st: &AppState) -> oauth_handlers::OAuthHandlerState {
    oauth_handlers::OAuthHandlerState {
        pool: st.pool.clone(),
        session_store: st.session_store.clone(),
    }
}

/// Header `Authorization` dùng để auth gateway, không nên forward thẳng sang upstream generic.
fn sanitize_upstream_headers(headers: &HeaderMap) -> HeaderMap {
    let mut out = headers.clone();
    out.remove(AUTHORIZATION);
    out
}

#[allow(dead_code)]
fn canonical_request_path(uri: &Uri) -> String {
    let path = uri.path();
    match uri.query() {
        Some(q) if !q.is_empty() => format!("{path}?{q}"),
        _ => path.to_string(),
    }
}

fn mask_subject_for_log(subject: &str) -> String {
    let s = subject.trim();
    if s.is_empty() {
        return "(none)".into();
    }
    if s.len() <= 8 {
        return "****".into();
    }
    format!("{}…", &s[..8.min(s.len())])
}

/// Max bytes of request/response body persisted per transaction detail.
const MAX_TX_DETAIL_BODY: usize = 16 * 1024;

/// Headers redacted before persisting transaction detail (avoid leaking secrets).
fn header_is_sensitive(name: &str) -> bool {
    matches!(
        name.to_ascii_lowercase().as_str(),
        "authorization"
            | "proxy-authorization"
            | "cookie"
            | "set-cookie"
            | "x-api-key"
            | "x-client-secret"
            | "x-auth-token"
    )
}

/// Serialize headers to a compact JSON object, redacting sensitive values.
fn capture_headers(headers: &axum::http::HeaderMap) -> String {
    let map: std::collections::BTreeMap<String, String> = headers
        .iter()
        .map(|(k, v)| {
            let name = k.as_str().to_string();
            let value = if header_is_sensitive(&name) {
                "***redacted***".to_string()
            } else {
                v.to_str().unwrap_or("(binary)").to_string()
            };
            (name, value)
        })
        .collect();
    serde_json::to_string(&map).unwrap_or_else(|_| "{}".into())
}

/// Truncate + lossily decode a body to UTF-8 text. Returns (text, total_bytes, truncated).
fn capture_body(bytes: &[u8]) -> (Option<String>, i64, bool) {
    let total = bytes.len() as i64;
    if bytes.is_empty() {
        return (None, 0, false);
    }
    let truncated = bytes.len() > MAX_TX_DETAIL_BODY;
    let slice = &bytes[..bytes.len().min(MAX_TX_DETAIL_BODY)];
    (
        Some(String::from_utf8_lossy(slice).into_owned()),
        total,
        truncated,
    )
}

/// FR-D1: structured JSON transaction log + persist to PostgreSQL for admin UI.
#[allow(clippy::too_many_arguments)]
fn log_gateway_transaction(
    tenant_id: Option<i64>,
    client_ip: Option<&str>,
    outcome: &'static str,
    reason: &'static str,
    method: &str,
    path: &str,
    status: u16,
    subject: &str,
    upstream: Option<&str>,
    elapsed_ms: u128,
    client_key_id: Option<i64>,
) {
    log_gateway_transaction_detailed(
        tenant_id,
        client_ip,
        outcome,
        reason,
        method,
        path,
        status,
        subject,
        upstream,
        elapsed_ms,
        client_key_id,
        None,
    );
}

#[allow(clippy::too_many_arguments)]
fn log_gateway_transaction_detailed(
    tenant_id: Option<i64>,
    client_ip: Option<&str>,
    outcome: &'static str,
    reason: &'static str,
    method: &str,
    path: &str,
    status: u16,
    subject: &str,
    upstream: Option<&str>,
    elapsed_ms: u128,
    client_key_id: Option<i64>,
    detail: Option<db::TransactionDetail>,
) {
    let request_id = uuid::Uuid::new_v4().to_string();
    let api_key_masked = mask_subject_for_log(subject);
    info!(
        event = "gateway_transaction",
        request_id = %request_id,
        outcome = outcome,
        reason = reason,
        method = method,
        path = path,
        status = status,
        api_key_masked = %api_key_masked,
        upstream = upstream.unwrap_or(""),
        elapsed_ms = elapsed_ms,
        "gateway_transaction"
    );
    if path_is_under_data_plane(path) {
        if let Some(st) = STATE.get() {
            st.gateway_metrics.record_data_plane(outcome);
            st.gateway_metrics.record_latency(elapsed_ms);
        }
    }

    if let Some(st) = STATE.get() {
        let pool = st.pool.clone();
        let req_id = request_id.clone();
        let method = method.to_string();
        let path = path.to_string();
        let api_key_masked = api_key_masked.clone();
        let outcome = outcome.to_string();
        let reason = reason.to_string();
        let upstream = upstream.map(|s| s.to_string());
        let client_ip = client_ip.map(|s| s.to_string());
        tokio::spawn(async move {
            if let Err(e) = db::insert_transaction_log(
                &pool,
                tenant_id,
                &req_id,
                &method,
                &path,
                status as i32,
                elapsed_ms as i64,
                client_ip.as_deref(),
                &api_key_masked,
                client_key_id,
                &outcome,
                &reason,
                upstream.as_deref(),
                detail.as_ref(),
            )
            .await
            {
                tracing::warn!(error = %e, path = %path, "insert_transaction_log failed — traffic log dropped");
            }
        });
    }
}

fn read_yaml_bootstrap(path: &str) -> YamlBootstrap {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|raw| serde_yaml::from_str::<YamlBootstrap>(&raw).ok())
        .unwrap_or_default()
}

fn current_bind_port() -> u16 {
    std::env::var("PORT")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(3000)
}

/// Shared HTTP client cho proxy/integrations. Bắt buộc có connect + read timeout
/// để upstream (Zoho/SF/backend) treo KHÔNG giữ request tới nginx read_timeout (60s) → 502.
/// Proxy set `.timeout()` riêng theo route nên override được default này.
fn build_http_client() -> reqwest::Client {
    let connect_secs: u64 = std::env::var("HTTP_CONNECT_TIMEOUT_SECS")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(5);
    let request_secs: u64 = std::env::var("HTTP_REQUEST_TIMEOUT_SECS")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(30);
    reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(connect_secs.max(1)))
        .timeout(Duration::from_secs(request_secs.max(1)))
        .pool_idle_timeout(Duration::from_secs(30))
        .pool_max_idle_per_host(16)
        .tcp_keepalive(Duration::from_secs(30))
        .build()
        .unwrap_or_else(|e| {
            tracing::warn!(error = %e, "build_http_client fallback to default client");
            reqwest::Client::new()
        })
}

fn server_bind_addr(port: u16) -> SocketAddr {
    let host = std::env::var("BIND_HOST").unwrap_or_else(|_| "127.0.0.1".into());
    host.parse::<std::net::IpAddr>()
        .map(|ip| SocketAddr::from((ip, port)))
        .unwrap_or_else(|_| SocketAddr::from(([127, 0, 0, 1], port)))
}

fn parse_bool_setting(raw: Option<String>, default: bool) -> bool {
    match raw.as_deref().map(|s| s.trim().to_ascii_lowercase()) {
        Some(v) if matches!(v.as_str(), "1" | "true" | "yes" | "on") => true,
        Some(v) if matches!(v.as_str(), "0" | "false" | "no" | "off") => false,
        _ => default,
    }
}

fn parse_u32_setting(raw: Option<String>, default: u32) -> u32 {
    raw.and_then(|s| s.trim().parse::<u32>().ok())
        .unwrap_or(default)
}

async fn load_runtime_settings(
    pool: &PgPool,
    yaml: &YamlBootstrap,
) -> Result<RuntimeSettings, sqlx::Error> {
    let rate_limit_enabled = parse_bool_setting(
        db::load_setting(pool, "runtime_rate_limit_enabled").await?,
        yaml.rate_limit.enabled,
    );
    let rate_limit_rps = parse_u32_setting(
        db::load_setting(pool, "runtime_rate_limit_rps").await?,
        yaml.rate_limit.rps,
    );
    let rate_limit_burst = parse_u32_setting(
        db::load_setting(pool, "runtime_rate_limit_burst").await?,
        yaml.rate_limit.burst,
    );
    let rate_limit_burst_enabled = parse_bool_setting(
        db::load_setting(pool, "runtime_rate_limit_burst_enabled").await?,
        yaml.rate_limit.burst_enabled,
    );
    let enable_metrics = parse_bool_setting(
        db::load_setting(pool, "runtime_metrics_enabled").await?,
        true,
    );
    let enable_health_check = parse_bool_setting(
        db::load_setting(pool, "runtime_health_enabled").await?,
        true,
    );
    let transform_enabled = parse_bool_setting(
        db::load_setting(pool, "runtime_transform_enabled").await?,
        yaml.transform.enabled,
    );
    let retry_enabled = parse_bool_setting(
        db::load_setting(pool, "runtime_retry_enabled").await?,
        yaml.retry.enabled,
    );
    let queue_enabled = parse_bool_setting(
        db::load_setting(pool, "runtime_queue_enabled").await?,
        yaml.queue.enabled,
    );
    let undo_delete_seconds = parse_u32_setting(
        db::load_setting(pool, "runtime_undo_delete_seconds").await?,
        default_undo_delete_seconds(),
    );

    Ok(RuntimeSettings {
        rate_limit: RateLimitConfig {
            enabled: rate_limit_enabled,
            burst_enabled: rate_limit_burst_enabled,
            rps: rate_limit_rps,
            burst: rate_limit_burst,
        },
        enable_metrics,
        enable_health_check,
        extensions: proxy_ext::ExtensionToggles {
            transform_enabled,
            retry_enabled,
            queue_enabled,
        },
        undo_delete_seconds,
    })
}

async fn persist_runtime_settings(
    pool: &PgPool,
    body: &UpdateSettingsBody,
) -> Result<(), sqlx::Error> {
    db::upsert_setting(
        pool,
        "runtime_rate_limit_enabled",
        if body.rate_limit_enabled { "1" } else { "0" },
    )
    .await?;
    db::upsert_setting(
        pool,
        "runtime_rate_limit_rps",
        &body.rate_limit_rps.to_string(),
    )
    .await?;
    db::upsert_setting(
        pool,
        "runtime_rate_limit_burst",
        &body.rate_limit_burst.to_string(),
    )
    .await?;
    db::upsert_setting(
        pool,
        "runtime_rate_limit_burst_enabled",
        if body.rate_limit_burst_enabled {
            "1"
        } else {
            "0"
        },
    )
    .await?;
    db::upsert_setting(
        pool,
        "runtime_metrics_enabled",
        if body.enable_metrics { "1" } else { "0" },
    )
    .await?;
    db::upsert_setting(
        pool,
        "runtime_health_enabled",
        if body.enable_health_check { "1" } else { "0" },
    )
    .await?;
    db::upsert_setting(
        pool,
        "runtime_transform_enabled",
        if body.transform_enabled { "1" } else { "0" },
    )
    .await?;
    db::upsert_setting(
        pool,
        "runtime_retry_enabled",
        if body.retry_enabled { "1" } else { "0" },
    )
    .await?;
    db::upsert_setting(
        pool,
        "runtime_queue_enabled",
        if body.queue_enabled { "1" } else { "0" },
    )
    .await?;
    db::upsert_setting(
        pool,
        "runtime_undo_delete_seconds",
        &body.undo_delete_seconds.to_string(),
    )
    .await?;
    Ok(())
}

fn settings_response_from_config(cfg: &AppConfig) -> SettingsResponse {
    SettingsResponse {
        rate_limit_enabled: cfg.settings.rate_limit.enabled,
        rate_limit_burst_enabled: cfg.settings.rate_limit.burst_enabled,
        rate_limit_rps: cfg.settings.rate_limit.rps,
        rate_limit_burst: cfg.settings.rate_limit.burst,
        enable_metrics: cfg.settings.enable_metrics,
        enable_health_check: cfg.settings.enable_health_check,
        transform_enabled: cfg.settings.extensions.transform_enabled,
        retry_enabled: cfg.settings.extensions.retry_enabled,
        queue_enabled: cfg.settings.extensions.queue_enabled,
        undo_delete_seconds: cfg.settings.undo_delete_seconds,
        system_info: SettingsSystemInfo {
            version: env!("CARGO_PKG_VERSION"),
            runtime: "Rust/Tokio",
            database: "PostgreSQL",
            bind_port: current_bind_port(),
            log_format: "tracing JSON",
            has_admin_api_key: !cfg.admin_api_key_sha256.is_empty(),
            deployment_mode: if admin_auth::on_prem_single_org() {
                "on_prem"
            } else {
                "saas"
            },
        },
    }
}

fn validate_settings_write(body: &UpdateSettingsBody) -> Option<Response> {
    let mut fields = serde_json::Map::new();
    if body.rate_limit_enabled && body.rate_limit_rps == 0 {
        fields.insert(
            "rate_limit_rps".into(),
            serde_json::Value::String("Bật rate limit thì RPS phải > 0".into()),
        );
    }
    if body.rate_limit_enabled && body.rate_limit_burst_enabled && body.rate_limit_burst == 0 {
        fields.insert(
            "rate_limit_burst".into(),
            serde_json::Value::String("Bật burst thì giá trị burst phải > 0".into()),
        );
    }
    if body.rate_limit_rps > 100_000 {
        fields.insert(
            "rate_limit_rps".into(),
            serde_json::Value::String("RPS quá lớn".into()),
        );
    }
    if body.rate_limit_burst > 1_000_000 {
        fields.insert(
            "rate_limit_burst".into(),
            serde_json::Value::String("Burst quá lớn".into()),
        );
    }
    if body.undo_delete_seconds > 120 {
        fields.insert(
            "undo_delete_seconds".into(),
            serde_json::Value::String("Thời gian hoàn tác tối đa 120 giây".into()),
        );
    }
    if fields.is_empty() {
        None
    } else {
        Some(json_error_fields(
            StatusCode::BAD_REQUEST,
            "validation_failed",
            "Cấu hình hệ thống không hợp lệ",
            fields,
        ))
    }
}

async fn build_app_config(pool: &PgPool) -> Result<AppConfig, sqlx::Error> {
    let yaml = read_yaml_bootstrap("config.yaml");
    // Đọc lại routes + client keys
    let routes = db::load_route_rows(pool).await?;
    let client_credentials = db::load_client_credentials(pool).await?;
    let admin_api_key_sha256 = db::load_admin_hash(pool).await?;
    let settings = load_runtime_settings(pool, &yaml).await?;
    // Cấu hình runtime
    Ok(AppConfig {
        routes,
        client_credentials,
        admin_api_key_sha256,
        settings,
    })
}

async fn reload_runtime_config() -> Result<(), sqlx::Error> {
    let st = STATE.get().expect("STATE not initialized");
    let cfg = build_app_config(&st.pool).await?;
    // Cập nhật AppConfig
    *st.config.write().await = cfg;
    // Đã nạp
    Ok(())
}

/// Trả response API trước — tránh nginx 502 khi reload config chậm.
fn spawn_reload_runtime_config() {
    tokio::spawn(async {
        if let Err(e) = reload_runtime_config().await {
            tracing::warn!(error = %e, "background config reload failed");
        }
    });
}

fn spawn_touch_client_key(key_id: i64) {
    tokio::spawn(async move {
        if let Some(st) = STATE.get() {
            if let Err(e) = db::touch_client_key_last_used(&st.pool, key_id).await {
                tracing::debug!(error = %e, key_id, "touch client last_used failed");
            }
        }
    });
}

async fn ensure_client_key_manage_access(
    pool: &PgPool,
    ctx: &AdminCtx,
    id: i64,
) -> Result<(), Response> {
    if ctx.is_admin() {
        return Ok(());
    }
    match db::fetch_client_key_owner(pool, id, ctx.tenant_id).await {
        Ok(Some(owner)) if owner == ctx.user_id => Ok(()),
        Ok(None) => Err((
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({ "error": "client key not found" })),
        )
            .into_response()),
        Ok(Some(_)) => Err(admin_auth::forbidden_response()),
        Err(e) => Err((
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": format!("{e}") })),
        )
            .into_response()),
    }
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt().with_target(false).json().init();

    let database_url = std::env::var("DATABASE_URL")
        .unwrap_or_else(|_| "postgres://avaso:avaso@127.0.0.1:5432/avaso_gateway".into());

    let pool = db::connect(&database_url)
        .await
        .expect("open postgres database");
    db::migrate(&pool).await.expect("run migrations");

    let yaml = read_yaml_bootstrap("config.yaml");
    db::bootstrap_from_yaml_if_empty(&pool, &yaml)
        .await
        .expect("bootstrap yaml into db");
    db::bootstrap_admin_user_if_empty(&pool)
        .await
        .expect("bootstrap admin user");
    db::ensure_admin_setting(&pool)
        .await
        .expect("ensure admin api key hash in db");
    db::ensure_default_tenant(&pool)
        .await
        .expect("ensure default tenant");
    db::backfill_admin_tenants(&pool)
        .await
        .expect("backfill admin tenant_id");
    if admin_auth::on_prem_single_org() {
        db::migrate_on_prem_organization(&pool)
            .await
            .expect("on-prem organization migration");
    } else {
        db::migrate_workspace_isolation(&pool)
            .await
            .expect("workspace isolation migration");
    }
    integrations::ensure_integration_rows(&pool, 1)
        .await
        .expect("ensure integration rows");
    db::purge_expired_oauth_pending(&pool)
        .await
        .expect("purge expired oauth pending");
    db::backfill_client_secret_hashes(&pool)
        .await
        .expect("backfill client secret Argon2id");
    gateway_rsa::ensure_gateway_rsa_keys(&pool)
        .await
        .expect("ensure gateway RSA keypair");
    gateway_rsa::init_rsa_from_db(&pool)
        .await
        .expect("load gateway RSA private key");

    let worker_jwt_state = sync_worker_gateway::init_worker_jwt_state(&pool, 1)
        .await
        .expect("init sync worker JWT for gateway loopback");

    let initial = build_app_config(&pool)
        .await
        .expect("reload config after sync worker client ensure");

    integrations::ensure_integration_sync_setting(&pool)
        .await
        .expect("seed integration sync schedule setting");

    let session_store = session::init_session_store().await;
    let rate_limiter = Arc::new(rate_limit::RateLimiter::new(session_store.redis()));
    let proxy_queue = proxy_ext::ProxyQueue::new(pool.clone());

    proxy_ext::spawn_dlq_replay_worker(pool.clone());

    let pool_worker = pool.clone();
    let state = AppState {
        pool,
        config: Arc::new(RwLock::new(initial)),
        http: build_http_client(),
        rate_limiter,
        session_store,
        oauth_pending: Arc::new(DashMap::new()),
        proxy_queue,
        gateway_metrics: Arc::new(metrics::GatewayMetrics::new()),
        worker_jwt: Arc::new(RwLock::new(worker_jwt_state)),
    };
    let _ = STATE.set(state);

    integrations::spawn_integration_sync_worker(pool_worker);

    let api_protected = Router::new()
        .route("/proxy", get(proxy_handler))
        .route("/routes", get(api_routes).post(api_create_route))
        .route("/routes/acl-summary", get(api_routes_acl_summary))
        .route("/routes/:id/clients", get(api_route_clients))
        .route(
            "/routes/:id",
            put(api_update_route).delete(api_delete_route),
        )
        .route(
            "/client-keys",
            get(api_list_client_keys).post(api_create_client_key),
        )
        .route("/client-keys/bulk-status", post(api_bulk_client_key_status))
        .route(
            "/client-keys/traffic-summary",
            get(api_client_keys_traffic_summary),
        )
        .route(
            "/client-keys/encrypted",
            post(api_create_client_key_encrypted),
        )
        .route(
            "/client-keys/:id",
            get(api_get_client_key)
                .patch(api_patch_client_key)
                .delete(api_delete_client_key),
        )
        .route(
            "/client-keys/:id/routes",
            get(api_get_client_key_routes).put(api_put_client_key_routes),
        )
        .route(
            "/client-keys/:id/revoke-tokens",
            post(api_client_key_revoke_tokens),
        )
        .route("/client-keys/:id/rotate", post(api_rotate_client_key))
        .route("/client-keys/:id/traffic", get(api_get_client_key_traffic))
        .route("/users", get(api_list_users).post(api_create_user))
        .route("/users/:id", put(api_update_user).delete(api_delete_user))
        .route("/workspace/memberships", get(api_list_workspaces))
        .route("/workspace/switch", post(api_switch_workspace))
        .route(
            "/workspace/members",
            get(api_list_workspace_members).post(api_invite_workspace_member),
        )
        .route(
            "/workspace/members/:user_id",
            delete(api_remove_workspace_member),
        )
        .route("/audit-logs", get(api_list_audit_logs))
        .route("/transaction-logs", get(api_list_transaction_logs))
        .route(
            "/transaction-logs/:id/detail",
            get(api_get_transaction_detail),
        )
        .route("/proxy-queue", get(api_list_proxy_queue))
        .route(
            "/proxy-queue/bulk-delete",
            post(api_bulk_delete_proxy_queue),
        )
        .route("/proxy-queue/:id/retry", post(api_retry_proxy_queue))
        .route("/proxy-queue/:id", delete(api_delete_proxy_queue))
        .route("/integrations", get(api_list_integrations))
        .route(
            "/integrations/setup-hints",
            get(api_integrations_setup_hints),
        )
        .route(
            "/integrations/salesforce/connect",
            get(api_salesforce_connect),
        )
        .route("/integrations/salesforce/test", get(api_salesforce_test))
        .route("/integrations/salesforce/sync", post(api_salesforce_sync))
        .route(
            "/integrations/salesforce/disconnect",
            post(api_salesforce_disconnect),
        )
        .route(
            "/integrations/salesforce/config",
            get(api_salesforce_config_get).put(api_salesforce_config_put),
        )
        .route("/integrations/zoho/connect", get(api_zoho_connect))
        .route(
            "/integrations/zoho/config",
            get(api_zoho_config_get).put(api_zoho_config_put),
        )
        .route("/integrations/zoho/test", get(api_zoho_test))
        .route("/integrations/zoho/projects", get(api_zoho_projects))
        .route("/integrations/zoho/tasks", get(api_zoho_tasks))
        .route("/integrations/zoho/sync", post(api_zoho_sync))
        .route(
            "/integrations/snapshots",
            get(api_list_integration_snapshots),
        )
        .route("/integrations/zoho/disconnect", post(api_zoho_disconnect))
        .route("/integrations/sync-now", post(api_sync_now))
        .route(
            "/integrations/sync-schedule",
            get(api_get_integration_sync_schedule).put(api_update_integration_sync_schedule),
        )
        .route(
            "/integrations/pipeline-status",
            get(api_integration_pipeline_status),
        )
        .route("/integrations/sync-logs", get(api_list_sync_logs))
        .route("/integrations/catalog", get(api_integration_catalog))
        .route("/integrations/entity-links", get(api_list_entity_links))
        .route("/integrations/reset-sync", post(api_reset_integration_sync))
        .route("/settings", get(api_get_settings).put(api_update_settings))
        .route("/dashboard/stats", get(api_dashboard_stats))
        .route("/middleware/status", get(api_middleware_status))
        .route("/reload-config", post(api_reload_config))
        .route("/oauth/tokens", get(api_oauth_tokens_list))
        .route("/oauth/tokens/revoke", post(api_oauth_revoke_jti_handler))
        .route(
            "/oauth/apps",
            get(api_oauth_apps_list).post(api_oauth_apps_create),
        )
        .route(
            "/oauth/apps/:id",
            put(api_oauth_apps_update).delete(api_oauth_apps_delete),
        )
        .layer(middleware::from_fn(rbac_middleware))
        .layer(middleware::from_fn(admin_auth_middleware));

    let api_public = Router::new()
        .route("/ping", get(admin_api_ping))
        .route("/oauth/revoke", post(api_oauth_revoke_handler))
        .route("/oauth/logout", post(api_oauth_logout_handler))
        .route("/login", post(admin_login))
        .route("/oauth/token", post(oauth_token_handler))
        .route("/logout", post(admin_logout))
        .route("/me", get(admin_me).put(api_update_me))
        .route("/register", post(api_register_viewer))
        .route("/forgot-password", post(api_forgot_password))
        .route("/verify-reset-otp", post(api_verify_reset_otp))
        .route("/reset-password", post(api_reset_password))
        .route(
            "/integrations/salesforce/callback",
            get(api_salesforce_callback),
        )
        .route("/integrations/zoho/callback", get(api_zoho_callback))
        .route("/crypto/public-key", get(api_gateway_public_key))
        .merge(mock_api::router());

    let api = Router::new().merge(api_public).merge(api_protected);

    let cors = CorsLayer::new()
        .allow_credentials(true)
        .allow_methods([
            Method::GET,
            Method::POST,
            Method::PUT,
            Method::DELETE,
            Method::PATCH,
            Method::HEAD,
            Method::OPTIONS,
        ])
        .allow_headers([
            axum::http::header::ACCEPT,
            axum::http::header::AUTHORIZATION,
            axum::http::header::CONTENT_TYPE,
            COOKIE,
        ])
        .allow_origin(AllowOrigin::list(cors_allowed_origins()));

    let app = Router::new()
        .route("/oauth/token", post(oauth_token_handler))
        .route("/oauth/authorize", get(oauth_authorize_handler))
        .route("/oauth/consent", post(oauth_consent_handler))
        .nest("/api", api)
        // Public mock demo: /testAPI/* và /mock/report/* (không cần JWT/route DB)
        .merge(mock_api::router())
        .route("/health", get(health_handler))
        .route("/metrics", get(metrics_handler))
        .fallback(proxy_or_static)
        // NOTE: layers must be applied AFTER routes — axum `Router::layer` only wraps
        // routes registered before the call. client_ip_middleware inserts ResolvedClientIp
        // consumed by login/oauth handlers, so it must cover the /api nest.
        .layer(cors)
        .layer(middleware::from_fn(instance_label_middleware))
        .layer(middleware::from_fn(client_ip_middleware))
        .layer(NormalizePathLayer::trim_trailing_slash())
        // Outermost: mọi panic trong handler/middleware → 500 sạch, KHÔNG rớt TCP
        // (nginx thấy TCP reset = 502). Giữ gateway sống suốt demo.
        .layer(CatchPanicLayer::new());

    let port = current_bind_port();
    let addr = server_bind_addr(port);

    let listener = match tokio::net::TcpListener::bind(addr).await {
        Ok(l) => l,
        Err(e) if e.kind() == ErrorKind::AddrInUse => {
            eprintln!(
                "❌ Cổng {port} đang bị chiếm (address already in use).\n\
                 → Tắt hết bản gateway: pkill -9 -f avaso-gateway\n\
                 → Hoặc xem PID (số sau pid=, không phải cột Recv-Q): ss -tlnp | grep :{port}\n\
                 → Hoặc: PORT=3001 cargo run  (web/: VITE_GATEWAY_ORIGIN=http://127.0.0.1:3001)"
            );
            std::process::exit(1);
        }
        Err(e) => panic!("bind {addr}: {e}"),
    };

    println!("🚀 Gateway đang lắng nghe: http://{addr}/");
    println!("📊 Dashboard: http://{addr}/");
    println!("💾 Database: {}", database_url);
    println!(
        "🗄️  Session store: Redis ({})",
        session::redis_url_from_env()
            .split('@')
            .last()
            .unwrap_or("redis")
    );
    println!("🔐 Admin: GET /api/ping (kiểm tra triển khai) | POST /api/login …");
    println!("   GET /api/me | POST /api/logout");
    println!(
        "   CORS: thêm domain UI production → CORS_ALLOWED_ORIGINS (vd https://thientinh.io.vn)"
    );
    println!("   GET/POST /api/routes | PUT/DELETE /api/routes/:id");
    println!("   GET/POST /api/client-keys | DELETE /api/client-keys/:id");
    println!("   GET /api/integrations | SF OAuth connect/callback/test");
    println!("   GET /api/crypto/public-key | POST /api/client-keys/encrypted (RSA envelope)");
    println!("   POST /oauth/token (grant_type=password|client_credentials)");
    println!(
        "   Data plane prefix (Bearer JWT bắt buộc): {}",
        data_plane_prefix()
    );
    println!("🧪 Public mock (no auth): GET /testAPI/get|/empty|/invalid|/unauthorized|/not-found|/server-error|/delay");
    println!("   Alias: GET /api/testAPI/* và GET /api/mock/report/*");
    let shutdown = async {
        let ctrl_c = async {
            tokio::signal::ctrl_c()
                .await
                .expect("failed to install Ctrl+C handler");
        };
        #[cfg(unix)]
        let terminate = async {
            tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
                .expect("failed to install SIGTERM handler")
                .recv()
                .await;
        };
        #[cfg(not(unix))]
        let terminate = std::future::pending::<()>();
        tokio::select! {
            _ = ctrl_c => {},
            _ = terminate => {},
        }
        info!("Shutting down gracefully…");
    };

    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .with_graceful_shutdown(shutdown)
    .await
    .unwrap();
}

fn cookie_secure_flag() -> bool {
    std::env::var("COOKIE_SECURE")
        .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
        .unwrap_or(false)
}

fn session_cookie_value(token: &str, max_age_secs: u64) -> String {
    let mut s = format!(
        "{}={token}; HttpOnly; Path=/; SameSite=Lax; Max-Age={max_age_secs}",
        session::SESSION_COOKIE
    );
    if cookie_secure_flag() {
        s.push_str("; Secure");
    }
    s
}

fn session_cookie_clear_value() -> String {
    let mut s = format!(
        "{}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0",
        session::SESSION_COOKIE
    );
    if cookie_secure_flag() {
        s.push_str("; Secure");
    }
    s
}

fn gw_sid_from_headers(headers: &HeaderMap) -> Option<String> {
    let raw = headers.get(COOKIE)?.to_str().ok()?;
    for part in raw.split(';') {
        let p = part.trim();
        if let Some(val) = p.strip_prefix(&format!("{}=", session::SESSION_COOKIE)) {
            let v = val.trim();
            if !v.is_empty() {
                return Some(v.to_string());
            }
        }
    }
    None
}

async fn resolve_admin_ctx(headers: &HeaderMap) -> Result<AdminCtx, Response> {
    if admin_auth::admin_api_key_enabled() {
        if let Some(key) = headers.get("x-api-key").and_then(|v| v.to_str().ok()) {
            if let Some(st) = STATE.get() {
                let expected = st.config.read().await.admin_api_key_sha256.clone();
                if db::sha256_hex(key) == expected {
                    return Ok(AdminCtx::from_automation_api_key());
                }
            }
        }
    }
    let Some(sid) = gw_sid_from_headers(headers) else {
        return Err(json_error(
            StatusCode::UNAUTHORIZED,
            "unauthorized",
            "Invalid or missing admin X-API-Key or session cookie (POST /api/login)",
        ));
    };
    let Some(st) = STATE.get() else {
        return Err(json_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "internal_error",
            "gateway state not initialized",
        ));
    };
    match admin_auth::resolve_session_ctx(&st.session_store, &st.pool, &sid).await {
        Ok(Some(ctx)) => return Ok(ctx),
        Err(_) => return Err(session_unavailable_response()),
        Ok(None) => {}
    }
    let _ = st.session_store.destroy_by_sid(&sid).await;
    Err(json_error(
        StatusCode::UNAUTHORIZED,
        "unauthorized",
        "Session expired or invalid",
    ))
}

fn gateway_instance_name() -> Option<String> {
    std::env::var("INSTANCE_NAME")
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

async fn client_ip_middleware(mut req: Request<Body>, next: Next) -> Result<Response, Response> {
    let peer = req
        .extensions()
        .get::<ConnectInfo<SocketAddr>>()
        .map(|ci| ci.0);
    let ip = admin_auth::resolve_client_ip(req.headers(), peer);
    req.extensions_mut()
        .insert(admin_auth::ResolvedClientIp(ip));
    Ok(next.run(req).await)
}

async fn instance_label_middleware(req: Request<Body>, next: Next) -> Result<Response, Response> {
    let mut res = next.run(req).await;
    if let Some(name) = gateway_instance_name() {
        if let Ok(hv) = HeaderValue::from_str(&name) {
            res.headers_mut().insert(
                axum::http::HeaderName::from_static("x-gateway-instance"),
                hv,
            );
        }
    }
    Ok(res)
}

async fn admin_auth_middleware(mut req: Request<Body>, next: Next) -> Result<Response, Response> {
    let path = req.uri().path().to_string();
    let ip = admin_auth::client_ip_from_extensions(req.headers(), req.extensions());
    // Admin API + session cookie
    match resolve_admin_ctx(req.headers()).await {
        Ok(mut ctx) => {
            if ctx.client_ip.is_none() {
                ctx.client_ip = ip.clone();
            }
            req.extensions_mut().insert(ctx);
            Ok(next.run(req).await)
        }
        Err(resp) => {
            if let Some(st) = STATE.get() {
                write_audit_event(
                    &st.pool,
                    1,
                    "anonymous",
                    "-",
                    "admin_auth",
                    &path,
                    "failure",
                    ip.as_deref(),
                    Some("unauthorized"),
                )
                .await;
            }
            Err(resp)
        }
    }
}

async fn rbac_middleware(req: Request<Body>, next: Next) -> Result<Response, Response> {
    let ctx = req.extensions().get::<AdminCtx>().cloned().ok_or_else(|| {
        json_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "internal_error",
            "admin context missing",
        )
    })?;
    let method = req.method().clone();
    let path = req.uri().path().to_string();
    // Kiểm tra RBAC theo role
    if !admin_auth::rbac_allow(&method, &path, &ctx.role) {
        if let Some(st) = STATE.get() {
            let resource = format!("{} {path}", method.as_str());
            // Ghi audit (rbac_denied)
            write_audit_failure(
                &st.pool,
                &ctx,
                "rbac_denied",
                &resource,
                ctx.client_ip.as_deref(),
                Some("insufficient_permissions"),
            )
            .await;
            // Đã ghi
        }
        return Err(admin_auth::forbidden_response());
    }
    Ok(next.run(req).await)
}

#[derive(Debug, Deserialize)]
struct LoginBody {
    username: String,
    password: String,
}

async fn establish_admin_session(
    headers: &HeaderMap,
    resolved_ip: Option<String>,
    admin: &db::AdminUserRow,
    audit_action: &str,
) -> Response {
    let ip = resolved_ip.or_else(|| admin_auth::client_ip(headers));
    let Some(st) = STATE.get() else {
        return json_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "internal_error",
            "gateway state not initialized",
        );
    };

    if admin.is_active == 0 {
        let mut ctx = AdminCtx::from_user(admin);
        ctx.client_ip = ip.clone();
        write_audit_failure(
            &st.pool,
            &ctx,
            audit_action,
            "session",
            ip.as_deref(),
            Some("account_disabled"),
        )
        .await;
        return json_error(
            StatusCode::FORBIDDEN,
            "forbidden",
            "Tài khoản đã bị vô hiệu hóa",
        );
    }

    let username = admin.username.clone();
    let mut ctx = AdminCtx::from_user(admin);
    ctx.client_ip = ip.clone();
    let sid = uuid::Uuid::new_v4().to_string();
    let record = SessionRecord {
        user_id: ctx.user_id,
        username: username.clone(),
        home_tenant_id: ctx.tenant_id,
        tenant_id: ctx.tenant_id,
        role: ctx.role.clone(),
        last_db_check: 0,
    };
    if let Err(e) = st.session_store.revoke_all_for_user(ctx.user_id).await {
        tracing::warn!(error = %e, user_id = ctx.user_id, "revoke prior sessions failed");
    }
    if let Err(e) = st.session_store.create(&sid, record).await {
        tracing::error!(error = %e, "cannot persist session to redis");
        return json_error(
            StatusCode::SERVICE_UNAVAILABLE,
            "session_store_unavailable",
            "Không thể tạo phiên — session store (Redis) không khả dụng",
        );
    }
    write_audit(
        &st.pool,
        &ctx,
        audit_action,
        "session",
        "success",
        ip.as_deref(),
        None,
    )
    .await;
    let cookie_line = session_cookie_value(&sid, session::SESSION_MAX_AGE_SECS);
    let Ok(hv) = HeaderValue::from_str(&cookie_line) else {
        return json_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "internal_error",
            "invalid cookie header",
        );
    };
    let token = match identity::issue_user_token(admin) {
        Ok(t) => Some(t),
        Err(e) => {
            tracing::warn!(error = %e, "issue user jwt failed");
            None
        }
    };
    let mut body = serde_json::json!({
        "status": "ok",
        "username": username,
        "role": ctx.role,
        "tenant_id": ctx.tenant_id,
        "user_id": ctx.user_id,
        "email": admin.email
    });
    if let Some(t) = token {
        body["access_token"] = serde_json::Value::String(t.access_token);
        body["token_type"] = serde_json::Value::String(t.token_type.into());
        body["expires_in"] = serde_json::json!(t.expires_in);
    }
    let mut res = (StatusCode::OK, Json(body)).into_response();
    res.headers_mut().append(SET_COOKIE, hv);
    res
}

async fn oauth_token_handler(
    headers: HeaderMap,
    Form(form): Form<identity::OAuthTokenForm>,
) -> impl IntoResponse {
    // POST oauth token kèm grant_type client_credentials
    let st = match STATE.get() {
        Some(s) => s.clone(),
        None => {
            return json_error(
                StatusCode::INTERNAL_SERVER_ERROR,
                "internal_error",
                "gateway state not initialized",
            );
        }
    };
    let ip = admin_auth::client_ip(&headers);
    let client_id = form
        .client_id
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty());
    // Kiểm tra hạn mức token endpoint
    if let Err(retry_after) = st
        .rate_limiter
        .check_oauth_token_endpoint(client_id, ip.as_deref())
        .await
    {
        // Vượt hạn mức token endpoint
        // 429 rate_limit_exceeded
        st.gateway_metrics.record_rate_limit_hit();
        log_gateway_transaction(
            None,
            ip.as_deref(),
            "denied",
            "rate_limit_exceeded",
            "POST",
            "/oauth/token",
            StatusCode::TOO_MANY_REQUESTS.as_u16(),
            client_id.unwrap_or("(no-client)"),
            None,
            0,
            None,
        );
        let reset = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0)
            + retry_after;
        return rate_limit_response(
            &rate_limit::RateLimitInfo {
                limit: rate_limit::OAUTH_TOKEN_IP_PER_MIN,
                remaining: 0,
                reset_unix: reset,
            },
            retry_after,
        );
    }
    let cfg = st.config.read().await.clone();
    // Đổi grant lấy access token
    match identity::exchange_token(&st.pool, &cfg.client_credentials, form).await {
        Ok(issued) => {
            // Lưu oauth_access_tokens
            oauth_handlers::record_issued_token(&st.pool, &headers, &issued).await;
            // 200 access_token, token_type, expires_in
            Json(issued.response).into_response()
        }
        Err(err) => {
            let msg = err.message();
            json_error(err.status(), err.error_code(), &msg)
        }
    }
}

async fn api_oauth_revoke_handler(
    Form(body): Form<oauth_handlers::OAuthRevokeForm>,
) -> impl IntoResponse {
    let Some(st) = STATE.get() else {
        return json_error(StatusCode::INTERNAL_SERVER_ERROR, "internal_error", "state");
    };
    oauth_handlers::api_oauth_revoke(&oauth_handler_state(st), body).await
}

async fn api_oauth_logout_handler(headers: HeaderMap) -> impl IntoResponse {
    let Some(st) = STATE.get() else {
        return json_error(StatusCode::INTERNAL_SERVER_ERROR, "internal_error", "state");
    };
    oauth_handlers::api_oauth_logout_bearer(&oauth_handler_state(st), headers).await
}

async fn api_oauth_tokens_list(
    Extension(ctx): Extension<AdminCtx>,
    Query(q): Query<oauth_handlers::ListTokensQuery>,
) -> impl IntoResponse {
    let Some(st) = STATE.get() else {
        return json_error(StatusCode::INTERNAL_SERVER_ERROR, "internal_error", "state");
    };
    oauth_handlers::api_list_oauth_tokens(&oauth_handler_state(st), &ctx, q).await
}

async fn api_oauth_apps_list(Extension(ctx): Extension<AdminCtx>) -> impl IntoResponse {
    let Some(st) = STATE.get() else {
        return json_error(StatusCode::INTERNAL_SERVER_ERROR, "internal_error", "state");
    };
    oauth_handlers::api_list_oauth_apps(&oauth_handler_state(st), &ctx).await
}

async fn api_oauth_apps_create(
    Extension(ctx): Extension<AdminCtx>,
    Json(body): Json<oauth_handlers::CreateOAuthAppBody>,
) -> impl IntoResponse {
    let Some(st) = STATE.get() else {
        return json_error(StatusCode::INTERNAL_SERVER_ERROR, "internal_error", "state");
    };
    oauth_handlers::api_create_oauth_app(&oauth_handler_state(st), &ctx, body).await
}

async fn api_oauth_apps_update(
    Extension(ctx): Extension<AdminCtx>,
    Path(id): Path<i64>,
    Json(body): Json<oauth_handlers::UpdateOAuthAppBody>,
) -> impl IntoResponse {
    let Some(st) = STATE.get() else {
        return json_error(StatusCode::INTERNAL_SERVER_ERROR, "internal_error", "state");
    };
    oauth_handlers::api_update_oauth_app(&oauth_handler_state(st), &ctx, id, body).await
}

async fn api_oauth_apps_delete(
    Extension(ctx): Extension<AdminCtx>,
    Path(id): Path<i64>,
) -> impl IntoResponse {
    let Some(st) = STATE.get() else {
        return json_error(StatusCode::INTERNAL_SERVER_ERROR, "internal_error", "state");
    };
    oauth_handlers::api_delete_oauth_app(&oauth_handler_state(st), &ctx, id).await
}

async fn api_client_key_revoke_tokens(
    Extension(ctx): Extension<AdminCtx>,
    Path(id): Path<i64>,
) -> impl IntoResponse {
    let Some(st) = STATE.get() else {
        return json_error(StatusCode::INTERNAL_SERVER_ERROR, "internal_error", "state");
    };
    if let Err(e) = ensure_client_key_manage_access(&st.pool, &ctx, id).await {
        return e;
    }
    let resp = oauth_handlers::api_revoke_client_tokens(&oauth_handler_state(st), &ctx, id).await;
    spawn_reload_runtime_config();
    resp
}

async fn api_oauth_revoke_jti_handler(
    Extension(ctx): Extension<AdminCtx>,
    Json(body): Json<oauth_handlers::RevokeJtiBody>,
) -> impl IntoResponse {
    let Some(st) = STATE.get() else {
        return json_error(StatusCode::INTERNAL_SERVER_ERROR, "internal_error", "state");
    };
    oauth_handlers::api_revoke_token_jti(&oauth_handler_state(st), &ctx, body).await
}

async fn oauth_authorize_handler(
    headers: HeaderMap,
    Query(q): Query<oauth_handlers::AuthorizeQuery>,
) -> impl IntoResponse {
    let Some(st) = STATE.get() else {
        return json_error(StatusCode::INTERNAL_SERVER_ERROR, "internal_error", "state");
    };
    oauth_handlers::oauth_authorize_get(&oauth_handler_state(st), headers, q).await
}

async fn oauth_consent_handler(
    headers: HeaderMap,
    Form(form): Form<oauth_handlers::ConsentForm>,
) -> impl IntoResponse {
    let Some(st) = STATE.get() else {
        return json_error(StatusCode::INTERNAL_SERVER_ERROR, "internal_error", "state");
    };
    oauth_handlers::oauth_consent_post(&oauth_handler_state(st), form, headers).await
}

async fn admin_login(
    Extension(admin_auth::ResolvedClientIp(resolved_ip)): Extension<admin_auth::ResolvedClientIp>,
    headers: HeaderMap,
    Json(body): Json<LoginBody>,
) -> impl IntoResponse {
    let user = body.username.trim();
    let pass = body.password.as_str();
    let ip = resolved_ip.clone();
    let mut fields = serde_json::Map::new();
    if user.is_empty() {
        fields.insert(
            "username".into(),
            serde_json::Value::String("Nhập tên đăng nhập".into()),
        );
    }
    if pass.is_empty() {
        fields.insert(
            "password".into(),
            serde_json::Value::String("Nhập mật khẩu".into()),
        );
    }
    if !fields.is_empty() {
        if let Some(st) = STATE.get() {
            write_audit_event(
                &st.pool,
                1,
                user,
                "-",
                "login",
                "session",
                "failure",
                ip.as_deref(),
                Some("validation_failed"),
            )
            .await;
        }
        return json_error_fields(
            StatusCode::BAD_REQUEST,
            "validation_failed",
            "Thiếu thông tin đăng nhập",
            fields,
        );
    }

    let Some(st) = STATE.get() else {
        return json_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "internal_error",
            "gateway state not initialized",
        );
    };

    let row = match db::fetch_admin_user_by_username(&st.pool, user).await {
        Ok(r) => r,
        Err(e) => {
            tracing::error!(error = %e, username = %user, "fetch_admin_user_by_username failed");
            return json_error(
                StatusCode::INTERNAL_SERVER_ERROR,
                "internal_error",
                "cannot load user",
            );
        }
    };

    let Some(admin) = row else {
        write_audit_event(
            &st.pool,
            1,
            user,
            "-",
            "login",
            "session",
            "failure",
            ip.as_deref(),
            Some("invalid_credentials"),
        )
        .await;
        fields.insert(
            "username".into(),
            serde_json::Value::String("Sai tên đăng nhập".into()),
        );
        return json_error_fields(
            StatusCode::UNAUTHORIZED,
            "unauthorized",
            "Thông tin đăng nhập không đúng",
            fields,
        );
    };

    if !db::verify_password(pass, &admin.password_hash) {
        let ctx = AdminCtx::from_user(&admin);
        write_audit_failure(
            &st.pool,
            &ctx,
            "login",
            "session",
            ip.as_deref(),
            Some("invalid_credentials"),
        )
        .await;
        fields.insert(
            "password".into(),
            serde_json::Value::String("Sai mật khẩu".into()),
        );
        return json_error_fields(
            StatusCode::UNAUTHORIZED,
            "unauthorized",
            "Thông tin đăng nhập không đúng",
            fields,
        );
    }

    establish_admin_session(&headers, ip, &admin, "login").await
}

#[derive(Debug, Deserialize)]
struct RegisterViewerBody {
    username: String,
    password: String,
    email: String,
}

async fn api_register_viewer(
    Extension(admin_auth::ResolvedClientIp(resolved_ip)): Extension<admin_auth::ResolvedClientIp>,
    headers: HeaderMap,
    Json(body): Json<RegisterViewerBody>,
) -> impl IntoResponse {
    let ip = resolved_ip.clone();
    if !admin_auth::viewer_registration_enabled() {
        return json_error(
            StatusCode::FORBIDDEN,
            "registration_disabled",
            "Đăng ký công khai đang tắt — nhờ Quản trị viên tạo tài khoản hoặc bật ALLOW_VIEWER_REGISTRATION=1",
        );
    }

    let username = body.username.trim();
    let pass = body.password.trim();
    let email_raw = body.email.trim();
    let mut fields = serde_json::Map::new();
    if username.is_empty() {
        fields.insert(
            "username".into(),
            serde_json::Value::String("Nhập tên đăng nhập".into()),
        );
    } else if username.len() > 64 {
        fields.insert(
            "username".into(),
            serde_json::Value::String("Username tối đa 64 ký tự".into()),
        );
    }
    if pass.len() < 6 {
        fields.insert(
            "password".into(),
            serde_json::Value::String("Mật khẩu tối thiểu 6 ký tự".into()),
        );
    }
    let email = password_reset::normalize_email(email_raw);
    if email.is_none() && !email_raw.is_empty() || email_raw.is_empty() {
        fields.insert(
            "email".into(),
            serde_json::Value::String(if email_raw.is_empty() {
                "Nhập email".into()
            } else {
                "Email không hợp lệ".into()
            }),
        );
    }
    if !fields.is_empty() {
        if let Some(st) = STATE.get() {
            write_audit_event(
                &st.pool,
                1,
                username,
                "-",
                "register",
                "session",
                "failure",
                ip.as_deref(),
                Some("validation_failed"),
            )
            .await;
        }
        return json_error_fields(
            StatusCode::BAD_REQUEST,
            "validation_failed",
            "Dữ liệu đăng ký không hợp lệ",
            fields,
        );
    }
    let email = email.expect("validated above");

    let Some(st) = STATE.get() else {
        return json_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "internal_error",
            "gateway state not initialized",
        );
    };

    match db::admin_email_taken(&st.pool, &email, 0).await {
        Ok(true) => {
            fields.insert(
                "email".into(),
                serde_json::Value::String("Email đã tồn tại".into()),
            );
            return json_error_fields(
                StatusCode::CONFLICT,
                "email_taken",
                "Email đã được dùng",
                fields,
            );
        }
        Ok(false) => {}
        Err(e) => {
            return json_error(
                StatusCode::INTERNAL_SERVER_ERROR,
                "internal_error",
                &format!("{e}"),
            );
        }
    }

    let password_hash = match db::hash_password(pass) {
        Ok(h) => h,
        Err(e) => {
            return json_error(
                StatusCode::INTERNAL_SERVER_ERROR,
                "internal_error",
                &format!("hash: {e}"),
            );
        }
    };

    let _ = db::ensure_default_tenant(&st.pool).await;
    let tenant_id = 1_i64;
    let role = if admin_auth::on_prem_single_org() {
        "viewer"
    } else {
        "admin"
    };
    match db::insert_admin_user(
        &st.pool,
        username,
        &password_hash,
        role,
        tenant_id,
        Some(&email),
    )
    .await
    {
        Ok(id) => {
            if role == "admin" {
                let _ = integrations::ensure_integration_rows(&st.pool, tenant_id).await;
            }
            write_audit_event(
                &st.pool,
                tenant_id,
                username,
                role,
                "register",
                "session",
                "success",
                ip.as_deref(),
                Some("admin_self_register"),
            )
            .await;
            match db::fetch_admin_user_by_id(&st.pool, id, tenant_id).await {
                Ok(Some(row)) => {
                    let mut res =
                        establish_admin_session(&headers, ip.clone(), &row, "register").await;
                    if res.status() == StatusCode::OK {
                        *res.status_mut() = StatusCode::CREATED;
                    }
                    res
                }
                Ok(None) | Err(_) => (
                    StatusCode::CREATED,
                    Json(serde_json::json!({
                        "status": "ok",
                        "username": username,
                        "role": role,
                        "tenant_id": tenant_id,
                        "user_id": id,
                        "email": email
                    })),
                )
                    .into_response(),
            }
        }
        Err(e) => {
            if let sqlx::Error::Database(ref d) = e {
                if d.is_unique_violation() {
                    fields.insert(
                        "username".into(),
                        serde_json::Value::String("Username đã tồn tại".into()),
                    );
                    write_audit_event(
                        &st.pool,
                        1,
                        username,
                        "-",
                        "register",
                        "session",
                        "failure",
                        ip.as_deref(),
                        Some("username_exists"),
                    )
                    .await;
                    return json_error_fields(
                        StatusCode::CONFLICT,
                        "username_exists",
                        "Username đã được dùng",
                        fields,
                    );
                }
            }
            tracing::error!(error = %e, "register viewer failed");
            json_error(
                StatusCode::INTERNAL_SERVER_ERROR,
                "internal_error",
                "Không tạo được tài khoản",
            )
        }
    }
}

#[derive(Debug, Deserialize)]
struct UpdateMeBody {
    username: Option<String>,
    email: Option<String>,
    password: Option<String>,
    current_password: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ForgotPasswordBody {
    username: String,
    email: String,
}

#[derive(Debug, Deserialize)]
struct VerifyResetOtpBody {
    username: String,
    otp: String,
}

#[derive(Debug, Deserialize)]
struct ResetPasswordBody {
    reset_token: String,
    password: String,
}

async fn api_update_me(headers: HeaderMap, Json(body): Json<UpdateMeBody>) -> impl IntoResponse {
    let Some(sid) = gw_sid_from_headers(&headers) else {
        return json_error(StatusCode::UNAUTHORIZED, "unauthorized", "Not logged in");
    };
    let Some(st) = STATE.get() else {
        return json_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "internal_error",
            "gateway state not initialized",
        );
    };

    let ctx = match admin_auth::resolve_session_ctx(&st.session_store, &st.pool, &sid).await {
        Ok(Some(c)) => c,
        Ok(None) => {
            return json_error(
                StatusCode::UNAUTHORIZED,
                "unauthorized",
                "Session expired or invalid",
            );
        }
        Err(_) => return session_unavailable_response(),
    };

    if ctx.via_api_key {
        return json_error(
            StatusCode::FORBIDDEN,
            "forbidden",
            "API key automation không đổi hồ sơ — dùng session đăng nhập",
        );
    }

    let new_username = body
        .username
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string);
    let email_patch: Option<Option<String>> = match &body.email {
        None => None,
        Some(s) => {
            let t = s.trim();
            if t.is_empty() {
                Some(None)
            } else if let Some(em) = password_reset::normalize_email(t) {
                Some(Some(em))
            } else {
                let mut f = serde_json::Map::new();
                f.insert(
                    "email".into(),
                    serde_json::Value::String("Email không hợp lệ".into()),
                );
                return json_error_fields(
                    StatusCode::BAD_REQUEST,
                    "validation_failed",
                    "Dữ liệu hồ sơ không hợp lệ",
                    f,
                );
            }
        }
    };
    let new_pass = body
        .password
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string);
    let current_pass = body.current_password.as_deref().unwrap_or("").trim();

    let mut fields = serde_json::Map::new();
    if new_username.is_none() && new_pass.is_none() && email_patch.is_none() {
        fields.insert(
            "username".into(),
            serde_json::Value::String("Không có thay đổi nào".into()),
        );
    }
    let username_changing = new_username
        .as_deref()
        .map(|u| u != ctx.username.as_str())
        .unwrap_or(false);
    if (new_pass.is_some() || username_changing) && current_pass.is_empty() {
        fields.insert(
            "current_password".into(),
            serde_json::Value::String("Nhập mật khẩu hiện tại để xác nhận".into()),
        );
    }
    if let Some(ref p) = new_pass {
        if p.len() < 6 {
            fields.insert(
                "password".into(),
                serde_json::Value::String("Mật khẩu mới tối thiểu 6 ký tự".into()),
            );
        }
    }
    if !fields.is_empty() {
        return json_error_fields(
            StatusCode::BAD_REQUEST,
            "validation_failed",
            "Dữ liệu hồ sơ không hợp lệ",
            fields,
        );
    }

    let row = match db::fetch_admin_user_by_id(&st.pool, ctx.user_id, ctx.tenant_id).await {
        Ok(Some(r)) => r,
        Ok(None) => {
            return json_error(
                StatusCode::NOT_FOUND,
                "user_not_found",
                "Tài khoản không tồn tại",
            );
        }
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": format!("{e}") })),
            )
                .into_response();
        }
    };

    let final_username = new_username.unwrap_or_else(|| ctx.username.clone());
    let email_changing = match (&email_patch, &row.email) {
        (Some(None), Some(_)) => true,
        (Some(None), None) => false,
        (Some(Some(new)), old) => old.as_deref() != Some(new.as_str()),
        (None, _) => false,
    };
    if email_changing && current_pass.is_empty() {
        return json_error_fields(
            StatusCode::BAD_REQUEST,
            "validation_failed",
            "Dữ liệu hồ sơ không hợp lệ",
            serde_json::Map::from_iter([(
                "current_password".into(),
                serde_json::Value::String("Nhập mật khẩu hiện tại để đổi email".into()),
            )]),
        );
    }
    if (new_pass.is_some() || username_changing || email_changing)
        && !db::verify_password(current_pass, &row.password_hash)
    {
        write_audit_failure(
            &st.pool,
            &ctx,
            "profile_update",
            "me",
            admin_auth::client_ip(&headers).as_deref(),
            Some("invalid_current_password"),
        )
        .await;
        return json_error_fields(
            StatusCode::BAD_REQUEST,
            "invalid_current_password",
            "Mật khẩu hiện tại không đúng",
            serde_json::Map::from_iter([(
                "current_password".into(),
                serde_json::Value::String("Mật khẩu hiện tại không đúng".into()),
            )]),
        );
    }
    if let Some(Some(ref em)) = email_patch {
        match db::admin_email_taken(&st.pool, em, ctx.user_id).await {
            Ok(true) => {
                return json_error_fields(
                    StatusCode::CONFLICT,
                    "email_taken",
                    "Email đã được sử dụng",
                    serde_json::Map::from_iter([(
                        "email".into(),
                        serde_json::Value::String("Email đã tồn tại".into()),
                    )]),
                );
            }
            Ok(false) => {}
            Err(e) => {
                return (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(serde_json::json!({ "error": format!("{e}") })),
                )
                    .into_response();
            }
        }
    }
    if final_username != ctx.username {
        match db::admin_username_taken(&st.pool, &final_username, ctx.user_id).await {
            Ok(true) => {
                return json_error_fields(
                    StatusCode::CONFLICT,
                    "username_taken",
                    "Username đã được sử dụng",
                    serde_json::Map::from_iter([(
                        "username".into(),
                        serde_json::Value::String("Username đã tồn tại".into()),
                    )]),
                );
            }
            Ok(false) => {}
            Err(e) => {
                return (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(serde_json::json!({ "error": format!("{e}") })),
                )
                    .into_response();
            }
        }
    }

    let pass_hash = if let Some(ref p) = new_pass {
        match db::hash_password(p) {
            Ok(h) => Some(h),
            Err(e) => {
                return (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(serde_json::json!({ "error": format!("hash: {e}") })),
                )
                    .into_response();
            }
        }
    } else {
        None
    };

    let email_db: Option<Option<&str>> = email_patch.as_ref().map(|o| o.as_deref());

    match db::update_own_profile(
        &st.pool,
        ctx.user_id,
        ctx.tenant_id,
        &final_username,
        email_db,
        pass_hash.as_deref(),
    )
    .await
    {
        Ok(0) => json_error(
            StatusCode::NOT_FOUND,
            "user_not_found",
            "Tài khoản không tồn tại hoặc đã bị vô hiệu hóa",
        ),
        Ok(_) => {
            if pass_hash.is_some() {
                let _ = db::bump_user_token_version(&st.pool, ctx.user_id).await;
                if let Err(e) = st.session_store.revoke_all_for_user(ctx.user_id).await {
                    tracing::warn!(error = %e, user_id = ctx.user_id, "revoke sessions after password change failed");
                }
            } else if let Ok(Some(mut rec)) = st.session_store.get(&sid).await {
                rec.username = final_username.clone();
                rec.last_db_check = session::now_unix_ts();
                let _ = st.session_store.save(&sid, &rec).await;
            }

            write_audit(
                &st.pool,
                &ctx,
                if pass_hash.is_some() {
                    "profile_password_change"
                } else {
                    "profile_update"
                },
                "me",
                "success",
                admin_auth::client_ip(&headers).as_deref(),
                Some(&final_username),
            )
            .await;

            let out_email = email_patch.map(|o| o).unwrap_or_else(|| row.email.clone());
            Json(serde_json::json!({
                "status": "ok",
                "username": final_username,
                "email": out_email,
                "role": ctx.role,
                "tenant_id": ctx.tenant_id,
                "user_id": ctx.user_id,
                "password_changed": pass_hash.is_some(),
            }))
            .into_response()
        }
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": format!("{e}") })),
        )
            .into_response(),
    }
}

async fn api_forgot_password(
    headers: HeaderMap,
    Json(body): Json<ForgotPasswordBody>,
) -> impl IntoResponse {
    let username = body.username.trim();
    let email_input = body.email.trim();
    let mut fields = serde_json::Map::new();
    if username.is_empty() {
        fields.insert(
            "username".into(),
            serde_json::Value::String("Nhập tên đăng nhập".into()),
        );
    }
    if email_input.is_empty() {
        fields.insert(
            "email".into(),
            serde_json::Value::String("Nhập email".into()),
        );
    } else if password_reset::normalize_email(email_input).is_none() {
        fields.insert(
            "email".into(),
            serde_json::Value::String("Email không hợp lệ".into()),
        );
    }
    if !fields.is_empty() {
        return json_error_fields(
            StatusCode::BAD_REQUEST,
            "validation_failed",
            "Thiếu thông tin",
            fields,
        );
    }

    let Some(st) = STATE.get() else {
        return json_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "internal_error",
            "gateway state not initialized",
        );
    };

    let delivery = password_reset::otp_delivery_mode();
    let row = match db::fetch_admin_user_by_username(&st.pool, username).await {
        Ok(r) => r,
        Err(e) => {
            tracing::error!(error = %e, "forgot-password lookup failed");
            return json_error(
                StatusCode::INTERNAL_SERVER_ERROR,
                "internal_error",
                "Không tra cứu được tài khoản — thử lại sau",
            );
        }
    };

    let Some(user) = row else {
        return json_error_fields(
            StatusCode::NOT_FOUND,
            "account_not_found",
            "Tên đăng nhập không tồn tại",
            serde_json::Map::from_iter([(
                "username".into(),
                serde_json::Value::String("Không tìm thấy tài khoản với tên đăng nhập này".into()),
            )]),
        );
    };

    if user.is_active == 0 {
        return json_error(
            StatusCode::FORBIDDEN,
            "account_inactive",
            "Tài khoản đã bị khóa — liên hệ Admin.",
        );
    }

    let Some(ref stored_email) = user.email else {
        return json_error(
            StatusCode::BAD_REQUEST,
            "no_email",
            "Tài khoản chưa có email — nhờ Admin cấp email trong Quản lý Users.",
        );
    };

    let email_norm = password_reset::normalize_email(email_input).unwrap_or_default();
    let stored_norm = password_reset::normalize_email(stored_email).unwrap_or_default();
    if email_norm != stored_norm {
        return json_error_fields(
            StatusCode::BAD_REQUEST,
            "email_mismatch",
            "Email không khớp với tài khoản",
            serde_json::Map::from_iter([(
                "email".into(),
                serde_json::Value::String(
                    "Email không trùng với email đã đăng ký của tài khoản này".into(),
                ),
            )]),
        );
    }

    if delivery == "none" {
        return json_error(
            StatusCode::SERVICE_UNAVAILABLE,
            "mail_unavailable",
            "Hệ thống chưa cấu hình gửi mail. Bật BREVO_API_KEY hoặc PASSWORD_RESET_DEV_LOG=1 (dev).",
        );
    }

    let mut conn = st.session_store.redis();
    match password_reset::issue_password_reset_otp(&mut conn, &user.username, user.id, stored_email)
        .await
    {
        Ok(()) => {
            write_audit_event(
                &st.pool,
                user.tenant_id.unwrap_or(1),
                &user.username,
                &user.role,
                "forgot_password",
                "session",
                "success",
                admin_auth::client_ip(&headers).as_deref(),
                Some("otp_sent"),
            )
            .await;
            let message = if delivery == "email" {
                format!(
                    "Mã OTP đã gửi tới {} — kiểm tra hộp thư (có thể trong Spam).",
                    password_reset::mask_email(stored_email)
                )
            } else {
                "Mã OTP đã tạo. Server chưa cấu hình Brevo/SMTP — Admin xem: journalctl -u avaso-gateway -f".into()
            };
            Json(serde_json::json!({
                "status": "ok",
                "message": message,
                "username": user.username,
                "email_masked": password_reset::mask_email(stored_email),
                "delivery": delivery
            }))
            .into_response()
        }
        Err(password_reset::PasswordResetError::RateLimited) => json_error(
            StatusCode::TOO_MANY_REQUESTS,
            "rate_limited",
            "Quá nhiều yêu cầu — thử lại sau 15 phút",
        ),
        Err(password_reset::PasswordResetError::MailUnavailable) => json_error(
            StatusCode::SERVICE_UNAVAILABLE,
            "mail_unavailable",
            "Không gửi được OTP — kiểm tra cấu hình Brevo/SMTP",
        ),
        Err(password_reset::PasswordResetError::MailSend(e)) => {
            tracing::warn!(error = %e, "forgot-password mail failed");
            json_error(
                StatusCode::SERVICE_UNAVAILABLE,
                "mail_send_failed",
                "Gửi email thất bại — thử lại sau",
            )
        }
    }
}

async fn api_verify_reset_otp(Json(body): Json<VerifyResetOtpBody>) -> impl IntoResponse {
    let username = body.username.trim();
    let otp = body.otp.trim();
    let mut fields = serde_json::Map::new();
    if username.is_empty() {
        fields.insert(
            "username".into(),
            serde_json::Value::String("Thiếu username".into()),
        );
    }
    if otp.len() != 6 || !otp.chars().all(|c| c.is_ascii_digit()) {
        fields.insert(
            "otp".into(),
            serde_json::Value::String("OTP gồm 6 chữ số".into()),
        );
    }
    if !fields.is_empty() {
        return json_error_fields(
            StatusCode::BAD_REQUEST,
            "validation_failed",
            "Dữ liệu không hợp lệ",
            fields,
        );
    }

    let Some(st) = STATE.get() else {
        return json_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "internal_error",
            "gateway state not initialized",
        );
    };

    let mut conn = st.session_store.redis();
    let issued = match password_reset::verify_otp_and_create_ticket(&mut conn, username, otp).await
    {
        Ok(v) => v,
        Err(e) => {
            tracing::error!(error = %e, "verify-reset-otp redis failed");
            return json_error(
                StatusCode::SERVICE_UNAVAILABLE,
                "session_store_unavailable",
                "Redis không khả dụng",
            );
        }
    };

    match issued {
        Ok(token) => Json(serde_json::json!({
            "status": "ok",
            "message": "OTP hợp lệ — nhập mật khẩu mới",
            "username": username,
            "reset_token": token
        }))
        .into_response(),
        Err(password_reset::VerifyOtpResult::NotFound) => json_error(
            StatusCode::BAD_REQUEST,
            "otp_invalid",
            "OTP hết hạn hoặc không hợp lệ — gửi lại mã",
        ),
        Err(password_reset::VerifyOtpResult::WrongOtp) => json_error_fields(
            StatusCode::BAD_REQUEST,
            "otp_invalid",
            "OTP không đúng",
            serde_json::Map::from_iter([(
                "otp".into(),
                serde_json::Value::String("Mã OTP không đúng".into()),
            )]),
        ),
        Err(password_reset::VerifyOtpResult::TooManyAttempts) => json_error(
            StatusCode::BAD_REQUEST,
            "otp_locked",
            "Nhập sai quá nhiều lần — yêu cầu mã OTP mới",
        ),
        Err(password_reset::VerifyOtpResult::Ok(_)) => json_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "internal_error",
            "Lỗi xác minh OTP",
        ),
    }
}

async fn api_reset_password(
    Extension(admin_auth::ResolvedClientIp(resolved_ip)): Extension<admin_auth::ResolvedClientIp>,
    headers: HeaderMap,
    Json(body): Json<ResetPasswordBody>,
) -> impl IntoResponse {
    let token = body.reset_token.trim();
    let pass = body.password.trim();
    let mut fields = serde_json::Map::new();
    if token.is_empty() {
        fields.insert(
            "reset_token".into(),
            serde_json::Value::String(
                "Phiên đặt lại mật khẩu không hợp lệ — xác minh OTP lại".into(),
            ),
        );
    }
    if pass.len() < 6 {
        fields.insert(
            "password".into(),
            serde_json::Value::String("Mật khẩu mới tối thiểu 6 ký tự".into()),
        );
    }
    if !fields.is_empty() {
        return json_error_fields(
            StatusCode::BAD_REQUEST,
            "validation_failed",
            "Dữ liệu không hợp lệ",
            fields,
        );
    }

    let Some(st) = STATE.get() else {
        return json_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "internal_error",
            "gateway state not initialized",
        );
    };

    let mut conn = st.session_store.redis();
    let ticket = match password_reset::consume_reset_ticket(&mut conn, token).await {
        Ok(t) => t,
        Err(e) => {
            tracing::error!(error = %e, "reset-password redis failed");
            return json_error(
                StatusCode::SERVICE_UNAVAILABLE,
                "session_store_unavailable",
                "Redis không khả dụng",
            );
        }
    };

    let Some(ticket) = ticket else {
        return json_error(
            StatusCode::BAD_REQUEST,
            "reset_token_invalid",
            "Phiên đặt lại mật khẩu hết hạn — xác minh OTP lại",
        );
    };

    let user_id = ticket.user_id;

    let hash = match db::hash_password(pass) {
        Ok(h) => h,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": format!("hash: {e}") })),
            )
                .into_response();
        }
    };

    match db::set_user_password(&st.pool, user_id, &hash).await {
        Ok(0) => json_error(
            StatusCode::NOT_FOUND,
            "user_not_found",
            "Tài khoản không tồn tại",
        ),
        Ok(_) => {
            let _ = db::bump_user_token_version(&st.pool, user_id).await;
            let _ = st.session_store.revoke_all_for_user(user_id).await;
            if let Ok(Some(u)) = db::fetch_admin_user_by_id_any(&st.pool, user_id).await {
                let ip = resolved_ip
                    .clone()
                    .or_else(|| admin_auth::client_ip(&headers));
                write_audit_event(
                    &st.pool,
                    u.tenant_id.unwrap_or(1),
                    &u.username,
                    &u.role,
                    "reset_password",
                    "session",
                    "success",
                    ip.as_deref(),
                    Some("otp_verified"),
                )
                .await;
            }
            Json(serde_json::json!({
                "status": "ok",
                "message": "Đã đặt lại mật khẩu — đăng nhập lại."
            }))
            .into_response()
        }
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": format!("{e}") })),
        )
            .into_response(),
    }
}

async fn admin_me(headers: HeaderMap) -> impl IntoResponse {
    let Some(sid) = gw_sid_from_headers(&headers) else {
        return json_error(StatusCode::UNAUTHORIZED, "unauthorized", "Not logged in");
    };
    let Some(st) = STATE.get() else {
        return json_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "internal_error",
            "gateway state not initialized",
        );
    };
    match admin_auth::resolve_session_ctx(&st.session_store, &st.pool, &sid).await {
        Ok(Some(ctx)) => {
            let email = db::fetch_admin_user_by_id_any(&st.pool, ctx.user_id)
                .await
                .ok()
                .flatten()
                .and_then(|r| r.email);
            let mut workspaces =
                db::list_accessible_workspaces(&st.pool, ctx.user_id, ctx.home_tenant_id)
                    .await
                    .unwrap_or_default();
            if admin_auth::on_prem_single_org() {
                workspaces.retain(|w| w.is_home);
            }
            Json(serde_json::json!({
                "username": ctx.username,
                "email": email,
                "role": ctx.role,
                "tenant_id": ctx.tenant_id,
                "home_tenant_id": ctx.home_tenant_id,
                "user_id": ctx.user_id,
                "deployment_mode": if admin_auth::on_prem_single_org() { "on_prem" } else { "saas" },
                "workspaces": workspaces,
            }))
            .into_response()
        }
        Ok(None) => json_error(
            StatusCode::UNAUTHORIZED,
            "unauthorized",
            "Session expired or invalid",
        ),
        Err(_) => session_unavailable_response(),
    }
}

#[derive(Deserialize)]
struct SwitchWorkspaceBody {
    tenant_id: i64,
}

async fn api_switch_workspace(
    headers: HeaderMap,
    Extension(ctx): Extension<AdminCtx>,
    Json(body): Json<SwitchWorkspaceBody>,
) -> impl IntoResponse {
    if admin_auth::on_prem_single_org() {
        return json_error(
            StatusCode::FORBIDDEN,
            "on_prem_mode",
            "Triển khai on-prem: một tổ chức — không chuyển workspace",
        );
    }
    let Some(sid) = gw_sid_from_headers(&headers) else {
        return json_error(StatusCode::UNAUTHORIZED, "unauthorized", "Not logged in");
    };
    let Some(st) = STATE.get() else {
        return json_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "internal_error",
            "state not initialized",
        );
    };
    if body.tenant_id <= 0 {
        return json_error(
            StatusCode::BAD_REQUEST,
            "invalid_tenant",
            "tenant_id không hợp lệ",
        );
    }
    let Ok(can) =
        db::user_can_access_workspace(&st.pool, ctx.user_id, ctx.home_tenant_id, body.tenant_id)
            .await
    else {
        return json_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "internal_error",
            "db error",
        );
    };
    if !can {
        return json_error(
            StatusCode::FORBIDDEN,
            "forbidden",
            "Bạn không có quyền vào workspace này",
        );
    }
    let Some(user) = db::fetch_admin_user_by_id_any(&st.pool, ctx.user_id)
        .await
        .ok()
        .flatten()
    else {
        return json_error(StatusCode::UNAUTHORIZED, "unauthorized", "User not found");
    };
    let role = db::effective_workspace_role(
        &st.pool,
        ctx.user_id,
        ctx.home_tenant_id,
        &user.role,
        body.tenant_id,
    )
    .await
    .unwrap_or_else(|_| user.role.clone());
    let mut rec = match st.session_store.get(&sid).await {
        Ok(Some(r)) => r,
        Ok(None) => {
            return json_error(StatusCode::UNAUTHORIZED, "unauthorized", "Session expired");
        }
        Err(_) => return session_unavailable_response(),
    };
    rec.tenant_id = body.tenant_id;
    rec.role = role.clone();
    if let Err(e) = st.session_store.save(&sid, &rec).await {
        tracing::warn!(error = %e, "switch workspace save session failed");
        return json_error(
            StatusCode::SERVICE_UNAVAILABLE,
            "session_store_unavailable",
            "Không lưu được phiên",
        );
    }
    Json(serde_json::json!({
        "status": "ok",
        "tenant_id": body.tenant_id,
        "role": role,
    }))
    .into_response()
}

async fn api_list_workspaces(Extension(ctx): Extension<AdminCtx>) -> impl IntoResponse {
    if admin_auth::on_prem_single_org() {
        return json_error(
            StatusCode::FORBIDDEN,
            "on_prem_mode",
            "Triển khai on-prem: một tổ chức — không có danh sách workspace",
        );
    }
    let Some(st) = STATE.get() else {
        return json_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "internal_error",
            "state not initialized",
        );
    };
    match db::list_accessible_workspaces(&st.pool, ctx.user_id, ctx.home_tenant_id).await {
        Ok(rows) => Json(rows).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": format!("{e}") })),
        )
            .into_response(),
    }
}

#[derive(Deserialize)]
struct InviteMemberBody {
    username: String,
    role: String,
}

async fn api_list_workspace_members(Extension(ctx): Extension<AdminCtx>) -> impl IntoResponse {
    if admin_auth::on_prem_single_org() {
        return json_error(
            StatusCode::FORBIDDEN,
            "on_prem_mode",
            "Triển khai on-prem — dùng Quản lý Users",
        );
    }
    if !ctx.is_admin() {
        return audit_admin_denied(&ctx, "workspace/members").await;
    }
    let Some(st) = STATE.get() else {
        return json_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "internal_error",
            "state not initialized",
        );
    };
    match db::list_workspace_users(&st.pool, ctx.tenant_id).await {
        Ok(rows) => Json(rows).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": format!("{e}") })),
        )
            .into_response(),
    }
}

async fn api_invite_workspace_member(
    Extension(ctx): Extension<AdminCtx>,
    Json(body): Json<InviteMemberBody>,
) -> impl IntoResponse {
    if admin_auth::on_prem_single_org() {
        return json_error(
            StatusCode::FORBIDDEN,
            "on_prem_mode",
            "Triển khai on-prem — dùng Thêm User",
        );
    }
    if !ctx.is_admin() {
        return audit_admin_denied(&ctx, "workspace/members").await;
    }
    let Some(st) = STATE.get() else {
        return json_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "internal_error",
            "state not initialized",
        );
    };
    let username = body.username.trim();
    if username.is_empty() {
        return json_error(
            StatusCode::BAD_REQUEST,
            "validation_failed",
            "Nhập username",
        );
    }
    let Some(role) = normalize_user_role(&body.role) else {
        return json_error(StatusCode::BAD_REQUEST, "invalid_role", "Role không hợp lệ");
    };
    if role == "admin" && ctx.tenant_id != ctx.home_tenant_id {
        return json_error(
            StatusCode::FORBIDDEN,
            "forbidden",
            "Chỉ chủ workspace mới mời admin",
        );
    }
    let Some(user) = db::fetch_admin_user_by_username(&st.pool, username)
        .await
        .ok()
        .flatten()
    else {
        return json_error(
            StatusCode::NOT_FOUND,
            "user_not_found",
            "Không tìm thấy user — họ cần tự đăng ký trước",
        );
    };
    if user.id == ctx.user_id {
        return json_error(
            StatusCode::BAD_REQUEST,
            "invalid_target",
            "Không mời chính mình",
        );
    }
    if user.tenant_id.unwrap_or(1) == ctx.tenant_id {
        return json_error(
            StatusCode::CONFLICT,
            "already_member",
            "User đã thuộc workspace này",
        );
    }
    if db::upsert_tenant_membership(&st.pool, ctx.tenant_id, user.id, &role)
        .await
        .is_err()
    {
        return json_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "internal_error",
            "Không thêm membership",
        );
    }
    write_audit(
        &st.pool,
        &ctx,
        "workspace.invite",
        username,
        "success",
        None,
        Some(&role),
    )
    .await;
    Json(serde_json::json!({
        "status": "ok",
        "user_id": user.id,
        "username": user.username,
        "role": role,
        "workspace_tenant_id": ctx.tenant_id,
    }))
    .into_response()
}

async fn api_remove_workspace_member(
    Extension(ctx): Extension<AdminCtx>,
    Path(user_id): Path<i64>,
) -> impl IntoResponse {
    if admin_auth::on_prem_single_org() {
        return json_error(
            StatusCode::FORBIDDEN,
            "on_prem_mode",
            "Triển khai on-prem — không gỡ collaborator",
        );
    }
    if !ctx.is_admin() {
        return audit_admin_denied(&ctx, "workspace/members").await;
    }
    let Some(st) = STATE.get() else {
        return json_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "internal_error",
            "state not initialized",
        );
    };
    if user_id == ctx.user_id {
        return json_error(
            StatusCode::BAD_REQUEST,
            "invalid_target",
            "Không xóa chính mình",
        );
    }
    let Some(target) = db::fetch_admin_user_by_id_any(&st.pool, user_id)
        .await
        .ok()
        .flatten()
    else {
        return json_error(
            StatusCode::NOT_FOUND,
            "user_not_found",
            "User không tồn tại",
        );
    };
    if target.tenant_id.unwrap_or(1) == ctx.tenant_id {
        return json_error(
            StatusCode::FORBIDDEN,
            "forbidden",
            "Không xóa chủ workspace — dùng Xóa user nếu là tài khoản nội bộ",
        );
    }
    match db::delete_tenant_membership(&st.pool, ctx.tenant_id, user_id).await {
        Ok(true) => {
            write_audit(
                &st.pool,
                &ctx,
                "workspace.remove_member",
                &target.username,
                "success",
                None,
                None,
            )
            .await;
            Json(serde_json::json!({ "status": "ok" })).into_response()
        }
        Ok(false) => json_error(
            StatusCode::NOT_FOUND,
            "not_a_member",
            "User không phải thành viên được mời",
        ),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": format!("{e}") })),
        )
            .into_response(),
    }
}

async fn admin_logout(headers: HeaderMap) -> impl IntoResponse {
    if let Some(sid) = gw_sid_from_headers(&headers) {
        if let Some(st) = STATE.get() {
            let _ = st.session_store.destroy_by_sid(&sid).await;
        }
    }
    let Ok(hv) = HeaderValue::from_str(&session_cookie_clear_value()) else {
        return json_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "internal_error",
            "invalid cookie clear header",
        );
    };
    let mut res = (StatusCode::OK, Json(serde_json::json!({ "status": "ok" }))).into_response();
    res.headers_mut().append(SET_COOKIE, hv);
    res
}

async fn health_handler() -> Response {
    let enabled = if let Some(st) = STATE.get() {
        st.config.read().await.settings.enable_health_check
    } else {
        true
    };
    if !enabled {
        return json_error(
            StatusCode::NOT_FOUND,
            "disabled",
            "health endpoint disabled",
        );
    }

    let (db_ok, db_ms, redis_status, redis_ms) = if let Some(st) = STATE.get() {
        let (db_ok, db_ms) = db::ping_timed(&st.pool).await;
        let (redis_status, redis_ms) = st.session_store.ping_timed().await;
        (db_ok, db_ms, redis_status, redis_ms)
    } else {
        (false, 0, SessionStoreStatus::Down, 0)
    };
    let redis_ok = redis_status == SessionStoreStatus::Up;

    let overall = if db_ok && redis_ok { "ok" } else { "degraded" };

    let mut body = serde_json::json!({
        "status": overall,
        "service": "avaso-gateway",
        "version": env!("CARGO_PKG_VERSION"),
        "components": {
            "database": { "status": if db_ok { "up" } else { "down" }, "latency_ms": db_ms },
            "session_store": {
                "status": if redis_ok { "up" } else { "down" },
                "backend": "redis",
                "latency_ms": redis_ms
            }
        }
    });
    if let Some(inst) = gateway_instance_name() {
        body["instance"] = serde_json::Value::String(inst);
    }

    let code = if overall == "ok" {
        StatusCode::OK
    } else {
        StatusCode::SERVICE_UNAVAILABLE
    };
    (code, Json(body)).into_response()
}

/// Public: xác minh Nginx → gateway đúng binary (có route /api/*). Không cần auth.
async fn admin_api_ping() -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "status": "ok",
        "service": "avaso-gateway",
        "version": env!("CARGO_PKG_VERSION"),
        "features": {
            "forgot_password": true,
            "register_viewer": admin_auth::viewer_registration_enabled(),
            "deployment_mode": if admin_auth::on_prem_single_org() {
                "on_prem"
            } else {
                "saas"
            },
            "password_reset_dev_log": password_reset::password_reset_dev_log(),
            "dashboard_users_table": true
        }
    }))
}

#[derive(Debug, Deserialize)]
struct PaginationQuery {
    limit: Option<usize>,
    offset: Option<usize>,
}

#[derive(Debug, Deserialize)]
struct MetricsQuery {
    format: Option<String>,
}

async fn metrics_handler(headers: HeaderMap, Query(q): Query<MetricsQuery>) -> Response {
    let enabled = if let Some(st) = STATE.get() {
        st.config.read().await.settings.enable_metrics
    } else {
        true
    };
    if !enabled {
        return json_error(
            StatusCode::NOT_FOUND,
            "disabled",
            "metrics endpoint disabled",
        );
    }
    let wants_prometheus = q.format.as_deref() == Some("prometheus")
        || headers
            .get("accept")
            .and_then(|v| v.to_str().ok())
            .map(|s| {
                s.contains("text/plain")
                    || s.contains("application/openmetrics-text")
                    || s.contains("openmetrics")
            })
            .unwrap_or(false);
    if let Some(st) = STATE.get() {
        if wants_prometheus {
            let text = st.gateway_metrics.prometheus_text();
            return (
                StatusCode::OK,
                [(
                    CONTENT_TYPE,
                    HeaderValue::from_static("text/plain; version=0.0.4; charset=utf-8"),
                )],
                text,
            )
                .into_response();
        }
        return Json(st.gateway_metrics.snapshot()).into_response();
    }
    if wants_prometheus {
        return (
            StatusCode::OK,
            [(
                CONTENT_TYPE,
                HeaderValue::from_static("text/plain; version=0.0.4; charset=utf-8"),
            )],
            "# gateway not initialized\n".to_string(),
        )
            .into_response();
    }
    Json(serde_json::json!({
        "status": "ok",
        "service": "avaso-gateway",
        "data_plane": { "requests_total": 0 }
    }))
    .into_response()
}

async fn api_get_settings() -> impl IntoResponse {
    let st = match STATE.get() {
        Some(s) => s.clone(),
        None => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": "state not initialized" })),
            )
                .into_response();
        }
    };
    let cfg = st.config.read().await.clone();
    Json(settings_response_from_config(&cfg)).into_response()
}

async fn api_update_settings(
    headers: HeaderMap,
    Extension(ctx): Extension<AdminCtx>,
    Json(body): Json<UpdateSettingsBody>,
) -> impl IntoResponse {
    let ip = admin_auth::client_ip(&headers);
    if !ctx.is_admin() {
        if let Some(st) = STATE.get() {
            write_audit_failure(
                &st.pool,
                &ctx,
                "update_settings",
                "gateway_settings",
                ip.as_deref(),
                Some("admin_only"),
            )
            .await;
        }
        return admin_auth::forbidden_response();
    }
    if let Some(resp) = validate_settings_write(&body) {
        return resp;
    }
    let st = match STATE.get() {
        Some(s) => s.clone(),
        None => {
            return json_error(
                StatusCode::INTERNAL_SERVER_ERROR,
                "internal_error",
                "gateway state not initialized",
            );
        }
    };

    if let Err(e) = persist_runtime_settings(&st.pool, &body).await {
        return json_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "settings_save_failed",
            &format!("cannot save settings: {e}"),
        );
    }
    if let Err(e) = reload_runtime_config().await {
        return json_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "reload_failed",
            &format!("cannot reload settings: {e}"),
        );
    }

    write_audit(
        &st.pool,
        &ctx,
        "update_settings",
        "gateway_settings",
        "success",
        ip.as_deref(),
        Some("rate_limit,metrics,health"),
    )
    .await;

    let cfg = st.config.read().await.clone();
    Json(settings_response_from_config(&cfg)).into_response()
}

async fn api_reload_config() -> impl IntoResponse {
    match reload_runtime_config().await {
        Ok(()) => (
            StatusCode::OK,
            Json(serde_json::json!({
                "status": "ok",
                "message": "config reloaded from database"
            })),
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({
                "error": "reload_failed",
                "message": format!("{e}")
            })),
        )
            .into_response(),
    }
}

async fn proxy_handler() -> impl IntoResponse {
    let backend_url = "https://jsonplaceholder.typicode.com/todos/1";

    let result = match STATE.get() {
        Some(st) => st.http.get(backend_url).send().await,
        None => {
            reqwest::Client::builder()
                .timeout(Duration::from_secs(10))
                .build()
                .unwrap_or_else(|_| reqwest::Client::new())
                .get(backend_url)
                .send()
                .await
        }
    };

    match result {
        Ok(res) => {
            let body = res.text().await.unwrap_or_default();
            (
                StatusCode::OK,
                Json(serde_json::json!({
                    "status": "ok",
                    "demo_only": true,
                    "upstream": "jsonplaceholder.typicode.com",
                    "body": body
                })),
            )
                .into_response()
        }
        Err(_) => (
            StatusCode::BAD_GATEWAY,
            Json(serde_json::json!({
                "error": "bad_gateway",
                "message": "Could not reach upstream demo service"
            })),
        )
            .into_response(),
    }
}

async fn api_routes(
    Extension(ctx): Extension<AdminCtx>,
    axum::extract::Query(pq): axum::extract::Query<PaginationQuery>,
) -> impl IntoResponse {
    let st = match STATE.get() {
        Some(s) => s.clone(),
        None => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": "state not initialized" })),
            )
                .into_response();
        }
    };
    match db::list_routes_for_tenant(&st.pool, ctx.tenant_id).await {
        Ok(rows) => {
            let offset = pq.offset.unwrap_or(0);
            let limit = pq.limit.unwrap_or(500).min(1000);
            let page: Vec<_> = rows.into_iter().skip(offset).take(limit).collect();
            Json(page).into_response()
        }
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": format!("{e}") })),
        )
            .into_response(),
    }
}

#[derive(Debug, Deserialize)]
struct RouteWriteBody {
    path: String,
    target: String,
    #[serde(default = "default_timeout_secs")]
    timeout_secs: i32,
    #[serde(default = "default_rate_limit_per_min")]
    rate_limit_per_min: i32,
    #[serde(default = "default_json_obj")]
    transform_add_headers: String,
    #[serde(default = "default_json_arr")]
    transform_remove_headers: String,
    #[serde(default)]
    retry_max: i32,
    #[serde(
        default = "route_match::default_retry_status_codes",
        deserialize_with = "route_match::deserialize_retry_status"
    )]
    retry_on_status: Vec<i32>,
    #[serde(default = "default_one", deserialize_with = "deserialize_i32_or_bool")]
    retry_on_timeout: i32,
    #[serde(default)]
    queue_on_failure: bool,
    #[serde(
        default = "route_match::default_allowed_methods_list",
        deserialize_with = "route_match::deserialize_allowed_methods"
    )]
    allowed_methods: Vec<String>,
}

/// FE có thể gửi `true`/`false` hoặc `0`/`1`.
fn deserialize_i32_or_bool<'de, D>(deserializer: D) -> Result<i32, D::Error>
where
    D: serde::Deserializer<'de>,
{
    use serde::de::{self, Unexpected};
    struct I32OrBool;
    impl<'de> de::Visitor<'de> for I32OrBool {
        type Value = i32;
        fn expecting(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
            f.write_str("boolean or integer 0/1")
        }
        fn visit_bool<E>(self, v: bool) -> Result<i32, E> {
            Ok(if v { 1 } else { 0 })
        }
        fn visit_i64<E>(self, v: i64) -> Result<i32, E> {
            Ok(if v != 0 { 1 } else { 0 })
        }
        fn visit_u64<E>(self, v: u64) -> Result<i32, E> {
            Ok(if v != 0 { 1 } else { 0 })
        }
        fn visit_str<E>(self, v: &str) -> Result<i32, E>
        where
            E: de::Error,
        {
            match v.trim().to_lowercase().as_str() {
                "1" | "true" => Ok(1),
                "0" | "false" => Ok(0),
                _ => Err(de::Error::invalid_value(Unexpected::Str(v), &self)),
            }
        }
    }
    deserializer.deserialize_any(I32OrBool)
}

fn route_policy_from_body(body: &RouteWriteBody) -> (String, String, i32, i32, i32) {
    (
        body.transform_add_headers.clone(),
        body.transform_remove_headers.clone(),
        body.retry_max.max(0),
        if body.retry_on_timeout != 0 { 1 } else { 0 },
        if body.queue_on_failure { 1 } else { 0 },
    )
}

fn validate_route_proxy_policy(body: &RouteWriteBody) -> Option<Response> {
    let mut fields = serde_json::Map::new();
    if serde_json::from_str::<serde_json::Map<String, serde_json::Value>>(
        &body.transform_add_headers,
    )
    .is_err()
    {
        fields.insert(
            "transform_add_headers".into(),
            serde_json::Value::String("JSON object, vd {\"X-Proxy-Version\":\"1.0\"}".into()),
        );
    }
    if serde_json::from_str::<Vec<String>>(&body.transform_remove_headers).is_err() {
        fields.insert(
            "transform_remove_headers".into(),
            serde_json::Value::String("JSON array, vd [\"Authorization\"]".into()),
        );
    }
    if body.retry_max < 0 || body.retry_max > 10 {
        fields.insert(
            "retry_max".into(),
            serde_json::Value::String("retry_max từ 0 đến 10".into()),
        );
    }
    if fields.is_empty() {
        None
    } else {
        Some(json_error_fields(
            StatusCode::BAD_REQUEST,
            "validation_failed",
            "Cấu hình route không hợp lệ",
            fields,
        ))
    }
}

fn default_timeout_secs() -> i32 {
    30
}

fn default_rate_limit_per_min() -> i32 {
    100
}

async fn api_create_route(
    Extension(ctx): Extension<AdminCtx>,
    Json(body): Json<RouteWriteBody>,
) -> impl IntoResponse {
    let st = match STATE.get() {
        Some(s) => s.clone(),
        None => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": "state not initialized" })),
            )
                .into_response();
        }
    };
    let path = body.path.trim().to_string();
    let target = body.target.trim().to_string();
    // Validate route / sinh key-secret (tùy thao tác)
    if let Some(resp) =
        validate_route_write(&path, &target, body.timeout_secs, body.rate_limit_per_min)
    {
        return resp;
    }
    if let Some(resp) = validate_route_proxy_policy(&body) {
        return resp;
    }
    let allowed_methods = route_match::normalize_allowed_methods_list(body.allowed_methods.clone());
    if !route_match::validate_allowed_methods_list(&allowed_methods) {
        return json_error_fields(
            StatusCode::BAD_REQUEST,
            "validation_failed",
            "allowed_methods không hợp lệ",
            serde_json::Map::from_iter([(
                "allowed_methods".into(),
                serde_json::Value::String(
                    "Dùng [\"*\"] hoặc mảng GET,POST,PUT,DELETE,PATCH,HEAD,OPTIONS".into(),
                ),
            )]),
        );
    }
    let retry_status = route_match::normalize_retry_status_codes(body.retry_on_status.clone());
    if !route_match::validate_retry_status_codes(&retry_status) {
        return json_error_fields(
            StatusCode::BAD_REQUEST,
            "validation_failed",
            "retry_on_status không hợp lệ",
            serde_json::Map::from_iter([(
                "retry_on_status".into(),
                serde_json::Value::String("Mỗi phần tử phải là mã HTTP 100–599".into()),
            )]),
        );
    }
    let (t_add, t_rm, retry_max, retry_timeout, queue_fail) = route_policy_from_body(&body);
    // Ghi PG — routes CRUD hoặc client key tạo/rotate (+ACL)
    match db::insert_route(
        &st.pool,
        &path,
        &target,
        body.timeout_secs,
        body.rate_limit_per_min,
        ctx.tenant_id,
        &t_add,
        &t_rm,
        retry_max,
        &retry_status,
        retry_timeout,
        queue_fail,
        &allowed_methods,
    )
    .await
    {
        Ok(row) => {
            let _ = reload_runtime_config().await;
            // Audit create/update/delete_route hoặc create/rotate_client_key
            write_audit(
                &st.pool,
                &ctx,
                "create_route",
                &path,
                "success",
                None,
                Some(&target),
            )
            .await;
            // Đã ghi
            // 201/200/204 (secret chỉ trả một lần nếu ACL)
            (StatusCode::CREATED, Json(row)).into_response()
        }
        Err(e) => route_db_error_response(e),
    }
}

async fn api_update_route(
    Extension(ctx): Extension<AdminCtx>,
    Path(id): Path<i64>,
    Json(body): Json<RouteWriteBody>,
) -> impl IntoResponse {
    let st = match STATE.get() {
        Some(s) => s.clone(),
        None => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": "state not initialized" })),
            )
                .into_response();
        }
    };
    let path = body.path.trim().to_string();
    let target = body.target.trim().to_string();
    if let Some(resp) =
        validate_route_write(&path, &target, body.timeout_secs, body.rate_limit_per_min)
    {
        return resp;
    }
    if let Some(resp) = validate_route_proxy_policy(&body) {
        return resp;
    }
    let allowed_methods = route_match::normalize_allowed_methods_list(body.allowed_methods.clone());
    if !route_match::validate_allowed_methods_list(&allowed_methods) {
        return json_error_fields(
            StatusCode::BAD_REQUEST,
            "validation_failed",
            "allowed_methods không hợp lệ",
            serde_json::Map::from_iter([(
                "allowed_methods".into(),
                serde_json::Value::String(
                    "Dùng [\"*\"] hoặc mảng GET,POST,PUT,DELETE,PATCH,HEAD,OPTIONS".into(),
                ),
            )]),
        );
    }
    let retry_status = route_match::normalize_retry_status_codes(body.retry_on_status.clone());
    if !route_match::validate_retry_status_codes(&retry_status) {
        return json_error_fields(
            StatusCode::BAD_REQUEST,
            "validation_failed",
            "retry_on_status không hợp lệ",
            serde_json::Map::from_iter([(
                "retry_on_status".into(),
                serde_json::Value::String("Mỗi phần tử phải là mã HTTP 100–599".into()),
            )]),
        );
    }
    let (t_add, t_rm, retry_max, retry_timeout, queue_fail) = route_policy_from_body(&body);
    match db::update_route(
        &st.pool,
        id,
        ctx.tenant_id,
        &path,
        &target,
        body.timeout_secs,
        body.rate_limit_per_min,
        &t_add,
        &t_rm,
        retry_max,
        &retry_status,
        retry_timeout,
        queue_fail,
        &allowed_methods,
    )
    .await
    {
        Ok(0) => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({ "error": "route_not_found", "message": "Route không tồn tại" })),
        )
            .into_response(),
        Ok(_) => match db::fetch_route_by_id_tenant(&st.pool, id, ctx.tenant_id).await {
            Ok(Some(row)) => {
                let _ = reload_runtime_config().await;
                write_audit(
                    &st.pool,
                    &ctx,
                    "update_route",
                    &path,
                    "success",
                    None,
                    Some(&target),
                )
                .await;
                (StatusCode::OK, Json(row)).into_response()
            }
            Ok(None) => (
                StatusCode::NOT_FOUND,
                Json(serde_json::json!({ "error": "route_not_found", "message": "Route không tồn tại" })),
            )
                .into_response(),
            Err(e) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": "db_error", "message": format!("{e}") })),
            )
                .into_response(),
        },
        Err(e) => route_db_error_response(e),
    }
}

fn route_db_error_response(e: sqlx::Error) -> Response {
    if let sqlx::Error::Database(ref d) = e {
        if d.is_unique_violation() {
            let mut fields = serde_json::Map::new();
            fields.insert(
                "path".into(),
                serde_json::Value::String("Path này đã tồn tại — chọn path khác".into()),
            );
            return json_error_fields(
                StatusCode::CONFLICT,
                "path_already_exists",
                "Path đã được dùng bởi route khác",
                fields,
            );
        }
    }
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(serde_json::json!({ "error": "db_error", "message": format!("{e}") })),
    )
        .into_response()
}

async fn api_delete_route(
    Extension(ctx): Extension<AdminCtx>,
    Path(id): Path<i64>,
) -> impl IntoResponse {
    let st = match STATE.get() {
        Some(s) => s.clone(),
        None => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": "state not initialized" })),
            )
                .into_response();
        }
    };
    match db::delete_route(&st.pool, id, ctx.tenant_id).await {
        Ok(0) => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({ "error": "route not found" })),
        )
            .into_response(),
        Ok(_) => {
            // Kết quả ghi (CASCADE ACL nếu xóa route)
            let _ = reload_runtime_config().await;
            write_audit(
                &st.pool,
                &ctx,
                "delete_route",
                &format!("route:{id}"),
                "success",
                None,
                None,
            )
            .await;
            // 201/200/204 (secret chỉ trả một lần nếu ACL)
            StatusCode::NO_CONTENT.into_response()
        }
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": format!("{e}") })),
        )
            .into_response(),
    }
}

async fn api_client_keys_traffic_summary(Extension(ctx): Extension<AdminCtx>) -> impl IntoResponse {
    if !admin_auth::can_view_client_keys(&ctx.role) {
        return admin_auth::forbidden_response();
    }
    let st = match STATE.get() {
        Some(s) => s.clone(),
        None => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": "state not initialized" })),
            )
                .into_response();
        }
    };
    match db::client_keys_traffic_summary_24h(&st.pool, ctx.tenant_id).await {
        Ok(rows) => Json(rows).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": format!("{e}") })),
        )
            .into_response(),
    }
}

async fn api_list_client_keys(
    Extension(ctx): Extension<AdminCtx>,
    axum::extract::Query(pq): axum::extract::Query<PaginationQuery>,
) -> impl IntoResponse {
    if !admin_auth::can_view_client_keys(&ctx.role) {
        return admin_auth::forbidden_response();
    }
    let st = match STATE.get() {
        Some(s) => s.clone(),
        None => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": "state not initialized" })),
            )
                .into_response();
        }
    };
    // Viewer quan sát toàn tenant (không sở hữu key nào); operator chỉ key của mình.
    let admin_scope = ctx.is_admin() || ctx.is_viewer();
    match db::list_client_keys_scoped(&st.pool, ctx.tenant_id, Some(ctx.user_id), admin_scope).await
    {
        Ok(rows) => {
            let offset = pq.offset.unwrap_or(0);
            let limit = pq.limit.unwrap_or(500).min(1000);
            let page: Vec<_> = rows.into_iter().skip(offset).take(limit).collect();
            Json(page).into_response()
        }
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": format!("{e}") })),
        )
            .into_response(),
    }
}

#[derive(Debug, Deserialize)]
struct CreateClientKeyBody {
    name: String,
    #[serde(default = "default_integration_type")]
    integration_type: String,
    #[serde(default)]
    rate_limit_per_min: i32,
    #[serde(default)]
    route_ids: Vec<i64>,
}

fn default_integration_type() -> String {
    "app".into()
}

#[derive(Debug, Serialize)]
struct CreateClientKeyResponse {
    id: i64,
    name: String,
    api_key: String,
    secret_key: String,
    auth: &'static str,
    integration_type: String,
    tenant_id: i64,
    purpose: String,
}

fn integration_purpose_label(t: &str) -> &'static str {
    match t {
        "app" => "Ứng dụng / phần mềm gọi API (mobile, web, script)",
        "partner" => "Đối tác / B2B tích hợp",
        "salesforce" => "Client data-plane Salesforce",
        "zoho" => "Client data-plane Zoho Projects",
        "test" => "Thử nghiệm / dev",
        _ => "Ứng dụng",
    }
}

fn normalize_integration_type(raw: &str) -> String {
    let t = raw.trim().to_ascii_lowercase();
    match t.as_str() {
        "app" | "partner" | "salesforce" | "zoho" | "test" => t,
        _ => "app".into(),
    }
}

async fn api_create_client_key(
    Extension(ctx): Extension<AdminCtx>,
    Json(body): Json<CreateClientKeyBody>,
) -> impl IntoResponse {
    let st = match STATE.get() {
        Some(s) => s.clone(),
        None => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": "state not initialized" })),
            )
                .into_response();
        }
    };
    let name = body.name.trim().to_string();
    if name.is_empty() {
        let mut fields = serde_json::Map::new();
        fields.insert(
            "name".into(),
            serde_json::Value::String("Nhập tên app / đối tác".into()),
        );
        return json_error_fields(
            StatusCode::BAD_REQUEST,
            "validation_failed",
            "Dữ liệu key không hợp lệ",
            fields,
        );
    }
    // Validate route / sinh key-secret (tùy thao tác)
    let api_key = db::random_api_key_id();
    let secret_key = db::random_secret_key();
    let integration_type = normalize_integration_type(&body.integration_type);
    let rate_limit = body.rate_limit_per_min;
    if rate_limit < 0 || rate_limit > 1_000_000 {
        let mut fields = serde_json::Map::new();
        fields.insert(
            "rate_limit_per_min".into(),
            serde_json::Value::String(
                "Rate limit phải từ 0 (mặc định route/global) đến 1.000.000 req/min".into(),
            ),
        );
        return json_error_fields(
            StatusCode::BAD_REQUEST,
            "validation_failed",
            "Dữ liệu key không hợp lệ",
            fields,
        );
    }
    match db::insert_oauth_client(
        &st.pool,
        &name,
        &api_key,
        &secret_key,
        ctx.tenant_id,
        &integration_type,
        ctx.user_id,
        rate_limit,
    )
    .await
    {
        Ok(id) => {
            // Ghi PG — routes CRUD hoặc client key tạo/rotate (+ACL)
            if !body.route_ids.is_empty() {
                let _ =
                    db::set_client_key_routes(&st.pool, id, ctx.tenant_id, &body.route_ids).await;
            }
            spawn_reload_runtime_config();
            // Audit create/update/delete_route hoặc create/rotate_client_key
            write_audit(
                &st.pool,
                &ctx,
                "create_client_key",
                &name,
                "success",
                None,
                Some(&integration_type),
            )
            .await;
            let purpose = integration_purpose_label(&integration_type).to_string();
            // 201/200/204 (secret chỉ trả một lần nếu ACL)
            (
                StatusCode::CREATED,
                Json(CreateClientKeyResponse {
                    id,
                    name,
                    api_key,
                    secret_key,
                    auth: "oauth2",
                    integration_type: integration_type.clone(),
                    tenant_id: ctx.tenant_id,
                    purpose,
                }),
            )
                .into_response()
        }
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": format!("{e}") })),
        )
            .into_response(),
    }
}

async fn api_gateway_public_key() -> impl IntoResponse {
    let Some(st) = STATE.get() else {
        return json_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "internal_error",
            "gateway state not initialized",
        );
    };
    match gateway_rsa::public_key_response(&st.pool).await {
        Ok(body) => Json(body).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": "public_key_unavailable", "message": e })),
        )
            .into_response(),
    }
}

#[derive(Debug, Deserialize)]
struct EncryptedCreateClientKeyBody {
    envelope: gateway_rsa::CryptoEnvelope,
}

async fn api_create_client_key_encrypted(
    Extension(ctx): Extension<AdminCtx>,
    Json(body): Json<EncryptedCreateClientKeyBody>,
) -> impl IntoResponse {
    let st = match STATE.get() {
        Some(s) => s.clone(),
        None => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": "state not initialized" })),
            )
                .into_response();
        }
    };

    let plain = match gateway_rsa::decrypt_envelope(&body.envelope) {
        Ok(bytes) => bytes,
        Err(e) => {
            write_audit_failure(
                &st.pool,
                &ctx,
                "create_client_key_encrypted",
                "envelope",
                None,
                Some("decrypt_failed"),
            )
            .await;
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({
                    "error": "decrypt_failed",
                    "message": e
                })),
            )
                .into_response();
        }
    };

    let parsed: gateway_rsa::EncryptedCreateKeyPlain = match serde_json::from_slice(&plain) {
        Ok(p) => p,
        Err(e) => {
            write_audit_failure(
                &st.pool,
                &ctx,
                "create_client_key_encrypted",
                "envelope",
                None,
                Some("invalid_plaintext_json"),
            )
            .await;
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({
                    "error": "invalid_plaintext_json",
                    "message": format!("{e}")
                })),
            )
                .into_response();
        }
    };

    let name = parsed.name.trim().to_string();
    if name.is_empty() {
        write_audit_failure(
            &st.pool,
            &ctx,
            "create_client_key_encrypted",
            "envelope",
            None,
            Some("name_required"),
        )
        .await;
        return json_error_fields(
            StatusCode::BAD_REQUEST,
            "validation_failed",
            "Dữ liệu key không hợp lệ",
            serde_json::Map::from_iter([(
                "name".into(),
                serde_json::Value::String("Nhập tên app / đối tác".into()),
            )]),
        );
    }

    let integration_type = normalize_integration_type(&parsed.integration_type);
    let api_key = db::random_api_key_id();
    let secret_key = parsed
        .secret_key
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| db::random_secret_key());

    match db::insert_oauth_client(
        &st.pool,
        &name,
        &api_key,
        &secret_key,
        ctx.tenant_id,
        &integration_type,
        ctx.user_id,
        parsed.rate_limit_per_min,
    )
    .await
    {
        Ok(id) => {
            if !parsed.route_ids.is_empty() {
                let _ =
                    db::set_client_key_routes(&st.pool, id, ctx.tenant_id, &parsed.route_ids).await;
            }
            spawn_reload_runtime_config();
            write_audit(
                &st.pool,
                &ctx,
                "create_client_key_encrypted",
                &name,
                "success",
                None,
                Some("rsa-envelope"),
            )
            .await;
            let purpose = integration_purpose_label(&integration_type).to_string();
            (
                StatusCode::CREATED,
                Json(CreateClientKeyResponse {
                    id,
                    name,
                    api_key,
                    secret_key,
                    auth: "oauth2",
                    integration_type: integration_type.clone(),
                    tenant_id: ctx.tenant_id,
                    purpose,
                }),
            )
                .into_response()
        }
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": format!("{e}") })),
        )
            .into_response(),
    }
}

async fn api_get_client_key(
    Extension(ctx): Extension<AdminCtx>,
    Path(id): Path<i64>,
) -> impl IntoResponse {
    if !admin_auth::can_view_client_keys(&ctx.role) {
        return admin_auth::forbidden_response();
    }
    let st = match STATE.get() {
        Some(s) => s.clone(),
        None => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": "state not initialized" })),
            )
                .into_response();
        }
    };
    if !ctx.is_admin() && !ctx.is_viewer() {
        if let Err(res) = ensure_client_key_manage_access(&st.pool, &ctx, id).await {
            return res;
        }
    }
    match db::fetch_client_key_meta_by_id(&st.pool, id, ctx.tenant_id).await {
        Ok(Some(row)) => Json(row).into_response(),
        Ok(None) => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({ "error": "client key not found" })),
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": format!("{e}") })),
        )
            .into_response(),
    }
}

async fn api_get_client_key_traffic(
    Extension(ctx): Extension<AdminCtx>,
    Path(id): Path<i64>,
    axum::extract::Query(query): axum::extract::Query<ClientKeyTrafficQuery>,
) -> impl IntoResponse {
    if !admin_auth::can_view_client_keys(&ctx.role) {
        return admin_auth::forbidden_response();
    }
    let st = match STATE.get() {
        Some(s) => s.clone(),
        None => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": "state not initialized" })),
            )
                .into_response();
        }
    };
    if !ctx.is_admin() && !ctx.is_viewer() {
        if let Err(res) = ensure_client_key_manage_access(&st.pool, &ctx, id).await {
            return res;
        }
    }
    let hours = query.hours.unwrap_or(24);
    match db::client_key_traffic_stats(&st.pool, ctx.tenant_id, id, hours).await {
        Ok(stats) => Json(stats).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": format!("{e}") })),
        )
            .into_response(),
    }
}

#[derive(Debug, serde::Deserialize)]
struct ClientKeyTrafficQuery {
    hours: Option<i32>,
}

async fn api_get_client_key_routes(
    Extension(ctx): Extension<AdminCtx>,
    Path(id): Path<i64>,
) -> impl IntoResponse {
    if !admin_auth::can_view_client_keys(&ctx.role) {
        return admin_auth::forbidden_response();
    }
    let st = match STATE.get() {
        Some(s) => s.clone(),
        None => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": "state not initialized" })),
            )
                .into_response();
        }
    };
    if !ctx.is_admin() && !ctx.is_viewer() {
        if let Err(res) = ensure_client_key_manage_access(&st.pool, &ctx, id).await {
            return res;
        }
    }
    match db::fetch_client_key_routes(&st.pool, id, ctx.tenant_id).await {
        Ok(Some(ids)) => Json(serde_json::json!({ "route_ids": ids })).into_response(),
        Ok(None) => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({ "error": "client key not found" })),
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": format!("{e}") })),
        )
            .into_response(),
    }
}

async fn api_routes_acl_summary(Extension(ctx): Extension<AdminCtx>) -> impl IntoResponse {
    let st = match STATE.get() {
        Some(s) => s.clone(),
        None => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": "state not initialized" })),
            )
                .into_response();
        }
    };
    match db::route_acl_summary(&st.pool, ctx.tenant_id).await {
        Ok(rows) => Json(rows).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": format!("{e}") })),
        )
            .into_response(),
    }
}

async fn api_route_clients(
    Extension(ctx): Extension<AdminCtx>,
    Path(id): Path<i64>,
) -> impl IntoResponse {
    let st = match STATE.get() {
        Some(s) => s.clone(),
        None => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": "state not initialized" })),
            )
                .into_response();
        }
    };
    let exists = db::fetch_route_by_id(&st.pool, id).await.ok().flatten();
    if exists.is_none() || exists.as_ref().map(|r| r.tenant_id) != Some(ctx.tenant_id) {
        return (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({ "error": "route not found" })),
        )
            .into_response();
    }
    match db::list_clients_for_route(&st.pool, id, ctx.tenant_id).await {
        Ok(rows) => Json(rows).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": format!("{e}") })),
        )
            .into_response(),
    }
}

async fn api_patch_client_key(
    Extension(ctx): Extension<AdminCtx>,
    Path(id): Path<i64>,
    Json(body): Json<PatchClientKeyBody>,
) -> impl IntoResponse {
    if !admin_auth::can_manage_client_keys(&ctx.role) {
        return admin_auth::forbidden_response();
    }
    let st = match STATE.get() {
        Some(s) => s.clone(),
        None => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": "state not initialized" })),
            )
                .into_response();
        }
    };
    if !ctx.is_admin() {
        match db::fetch_client_key_owner(&st.pool, id, ctx.tenant_id).await {
            Ok(Some(owner)) if owner == ctx.user_id => {}
            Ok(None) => {
                return (
                    StatusCode::NOT_FOUND,
                    Json(serde_json::json!({ "error": "client key not found" })),
                )
                    .into_response();
            }
            Ok(Some(_)) => return admin_auth::forbidden_response(),
            Err(e) => {
                return (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(serde_json::json!({ "error": format!("{e}") })),
                )
                    .into_response();
            }
        }
    }
    let mut fields = serde_json::Map::new();
    let name = body
        .name
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty());
    if body.name.is_some() && name.is_none() {
        fields.insert(
            "name".into(),
            serde_json::Value::String("Nhập tên client".into()),
        );
    }
    let status = body
        .status
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty());
    if let Some(s) = status {
        if s != "active" && s != "disabled" {
            fields.insert(
                "status".into(),
                serde_json::Value::String("status phải là active hoặc disabled".into()),
            );
        }
    }
    if let Some(rl) = body.rate_limit_per_min {
        if rl < 0 || rl > 1_000_000 {
            fields.insert(
                "rate_limit_per_min".into(),
                serde_json::Value::String("Rate limit phải từ 0 đến 1.000.000 req/min".into()),
            );
        }
    }
    if name.is_none() && status.is_none() && body.rate_limit_per_min.is_none() {
        fields.insert(
            "_form".into(),
            serde_json::Value::String("Gửi name, status và/hoặc rate_limit_per_min".into()),
        );
    }
    if !fields.is_empty() {
        return json_error_fields(
            StatusCode::BAD_REQUEST,
            "validation_failed",
            "Dữ liệu key không hợp lệ",
            fields,
        );
    }
    match db::update_client_key_registry(
        &st.pool,
        id,
        ctx.tenant_id,
        name,
        status,
        body.rate_limit_per_min,
    )
    .await
    {
        Ok(0) => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({ "error": "client key not found" })),
        )
            .into_response(),
        Ok(_) => {
            spawn_reload_runtime_config();
            write_audit(
                &st.pool,
                &ctx,
                "update_client_key",
                &format!("key:{id}"),
                "success",
                None,
                name.or(status),
            )
            .await;
            StatusCode::NO_CONTENT.into_response()
        }
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": format!("{e}") })),
        )
            .into_response(),
    }
}

#[derive(Debug, Deserialize)]
struct PatchClientKeyBody {
    name: Option<String>,
    status: Option<String>,
    rate_limit_per_min: Option<i32>,
}

#[derive(Debug, Deserialize)]
struct PutClientKeyRoutesBody {
    route_ids: Vec<i64>,
}

async fn api_put_client_key_routes(
    Extension(ctx): Extension<AdminCtx>,
    Path(id): Path<i64>,
    Json(body): Json<PutClientKeyRoutesBody>,
) -> impl IntoResponse {
    if !admin_auth::can_manage_client_keys(&ctx.role) {
        return admin_auth::forbidden_response();
    }
    let st = match STATE.get() {
        Some(s) => s.clone(),
        None => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": "state not initialized" })),
            )
                .into_response();
        }
    };
    if !ctx.is_admin() {
        match db::fetch_client_key_owner(&st.pool, id, ctx.tenant_id).await {
            Ok(Some(owner)) if owner == ctx.user_id => {}
            Ok(None) => {
                return (
                    StatusCode::NOT_FOUND,
                    Json(serde_json::json!({ "error": "client key not found" })),
                )
                    .into_response();
            }
            Ok(Some(_)) => return admin_auth::forbidden_response(),
            Err(e) => {
                return (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(serde_json::json!({ "error": format!("{e}") })),
                )
                    .into_response();
            }
        }
    }
    match db::set_client_key_routes(&st.pool, id, ctx.tenant_id, &body.route_ids).await {
        Ok(false) => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({ "error": "client key not found" })),
        )
            .into_response(),
        Ok(true) => {
            spawn_reload_runtime_config();
            let detail = if body.route_ids.is_empty() {
                "ACL rỗng — mọi route".to_string()
            } else {
                match db::fetch_route_paths_for_ids(&st.pool, ctx.tenant_id, &body.route_ids).await
                {
                    Ok(paths) if !paths.is_empty() => format!("ACL: {}", paths.join(", ")),
                    _ => format!(
                        "ACL ids: {}",
                        body.route_ids
                            .iter()
                            .map(|i| i.to_string())
                            .collect::<Vec<_>>()
                            .join(", ")
                    ),
                }
            };
            write_audit(
                &st.pool,
                &ctx,
                "update_client_key_routes",
                &format!("key:{id}"),
                "success",
                None,
                Some(&detail),
            )
            .await;
            Json(serde_json::json!({ "route_ids": body.route_ids })).into_response()
        }
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": format!("{e}") })),
        )
            .into_response(),
    }
}

#[derive(Debug, Serialize)]
struct RotateClientKeyResponse {
    api_key: String,
    secret_key: String,
    auth: &'static str,
}

#[derive(Debug, Deserialize)]
struct BulkClientKeyStatusBody {
    ids: Vec<i64>,
    status: String,
}

async fn api_bulk_client_key_status(
    Extension(ctx): Extension<AdminCtx>,
    Json(body): Json<BulkClientKeyStatusBody>,
) -> impl IntoResponse {
    if !admin_auth::can_manage_client_keys(&ctx.role) {
        return admin_auth::forbidden_response();
    }
    let st = match STATE.get() {
        Some(s) => s.clone(),
        None => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": "state not initialized" })),
            )
                .into_response();
        }
    };
    let status = body.status.trim().to_ascii_lowercase();
    if status != "active" && status != "disabled" {
        return json_error_fields(
            StatusCode::BAD_REQUEST,
            "validation_failed",
            "status phải là active hoặc disabled",
            serde_json::Map::from_iter([(
                "status".into(),
                serde_json::Value::String("active | disabled".into()),
            )]),
        );
    }
    let ids: Vec<i64> = body.ids.into_iter().filter(|id| *id > 0).collect();
    if ids.is_empty() {
        return json_error_fields(
            StatusCode::BAD_REQUEST,
            "validation_failed",
            "Chọn ít nhất một client",
            serde_json::Map::from_iter([(
                "ids".into(),
                serde_json::Value::String("Danh sách id không được rỗng".into()),
            )]),
        );
    }
    if ids.len() > 200 {
        return json_error_fields(
            StatusCode::BAD_REQUEST,
            "validation_failed",
            "Tối đa 200 client mỗi lần",
            serde_json::Map::from_iter([(
                "ids".into(),
                serde_json::Value::String("Giảm số lượng client".into()),
            )]),
        );
    }
    let owner_only = if ctx.is_admin() {
        None
    } else {
        Some(ctx.user_id)
    };
    match db::bulk_update_client_key_status(&st.pool, ctx.tenant_id, &ids, &status, owner_only)
        .await
    {
        Ok(updated) => {
            if updated > 0 {
                spawn_reload_runtime_config();
            }
            write_audit(
                &st.pool,
                &ctx,
                "bulk_update_client_key_status",
                &format!("count:{updated}"),
                "success",
                None,
                Some(&format!("status:{status}")),
            )
            .await;
            Json(serde_json::json!({ "updated": updated })).into_response()
        }
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": format!("{e}") })),
        )
            .into_response(),
    }
}

async fn api_rotate_client_key(
    Extension(ctx): Extension<AdminCtx>,
    Path(id): Path<i64>,
) -> impl IntoResponse {
    if !admin_auth::can_manage_client_keys(&ctx.role) {
        return admin_auth::forbidden_response();
    }
    let st = match STATE.get() {
        Some(s) => s.clone(),
        None => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": "state not initialized" })),
            )
                .into_response();
        }
    };
    if let Err(res) = ensure_client_key_manage_access(&st.pool, &ctx, id).await {
        return res;
    }
    let secret_key = db::random_secret_key();
    // Ghi PG — routes CRUD hoặc client key tạo/rotate (+ACL)
    match db::rotate_client_key_secret(&st.pool, id, ctx.tenant_id, &secret_key).await {
        Ok(Some(api_key)) => {
            let _ = db::bump_client_token_version(&st.pool, id, ctx.tenant_id).await;
            spawn_reload_runtime_config();
            // Audit create/update/delete_route hoặc create/rotate_client_key
            write_audit(
                &st.pool,
                &ctx,
                "rotate_client_key",
                &format!("key:{id}"),
                "success",
                None,
                None,
            )
            .await;
            // 201/200/204 (secret chỉ trả một lần nếu ACL)
            (
                StatusCode::OK,
                Json(RotateClientKeyResponse {
                    api_key,
                    secret_key,
                    auth: "oauth2",
                }),
            )
                .into_response()
        }
        Ok(None) => (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({
                "error": "rotate_not_supported",
                "message": "Chỉ OAuth client (avaso_cid_* / legacy avaso_pk_*) mới rotate secret"
            })),
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": format!("{e}") })),
        )
            .into_response(),
    }
}

async fn api_delete_client_key(
    Extension(ctx): Extension<AdminCtx>,
    Path(id): Path<i64>,
) -> impl IntoResponse {
    if !admin_auth::can_manage_client_keys(&ctx.role) {
        return admin_auth::forbidden_response();
    }
    let st = match STATE.get() {
        Some(s) => s.clone(),
        None => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": "state not initialized" })),
            )
                .into_response();
        }
    };
    if !ctx.is_admin() {
        match db::fetch_client_key_owner(&st.pool, id, ctx.tenant_id).await {
            Ok(Some(owner)) if owner == ctx.user_id => {}
            Ok(None) => {
                return (
                    StatusCode::NOT_FOUND,
                    Json(serde_json::json!({ "error": "client key not found" })),
                )
                    .into_response();
            }
            Ok(Some(_)) => return admin_auth::forbidden_response(),
            Err(e) => {
                return (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(serde_json::json!({ "error": format!("{e}") })),
                )
                    .into_response();
            }
        }
    }
    match db::delete_client_key(&st.pool, id, ctx.tenant_id).await {
        Ok(0) => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({ "error": "client key not found" })),
        )
            .into_response(),
        Ok(_) => {
            let _ = reload_runtime_config().await;
            write_audit(
                &st.pool,
                &ctx,
                "delete_client_key",
                &format!("key:{id}"),
                "success",
                None,
                None,
            )
            .await;
            StatusCode::NO_CONTENT.into_response()
        }
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": format!("{e}") })),
        )
            .into_response(),
    }
}

fn normalize_user_role(raw: &str) -> Option<String> {
    let r = raw.trim().to_ascii_lowercase();
    match r.as_str() {
        "admin" | "operator" | "viewer" => Some(r),
        _ => None,
    }
}

#[derive(Debug, Deserialize)]
struct CreateUserBody {
    username: String,
    password: String,
    role: String,
    email: Option<String>,
}

#[derive(Debug, Deserialize)]
struct UpdateUserBody {
    username: String,
    role: String,
    #[serde(default = "default_user_active")]
    is_active: bool,
    password: Option<String>,
    /// Bắt buộc khi tự đổi mật khẩu (id == session user). Admin đổi user khác không cần.
    current_password: Option<String>,
    email: Option<String>,
}

fn parse_optional_email_field(
    raw: &Option<String>,
) -> Result<Option<Option<String>>, serde_json::Map<String, serde_json::Value>> {
    let Some(s) = raw else {
        return Ok(None);
    };
    let t = s.trim();
    if t.is_empty() {
        return Ok(Some(None));
    }
    match password_reset::normalize_email(t) {
        Some(em) => Ok(Some(Some(em))),
        None => {
            let mut fields = serde_json::Map::new();
            fields.insert(
                "email".into(),
                serde_json::Value::String("Email không hợp lệ".into()),
            );
            Err(fields)
        }
    }
}

fn default_user_active() -> bool {
    true
}

async fn api_list_users(
    Extension(ctx): Extension<AdminCtx>,
    axum::extract::Query(pq): axum::extract::Query<PaginationQuery>,
) -> impl IntoResponse {
    let st = match STATE.get() {
        Some(s) => s.clone(),
        None => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": "state not initialized" })),
            )
                .into_response();
        }
    };
    match db::list_dashboard_users_for_tenant(&st.pool, ctx.tenant_id).await {
        Ok(rows) => {
            let offset = pq.offset.unwrap_or(0);
            let limit = pq.limit.unwrap_or(500).min(1000);
            let page: Vec<_> = rows.into_iter().skip(offset).take(limit).collect();
            Json(page).into_response()
        }
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": format!("{e}") })),
        )
            .into_response(),
    }
}

async fn api_create_user(
    Extension(ctx): Extension<AdminCtx>,
    Json(body): Json<CreateUserBody>,
) -> impl IntoResponse {
    let st = match STATE.get() {
        Some(s) => s.clone(),
        None => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": "state not initialized" })),
            )
                .into_response();
        }
    };
    let username = body.username.trim();
    let pass = body.password.trim();
    let mut fields = serde_json::Map::new();
    if username.is_empty() {
        fields.insert(
            "username".into(),
            serde_json::Value::String("Nhập username".into()),
        );
    }
    if pass.len() < 6 {
        fields.insert(
            "password".into(),
            serde_json::Value::String("Mật khẩu tối thiểu 6 ký tự".into()),
        );
    }
    if !fields.is_empty() {
        return json_error_fields(
            StatusCode::BAD_REQUEST,
            "validation_failed",
            "Dữ liệu user không hợp lệ",
            fields,
        );
    }
    let Some(role) = normalize_user_role(&body.role) else {
        fields.insert(
            "role".into(),
            serde_json::Value::String("Chọn admin, operator hoặc viewer".into()),
        );
        return json_error_fields(
            StatusCode::BAD_REQUEST,
            "invalid_role",
            "Dữ liệu user không hợp lệ",
            fields,
        );
    };
    let password_hash = match db::hash_password(pass) {
        Ok(h) => h,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": format!("hash: {e}") })),
            )
                .into_response();
        }
    };
    let email_patch = match parse_optional_email_field(&body.email) {
        Ok(v) => v,
        Err(fields) => {
            return json_error_fields(
                StatusCode::BAD_REQUEST,
                "validation_failed",
                "Dữ liệu user không hợp lệ",
                fields,
            );
        }
    };
    if let Some(Some(ref em)) = email_patch {
        match db::admin_email_taken(&st.pool, em, 0).await {
            Ok(true) => {
                fields.insert(
                    "email".into(),
                    serde_json::Value::String("Email đã tồn tại".into()),
                );
                return json_error_fields(
                    StatusCode::CONFLICT,
                    "email_taken",
                    "Email đã được dùng",
                    fields,
                );
            }
            Ok(false) => {}
            Err(e) => {
                return (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(serde_json::json!({ "error": format!("{e}") })),
                )
                    .into_response();
            }
        }
    }
    let tenant_id = ctx.tenant_id;
    if tenant_id <= 0 {
        return json_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "internal_error",
            "tenant_id không hợp lệ",
        );
    }
    let email_ins = email_patch.as_ref().and_then(|o| o.as_deref());
    match db::insert_admin_user(
        &st.pool,
        username,
        &password_hash,
        &role,
        tenant_id,
        email_ins,
    )
    .await
    {
        Ok(id) => {
            if role == "admin" {
                let _ = integrations::ensure_integration_rows(&st.pool, tenant_id).await;
            }
            write_audit(
                &st.pool,
                &ctx,
                "create_user",
                username,
                "success",
                None,
                Some(&role),
            )
            .await;
            match db::fetch_dashboard_user_public_by_id(&st.pool, id).await {
                Ok(Some(u)) => return (StatusCode::CREATED, Json(u)).into_response(),
                Ok(None) => {}
                Err(e) => {
                    tracing::warn!(error = %e, user_id = id, "fetch created user failed");
                }
            }
            (
                StatusCode::CREATED,
                Json(serde_json::json!({ "id": id, "username": username, "role": role })),
            )
                .into_response()
        }
        Err(e) => {
            if let sqlx::Error::Database(ref d) = e {
                if d.is_unique_violation() {
                    fields.insert(
                        "username".into(),
                        serde_json::Value::String("Username đã tồn tại".into()),
                    );
                    return json_error_fields(
                        StatusCode::CONFLICT,
                        "username_exists",
                        "Username đã được dùng",
                        fields,
                    );
                }
            }
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": format!("{e}") })),
            )
                .into_response()
        }
    }
}

async fn api_update_user(
    Extension(ctx): Extension<AdminCtx>,
    Path(id): Path<i64>,
    Json(body): Json<UpdateUserBody>,
) -> impl IntoResponse {
    let st = match STATE.get() {
        Some(s) => s.clone(),
        None => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": "state not initialized" })),
            )
                .into_response();
        }
    };
    if id == ctx.user_id && !body.is_active {
        return json_error(
            StatusCode::BAD_REQUEST,
            "cannot_disable_self",
            "Không thể tự vô hiệu hóa tài khoản đang đăng nhập",
        );
    }
    let username = body.username.trim();
    let mut fields = serde_json::Map::new();
    if username.is_empty() {
        fields.insert(
            "username".into(),
            serde_json::Value::String("Nhập username".into()),
        );
    }
    let role = normalize_user_role(&body.role);
    if role.is_none() {
        fields.insert(
            "role".into(),
            serde_json::Value::String("Chọn admin, operator hoặc viewer".into()),
        );
    }
    if !fields.is_empty() {
        return json_error_fields(
            StatusCode::BAD_REQUEST,
            "validation_failed",
            "Dữ liệu user không hợp lệ",
            fields,
        );
    }
    let role = role.unwrap();
    let Some(target) = db::fetch_admin_user_by_id_any(&st.pool, id)
        .await
        .ok()
        .flatten()
    else {
        return (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({ "error": "user_not_found" })),
        )
            .into_response();
    };
    let target_tenant = target.tenant_id.unwrap_or(1);
    if target_tenant != ctx.tenant_id {
        return json_error(
            StatusCode::FORBIDDEN,
            "forbidden",
            "User không thuộc workspace — không thể sửa",
        );
    }
    let existing = Some(target);
    let current_role = existing
        .as_ref()
        .and_then(|u| normalize_user_role(&u.role))
        .unwrap_or_else(|| role.clone());

    // Không cho tự đổi role của chính mình.
    if id == ctx.user_id && role != current_role {
        return json_error_fields(
            StatusCode::FORBIDDEN,
            "cannot_change_own_role",
            "Không thể tự đổi quyền của chính mình",
            serde_json::Map::from_iter([(
                "role".into(),
                serde_json::Value::String("Không thể tự đổi quyền của chính mình".into()),
            )]),
        );
    }

    // Không hạ/xóa quyền admin cuối cùng trong workspace.
    let demoting_admin = current_role == "admin" && role != "admin";
    let disabling_admin = current_role == "admin" && !body.is_active;
    if demoting_admin || disabling_admin {
        match db::count_active_admins_in_tenant(&st.pool, target_tenant).await {
            Ok(n) if n <= 1 => {
                return json_error_fields(
                    StatusCode::BAD_REQUEST,
                    "cannot_demote_last_admin",
                    "Không thể hạ/vô hiệu hóa admin cuối cùng",
                    serde_json::Map::from_iter([(
                        "role".into(),
                        serde_json::Value::String("Cần ít nhất một admin đang hoạt động".into()),
                    )]),
                );
            }
            Ok(_) => {}
            Err(e) => {
                return (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(serde_json::json!({ "error": format!("{e}") })),
                )
                    .into_response();
            }
        }
    }

    let changing_own_password = id == ctx.user_id;
    let pass_hash = if let Some(ref p) = body.password {
        let t = p.trim();
        if t.is_empty() {
            None
        } else if t.len() < 6 {
            fields.insert(
                "password".into(),
                serde_json::Value::String("Mật khẩu tối thiểu 6 ký tự".into()),
            );
            return json_error_fields(
                StatusCode::BAD_REQUEST,
                "password_too_short",
                "Dữ liệu user không hợp lệ",
                fields,
            );
        } else {
            if changing_own_password {
                let current = body.current_password.as_deref().unwrap_or("").trim();
                if current.is_empty() {
                    fields.insert(
                        "current_password".into(),
                        serde_json::Value::String("Nhập mật khẩu hiện tại để xác nhận".into()),
                    );
                    return json_error_fields(
                        StatusCode::BAD_REQUEST,
                        "validation_failed",
                        "Dữ liệu user không hợp lệ",
                        fields,
                    );
                }
                let row = existing.as_ref().expect("target user loaded");
                if !db::verify_password(current, &row.password_hash) {
                    return json_error_fields(
                        StatusCode::BAD_REQUEST,
                        "invalid_current_password",
                        "Mật khẩu hiện tại không đúng",
                        serde_json::Map::from_iter([(
                            "current_password".into(),
                            serde_json::Value::String("Mật khẩu hiện tại không đúng".into()),
                        )]),
                    );
                }
            }
            match db::hash_password(t) {
                Ok(h) => Some(h),
                Err(e) => {
                    return (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        Json(serde_json::json!({ "error": format!("{e}") })),
                    )
                        .into_response();
                }
            }
        }
    } else {
        None
    };
    let email_patch = match parse_optional_email_field(&body.email) {
        Ok(v) => v,
        Err(fields) => {
            return json_error_fields(
                StatusCode::BAD_REQUEST,
                "validation_failed",
                "Dữ liệu user không hợp lệ",
                fields,
            );
        }
    };
    if let Some(Some(ref em)) = email_patch {
        match db::admin_email_taken(&st.pool, em, id).await {
            Ok(true) => {
                return json_error_fields(
                    StatusCode::CONFLICT,
                    "email_taken",
                    "Email đã được dùng",
                    serde_json::Map::from_iter([(
                        "email".into(),
                        serde_json::Value::String("Email đã tồn tại".into()),
                    )]),
                );
            }
            Ok(false) => {}
            Err(e) => {
                return (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(serde_json::json!({ "error": format!("{e}") })),
                )
                    .into_response();
            }
        }
    }
    let email_db: Option<Option<&str>> = email_patch.as_ref().map(|o| o.as_deref());
    match db::update_admin_user(
        &st.pool,
        id,
        target_tenant,
        username,
        &role,
        body.is_active,
        email_db,
        pass_hash.as_deref(),
    )
    .await
    {
        Ok(0) => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({ "error": "user_not_found" })),
        )
            .into_response(),
        Ok(_) => {
            let should_revoke = pass_hash.is_some()
                || !body.is_active
                || existing
                    .as_ref()
                    .map(|u| normalize_user_role(&u.role).as_deref() != Some(role.as_str()))
                    .unwrap_or(false);
            if should_revoke {
                if let Err(e) = st.session_store.revoke_all_for_user(id).await {
                    tracing::warn!(error = %e, user_id = id, "revoke sessions after user update failed");
                }
            }
            write_audit(
                &st.pool,
                &ctx,
                "update_user",
                username,
                "success",
                None,
                Some(&role),
            )
            .await;
            match db::fetch_dashboard_user_public(&st.pool, id, target_tenant).await {
                Ok(Some(u)) => return (StatusCode::OK, Json(u)).into_response(),
                Ok(None) => {
                    tracing::error!(
                        user_id = id,
                        tenant_id = target_tenant,
                        "update_user: row missing after update"
                    );
                    return json_error(
                        StatusCode::INTERNAL_SERVER_ERROR,
                        "internal_error",
                        "Đã cập nhật nhưng không đọc lại được user — thử tải lại trang",
                    );
                }
                Err(e) => {
                    tracing::error!(error = %e, user_id = id, "fetch user after update failed");
                    return json_error(
                        StatusCode::INTERNAL_SERVER_ERROR,
                        "internal_error",
                        &format!("{e}"),
                    );
                }
            }
        }
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": format!("{e}") })),
        )
            .into_response(),
    }
}

async fn api_delete_user(
    Extension(ctx): Extension<AdminCtx>,
    Path(id): Path<i64>,
) -> impl IntoResponse {
    let st = match STATE.get() {
        Some(s) => s.clone(),
        None => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": "state not initialized" })),
            )
                .into_response();
        }
    };
    if id == ctx.user_id {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": "cannot_delete_self" })),
        )
            .into_response();
    }
    if let Some(target) = db::fetch_admin_user_by_id_any(&st.pool, id)
        .await
        .ok()
        .flatten()
    {
        let target_tenant = target.tenant_id.unwrap_or(1);
        if target_tenant == ctx.tenant_id
            && normalize_user_role(&target.role).as_deref() == Some("admin")
            && target.is_active != 0
        {
            match db::count_active_admins_in_tenant(&st.pool, target_tenant).await {
                Ok(n) if n <= 1 => {
                    return json_error(
                        StatusCode::BAD_REQUEST,
                        "cannot_delete_last_admin",
                        "Không thể xóa admin cuối cùng",
                    );
                }
                Ok(_) => {}
                Err(e) => {
                    return (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        Json(serde_json::json!({ "error": format!("{e}") })),
                    )
                        .into_response();
                }
            }
        }
    }
    match db::delete_admin_user(&st.pool, id, ctx.tenant_id).await {
        Ok(0) => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({ "error": "user_not_found" })),
        )
            .into_response(),
        Ok(_) => {
            if let Err(e) = st.session_store.revoke_all_for_user(id).await {
                tracing::warn!(error = %e, user_id = id, "revoke sessions after user delete failed");
            }
            write_audit(
                &st.pool,
                &ctx,
                "delete_user",
                &format!("user:{id}"),
                "success",
                None,
                None,
            )
            .await;
            StatusCode::NO_CONTENT.into_response()
        }
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": format!("{e}") })),
        )
            .into_response(),
    }
}

async fn api_list_proxy_queue(Extension(ctx): Extension<AdminCtx>) -> impl IntoResponse {
    let Some(st) = STATE.get() else {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": "state not initialized" })),
        )
            .into_response();
    };
    let items = st.proxy_queue.list(ctx.tenant_id).await;
    Json(items).into_response()
}

async fn api_retry_proxy_queue(
    Extension(ctx): Extension<AdminCtx>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    // POST /api/proxy-queue/{id}/retry
    let Some(st) = STATE.get() else {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": "state not initialized" })),
        )
            .into_response();
    };
    let Some(item) = st.proxy_queue.fetch_for_retry(ctx.tenant_id, &id).await else {
        return (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({ "error": "not_found", "message": "Queue item không tồn tại hoặc đã replay" })),
        )
            .into_response();
    };
    let route = match db::fetch_route_by_id(&st.pool, item.route_id).await {
        Ok(Some(r)) if r.tenant_id == ctx.tenant_id => r,
        _ => {
            return (
                StatusCode::NOT_FOUND,
                Json(serde_json::json!({ "error": "route_not_found" })),
            )
                .into_response();
        }
    };
    let timeout = route.timeout_secs.max(1) as u64;
    match proxy_ext::replay_queue_item(&st.http, &item, timeout).await {
        Ok((status, body)) if status.is_success() => {
            st.proxy_queue.mark_replayed(ctx.tenant_id, &id).await;
            write_audit(
                &st.pool,
                &ctx,
                "proxy_queue_retry",
                &item.path,
                if status.is_success() {
                    "success"
                } else {
                    "failure"
                },
                None,
                Some(&format!("status={}", status.as_u16())),
            )
            .await;
            // 200 retried
            (
                StatusCode::OK,
                Json(serde_json::json!({
                    "status": "retried",
                    "upstream_status": status.as_u16(),
                    "body_preview": String::from_utf8_lossy(&body[..body.len().min(500)]),
                })),
            )
                .into_response()
        }
        Ok((status, body)) => {
            let next = item.retry_attempts + 1;
            st.proxy_queue
                .record_retry_failure(ctx.tenant_id, &id, next)
                .await;
            write_audit(
                &st.pool,
                &ctx,
                "proxy_queue_retry",
                &item.path,
                "failure",
                None,
                Some(&format!("status={}", status.as_u16())),
            )
            .await;
            // 502 retry_failed
            (
                StatusCode::BAD_GATEWAY,
                Json(serde_json::json!({
                    "error": "retry_failed",
                    "message": format!("upstream HTTP {}", status.as_u16()),
                    "body_preview": String::from_utf8_lossy(&body[..body.len().min(500)]),
                })),
            )
                .into_response()
        }
        Err(e) => {
            let next = item.retry_attempts + 1;
            st.proxy_queue
                .record_retry_failure(ctx.tenant_id, &id, next)
                .await;
            // 502 retry_failed
            (
                StatusCode::BAD_GATEWAY,
                Json(serde_json::json!({ "error": "retry_failed", "message": e })),
            )
                .into_response()
        }
    }
}

#[derive(Deserialize)]
struct BulkProxyQueueDeleteBody {
    ids: Vec<String>,
}

async fn api_bulk_delete_proxy_queue(
    Extension(ctx): Extension<AdminCtx>,
    Json(body): Json<BulkProxyQueueDeleteBody>,
) -> impl IntoResponse {
    let Some(st) = STATE.get() else {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": "state not initialized" })),
        )
            .into_response();
    };
    let ids: Vec<String> = body
        .ids
        .into_iter()
        .map(|id| id.trim().to_string())
        .filter(|id| !id.is_empty())
        .collect();
    if ids.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({
                "error": "validation_failed",
                "message": "Chọn ít nhất một bản ghi"
            })),
        )
            .into_response();
    }
    let summaries = st
        .proxy_queue
        .fetch_discard_summaries(ctx.tenant_id, &ids)
        .await;
    let deleted = st.proxy_queue.remove_many(ctx.tenant_id, &ids).await;
    if deleted > 0 {
        let detail_lines: Vec<String> = if summaries.is_empty() {
            vec![format!("(không đọc được method/path trước khi xóa)")]
        } else {
            summaries
                .iter()
                .map(|(method, path, reason)| {
                    let r = if reason.is_empty() {
                        "—"
                    } else {
                        reason.as_str()
                    };
                    format!("{method} {path} · {r}")
                })
                .collect()
        };
        let details = format!(
            "Đã xóa {deleted}/{} bản ghi Proxy Queue (DLQ)\n{}",
            ids.len(),
            detail_lines.join("\n")
        );
        write_audit(
            &st.pool,
            &ctx,
            "proxy_queue_bulk_discard",
            "proxy_queue",
            "success",
            None,
            Some(&details),
        )
        .await;
    }
    Json(serde_json::json!({ "deleted": deleted })).into_response()
}

async fn api_delete_proxy_queue(
    Extension(ctx): Extension<AdminCtx>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    let Some(st) = STATE.get() else {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": "state not initialized" })),
        )
            .into_response();
    };
    let summary = st
        .proxy_queue
        .fetch_discard_summaries(ctx.tenant_id, &[id.clone()])
        .await
        .into_iter()
        .next();
    if st.proxy_queue.remove(ctx.tenant_id, &id).await {
        let details = match summary {
            Some((method, path, reason)) => {
                let r = if reason.is_empty() {
                    "—"
                } else {
                    reason.as_str()
                };
                format!("Đã xóa 1 bản ghi Proxy Queue (DLQ)\n{method} {path} · {r}")
            }
            None => "Đã xóa 1 bản ghi Proxy Queue (DLQ)".to_string(),
        };
        write_audit(
            &st.pool,
            &ctx,
            "proxy_queue_discard",
            "proxy_queue",
            "success",
            None,
            Some(&details),
        )
        .await;
        Json(serde_json::json!({ "status": "discarded" })).into_response()
    } else {
        (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({ "error": "not_found" })),
        )
            .into_response()
    }
}

async fn api_list_audit_logs(
    Extension(ctx): Extension<AdminCtx>,
    axum::extract::Query(query): axum::extract::Query<AuditLogsQuery>,
) -> impl IntoResponse {
    let st = match STATE.get() {
        Some(s) => s.clone(),
        None => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": "state not initialized" })),
            )
                .into_response();
        }
    };
    let limit = query.limit.unwrap_or(100);
    match db::list_audit_logs_filtered(
        &st.pool,
        ctx.tenant_id,
        limit,
        query.result.as_deref(),
        query.search.as_deref(),
        query.date_from.as_deref(),
        query.date_to.as_deref(),
        query.before_id,
    )
    .await
    {
        Ok(rows) => Json(rows).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": format!("{e}") })),
        )
            .into_response(),
    }
}

#[derive(Debug, serde::Deserialize)]
struct AuditLogsQuery {
    limit: Option<i64>,
    result: Option<String>,
    search: Option<String>,
    date_from: Option<String>,
    date_to: Option<String>,
    before_id: Option<i64>,
}

#[derive(Debug, serde::Deserialize)]
struct TransactionLogsQuery {
    limit: Option<i64>,
    method: Option<String>,
    status: Option<String>,
    outcome: Option<String>,
    search: Option<String>,
    reason: Option<String>,
    client_key_id: Option<i64>,
    date_from: Option<String>,
    date_to: Option<String>,
    before_id: Option<i64>,
}

fn status_filter_range(status: Option<&str>) -> (Option<i64>, Option<i64>) {
    match status.filter(|s| !s.is_empty() && *s != "all") {
        Some("2xx") => (Some(200), Some(300)),
        Some("4xx") => (Some(400), Some(500)),
        Some("5xx") => (Some(500), Some(600)),
        _ => (None, None),
    }
}

async fn api_list_transaction_logs(
    Extension(ctx): Extension<AdminCtx>,
    axum::extract::Query(query): axum::extract::Query<TransactionLogsQuery>,
) -> impl IntoResponse {
    let st = match STATE.get() {
        Some(s) => s.clone(),
        None => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": "state not initialized" })),
            )
                .into_response();
        }
    };
    let limit = query.limit.unwrap_or(200);
    let (status_min, status_max) = status_filter_range(query.status.as_deref());
    match db::list_transaction_logs(
        &st.pool,
        ctx.tenant_id,
        limit,
        query.method.as_deref(),
        status_min,
        status_max,
        query.outcome.as_deref(),
        query.search.as_deref(),
        query.reason.as_deref(),
        query.client_key_id,
        query.date_from.as_deref(),
        query.date_to.as_deref(),
        query.before_id,
        ctx.is_admin(),
    )
    .await
    {
        Ok(rows) => Json(rows).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": format!("{e}") })),
        )
            .into_response(),
    }
}

async fn api_get_transaction_detail(
    Extension(ctx): Extension<AdminCtx>,
    axum::extract::Path(id): axum::extract::Path<i64>,
) -> impl IntoResponse {
    let st = match STATE.get() {
        Some(s) => s.clone(),
        None => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": "state not initialized" })),
            )
                .into_response();
        }
    };
    match db::get_transaction_detail(&st.pool, ctx.tenant_id, id, ctx.is_admin()).await {
        Ok(Some(row)) => Json(row).into_response(),
        Ok(None) => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({ "error": "not_found" })),
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": format!("{e}") })),
        )
            .into_response(),
    }
}

async fn api_list_integrations(Extension(ctx): Extension<AdminCtx>) -> impl IntoResponse {
    if !ctx.is_admin() {
        return audit_admin_denied(&ctx, "integrations").await;
    }
    integrations::api_list_integrations(&ctx).await
}

async fn api_integrations_setup_hints(Extension(ctx): Extension<AdminCtx>) -> impl IntoResponse {
    if !ctx.is_admin() {
        return audit_admin_denied(&ctx, "integrations/setup-hints").await;
    }
    integrations::api_integrations_setup_hints(&ctx).await
}

async fn audit_admin_denied(ctx: &AdminCtx, resource: &str) -> Response {
    if let Some(st) = STATE.get() {
        write_audit_failure(
            &st.pool,
            ctx,
            "admin_only",
            resource,
            ctx.client_ip.as_deref(),
            Some("forbidden"),
        )
        .await;
    }
    admin_auth::forbidden_response()
}

async fn api_salesforce_connect(Extension(ctx): Extension<AdminCtx>) -> impl IntoResponse {
    if !ctx.is_admin() {
        return audit_admin_denied(&ctx, "integrations/salesforce/connect").await;
    }
    integrations::api_salesforce_connect(&ctx).await
}

async fn api_salesforce_callback(
    headers: HeaderMap,
    query: axum::extract::Query<integrations::SfCallbackQuery>,
) -> impl IntoResponse {
    integrations::api_salesforce_callback(headers, query).await
}

async fn api_salesforce_test(Extension(ctx): Extension<AdminCtx>) -> impl IntoResponse {
    if !ctx.is_admin() {
        return audit_admin_denied(&ctx, "integrations/salesforce/test").await;
    }
    integrations::api_salesforce_test(&ctx).await
}

async fn api_salesforce_sync(Extension(ctx): Extension<AdminCtx>) -> impl IntoResponse {
    if !ctx.is_admin() {
        return audit_admin_denied(&ctx, "integrations/salesforce/sync").await;
    }
    integrations::api_salesforce_sync(&ctx).await
}

async fn api_salesforce_disconnect(Extension(ctx): Extension<AdminCtx>) -> impl IntoResponse {
    if !ctx.is_admin() {
        return audit_admin_denied(&ctx, "integrations/salesforce/disconnect").await;
    }
    integrations::api_salesforce_disconnect(&ctx).await
}

async fn api_salesforce_config_get(Extension(ctx): Extension<AdminCtx>) -> impl IntoResponse {
    if !ctx.is_admin() {
        return audit_admin_denied(&ctx, "integrations/salesforce/config").await;
    }
    integrations::api_salesforce_config_get(&ctx).await
}

async fn api_salesforce_config_put(
    Extension(ctx): Extension<AdminCtx>,
    Json(body): Json<integrations::SalesforceProviderConfigWriteBody>,
) -> impl IntoResponse {
    if !ctx.is_admin() {
        return audit_admin_denied(&ctx, "integrations/salesforce/config").await;
    }
    integrations::api_salesforce_config_put(&ctx, body).await
}

async fn api_zoho_connect(Extension(ctx): Extension<AdminCtx>) -> impl IntoResponse {
    if !ctx.is_admin() {
        return audit_admin_denied(&ctx, "integrations/zoho/connect").await;
    }
    integrations::api_zoho_connect(&ctx).await
}

async fn api_zoho_callback(
    headers: HeaderMap,
    query: axum::extract::Query<integrations::SfCallbackQuery>,
) -> impl IntoResponse {
    integrations::api_zoho_callback(headers, query).await
}

async fn api_zoho_test(Extension(ctx): Extension<AdminCtx>) -> impl IntoResponse {
    if !ctx.is_admin() {
        return audit_admin_denied(&ctx, "integrations/zoho/test").await;
    }
    integrations::api_zoho_test(&ctx).await
}

async fn api_zoho_config_get(Extension(ctx): Extension<AdminCtx>) -> impl IntoResponse {
    if !ctx.is_admin() {
        return audit_admin_denied(&ctx, "integrations/zoho/config").await;
    }
    integrations::api_zoho_config_get(&ctx).await
}

async fn api_zoho_config_put(
    Extension(ctx): Extension<AdminCtx>,
    Json(body): Json<integrations::ZohoProviderConfigWriteBody>,
) -> impl IntoResponse {
    if !ctx.is_admin() {
        return audit_admin_denied(&ctx, "integrations/zoho/config").await;
    }
    integrations::api_zoho_config_put(&ctx, body).await
}

async fn api_zoho_projects(Extension(ctx): Extension<AdminCtx>) -> impl IntoResponse {
    if !ctx.is_admin() {
        return audit_admin_denied(&ctx, "integrations/zoho/projects").await;
    }
    integrations::api_zoho_projects(&ctx).await
}

async fn api_zoho_tasks(
    Extension(ctx): Extension<AdminCtx>,
    axum::extract::Query(query): axum::extract::Query<integrations::ZohoTasksQuery>,
) -> impl IntoResponse {
    if !ctx.is_admin() {
        return audit_admin_denied(&ctx, "integrations/zoho/tasks").await;
    }
    integrations::api_zoho_tasks(&ctx, query).await
}

async fn api_zoho_disconnect(Extension(ctx): Extension<AdminCtx>) -> impl IntoResponse {
    if !ctx.is_admin() {
        return audit_admin_denied(&ctx, "integrations/zoho/disconnect").await;
    }
    integrations::api_zoho_disconnect(&ctx).await
}

async fn api_zoho_sync(Extension(ctx): Extension<AdminCtx>) -> impl IntoResponse {
    if !ctx.is_admin() {
        return audit_admin_denied(&ctx, "integrations/zoho/sync").await;
    }
    integrations::api_zoho_sync(&ctx).await
}

async fn api_list_integration_snapshots(
    Extension(ctx): Extension<AdminCtx>,
    axum::extract::Query(query): axum::extract::Query<integrations::SnapshotsQuery>,
) -> impl IntoResponse {
    if !ctx.is_admin() {
        return audit_admin_denied(&ctx, "integrations/snapshots").await;
    }
    integrations::api_list_snapshots(&ctx, query).await
}

async fn api_sync_now(Extension(ctx): Extension<AdminCtx>) -> impl IntoResponse {
    if !ctx.is_admin() {
        return audit_admin_denied(&ctx, "integrations/sync-now").await;
    }
    integrations::api_sync_now(&ctx).await
}

async fn api_get_integration_sync_schedule(
    Extension(ctx): Extension<AdminCtx>,
) -> impl IntoResponse {
    if !ctx.is_admin() {
        return audit_admin_denied(&ctx, "integrations/sync-schedule").await;
    }
    integrations::api_get_integration_sync_schedule(&ctx).await
}

async fn api_update_integration_sync_schedule(
    Extension(ctx): Extension<AdminCtx>,
    Json(body): Json<integrations::UpdateIntegrationSyncScheduleBody>,
) -> impl IntoResponse {
    if !ctx.is_admin() {
        return audit_admin_denied(&ctx, "integrations/sync-schedule").await;
    }
    integrations::api_update_integration_sync_schedule(&ctx, body).await
}

async fn api_integration_pipeline_status(Extension(ctx): Extension<AdminCtx>) -> impl IntoResponse {
    if !ctx.is_admin() {
        return audit_admin_denied(&ctx, "integrations/pipeline-status").await;
    }
    integrations::api_integration_pipeline_status(&ctx).await
}

async fn api_list_sync_logs(Extension(ctx): Extension<AdminCtx>) -> impl IntoResponse {
    if !ctx.is_admin() {
        return audit_admin_denied(&ctx, "integrations/sync-logs").await;
    }
    integrations::api_list_sync_logs(&ctx).await
}

async fn api_integration_catalog(Extension(ctx): Extension<AdminCtx>) -> impl IntoResponse {
    if !ctx.is_admin() {
        return audit_admin_denied(&ctx, "integrations/catalog").await;
    }
    integrations::api_integration_catalog(&ctx).await
}

async fn api_list_entity_links(Extension(ctx): Extension<AdminCtx>) -> impl IntoResponse {
    if !ctx.is_admin() {
        return audit_admin_denied(&ctx, "integrations/entity-links").await;
    }
    integrations::api_list_entity_links(&ctx).await
}

async fn api_reset_integration_sync(Extension(ctx): Extension<AdminCtx>) -> impl IntoResponse {
    if !ctx.is_admin() {
        return audit_admin_denied(&ctx, "integrations/reset-sync").await;
    }
    integrations::api_reset_integration_sync(&ctx).await
}

async fn api_dashboard_stats(
    Extension(ctx): Extension<AdminCtx>,
    Query(q): Query<dashboard::DashboardStatsQuery>,
) -> impl IntoResponse {
    dashboard::api_dashboard_stats(&ctx, q.hours).await
}

#[derive(Debug, serde::Serialize)]
struct MiddlewareStatusResponse {
    data_plane_prefix: &'static str,
    client_registry: dashboard::ClientRegistryStats,
    routes_count: i64,
    oauth_clients_loaded: usize,
    rate_limit_global_enabled: bool,
    rate_limit_global_rps: f64,
    integration_platform: IntegrationPlatformStatus,
}

#[derive(Debug, Serialize)]
struct IntegrationPlatformStatus {
    connectors: Vec<&'static str>,
    dlq_storage: &'static str,
    dlq_auto_replay_worker: bool,
}

async fn api_middleware_status(Extension(ctx): Extension<AdminCtx>) -> impl IntoResponse {
    let st = match STATE.get() {
        Some(s) => s.clone(),
        None => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": "state not initialized" })),
            )
                .into_response();
        }
    };
    let routes_count = match db::list_routes_for_tenant(&st.pool, ctx.tenant_id).await {
        Ok(rows) => rows.len() as i64,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": format!("{e}") })),
            )
                .into_response();
        }
    };
    let (active, disabled) = match db::count_client_keys_by_status(&st.pool, ctx.tenant_id).await {
        Ok(v) => v,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": format!("{e}") })),
            )
                .into_response();
        }
    };
    let cfg = st.config.read().await;
    let oauth_clients_loaded = (active + disabled).max(0) as usize;
    let body = MiddlewareStatusResponse {
        data_plane_prefix: data_plane_prefix(),
        client_registry: dashboard::ClientRegistryStats {
            total: active + disabled,
            active,
            disabled,
        },
        routes_count,
        oauth_clients_loaded,
        rate_limit_global_enabled: cfg.settings.rate_limit.enabled,
        rate_limit_global_rps: f64::from(cfg.settings.rate_limit.rps),
        integration_platform: IntegrationPlatformStatus {
            connectors: vec!["salesforce", "zoho_projects"],
            dlq_storage: "postgresql",
            dlq_auto_replay_worker: true,
        },
    };
    Json(body).into_response()
}

async fn proxy_or_static(req: Request<Body>) -> Response {
    let state = STATE.get().expect("STATE not initialized").clone();
    let uri: Uri = req.uri().clone();
    let path = uri.path().to_string();

    if path.starts_with("/api/") {
        return json_error(
            StatusCode::NOT_FOUND,
            "not_found",
            "Admin API is mounted at /api/*; use a valid path and admin X-API-Key",
        );
    }

    if path_is_under_data_plane(&path) {
        return handle_data_plane_request(state, req, uri, path).await;
    }

    let cfg = state.config.read().await.clone();
    let matched = cfg
        .routes
        .iter()
        .filter(|r| path == r.path || path.starts_with(&(r.path.clone() + "/")))
        .max_by_key(|r| r.path.len())
        .cloned();

    if let Some(route) = matched {
        match handle_proxied_route(state, req, uri, path, route).await {
            Ok(resp) => resp,
            Err(e) => e,
        }
    } else if path_is_data_plane_typo(&path) || path_is_api_namespace(&path) {
        reject_non_api_path(&path)
    } else {
        serve_frontend(req).await
    }
}

async fn handle_data_plane_request(
    state: AppState,
    req: Request<Body>,
    uri: Uri,
    path: String,
) -> Response {
    let cfg = state.config.read().await.clone();
    let method = req.method().as_str().to_string();
    let bearer = jwt_auth::bearer_from_headers(req.headers()).unwrap_or_default();
    let (parts, body) = req.into_parts();
    let client_ip = admin_auth::client_ip_from_extensions(&parts.headers, &parts.extensions);
    let body_bytes = match axum::body::to_bytes(body, MAX_DATA_PLANE_BODY).await {
        Ok(b) => b,
        Err(_) => {
            return json_error(
                StatusCode::BAD_REQUEST,
                "bad_request",
                "Request body too large",
            );
        }
    };
    let verified = match verify_data_plane_auth(&state, &cfg, &parts.headers).await {
        Ok(v) => v,
        Err(err) => {
            let (status, reason, msg) = jwt_auth::token_auth_to_response(err);
            let (log_key_id, log_tenant) =
                jwt_auth::identity_for_log(&cfg.client_credentials, &bearer);
            log_gateway_transaction(
                log_tenant,
                client_ip.as_deref(),
                "denied",
                reason,
                &method,
                &path,
                status.as_u16(),
                &bearer,
                None,
                0,
                log_key_id,
            );
            return json_error(status, reason, msg);
        }
    };
    let subject = verified.subject.clone();
    if verified.key_id > 0 {
        spawn_touch_client_key(verified.key_id);
    }
    if canonical_api::parse_canonical_path(data_plane_prefix(), &path).is_some() {
        let rl = resolve_rate_limit(&verified, None, &cfg.settings);
        let rl_key = rate_limit::bucket_key(verified.tenant_id, "canonical", &subject);
        let rl_info = match consume_data_plane_rate_limit(&state.rate_limiter, rl, &rl_key).await {
            Ok(info) => info,
            Err((info, retry_after)) => {
                state.gateway_metrics.record_rate_limit_hit();
                log_gateway_transaction(
                    Some(verified.tenant_id),
                    client_ip.as_deref(),
                    "denied",
                    "rate_limit_exceeded",
                    &method,
                    &path,
                    StatusCode::TOO_MANY_REQUESTS.as_u16(),
                    &subject,
                    Some("canonical_transform"),
                    0,
                    Some(verified.key_id),
                );
                return rate_limit_response(&info, retry_after);
            }
        };
        let ct = parts
            .headers
            .get(axum::http::header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok());
        let resp = canonical_api::canonical_data_plane_proxy(
            verified.tenant_id,
            &method,
            &path,
            uri.query(),
            &body_bytes,
            ct,
            data_plane_prefix(),
        )
        .await;
        log_gateway_transaction(
            Some(verified.tenant_id),
            client_ip.as_deref(),
            "success",
            "canonical_transform",
            &method,
            &path,
            resp.status().as_u16(),
            &subject,
            Some("canonical_transform"),
            0,
            Some(verified.key_id),
        );
        if let Some(info) = rl_info.as_ref() {
            let mut out = resp;
            apply_rate_limit_headers(&mut out, info);
            return out;
        }
        return resp;
    }
    if integrations::parse_integration_proxy_path(data_plane_prefix(), &path).is_some() {
        let rl = resolve_rate_limit(&verified, None, &cfg.settings);
        let rl_key = rate_limit::bucket_key(verified.tenant_id, "integration", &subject);
        let rl_info = match consume_data_plane_rate_limit(&state.rate_limiter, rl, &rl_key).await {
            Ok(info) => info,
            Err((info, retry_after)) => {
                state.gateway_metrics.record_rate_limit_hit();
                log_gateway_transaction(
                    Some(verified.tenant_id),
                    client_ip.as_deref(),
                    "denied",
                    "rate_limit_exceeded",
                    &method,
                    &path,
                    StatusCode::TOO_MANY_REQUESTS.as_u16(),
                    &subject,
                    Some("integration_oauth"),
                    0,
                    Some(verified.key_id),
                );
                return rate_limit_response(&info, retry_after);
            }
        };
        let ct = parts
            .headers
            .get(axum::http::header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok());
        let resp = integrations::integration_data_plane_proxy(
            verified.tenant_id,
            &method,
            &path,
            uri.query(),
            &body_bytes,
            ct,
            data_plane_prefix(),
        )
        .await;
        log_gateway_transaction(
            Some(verified.tenant_id),
            client_ip.as_deref(),
            "success",
            "integration_proxy",
            &method,
            &path,
            resp.status().as_u16(),
            &subject,
            Some("integration_oauth"),
            0,
            Some(verified.key_id),
        );
        if let Some(info) = rl_info.as_ref() {
            let mut out = resp;
            apply_rate_limit_headers(&mut out, info);
            return out;
        }
        return resp;
    }
    let matched = route_match::find_route(&cfg.routes, &method, &path);
    if let Some(matched) = matched {
        let route = matched.route;
        if !jwt_auth::client_allows_route(&verified, &route) {
            log_gateway_transaction(
                Some(verified.tenant_id),
                client_ip.as_deref(),
                "denied",
                "route_forbidden",
                &method,
                &path,
                StatusCode::FORBIDDEN.as_u16(),
                &subject,
                Some(&route.target),
                0,
                Some(verified.key_id),
            );
            return json_error(
                StatusCode::FORBIDDEN,
                "forbidden",
                "API key is not authorized for this route",
            );
        }
        let req = Request::from_parts(parts, Body::from(body_bytes));
        return match do_proxy(
            state,
            req,
            uri,
            path,
            route,
            matched.params,
            matched.suffix,
            verified,
        )
        .await
        {
            Ok(resp) => resp,
            Err(e) => e,
        };
    }
    log_gateway_transaction(
        Some(verified.tenant_id),
        client_ip.as_deref(),
        "denied",
        "not_found",
        &method,
        &path,
        StatusCode::NOT_FOUND.as_u16(),
        &subject,
        None,
        0,
        Some(verified.key_id),
    );
    json_error(
        StatusCode::NOT_FOUND,
        "not_found",
        "No route configured for this path",
    )
}

async fn handle_proxied_route(
    state: AppState,
    req: Request<Body>,
    uri: Uri,
    path: String,
    route: RouteRow,
) -> Result<Response, Response> {
    let cfg = state.config.read().await.clone();
    let (parts, body) = req.into_parts();
    let body_bytes = axum::body::to_bytes(body, MAX_DATA_PLANE_BODY)
        .await
        .map_err(|_| status_to_json_error(StatusCode::BAD_REQUEST))?;
    let verified = verify_data_plane_auth(&state, &cfg, &parts.headers)
        .await
        .map_err(|err| {
            let (status, _, _) = jwt_auth::token_auth_to_response(err);
            status_to_json_error(status)
        })?;
    if !jwt_auth::client_allows_route(&verified, &route) {
        return Err(status_to_json_error(StatusCode::FORBIDDEN));
    }
    if verified.key_id > 0 {
        spawn_touch_client_key(verified.key_id);
    }
    let req = Request::from_parts(parts, Body::from(body_bytes));
    let suffix = path
        .strip_prefix(route.path.trim_end_matches('/'))
        .unwrap_or("")
        .to_string();
    do_proxy(
        state,
        req,
        uri,
        path,
        route,
        std::collections::HashMap::new(),
        suffix,
        verified,
    )
    .await
}

/// SPA fallback chỉ cho route UI — không trả index.html cho asset (.js/.css/…) thiếu file.
fn spa_index_fallback_allowed(path: &str) -> bool {
    let p = path.trim();
    if p.is_empty() || p == "/" {
        return true;
    }
    if p.starts_with("/assets/") {
        return false;
    }
    if let Some(ext) = p.rsplit('.').next() {
        match ext.to_ascii_lowercase().as_str() {
            "js" | "mjs" | "css" | "map" | "svg" | "png" | "jpg" | "jpeg" | "webp" | "gif"
            | "ico" | "woff" | "woff2" | "ttf" | "eot" | "json" | "txt" | "xml" => return false,
            _ => {}
        }
    }
    true
}

async fn serve_frontend(req: Request<Body>) -> Response {
    let dist_dir = "web/dist";
    let path = req.uri().path().to_string();

    let resp = match ServeDir::new(dist_dir)
        .append_index_html_on_directories(true)
        .oneshot(req)
        .await
    {
        Ok(r) => r.into_response(),
        Err(_) => {
            return json_error(
                StatusCode::INTERNAL_SERVER_ERROR,
                "static_error",
                "static file service error",
            );
        }
    };

    if resp.status() == StatusCode::NOT_FOUND && spa_index_fallback_allowed(&path) {
        return match ServeFile::new(format!("{dist_dir}/index.html"))
            .oneshot(Request::builder().uri("/").body(Body::empty()).unwrap())
            .await
        {
            Ok(r) => r.into_response(),
            Err(_) => json_error(
                StatusCode::INTERNAL_SERVER_ERROR,
                "static_error",
                "static file service error",
            ),
        };
    }

    resp
}

async fn do_proxy(
    state: AppState,
    req: Request<Body>,
    uri: Uri,
    path: String,
    route: RouteRow,
    route_params: std::collections::HashMap<String, String>,
    route_suffix: String,
    verified: VerifiedClient,
) -> Result<Response, Response> {
    // Gọi data plane (sau auth)
    let started = Instant::now();
    let (parts, body) = req.into_parts();

    let cfg = state.config.read().await.clone();
    let subject = verified.subject.clone();
    let client_ip = admin_auth::client_ip_from_extensions(&parts.headers, &parts.extensions);

    let body_bytes = axum::body::to_bytes(body, MAX_DATA_PLANE_BODY)
        .await
        .map_err(|_| status_to_json_error(StatusCode::BAD_REQUEST))?;

    let cap_req_headers = capture_headers(&parts.headers);
    let (cap_req_body, cap_req_bytes, cap_req_truncated) = capture_body(&body_bytes);

    let rl = resolve_rate_limit(&verified, Some(&route), &cfg.settings);
    let scope = if verified.rate_limit_per_min > 0 {
        "client".to_string()
    } else if route.rate_limit_per_min > 0 {
        format!("route:{}", route.id)
    } else {
        "global".to_string()
    };
    let rl_key = rate_limit::bucket_key(verified.tenant_id, &scope, &subject);
    let rl_info = match consume_data_plane_rate_limit(&state.rate_limiter, rl, &rl_key).await {
        Ok(info) => info,
        Err((info, retry_after)) => {
            let elapsed_ms = started.elapsed().as_millis();
            state.gateway_metrics.record_rate_limit_hit();
            log_gateway_transaction(
                Some(route.tenant_id),
                client_ip.as_deref(),
                "denied",
                "rate_limit_exceeded",
                parts.method.as_str(),
                &path,
                StatusCode::TOO_MANY_REQUESTS.as_u16(),
                &subject,
                Some(&route.target),
                elapsed_ms,
                Some(verified.key_id),
            );
            return Err(rate_limit_response(&info, retry_after));
        }
    };

    let mut url = route_match::build_upstream_url(&route.target, &route_params, &route_suffix);
    if let Some(q) = uri.query() {
        url = route_match::append_query_to_upstream_url(&url, q);
    }

    let method = parts.method.clone();
    let headers = sanitize_upstream_headers(&parts.headers);
    let policy = proxy_ext::RouteProxyPolicy::from_row(&route);
    let timeout_secs = route.timeout_secs.max(1) as u64;

    let upstream = proxy_ext::forward_with_policy(
        &state.http,
        &method,
        &url,
        headers,
        body_bytes,
        timeout_secs,
        &policy,
        &cfg.settings.extensions,
        &state.proxy_queue,
        route.tenant_id,
        &route,
        &path,
    )
    .await;

    let status = upstream.status;
    // Log forwarded hoặc forwarded_after_retry
    // Log queued / queued_after_failure
    // Log upstream_error
    let log_reason: &'static str = if upstream.queued_id.is_some() {
        "queued_after_failure"
    } else if upstream.attempts > 1 {
        "forwarded_after_retry"
    } else {
        "forwarded"
    };
    let log_outcome: &'static str = if status.is_success() {
        "success"
    } else if upstream.queued_id.is_some() {
        "queued"
    } else {
        "upstream_error"
    };

    let (cap_resp_body, cap_resp_bytes, cap_resp_truncated) = capture_body(&upstream.body);
    let tx_detail = db::TransactionDetail {
        route_id: Some(route.id),
        upstream_url: Some(url.clone()),
        req_headers: Some(cap_req_headers),
        req_body: cap_req_body,
        req_bytes: Some(cap_req_bytes),
        req_truncated: cap_req_truncated,
        resp_headers: Some(capture_headers(&upstream.headers)),
        resp_body: cap_resp_body,
        resp_bytes: Some(cap_resp_bytes),
        resp_truncated: cap_resp_truncated,
    };

    let elapsed_ms = started.elapsed().as_millis();
    log_gateway_transaction_detailed(
        Some(route.tenant_id),
        client_ip.as_deref(),
        log_outcome,
        log_reason,
        parts.method.as_str(),
        &path,
        status.as_u16(),
        &subject,
        Some(&route.target),
        elapsed_ms,
        Some(verified.key_id),
        Some(tx_detail),
    );

    if let Some(qid) = upstream.queued_id.clone() {
        // 502 + queue_id
        let body_json = serde_json::json!({
            "error": "upstream_failed",
            "message": "Request đã vào hàng đợi (DLQ) sau retry",
            "queue_id": qid,
            "attempts": upstream.attempts,
        });
        return Ok(append_rate_limit_to_builder(
            Response::builder()
                .status(StatusCode::BAD_GATEWAY)
                .header(CONTENT_TYPE, "application/json")
                .header("X-Queue-Id", qid),
            rl_info.as_ref(),
        )
        .body(Body::from(body_json.to_string()))
        .map_err(|_| status_to_json_error(StatusCode::BAD_GATEWAY))?);
    }

    // Upstream status (+ X-Retry-Attempts nếu >1)
    // 502/504 upstream lỗi
    let mut builder = Response::builder().status(status);
    if upstream.attempts > 1 {
        builder = builder.header("X-Retry-Attempts", upstream.attempts.to_string());
    }
    for (k, v) in upstream.headers.iter() {
        builder = builder.header(k, v);
    }
    builder = append_rate_limit_to_builder(builder, rl_info.as_ref());

    builder
        .body(Body::from(upstream.body))
        .map_err(|_| status_to_json_error(StatusCode::BAD_GATEWAY))
}

#[cfg(test)]
mod path_tests {
    use super::*;
    use axum::http::{HeaderValue, Uri};
    use std::time::{Duration, Instant};

    #[test]
    fn data_plane_paths() {
        assert!(path_is_under_data_plane("/v1/api"));
        assert!(path_is_under_data_plane("/v1/api/get"));
        assert!(!path_is_under_data_plane("/v1/api1234124"));
    }

    #[test]
    fn data_plane_typo() {
        assert!(path_is_data_plane_typo("/v1/api1234124"));
        assert!(!path_is_data_plane_typo("/v1/api/get"));
        assert!(!path_is_data_plane_typo("/v1/foo"));
    }

    #[test]
    fn api_namespace() {
        assert!(path_is_api_namespace("/v1/foo"));
        assert!(!path_is_api_namespace("/assets/main.js"));
    }

    #[test]
    fn canonical_request_path_includes_query() {
        let uri: Uri = "/v1/api/get?a=1&b=2".parse().unwrap();
        assert_eq!(canonical_request_path(&uri), "/v1/api/get?a=1&b=2");
        let uri2: Uri = "/v1/api/get".parse().unwrap();
        assert_eq!(canonical_request_path(&uri2), "/v1/api/get");
    }

    #[test]
    fn strips_gateway_bearer_before_upstream() {
        let mut headers = HeaderMap::new();
        headers.insert(AUTHORIZATION, HeaderValue::from_static("Bearer test-token"));
        headers.insert("x-demo", HeaderValue::from_static("ok"));

        let sanitized = sanitize_upstream_headers(&headers);
        assert!(sanitized.get(AUTHORIZATION).is_none());
        assert_eq!(
            sanitized.get("x-demo"),
            Some(&HeaderValue::from_static("ok"))
        );
    }

    #[test]
    fn parse_bool_setting_values() {
        assert!(parse_bool_setting(Some("true".into()), false));
        assert!(parse_bool_setting(Some("1".into()), false));
        assert!(!parse_bool_setting(Some("off".into()), true));
        assert!(parse_bool_setting(None, true));
    }

    #[test]
    fn per_min_burst_capped_via_module() {
        let (_, burst) = rate_limit::per_min_to_bucket(10);
        assert_eq!(burst, 1);
        assert_eq!(rate_limit::effective_burst(burst, false), 1);
        assert_eq!(rate_limit::effective_burst(5, true), 5);
    }

    #[test]
    fn spa_fallback_skips_assets() {
        assert!(!spa_index_fallback_allowed("/assets/main-abc.js"));
        assert!(!spa_index_fallback_allowed("/assets/index.css"));
        assert!(spa_index_fallback_allowed("/auth"));
        assert!(spa_index_fallback_allowed("/"));
    }

    fn test_route(id: i64, tenant_id: i64) -> RouteRow {
        RouteRow {
            id,
            path: "/v1/api/test".into(),
            target: "https://example.com".into(),
            timeout_secs: 30,
            rate_limit_per_min: 0,
            tenant_id,
            transform_add_headers: "{}".into(),
            transform_remove_headers: "[]".into(),
            retry_max: 0,
            retry_on_status: vec![502],
            retry_on_timeout: 1,
            queue_on_failure: 0,
            allowed_methods: vec!["*".into()],
        }
    }

    #[test]
    fn client_allows_route_tenant_and_acl() {
        let route = test_route(5, 1);
        let other_tenant = test_route(6, 10);
        let full = VerifiedClient {
            key_id: 1,
            tenant_id: 1,
            rate_limit_per_min: 0,
            allowed_route_ids: vec![],
            subject: "client:pk".into(),
            token_type: "client".into(),
        };
        let restricted = VerifiedClient {
            key_id: 2,
            tenant_id: 1,
            rate_limit_per_min: 0,
            allowed_route_ids: vec![5],
            subject: "client:pk2".into(),
            token_type: "client".into(),
        };
        assert!(jwt_auth::client_allows_route(&full, &route));
        assert!(jwt_auth::client_allows_route(&restricted, &route));
        assert!(!jwt_auth::client_allows_route(
            &restricted,
            &test_route(6, 10)
        ));
        assert!(!jwt_auth::client_allows_route(&full, &other_tenant));
    }

    #[test]
    fn mask_subject_for_log_prefix() {
        assert_eq!(mask_subject_for_log("client:avaso_cid_ab"), "client:a…");
        assert_eq!(mask_subject_for_log("client:avaso_pk_ab"), "client:a…");
        assert_eq!(mask_subject_for_log(""), "(none)");
    }
}
