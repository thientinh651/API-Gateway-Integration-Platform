mod admin_auth;
mod canonical_api;
mod crypto;
mod db;
mod dashboard;
mod gateway_rsa;
mod integration_office;
mod integrations;
mod metrics;
mod password_reset;
mod proxy_ext;
mod route_match;
mod session;
mod transform;

use admin_auth::{session_unavailable_response, write_audit, write_audit_event, write_audit_failure, AdminCtx};
use integrations::OAuthPending;
use session::{SessionRecord, SessionStore, SessionStoreStatus};
use axum::{
    body::Body,
    extract::{Extension, Json, Path, Query},
    http::{
        header::{COOKIE, CONTENT_TYPE, RETRY_AFTER, SET_COOKIE},
        HeaderMap, HeaderValue, Method, Request, StatusCode, Uri,
    },
    middleware::{self, Next},
    response::IntoResponse,
    response::Response,
    routing::{delete, get, patch, post, put},
    Router,
};
use dashmap::DashMap;
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use std::{
    io::ErrorKind,
    net::SocketAddr,
    sync::{Arc, OnceLock},
    time::{Duration, Instant},
};
use tokio::sync::RwLock;
use tower::ServiceExt;
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
                Err(_) => eprintln!("⚠️ CORS_ALLOWED_ORIGINS: bỏ qua giá trị không hợp lệ: {part:?}"),
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
    #[serde(default = "default_retry_status")]
    pub retry_on_status: String,
    #[serde(default = "default_one")]
    pub retry_on_timeout: i32,
    #[serde(default)]
    pub queue_on_failure: i32,
    #[serde(default = "default_allowed_methods")]
    pub allowed_methods: String,
}

fn default_allowed_methods() -> String {
    "*".into()
}

fn default_json_obj() -> String {
    "{}".into()
}

fn default_json_arr() -> String {
    "[]".into()
}

fn default_retry_status() -> String {
    "502,503,504".into()
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
    #[serde(default = "default_rl_rps")]
    rps: u32,
    #[serde(default = "default_rl_burst")]
    burst: u32,
}

impl Default for RateLimitConfig {
    fn default() -> Self {
        Self {
            enabled: default_rl_enabled(),
            rps: default_rl_rps(),
            burst: default_rl_burst(),
        }
    }
}

fn default_rl_enabled() -> bool {
    false
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
}

impl Default for RuntimeSettings {
    fn default() -> Self {
        Self {
            rate_limit: RateLimitConfig::default(),
            enable_metrics: true,
            enable_health_check: true,
            extensions: proxy_ext::ExtensionToggles::default(),
        }
    }
}

#[derive(Debug, Serialize)]
struct SettingsSystemInfo {
    version: &'static str,
    runtime: &'static str,
    database: &'static str,
    bind_port: u16,
    log_format: &'static str,
    has_admin_api_key: bool,
}

#[derive(Debug, Serialize)]
struct SettingsResponse {
    rate_limit_enabled: bool,
    rate_limit_rps: u32,
    rate_limit_burst: u32,
    enable_metrics: bool,
    enable_health_check: bool,
    transform_enabled: bool,
    retry_enabled: bool,
    queue_enabled: bool,
    system_info: SettingsSystemInfo,
}

#[derive(Debug, Deserialize)]
struct UpdateSettingsBody {
    rate_limit_enabled: bool,
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
}

#[derive(Clone)]
struct AppState {
    pool: PgPool,
    config: Arc<RwLock<AppConfig>>,
    http: reqwest::Client,
    rl: Arc<DashMap<String, TokenBucket>>,
    /// Admin browser sessions — Redis (module `session`).
    session_store: Arc<SessionStore>,
    /// HMAC X-Signature replay guard (TTL = timestamp skew window).
    hmac_replay: Arc<DashMap<String, Instant>>,
    /// OAuth CSRF cache (primary store: SQLite oauth_pending_states).
    oauth_pending: Arc<DashMap<String, OAuthPending>>,
    proxy_queue: proxy_ext::ProxyQueue,
    gateway_metrics: Arc<metrics::GatewayMetrics>,
}

static STATE: OnceLock<AppState> = OnceLock::new();

/// Prefix data plane (SRS): mọi path dưới đây bắt buộc `X-API-Key` client; không route → 404 JSON (không SPA).
/// `DATA_PLANE_PREFIX=` rỗng → tắt nhánh này.
static DATA_PLANE_PREFIX: OnceLock<&'static str> = OnceLock::new();

fn data_plane_prefix() -> &'static str {
    *DATA_PLANE_PREFIX.get_or_init(|| {
        match std::env::var("DATA_PLANE_PREFIX") {
            Ok(s) if !s.is_empty() => Box::leak(s.into_boxed_str()),
            Ok(_) => "",
            Err(_) => "/v1/api",
        }
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
            &format!(
                "Invalid path; use {p} or {p}/<segment> (typo: missing '/' after prefix?)"
            ),
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
/// `rate_limit_per_min == 0` → không áp limit theo route (fallback `config.yaml` nếu bật).
fn per_min_to_bucket(per_min: i32) -> (f64, u32) {
    let per_min = per_min.max(1) as u32;
    (per_min as f64 / 60.0, per_min)
}

/// Rate limit: client registry → route → global settings.
fn resolve_rate_limit(
    client: &VerifiedClient,
    route: Option<&RouteRow>,
    settings: &RuntimeSettings,
) -> (bool, f64, u32) {
    if client.rate_limit_per_min > 0 {
        let (rps, burst) = per_min_to_bucket(client.rate_limit_per_min);
        return (true, rps, burst);
    }
    if let Some(r) = route.filter(|r| r.rate_limit_per_min > 0) {
        let (rps, burst) = per_min_to_bucket(r.rate_limit_per_min);
        return (true, rps, burst);
    }
    if settings.rate_limit.enabled {
        (
            true,
            settings.rate_limit.rps as f64,
            settings.rate_limit.burst,
        )
    } else {
        (false, 0.0, 0)
    }
}

fn rate_limit_bucket_key(tenant_id: i64, scope: &str, api_key: &str) -> String {
    let key_part = if api_key.is_empty() {
        "anon".to_string()
    } else {
        db::sha256_hex(api_key)
    };
    format!("{tenant_id}:{scope}:{key_part}")
}

fn try_consume_rate_limit(
    state: &AppState,
    bucket_key: &str,
    rps: f64,
    burst: u32,
) -> Result<(), u64> {
    let now = Instant::now();
    let mut entry = state
        .rl
        .entry(bucket_key.to_string())
        .or_insert_with(|| TokenBucket::new(now, burst));
    let bucket = entry.value_mut();
    if bucket.take(now, rps, burst) {
        Ok(())
    } else {
        Err(bucket.retry_after_secs(rps))
    }
}

fn validate_route_write(path: &str, target: &str, timeout_secs: i32, rate_limit_per_min: i32) -> Option<Response> {
    let mut fields = serde_json::Map::new();
    if path.is_empty() {
        fields.insert(
            "path".into(),
            serde_json::Value::String("Nhập path (vd: /v1/api)".into()),
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
            serde_json::Value::String("Rate limit phải từ 0 (không giới hạn theo route) đến 1.000.000 req/min".into()),
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
        StatusCode::UNAUTHORIZED => ("unauthorized", "Missing or invalid X-API-Key"),
        StatusCode::TOO_MANY_REQUESTS => ("too_many_requests", "Rate limit exceeded"),
        StatusCode::BAD_GATEWAY => ("bad_gateway", "Upstream request failed"),
        StatusCode::BAD_REQUEST => ("bad_request", "Invalid request body"),
        _ => ("error", "Request failed"),
    };
    json_error(status, error, message)
}

fn rate_limit_response(retry_after_secs: u64) -> Response {
    let mut res = json_error(
        StatusCode::TOO_MANY_REQUESTS,
        "too_many_requests",
        "Rate limit exceeded",
    );
    if let Ok(hv) = HeaderValue::from_str(&retry_after_secs.max(1).to_string()) {
        res.headers_mut().insert(RETRY_AFTER, hv);
    }
    res
}

const HMAC_TIMESTAMP_MAX_SKEW_SECS: u64 = 300;
const MAX_DATA_PLANE_BODY: usize = 1024 * 1024;

fn x_api_key_from_headers(headers: &HeaderMap) -> String {
    headers
        .get("x-api-key")
        .or_else(|| headers.get("X-API-Key"))
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .trim()
        .to_string()
}

fn header_str(headers: &HeaderMap, name: &str) -> String {
    headers
        .get(name)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .trim()
        .to_string()
}

#[derive(Debug, Clone)]
struct VerifiedClient {
    key_id: i64,
    tenant_id: i64,
    rate_limit_per_min: i32,
    allowed_route_ids: Vec<i64>,
}

#[derive(Debug)]
enum ClientAuthFail {
    NoKeysConfigured,
    MissingApiKey,
    UnknownApiKey,
    KeyDisabled,
    MissingSignature,
    MissingTimestamp,
    BadTimestamp,
    BadSignature,
    ReplaySignature,
}

fn canonical_request_path(uri: &Uri) -> String {
    let path = uri.path();
    match uri.query() {
        Some(q) if !q.is_empty() => format!("{path}?{q}"),
        _ => path.to_string(),
    }
}

fn purge_hmac_replay_cache(cache: &DashMap<String, Instant>) {
    let now = Instant::now();
    cache.retain(|_, exp| *exp > now);
}

fn hmac_replay_cache_key(api_key: &str, signature: &str) -> String {
    format!("{}:{}", api_key, signature.trim().to_ascii_lowercase())
}

fn hmac_replay_is_duplicate(state: &AppState, api_key: &str, signature: &str) -> bool {
    purge_hmac_replay_cache(&state.hmac_replay);
    state
        .hmac_replay
        .contains_key(&hmac_replay_cache_key(api_key, signature))
}

fn hmac_replay_record(state: &AppState, api_key: &str, signature: &str) {
    let expires = Instant::now() + Duration::from_secs(HMAC_TIMESTAMP_MAX_SKEW_SECS);
    state.hmac_replay.insert(
        hmac_replay_cache_key(api_key, signature),
        expires,
    );
}

fn verify_client_auth(
    state: &AppState,
    cfg: &AppConfig,
    headers: &HeaderMap,
    method: &str,
    sign_path: &str,
    body: &[u8],
) -> Result<VerifiedClient, ClientAuthFail> {
    let creds = &cfg.client_credentials;
    if creds.hmac.is_empty() && creds.legacy.is_empty() {
        return Err(ClientAuthFail::NoKeysConfigured);
    }

    let api_key = x_api_key_from_headers(headers);
    if api_key.is_empty() {
        return Err(ClientAuthFail::MissingApiKey);
    }

    if creds.disabled_clients.iter().any(|k| k.api_key == api_key) {
        return Err(ClientAuthFail::KeyDisabled);
    }

    if let Some(pair) = creds.hmac.iter().find(|k| k.api_key == api_key) {
        let sig = header_str(headers, "x-signature");
        let ts = header_str(headers, "x-timestamp");
        if sig.is_empty() {
            return Err(ClientAuthFail::MissingSignature);
        }
        if ts.is_empty() {
            return Err(ClientAuthFail::MissingTimestamp);
        }
        let ts_u64: u64 = ts.parse().map_err(|_| ClientAuthFail::BadTimestamp)?;
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        if ts_u64.abs_diff(now) > HMAC_TIMESTAMP_MAX_SKEW_SECS {
            return Err(ClientAuthFail::BadTimestamp);
        }
        if hmac_replay_is_duplicate(state, &api_key, &sig) {
            return Err(ClientAuthFail::ReplaySignature);
        }
        let payload = crypto::signing_string(&api_key, &ts, method, sign_path, body);
        if !crypto::verify_hmac_sha256_hex(&pair.secret, &payload, &sig) {
            return Err(ClientAuthFail::BadSignature);
        }
        hmac_replay_record(state, &api_key, &sig);
        return Ok(VerifiedClient {
            key_id: pair.id,
            tenant_id: pair.tenant_id,
            rate_limit_per_min: pair.rate_limit_per_min,
            allowed_route_ids: pair.allowed_route_ids.clone(),
        });
    }

    let digest = db::sha256_hex(&api_key);
    if let Some(leg) = creds.legacy.iter().find(|k| k.sha256_hex == digest) {
        return Ok(VerifiedClient {
            key_id: leg.id,
            tenant_id: leg.tenant_id,
            rate_limit_per_min: leg.rate_limit_per_min,
            allowed_route_ids: leg.allowed_route_ids.clone(),
        });
    }

    Err(ClientAuthFail::UnknownApiKey)
}

fn client_allows_route(client: &VerifiedClient, route: &RouteRow) -> bool {
    if client.tenant_id != route.tenant_id {
        return false;
    }
    if client.allowed_route_ids.is_empty() {
        return true;
    }
    client.allowed_route_ids.contains(&route.id)
}

fn client_identity_for_log(cfg: &AppConfig, api_key: &str) -> (Option<i64>, Option<i64>) {
    if api_key.is_empty() {
        return (None, None);
    }
    let creds = &cfg.client_credentials;
    if let Some(p) = creds.hmac.iter().find(|k| k.api_key == api_key) {
        return (Some(p.id), Some(p.tenant_id));
    }
    if let Some(d) = creds.disabled_clients.iter().find(|k| k.api_key == api_key) {
        return (Some(d.id), Some(d.tenant_id));
    }
    let digest = db::sha256_hex(api_key);
    if let Some(leg) = creds.legacy.iter().find(|k| k.sha256_hex == digest) {
        return (Some(leg.id), Some(leg.tenant_id));
    }
    (None, None)
}

fn client_auth_to_response(err: ClientAuthFail) -> (StatusCode, &'static str, &'static str) {
    match err {
        ClientAuthFail::NoKeysConfigured => (
            StatusCode::SERVICE_UNAVAILABLE,
            "service_unavailable",
            "No client API keys configured; data plane requires X-API-Key per SRS",
        ),
        ClientAuthFail::MissingApiKey | ClientAuthFail::UnknownApiKey => (
            StatusCode::UNAUTHORIZED,
            "missing_or_invalid_api_key",
            "Missing or invalid X-API-Key",
        ),
        ClientAuthFail::KeyDisabled => (
            StatusCode::FORBIDDEN,
            "client_key_disabled",
            "Client API key is disabled",
        ),
        ClientAuthFail::MissingSignature
        | ClientAuthFail::MissingTimestamp
        | ClientAuthFail::BadTimestamp
        | ClientAuthFail::BadSignature => (
            StatusCode::UNAUTHORIZED,
            "invalid_signature",
            "Missing or invalid X-Signature / X-Timestamp (HMAC-SHA256)",
        ),
        ClientAuthFail::ReplaySignature => (
            StatusCode::UNAUTHORIZED,
            "replay_detected",
            "Duplicate X-Signature within allowed time window",
        ),
    }
}

/// NFR-12: never log plaintext API keys.
fn mask_api_key_for_log(key: &str) -> String {
    let k = key.trim();
    if k.is_empty() {
        return "(none)".into();
    }
    if k.len() <= 4 {
        return "****".into();
    }
    let prefix: String = k.chars().take(6).collect();
    format!("{prefix}…")
}

/// FR-D1: structured JSON transaction log + persist to SQLite for admin UI.
fn log_gateway_transaction(
    tenant_id: Option<i64>,
    client_ip: Option<&str>,
    outcome: &'static str,
    reason: &'static str,
    method: &str,
    path: &str,
    status: u16,
    api_key_header: &str,
    upstream: Option<&str>,
    elapsed_ms: u128,
    client_key_id: Option<i64>,
) {
    let request_id = uuid::Uuid::new_v4().to_string();
    let api_key_masked = mask_api_key_for_log(api_key_header);
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
            let _ = db::insert_transaction_log(
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
            )
            .await;
        });
    }
}

#[derive(Debug, Clone)]
struct TokenBucket {
    tokens: f64,
    last_refill: Instant,
}

impl TokenBucket {
    fn new(now: Instant, burst: u32) -> Self {
        Self {
            tokens: burst as f64,
            last_refill: now,
        }
    }

    fn take(&mut self, now: Instant, rps: f64, burst: u32) -> bool {
        let elapsed = now.duration_since(self.last_refill);
        let refill = elapsed.as_secs_f64() * rps;
        self.tokens = (self.tokens + refill).min(burst as f64);
        self.last_refill = now;
        if self.tokens >= 1.0 {
            self.tokens -= 1.0;
            true
        } else {
            false
        }
    }

    fn retry_after_secs(&self, rps: f64) -> u64 {
        if self.tokens >= 1.0 {
            return 1;
        }
        let needed = 1.0 - self.tokens;
        let secs = if rps > 0.0 {
            needed / rps
        } else {
            60.0
        };
        secs.ceil().max(1.0) as u64
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
    raw.and_then(|s| s.trim().parse::<u32>().ok()).unwrap_or(default)
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
    let enable_metrics =
        parse_bool_setting(db::load_setting(pool, "runtime_metrics_enabled").await?, true);
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

    Ok(RuntimeSettings {
        rate_limit: RateLimitConfig {
            enabled: rate_limit_enabled,
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
    Ok(())
}

fn settings_response_from_config(cfg: &AppConfig) -> SettingsResponse {
    SettingsResponse {
        rate_limit_enabled: cfg.settings.rate_limit.enabled,
        rate_limit_rps: cfg.settings.rate_limit.rps,
        rate_limit_burst: cfg.settings.rate_limit.burst,
        enable_metrics: cfg.settings.enable_metrics,
        enable_health_check: cfg.settings.enable_health_check,
        transform_enabled: cfg.settings.extensions.transform_enabled,
        retry_enabled: cfg.settings.extensions.retry_enabled,
        queue_enabled: cfg.settings.extensions.queue_enabled,
        system_info: SettingsSystemInfo {
            version: env!("CARGO_PKG_VERSION"),
            runtime: "Rust/Tokio",
            database: "PostgreSQL",
            bind_port: current_bind_port(),
            log_format: "tracing JSON",
            has_admin_api_key: !cfg.admin_api_key_sha256.is_empty(),
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
    if body.rate_limit_enabled && body.rate_limit_burst == 0 {
        fields.insert(
            "rate_limit_burst".into(),
            serde_json::Value::String("Bật rate limit thì burst phải > 0".into()),
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
    let routes = db::load_route_rows(pool).await?;
    let client_credentials = db::load_client_credentials(pool).await?;
    let admin_api_key_sha256 = db::load_admin_hash(pool).await?;
    let settings = load_runtime_settings(pool, &yaml).await?;
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
    *st.config.write().await = cfg;
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
    tracing_subscriber::fmt()
        .with_target(false)
        .json()
        .init();

    let database_url =
        std::env::var("DATABASE_URL")
            .unwrap_or_else(|_| "postgres://avaso:avaso@127.0.0.1:5432/avaso_gateway".into());

    let pool = db::connect(&database_url)
        .await
        .expect("open postgres database");
    db::migrate(&pool)
        .await
        .expect("run migrations");

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
    gateway_rsa::ensure_gateway_rsa_keys(&pool)
        .await
        .expect("ensure gateway RSA keypair");
    gateway_rsa::init_rsa_from_db(&pool)
        .await
        .expect("load gateway RSA private key");

    let initial = build_app_config(&pool)
        .await
        .expect("load config from database");

    let session_store = session::init_session_store().await;
    let proxy_queue = proxy_ext::ProxyQueue::new(pool.clone());

    integrations::spawn_integration_sync_worker(pool.clone());
    proxy_ext::spawn_dlq_replay_worker(pool.clone());

    let state = AppState {
        pool,
        config: Arc::new(RwLock::new(initial)),
        http: reqwest::Client::new(),
        rl: Arc::new(DashMap::new()),
        session_store,
        hmac_replay: Arc::new(DashMap::new()),
        oauth_pending: Arc::new(DashMap::new()),
        proxy_queue,
        gateway_metrics: Arc::new(metrics::GatewayMetrics::new()),
    };
    let _ = STATE.set(state);

    let api_protected = Router::new()
        .route("/proxy", get(proxy_handler))
        .route("/routes", get(api_routes).post(api_create_route))
        .route("/routes/acl-summary", get(api_routes_acl_summary))
        .route("/routes/:id/clients", get(api_route_clients))
        .route("/routes/:id", put(api_update_route).delete(api_delete_route))
        .route("/client-keys", get(api_list_client_keys).post(api_create_client_key))
        .route("/client-keys/bulk-status", post(api_bulk_client_key_status))
        .route("/client-keys/traffic-summary", get(api_client_keys_traffic_summary))
        .route(
            "/client-keys/encrypted",
            post(api_create_client_key_encrypted),
        )
        .route("/client-keys/:id", get(api_get_client_key).patch(api_patch_client_key).delete(api_delete_client_key))
        .route(
            "/client-keys/:id/routes",
            get(api_get_client_key_routes).put(api_put_client_key_routes),
        )
        .route("/client-keys/:id/rotate", post(api_rotate_client_key))
        .route("/client-keys/:id/traffic", get(api_get_client_key_traffic))
        .route("/users", get(api_list_users).post(api_create_user))
        .route("/users/:id", put(api_update_user).delete(api_delete_user))
        .route("/workspace/memberships", get(api_list_workspaces))
        .route("/workspace/switch", post(api_switch_workspace))
        .route("/workspace/members", post(api_invite_workspace_member))
        .route("/workspace/members/:user_id", delete(api_remove_workspace_member))
        .route("/audit-logs", get(api_list_audit_logs))
        .route("/transaction-logs", get(api_list_transaction_logs))
        .route("/proxy-queue", get(api_list_proxy_queue))
        .route("/proxy-queue/:id/retry", post(api_retry_proxy_queue))
        .route("/proxy-queue/:id", delete(api_delete_proxy_queue))
        .route("/integrations", get(api_list_integrations))
        .route("/integrations/setup-hints", get(api_integrations_setup_hints))
        .route(
            "/integrations/salesforce/connect",
            get(api_salesforce_connect),
        )
        .route(
            "/integrations/salesforce/test",
            get(api_salesforce_test),
        )
        .route(
            "/integrations/salesforce/sync",
            post(api_salesforce_sync),
        )
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
        .route(
            "/integrations/zoho/sync",
            post(api_zoho_sync),
        )
        .route(
            "/integrations/snapshots",
            get(api_list_integration_snapshots),
        )
        .route(
            "/integrations/snapshots/records",
            get(api_list_snapshot_records),
        )
        .route(
            "/integrations/zoho/disconnect",
            post(api_zoho_disconnect),
        )
        .route(
            "/integrations/bridge",
            get(api_get_integration_bridge).put(api_put_integration_bridge),
        )
        .route(
            "/integrations/bridge/run",
            post(api_run_integration_bridge),
        )
        .route(
            "/integrations/transform/profile",
            get(api_get_transform_profile),
        )
        .route(
            "/integrations/transform/preview",
            post(api_post_transform_preview),
        )
        .route(
            "/integrations/transform/sync-contact",
            post(api_sync_contact_sf_to_zoho),
        )
        .route(
            "/integrations/opportunity-templates",
            get(api_get_opportunity_templates).put(api_put_opportunity_templates),
        )
        .route("/integrations/sync-now", post(api_sync_now))
        .route("/integrations/sync-logs", get(api_list_sync_logs))
        .route("/integrations/entity-links", get(api_list_entity_links))
        .route("/integrations/documents", get(api_list_integration_documents))
        .route(
            "/integrations/documents/:id/download",
            get(api_download_integration_document),
        )
        .route(
            "/integrations/office/config",
            get(api_office_config_get).put(api_office_config_put),
        )
        .route("/integrations/office/test", get(api_office_test))
        .route("/integrations/reset-sync", post(api_reset_integration_sync))
        .route("/settings", get(api_get_settings).put(api_update_settings))
        .route("/dashboard/stats", get(api_dashboard_stats))
        .route("/middleware/status", get(api_middleware_status))
        .route("/reload-config", post(api_reload_config))
        .layer(middleware::from_fn(rbac_middleware))
        .layer(middleware::from_fn(admin_auth_middleware));

    let api_public = Router::new()
        .route("/ping", get(admin_api_ping))
        .route("/login", post(admin_login))
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
        .route("/crypto/public-key", get(api_gateway_public_key));

    let api = Router::new().merge(api_public).merge(api_protected);

    let cors = CorsLayer::new()
        .allow_credentials(true)
        .allow_methods([
            Method::GET,
            Method::POST,
            Method::PUT,
            Method::DELETE,
            Method::OPTIONS,
        ])
        .allow_headers([
            axum::http::header::ACCEPT,
            axum::http::header::AUTHORIZATION,
            axum::http::header::CONTENT_TYPE,
            COOKIE,
            axum::http::HeaderName::from_static("x-api-key"),
            axum::http::HeaderName::from_static("x-signature"),
            axum::http::HeaderName::from_static("x-timestamp"),
        ])
        .allow_origin(AllowOrigin::list(cors_allowed_origins()));

    let app = Router::new()
        .layer(NormalizePathLayer::trim_trailing_slash())
        .layer(middleware::from_fn(instance_label_middleware))
        .layer(cors)
        .nest("/api", api)
        .route("/health", get(health_handler))
        .route("/metrics", get(metrics_handler))
        .fallback(proxy_or_static);

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
    println!("🗄️  Session store: Redis ({})", session::redis_url_from_env().split('@').last().unwrap_or("redis"));
    println!("🔐 Admin: GET /api/ping (kiểm tra triển khai) | POST /api/login …");
    println!("   GET /api/me | POST /api/logout");
    println!("   CORS: thêm domain UI production → CORS_ALLOWED_ORIGINS (vd https://thientinh.io.vn)");
    println!("   GET/POST /api/routes | PUT/DELETE /api/routes/:id");
    println!("   GET/POST /api/client-keys | DELETE /api/client-keys/:id");
    println!("   GET /api/integrations | SF OAuth connect/callback/test");
    println!("   GET /api/crypto/public-key | POST /api/client-keys/encrypted (RSA envelope)");
    println!("   Data plane prefix (bắt buộc X-API-Key client): {}", data_plane_prefix());
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

    axum::serve(listener, app.into_make_service_with_connect_info::<SocketAddr>())
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
    let ip = admin_auth::client_ip(req.headers());
    match resolve_admin_ctx(req.headers()).await {
        Ok(ctx) => {
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
    let ctx = req
        .extensions()
        .get::<AdminCtx>()
        .cloned()
        .ok_or_else(|| {
            json_error(
                StatusCode::INTERNAL_SERVER_ERROR,
                "internal_error",
                "admin context missing",
            )
        })?;
    let method = req.method().clone();
    let path = req.uri().path().to_string();
    if !admin_auth::rbac_allow(&method, &path, &ctx.role) {
        if let Some(st) = STATE.get() {
            let resource = format!("{} {path}", method.as_str());
            write_audit_failure(
                &st.pool,
                &ctx,
                "rbac_denied",
                &resource,
                admin_auth::client_ip(req.headers()).as_deref(),
                Some("insufficient_permissions"),
            )
            .await;
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
    admin: &db::AdminUserRow,
    audit_action: &str,
) -> Response {
    let ip = admin_auth::client_ip(headers);
    let Some(st) = STATE.get() else {
        return json_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "internal_error",
            "gateway state not initialized",
        );
    };

    if admin.is_active == 0 {
        let ctx = AdminCtx::from_user(admin);
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
    let ctx = AdminCtx::from_user(admin);
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
    let mut res = (
        StatusCode::OK,
        Json(serde_json::json!({
            "status": "ok",
            "username": username,
            "role": ctx.role,
            "tenant_id": ctx.tenant_id,
            "user_id": ctx.user_id,
            "email": admin.email
        })),
    )
        .into_response();
    res.headers_mut().append(SET_COOKIE, hv);
    res
}

async fn admin_login(headers: HeaderMap, Json(body): Json<LoginBody>) -> impl IntoResponse {
    let user = body.username.trim();
    let pass = body.password.as_str();
    let ip = admin_auth::client_ip(&headers);
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

    establish_admin_session(&headers, &admin, "login").await
}

#[derive(Debug, Deserialize)]
struct RegisterViewerBody {
    username: String,
    password: String,
    email: String,
}

async fn api_register_viewer(headers: HeaderMap, Json(body): Json<RegisterViewerBody>) -> impl IntoResponse {
    let ip = admin_auth::client_ip(&headers);
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
            serde_json::Value::String(
                if email_raw.is_empty() {
                    "Nhập email".into()
                } else {
                    "Email không hợp lệ".into()
                },
            ),
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
                    let mut res = establish_admin_session(&headers, &row, "register").await;
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
        return json_error(
            StatusCode::UNAUTHORIZED,
            "unauthorized",
            "Not logged in",
        );
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

    let email_db: Option<Option<&str>> = email_patch
        .as_ref()
        .map(|o| o.as_deref());

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

            let out_email = email_patch
                .map(|o| o)
                .unwrap_or_else(|| row.email.clone());
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

async fn api_reset_password(Json(body): Json<ResetPasswordBody>) -> impl IntoResponse {
    let token = body.reset_token.trim();
    let pass = body.password.trim();
    let mut fields = serde_json::Map::new();
    if token.is_empty() {
        fields.insert(
            "reset_token".into(),
            serde_json::Value::String("Phiên đặt lại mật khẩu không hợp lệ — xác minh OTP lại".into()),
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
            let _ = st.session_store.revoke_all_for_user(user_id).await;
            if let Ok(Some(u)) = db::fetch_admin_user_by_id_any(&st.pool, user_id).await {
                write_audit_event(
                    &st.pool,
                    u.tenant_id.unwrap_or(1),
                    &u.username,
                    &u.role,
                    "reset_password",
                    "session",
                    "success",
                    None,
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
        return json_error(
            StatusCode::UNAUTHORIZED,
            "unauthorized",
            "Not logged in",
        );
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
            let mut workspaces = db::list_accessible_workspaces(&st.pool, ctx.user_id, ctx.home_tenant_id)
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
        return json_error(StatusCode::BAD_REQUEST, "invalid_tenant", "tenant_id không hợp lệ");
    }
    let Ok(can) = db::user_can_access_workspace(
        &st.pool,
        ctx.user_id,
        ctx.home_tenant_id,
        body.tenant_id,
    )
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

async fn api_invite_workspace_member(
    Extension(ctx): Extension<AdminCtx>,
    Json(body): Json<InviteMemberBody>,
) -> impl IntoResponse {
    if admin_auth::on_prem_single_org() {
        return json_error(
            StatusCode::FORBIDDEN,
            "on_prem_mode",
            "Triển khai on-prem — dùng Thêm User để thêm thành viên tổ chức",
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
        return json_error(StatusCode::BAD_REQUEST, "validation_failed", "Nhập username");
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
    let Some(user) = db::fetch_admin_user_by_username(&st.pool, username).await.ok().flatten()
    else {
        return json_error(
            StatusCode::NOT_FOUND,
            "user_not_found",
            "Không tìm thấy user — họ cần tự đăng ký trước",
        );
    };
    if user.id == ctx.user_id {
        return json_error(StatusCode::BAD_REQUEST, "invalid_target", "Không mời chính mình");
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
        return json_error(StatusCode::BAD_REQUEST, "invalid_target", "Không xóa chính mình");
    }
    let Some(target) = db::fetch_admin_user_by_id_any(&st.pool, user_id)
        .await
        .ok()
        .flatten()
    else {
        return json_error(StatusCode::NOT_FOUND, "user_not_found", "User không tồn tại");
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
    let mut res = (
        StatusCode::OK,
        Json(serde_json::json!({ "status": "ok" })),
    )
        .into_response();
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
        return json_error(StatusCode::NOT_FOUND, "disabled", "health endpoint disabled");
    }

    let (db_ok, redis_ok) = if let Some(st) = STATE.get() {
        (
            db::ping(&st.pool).await,
            st.session_store.ping().await == SessionStoreStatus::Up,
        )
    } else {
        (false, false)
    };

    let overall = if db_ok && redis_ok {
        "ok"
    } else {
        "degraded"
    };

    let mut body = serde_json::json!({
        "status": overall,
        "service": "avaso-gateway",
        "version": env!("CARGO_PKG_VERSION"),
        "components": {
            "database": { "status": if db_ok { "up" } else { "down" } },
            "session_store": {
                "status": if redis_ok { "up" } else { "down" },
                "backend": "redis"
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
struct MetricsQuery {
    format: Option<String>,
}

async fn metrics_handler(
    headers: HeaderMap,
    Query(q): Query<MetricsQuery>,
) -> Response {
    let enabled = if let Some(st) = STATE.get() {
        st.config.read().await.settings.enable_metrics
    } else {
        true
    };
    if !enabled {
        return json_error(StatusCode::NOT_FOUND, "disabled", "metrics endpoint disabled");
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

    let client = reqwest::Client::new();
    let result = client.get(backend_url).send().await;

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

async fn api_routes(Extension(ctx): Extension<AdminCtx>) -> impl IntoResponse {
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
        Ok(rows) => Json(rows).into_response(),
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
    #[serde(default = "default_retry_status")]
    retry_on_status: String,
    #[serde(default = "default_one", deserialize_with = "deserialize_i32_or_bool")]
    retry_on_timeout: i32,
    #[serde(default)]
    queue_on_failure: bool,
    #[serde(default = "default_allowed_methods")]
    allowed_methods: String,
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

fn route_policy_from_body(body: &RouteWriteBody) -> (String, String, i32, String, i32, i32) {
    (
        body.transform_add_headers.clone(),
        body.transform_remove_headers.clone(),
        body.retry_max.max(0),
        body.retry_on_status.clone(),
        if body.retry_on_timeout != 0 { 1 } else { 0 },
        if body.queue_on_failure { 1 } else { 0 },
    )
}

fn validate_route_proxy_policy(body: &RouteWriteBody) -> Option<Response> {
    let mut fields = serde_json::Map::new();
    if serde_json::from_str::<serde_json::Map<String, serde_json::Value>>(&body.transform_add_headers)
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
    if let Some(resp) = validate_route_write(
        &path,
        &target,
        body.timeout_secs,
        body.rate_limit_per_min,
    ) {
        return resp;
    }
    if let Some(resp) = validate_route_proxy_policy(&body) {
        return resp;
    }
    let allowed_methods = body.allowed_methods.trim().to_ascii_uppercase();
    if !route_match::validate_allowed_methods(&allowed_methods) {
        return json_error_fields(
            StatusCode::BAD_REQUEST,
            "validation_failed",
            "allowed_methods không hợp lệ",
            serde_json::Map::from_iter([(
                "allowed_methods".into(),
                serde_json::Value::String(
                    "Dùng * hoặc danh sách GET,POST,PUT,DELETE,PATCH,HEAD,OPTIONS".into(),
                ),
            )]),
        );
    }
    let (t_add, t_rm, retry_max, retry_status, retry_timeout, queue_fail) =
        route_policy_from_body(&body);
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
    if let Some(resp) = validate_route_write(
        &path,
        &target,
        body.timeout_secs,
        body.rate_limit_per_min,
    ) {
        return resp;
    }
    if let Some(resp) = validate_route_proxy_policy(&body) {
        return resp;
    }
    let allowed_methods = body.allowed_methods.trim().to_ascii_uppercase();
    if !route_match::validate_allowed_methods(&allowed_methods) {
        return json_error_fields(
            StatusCode::BAD_REQUEST,
            "validation_failed",
            "allowed_methods không hợp lệ",
            serde_json::Map::from_iter([(
                "allowed_methods".into(),
                serde_json::Value::String(
                    "Dùng * hoặc danh sách GET,POST,PUT,DELETE,PATCH,HEAD,OPTIONS".into(),
                ),
            )]),
        );
    }
    let (t_add, t_rm, retry_max, retry_status, retry_timeout, queue_fail) =
        route_policy_from_body(&body);
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
    if !admin_auth::can_access_client_keys(&ctx.role) {
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

async fn api_list_client_keys(Extension(ctx): Extension<AdminCtx>) -> impl IntoResponse {
    if !admin_auth::can_access_client_keys(&ctx.role) {
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
    let admin_scope = ctx.is_admin();
    match db::list_client_keys_scoped(&st.pool, ctx.tenant_id, Some(ctx.user_id), admin_scope).await {
        Ok(rows) => Json(rows).into_response(),
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
    let api_key = db::random_api_key_id();
    let secret_key = db::random_secret_key();
    let integration_type = normalize_integration_type(&body.integration_type);
    let rate_limit = body.rate_limit_per_min;
    if rate_limit < 0 || rate_limit > 1_000_000 {
        let mut fields = serde_json::Map::new();
        fields.insert(
            "rate_limit_per_min".into(),
            serde_json::Value::String("Rate limit phải từ 0 (mặc định route/global) đến 1.000.000 req/min".into()),
        );
        return json_error_fields(
            StatusCode::BAD_REQUEST,
            "validation_failed",
            "Dữ liệu key không hợp lệ",
            fields,
        );
    }
    match db::insert_client_key_hmac(
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
            if !body.route_ids.is_empty() {
                let _ = db::set_client_key_routes(&st.pool, id, ctx.tenant_id, &body.route_ids).await;
            }
            spawn_reload_runtime_config();
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
            (
                StatusCode::CREATED,
                Json(CreateClientKeyResponse {
                    id,
                    name,
                    api_key,
                    secret_key,
                    auth: "hmac-sha256",
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

    match db::insert_client_key_hmac(
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
                let _ = db::set_client_key_routes(&st.pool, id, ctx.tenant_id, &parsed.route_ids).await;
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
                    auth: "hmac-sha256",
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
    if !admin_auth::can_access_client_keys(&ctx.role) {
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
    if !admin_auth::can_access_client_keys(&ctx.role) {
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
    if !admin_auth::can_access_client_keys(&ctx.role) {
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
    let status = body.status.as_deref().map(str::trim).filter(|s| !s.is_empty());
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
    if status.is_none() && body.rate_limit_per_min.is_none() {
        fields.insert(
            "_form".into(),
            serde_json::Value::String("Gửi status và/hoặc rate_limit_per_min".into()),
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
                status,
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
            write_audit(
                &st.pool,
                &ctx,
                "update_client_key_routes",
                &format!("key:{id}"),
                "success",
                None,
                Some(&format!("routes:{}", body.route_ids.len())),
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
    let owner_only = if ctx.is_admin() { None } else { Some(ctx.user_id) };
    match db::bulk_update_client_key_status(&st.pool, ctx.tenant_id, &ids, &status, owner_only).await
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
    match db::rotate_client_key_secret(&st.pool, id, ctx.tenant_id, &secret_key).await {
        Ok(Some(api_key)) => {
            spawn_reload_runtime_config();
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
            (
                StatusCode::OK,
                Json(RotateClientKeyResponse {
                    api_key,
                    secret_key,
                    auth: "hmac-sha256",
                }),
            )
                .into_response()
        }
        Ok(None) => (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({
                "error": "rotate_not_supported",
                "message": "Chỉ client HMAC (avaso_pk_*) mới rotate secret"
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
    email: Option<String>,
}

fn parse_optional_email_field(raw: &Option<String>) -> Result<Option<Option<String>>, serde_json::Map<String, serde_json::Value>> {
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

async fn api_list_users(Extension(ctx): Extension<AdminCtx>) -> impl IntoResponse {
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
        Ok(rows) => Json(rows).into_response(),
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
    match db::insert_admin_user(&st.pool, username, &password_hash, &role, tenant_id, email_ins).await {
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
            "User không thuộc workspace của bạn — không thể sửa",
        );
    }
    let existing = Some(target);
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
                    tracing::error!(user_id = id, tenant_id = target_tenant, "update_user: row missing after update");
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
    let Some(st) = STATE.get() else {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": "state not initialized" })),
        )
            .into_response();
    };
    let Some(item) = st.proxy_queue.take(ctx.tenant_id, &id).await else {
        return (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({ "error": "not_found", "message": "Queue item không tồn tại" })),
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
        Ok((status, body)) => {
            write_audit(
                &st.pool,
                &ctx,
                "proxy_queue_retry",
                &item.path,
                if status.is_success() { "success" } else { "failure" },
                None,
                Some(&format!("status={}", status.as_u16())),
            )
            .await;
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
        Err(e) => {
            st.proxy_queue.push(item).await;
            (
                StatusCode::BAD_GATEWAY,
                Json(serde_json::json!({ "error": "retry_failed", "message": e })),
            )
                .into_response()
        }
    }
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
    if st.proxy_queue.remove(ctx.tenant_id, &id).await {
        write_audit(
            &st.pool,
            &ctx,
            "proxy_queue_discard",
            &id,
            "success",
            None,
            None,
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
            None,
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

async fn api_list_snapshot_records(
    Extension(ctx): Extension<AdminCtx>,
    axum::extract::Query(query): axum::extract::Query<integrations::SnapshotRecordsQuery>,
) -> impl IntoResponse {
    if !ctx.is_admin() {
        return audit_admin_denied(&ctx, "integrations/snapshots/records").await;
    }
    integrations::api_list_snapshot_records(&ctx, query).await
}

async fn api_get_integration_bridge(Extension(ctx): Extension<AdminCtx>) -> impl IntoResponse {
    if !ctx.is_admin() {
        return audit_admin_denied(&ctx, "integrations/bridge").await;
    }
    integrations::api_get_integration_bridge(&ctx).await
}

async fn api_put_integration_bridge(
    Extension(ctx): Extension<AdminCtx>,
    axum::Json(body): axum::Json<integrations::IntegrationBridgeWrite>,
) -> impl IntoResponse {
    if !ctx.is_admin() {
        return audit_admin_denied(&ctx, "integrations/bridge").await;
    }
    integrations::api_put_integration_bridge(&ctx, body).await
}

async fn api_run_integration_bridge(Extension(ctx): Extension<AdminCtx>) -> impl IntoResponse {
    if !ctx.is_admin() {
        return audit_admin_denied(&ctx, "integrations/bridge/run").await;
    }
    integrations::api_run_integration_bridge(&ctx).await
}

async fn api_get_transform_profile(Extension(ctx): Extension<AdminCtx>) -> impl IntoResponse {
    if !ctx.is_admin() {
        return audit_admin_denied(&ctx, "integrations/transform/profile").await;
    }
    integrations::api_get_transform_profile(&ctx).await
}

async fn api_post_transform_preview(
    Extension(ctx): Extension<AdminCtx>,
    Json(body): Json<integrations::TransformPreviewBody>,
) -> impl IntoResponse {
    if !ctx.is_admin() {
        return audit_admin_denied(&ctx, "integrations/transform/preview").await;
    }
    integrations::api_post_transform_preview(&ctx, body).await
}

async fn api_sync_contact_sf_to_zoho(
    Extension(ctx): Extension<AdminCtx>,
    Json(body): Json<integrations::SyncContactBody>,
) -> impl IntoResponse {
    if !ctx.is_admin() {
        return audit_admin_denied(&ctx, "integrations/transform/sync-contact").await;
    }
    integrations::api_sync_contact_sf_to_zoho(&ctx, body).await
}

async fn api_get_opportunity_templates(Extension(ctx): Extension<AdminCtx>) -> impl IntoResponse {
    if !ctx.is_admin() {
        return audit_admin_denied(&ctx, "integrations/opportunity-templates").await;
    }
    integrations::api_get_opportunity_templates(&ctx).await
}

async fn api_put_opportunity_templates(
    Extension(ctx): Extension<AdminCtx>,
    Json(body): Json<integrations::OpportunityTemplateConfigWriteBody>,
) -> impl IntoResponse {
    if !ctx.is_admin() {
        return audit_admin_denied(&ctx, "integrations/opportunity-templates").await;
    }
    integrations::api_put_opportunity_templates(&ctx, body).await
}

async fn api_sync_now(Extension(ctx): Extension<AdminCtx>) -> impl IntoResponse {
    if !ctx.is_admin() {
        return audit_admin_denied(&ctx, "integrations/sync-now").await;
    }
    integrations::api_sync_now(&ctx).await
}

async fn api_list_sync_logs(Extension(ctx): Extension<AdminCtx>) -> impl IntoResponse {
    if !ctx.is_admin() {
        return audit_admin_denied(&ctx, "integrations/sync-logs").await;
    }
    integrations::api_list_sync_logs(&ctx).await
}

async fn api_list_entity_links(Extension(ctx): Extension<AdminCtx>) -> impl IntoResponse {
    if !ctx.is_admin() {
        return audit_admin_denied(&ctx, "integrations/entity-links").await;
    }
    integration_office::api_list_entity_links(&ctx).await
}

async fn api_list_integration_documents(Extension(ctx): Extension<AdminCtx>) -> impl IntoResponse {
    if !ctx.is_admin() {
        return audit_admin_denied(&ctx, "integrations/documents").await;
    }
    integration_office::api_list_documents(&ctx).await
}

async fn api_download_integration_document(
    Extension(ctx): Extension<AdminCtx>,
    Path(id): Path<i64>,
) -> impl IntoResponse {
    if !ctx.is_admin() {
        return audit_admin_denied(&ctx, "integrations/documents/download").await;
    }
    integration_office::api_download_document(&ctx, id).await
}

async fn api_office_config_get(Extension(ctx): Extension<AdminCtx>) -> impl IntoResponse {
    if !ctx.is_admin() {
        return audit_admin_denied(&ctx, "integrations/office/config").await;
    }
    integration_office::api_office_config_get(&ctx).await
}

async fn api_office_config_put(
    Extension(ctx): Extension<AdminCtx>,
    axum::Json(body): axum::Json<integration_office::ZohoOfficeConfigWriteBody>,
) -> impl IntoResponse {
    if !ctx.is_admin() {
        return audit_admin_denied(&ctx, "integrations/office/config").await;
    }
    integration_office::api_office_config_put(&ctx, body).await
}

async fn api_office_test(Extension(ctx): Extension<AdminCtx>) -> impl IntoResponse {
    if !ctx.is_admin() {
        return audit_admin_denied(&ctx, "integrations/office/test").await;
    }
    integration_office::api_office_test(&ctx).await
}

async fn api_reset_integration_sync(Extension(ctx): Extension<AdminCtx>) -> impl IntoResponse {
    if !ctx.is_admin() {
        return audit_admin_denied(&ctx, "integrations/reset-sync").await;
    }
    integrations::api_reset_integration_sync(&ctx).await
}

async fn api_dashboard_stats(Extension(ctx): Extension<AdminCtx>) -> impl IntoResponse {
    dashboard::api_dashboard_stats(&ctx).await
}

#[derive(Debug, serde::Serialize)]
struct MiddlewareStatusResponse {
    data_plane_prefix: &'static str,
    client_registry: dashboard::ClientRegistryStats,
    routes_count: i64,
    hmac_clients_loaded: usize,
    rate_limit_global_enabled: bool,
    rate_limit_global_rps: f64,
    integration_platform: IntegrationPlatformStatus,
}

#[derive(Debug, Serialize)]
struct IntegrationPlatformStatus {
    transform_engine: &'static str,
    canonical_entities: Vec<&'static str>,
    connectors: Vec<&'static str>,
    dlq_storage: &'static str,
    dlq_auto_replay_worker: bool,
    bridge_enabled: bool,
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
    let hmac_clients_loaded = cfg.client_credentials.hmac.len();
    let bridge_row = db::fetch_integration_bridge(&st.pool, ctx.tenant_id)
        .await
        .ok()
        .flatten();
    let bridge_enabled = bridge_row.map(|r| r.enabled != 0).unwrap_or(false);
    let body = MiddlewareStatusResponse {
        data_plane_prefix: data_plane_prefix(),
        client_registry: dashboard::ClientRegistryStats {
            total: active + disabled,
            active,
            disabled,
        },
        routes_count,
        hmac_clients_loaded,
        rate_limit_global_enabled: cfg.settings.rate_limit.enabled,
        rate_limit_global_rps: f64::from(cfg.settings.rate_limit.rps),
        integration_platform: IntegrationPlatformStatus {
            transform_engine: "avaso_transform_v1",
            canonical_entities: vec!["contact"],
            connectors: vec!["salesforce", "zoho_projects"],
            dlq_storage: "postgresql",
            dlq_auto_replay_worker: true,
            bridge_enabled,
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
    let sign_path = canonical_request_path(&uri);
    let key = x_api_key_from_headers(req.headers());
    let (parts, body) = req.into_parts();
    let client_ip = admin_auth::client_ip(&parts.headers);
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
    let verified = match verify_client_auth(
        &state,
        &cfg,
        &parts.headers,
        &method,
        &sign_path,
        &body_bytes,
    ) {
        Ok(v) => v,
        Err(err) => {
            let (status, reason, msg) = client_auth_to_response(err);
            let (log_key_id, log_tenant) = client_identity_for_log(&cfg, &key);
            log_gateway_transaction(
                log_tenant,
                client_ip.as_deref(),
                "denied",
                reason,
                &method,
                &path,
                status.as_u16(),
                &key,
                None,
                0,
                log_key_id,
            );
            return json_error(status, reason, msg);
        }
    };
    spawn_touch_client_key(verified.key_id);
    if canonical_api::parse_canonical_path(data_plane_prefix(), &path).is_some() {
        let (rl_active, rl_rps, rl_burst) =
            resolve_rate_limit(&verified, None, &cfg.settings);
        if rl_active {
            let rl_key = rate_limit_bucket_key(verified.tenant_id, "canonical", &key);
            if let Err(retry_after) =
                try_consume_rate_limit(&state, &rl_key, rl_rps, rl_burst)
            {
                log_gateway_transaction(
                    Some(verified.tenant_id),
                    client_ip.as_deref(),
                    "denied",
                    "rate_limit_exceeded",
                    &method,
                    &path,
                    StatusCode::TOO_MANY_REQUESTS.as_u16(),
                    &key,
                    Some("canonical_transform"),
                    0,
                    Some(verified.key_id),
                );
                return rate_limit_response(retry_after);
            }
        }
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
            &key,
            Some("canonical_transform"),
            0,
            Some(verified.key_id),
        );
        return resp;
    }
    if integrations::parse_integration_proxy_path(data_plane_prefix(), &path).is_some() {
        let (rl_active, rl_rps, rl_burst) =
            resolve_rate_limit(&verified, None, &cfg.settings);
        if rl_active {
            let rl_key = rate_limit_bucket_key(verified.tenant_id, "integration", &key);
            if let Err(retry_after) =
                try_consume_rate_limit(&state, &rl_key, rl_rps, rl_burst)
            {
                log_gateway_transaction(
                    Some(verified.tenant_id),
                    client_ip.as_deref(),
                    "denied",
                    "rate_limit_exceeded",
                    &method,
                    &path,
                    StatusCode::TOO_MANY_REQUESTS.as_u16(),
                    &key,
                    Some("integration_oauth"),
                    0,
                    Some(verified.key_id),
                );
                return rate_limit_response(retry_after);
            }
        }
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
            &key,
            Some("integration_oauth"),
            0,
            Some(verified.key_id),
        );
        return resp;
    }
    let matched = route_match::find_route(&cfg.routes, &method, &path);
    if let Some(matched) = matched {
        let route = matched.route;
        if !client_allows_route(&verified, &route) {
            log_gateway_transaction(
                Some(verified.tenant_id),
                client_ip.as_deref(),
                "denied",
                "route_forbidden",
                &method,
                &path,
                StatusCode::FORBIDDEN.as_u16(),
                &key,
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
        return match do_proxy(state, req, uri, path, route, matched.params, matched.suffix, verified)
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
        &key,
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
    let sign_path = canonical_request_path(&uri);
    let (parts, body) = req.into_parts();
    let body_bytes = axum::body::to_bytes(body, MAX_DATA_PLANE_BODY)
        .await
        .map_err(|_| status_to_json_error(StatusCode::BAD_REQUEST))?;
    let verified = verify_client_auth(
        &state,
        &cfg,
        &parts.headers,
        parts.method.as_str(),
        &sign_path,
        &body_bytes,
    )
    .map_err(|err| {
        let (status, _, _) = client_auth_to_response(err);
        status_to_json_error(status)
    })?;
    if !client_allows_route(&verified, &route) {
        return Err(status_to_json_error(StatusCode::FORBIDDEN));
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

async fn serve_frontend(req: Request<Body>) -> Response {
    let dist_dir = "web/dist";

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

    if resp.status() == StatusCode::NOT_FOUND {
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
    let started = Instant::now();
    let (parts, body) = req.into_parts();

    let cfg = state.config.read().await.clone();
    let key = x_api_key_from_headers(&parts.headers);
    let client_ip = admin_auth::client_ip(&parts.headers);

    let body_bytes = axum::body::to_bytes(body, MAX_DATA_PLANE_BODY)
        .await
        .map_err(|_| status_to_json_error(StatusCode::BAD_REQUEST))?;

    let (rl_active, rl_rps, rl_burst) =
        resolve_rate_limit(&verified, Some(&route), &cfg.settings);

    if rl_active {
        let scope = if verified.rate_limit_per_min > 0 {
            "client".to_string()
        } else if route.rate_limit_per_min > 0 {
            format!("route:{}", route.id)
        } else {
            "global".to_string()
        };
        let rl_key = rate_limit_bucket_key(verified.tenant_id, &scope, &key);
        if let Err(retry_after) = try_consume_rate_limit(&state, &rl_key, rl_rps, rl_burst) {
            let elapsed_ms = started.elapsed().as_millis();
            log_gateway_transaction(
                Some(route.tenant_id),
                client_ip.as_deref(),
                "denied",
                "rate_limit_exceeded",
                parts.method.as_str(),
                &path,
                StatusCode::TOO_MANY_REQUESTS.as_u16(),
                &key,
                Some(&route.target),
                elapsed_ms,
                Some(verified.key_id),
            );
            return Err(rate_limit_response(retry_after));
        }
    }

    let mut url = route_match::build_upstream_url(&route.target, &route_params, &route_suffix);
    if let Some(q) = uri.query() {
        url.push('?');
        url.push_str(q);
    }

    let method = parts.method.clone();
    let headers: HeaderMap = parts.headers.clone();
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

    let elapsed_ms = started.elapsed().as_millis();
    log_gateway_transaction(
        Some(route.tenant_id),
        client_ip.as_deref(),
        log_outcome,
        log_reason,
        parts.method.as_str(),
        &path,
        status.as_u16(),
        &key,
        Some(&route.target),
        elapsed_ms,
        Some(verified.key_id),
    );

    if let Some(qid) = upstream.queued_id.clone() {
        let body_json = serde_json::json!({
            "error": "upstream_failed",
            "message": "Request đã vào hàng đợi (DLQ) sau retry",
            "queue_id": qid,
            "attempts": upstream.attempts,
        });
        return Ok(Response::builder()
            .status(StatusCode::BAD_GATEWAY)
            .header(CONTENT_TYPE, "application/json")
            .header("X-Queue-Id", qid)
            .body(Body::from(body_json.to_string()))
            .map_err(|_| status_to_json_error(StatusCode::BAD_GATEWAY))?);
    }

    let mut builder = Response::builder().status(status);
    if upstream.attempts > 1 {
        builder = builder.header("X-Retry-Attempts", upstream.attempts.to_string());
    }
    for (k, v) in upstream.headers.iter() {
        builder = builder.header(k, v);
    }

    builder
        .body(Body::from(upstream.body))
        .map_err(|_| status_to_json_error(StatusCode::BAD_GATEWAY))
}

#[cfg(test)]
mod path_tests {
    use super::*;
    use axum::http::Uri;
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
    fn parse_bool_setting_values() {
        assert!(parse_bool_setting(Some("true".into()), false));
        assert!(parse_bool_setting(Some("1".into()), false));
        assert!(!parse_bool_setting(Some("off".into()), true));
        assert!(parse_bool_setting(None, true));
    }

    #[test]
    fn token_bucket_allows_burst_then_limits() {
        let start = Instant::now();
        let mut bucket = TokenBucket::new(start, 2);
        assert!(bucket.take(start, 100.0, 2));
        assert!(bucket.take(start, 100.0, 2));
        assert!(!bucket.take(start, 100.0, 2));
        let later = start + Duration::from_secs(1);
        assert!(bucket.take(later, 1.0, 2));
    }

    #[test]
    fn hmac_replay_cache_key_normalizes_sig() {
        assert_eq!(
            hmac_replay_cache_key("pk", "AbCdEf"),
            hmac_replay_cache_key("pk", "abcdef")
        );
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
            retry_on_status: "502".into(),
            retry_on_timeout: 1,
            queue_on_failure: 0,
            allowed_methods: "*".into(),
        }
    }

    #[test]
    fn client_allows_route_tenant_and_acl() {
        let full = VerifiedClient {
            key_id: 1,
            tenant_id: 10,
            rate_limit_per_min: 0,
            allowed_route_ids: vec![],
        };
        let restricted = VerifiedClient {
            key_id: 2,
            tenant_id: 10,
            rate_limit_per_min: 100,
            allowed_route_ids: vec![5],
        };
        let route = test_route(5, 10);
        let other_tenant = test_route(5, 99);
        assert!(client_allows_route(&full, &route));
        assert!(client_allows_route(&restricted, &route));
        assert!(!client_allows_route(&restricted, &test_route(6, 10)));
        assert!(!client_allows_route(&full, &other_tenant));
    }

    #[test]
    fn mask_api_key_for_log_prefix() {
        assert_eq!(mask_api_key_for_log("avaso_pk_abcdefgh"), "avaso_…");
        assert_eq!(mask_api_key_for_log(""), "(none)");
    }
}
