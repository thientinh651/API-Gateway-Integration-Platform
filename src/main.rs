mod db;

use axum::{
    body::Body,
    http::{HeaderMap, Request, StatusCode, Uri},
    middleware::{self, Next},
    response::IntoResponse,
    response::Response,
    routing::{get, post},
    Router,
};
use dashmap::DashMap;
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use std::{
    net::SocketAddr,
    sync::{Arc, OnceLock},
    time::Instant,
};
use tokio::sync::RwLock;
use tower::ServiceExt;
use tower_http::services::{ServeDir, ServeFile};
use tracing::{error, info};

#[derive(Debug, Clone, Deserialize, Serialize, sqlx::FromRow)]
pub struct RouteConfig {
    path: String,
    target: String,
}

/// Fields read from `config.yaml` (operational toggles + optional bootstrap seed).
#[allow(dead_code)]
#[derive(Debug, Clone, Deserialize)]
pub struct YamlBootstrap {
    #[serde(default)]
    routes: Vec<RouteConfig>,
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
            routes: vec![],
            api_keys: vec![],
            rate_limit: RateLimitConfig::default(),
            transform: FeatureToggle::default(),
            retry: FeatureToggle::default(),
            queue: FeatureToggle::default(),
        }
    }
}

/// Runtime config: routes + API key **hashes** loaded from SQLite; rate limit from YAML.
#[derive(Debug, Clone)]
struct AppConfig {
    routes: Vec<RouteConfig>,
    api_key_sha256_hex: Vec<String>,
    admin_api_key_sha256: String,
    rate_limit: RateLimitConfig,
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

#[derive(Clone)]
struct AppState {
    pool: SqlitePool,
    config: Arc<RwLock<AppConfig>>,
    http: reqwest::Client,
    rl: Arc<DashMap<String, TokenBucket>>,
}

static STATE: OnceLock<AppState> = OnceLock::new();

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

    fn take(&mut self, now: Instant, rps: u32, burst: u32) -> bool {
        let elapsed = now.duration_since(self.last_refill);
        let refill = elapsed.as_secs_f64() * (rps as f64);
        self.tokens = (self.tokens + refill).min(burst as f64);
        self.last_refill = now;
        if self.tokens >= 1.0 {
            self.tokens -= 1.0;
            true
        } else {
            false
        }
    }
}

fn read_yaml_bootstrap(path: &str) -> YamlBootstrap {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|raw| serde_yaml::from_str::<YamlBootstrap>(&raw).ok())
        .unwrap_or_default()
}

async fn build_app_config(pool: &SqlitePool) -> Result<AppConfig, sqlx::Error> {
    let yaml = read_yaml_bootstrap("config.yaml");
    let routes = db::load_routes(pool).await?;
    let api_key_sha256_hex = db::load_client_key_hashes(pool).await?;
    let admin_api_key_sha256 = db::load_admin_hash(pool).await?;
    Ok(AppConfig {
        routes,
        api_key_sha256_hex,
        admin_api_key_sha256,
        rate_limit: yaml.rate_limit,
    })
}

async fn reload_runtime_config() -> Result<(), sqlx::Error> {
    let st = STATE.get().expect("STATE not initialized");
    let cfg = build_app_config(&st.pool).await?;
    *st.config.write().await = cfg;
    Ok(())
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_target(false)
        .json()
        .init();

    let database_url =
        std::env::var("DATABASE_URL").unwrap_or_else(|_| "sqlite:data/gateway.db".into());

    let pool = db::connect(&database_url)
        .await
        .expect("open sqlite database");
    db::migrate(&pool)
        .await
        .expect("run migrations");

    let yaml = read_yaml_bootstrap("config.yaml");
    db::bootstrap_from_yaml_if_empty(&pool, &yaml)
        .await
        .expect("bootstrap yaml into db");
    db::ensure_admin_setting(&pool)
        .await
        .expect("ensure admin api key hash in db");

    let initial = build_app_config(&pool)
        .await
        .expect("load config from database");

    let state = AppState {
        pool,
        config: Arc::new(RwLock::new(initial)),
        http: reqwest::Client::new(),
        rl: Arc::new(DashMap::new()),
    };
    let _ = STATE.set(state);

    let api_router = Router::new()
        .route("/proxy", get(proxy_handler))
        .route("/routes", get(api_routes))
        .route("/reload-config", post(api_reload_config))
        .layer(middleware::from_fn(api_key_auth));

    let app = Router::new()
        .nest("/api", api_router)
        .route("/health", get(|| async { "Gateway is healthy!" }))
        .fallback(proxy_or_static);

    let addr = SocketAddr::from(([127, 0, 0, 1], 3000));
    println!("🚀 Gateway đang chạy tại: http://{}", addr);
    println!("📊 Dashboard: http://{}/", addr);
    println!("💾 Database: {}", database_url);
    println!("🔐 Admin API: x-api-key (hash trong SQLite) + POST /api/reload-config");

    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, app.into_make_service_with_connect_info::<SocketAddr>())
        .await
        .unwrap();
}

async fn api_reload_config() -> impl IntoResponse {
    match reload_runtime_config().await {
        Ok(()) => (StatusCode::OK, "config reloaded from database").into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("reload failed: {e}"),
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
            (StatusCode::OK, body).into_response()
        }
        Err(_) => (StatusCode::BAD_GATEWAY, "Lỗi: Không thể kết nối với Backend!").into_response(),
    }
}

async fn api_routes() -> impl IntoResponse {
    let state = STATE.get().expect("STATE not initialized").clone();
    let cfg = state.config.read().await.clone();
    axum::Json(cfg.routes)
}

async fn proxy_or_static(req: Request<Body>) -> Response {
    let state = STATE.get().expect("STATE not initialized").clone();
    let uri: Uri = req.uri().clone();
    let path = uri.path().to_string();

    if path.starts_with("/api/") || path == "/health" {
        return StatusCode::NOT_FOUND.into_response();
    }

    let cfg = state.config.read().await.clone();
    let matched = cfg
        .routes
        .iter()
        .filter(|r| path == r.path || path.starts_with(&(r.path.clone() + "/")))
        .max_by_key(|r| r.path.len())
        .cloned();

    if let Some(route) = matched {
        match do_proxy(state, req, uri, path, route).await {
            Ok(resp) => resp,
            Err(code) => code.into_response(),
        }
    } else {
        serve_frontend(req).await
    }
}

async fn serve_frontend(req: Request<Body>) -> Response {
    let dist_dir = "web";

    let resp = match ServeDir::new(dist_dir)
        .append_index_html_on_directories(true)
        .oneshot(req)
        .await
    {
        Ok(r) => r.into_response(),
        Err(_) => return (StatusCode::INTERNAL_SERVER_ERROR, "static error").into_response(),
    };

    if resp.status() == StatusCode::NOT_FOUND {
        return match ServeFile::new(format!("{dist_dir}/index.html"))
            .oneshot(Request::builder().uri("/").body(Body::empty()).unwrap())
            .await
        {
            Ok(r) => r.into_response(),
            Err(_) => (StatusCode::INTERNAL_SERVER_ERROR, "static error").into_response(),
        };
    }

    resp
}

async fn do_proxy(
    state: AppState,
    req: Request<Body>,
    uri: Uri,
    path: String,
    route: RouteConfig,
) -> Result<Response, StatusCode> {
    let started = Instant::now();
    let (parts, body) = req.into_parts();

    let cfg = state.config.read().await.clone();
    let key = parts
        .headers
        .get("x-api-key")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();

    if !cfg.api_key_sha256_hex.is_empty() {
        let digest = db::sha256_hex(&key);
        if key.is_empty() || !cfg.api_key_sha256_hex.iter().any(|h| h == &digest) {
            return Err(StatusCode::UNAUTHORIZED);
        }
    }

    if cfg.rate_limit.enabled {
        let rl_key = if !key.is_empty() {
            db::sha256_hex(&key)
        } else {
            "anon".to_string()
        };
        let now = Instant::now();
        let mut entry = state
            .rl
            .entry(rl_key)
            .or_insert_with(|| TokenBucket::new(now, cfg.rate_limit.burst));
        if !entry
            .value_mut()
            .take(now, cfg.rate_limit.rps, cfg.rate_limit.burst)
        {
            return Err(StatusCode::TOO_MANY_REQUESTS);
        }
    }

    let suffix = path.strip_prefix(&route.path).unwrap_or("");
    let suffix = if suffix.is_empty() { "/" } else { suffix };

    let mut url = format!("{}{}", route.target.trim_end_matches('/'), suffix);
    if let Some(q) = uri.query() {
        url.push('?');
        url.push_str(q);
    }

    let method = parts.method.clone();
    let headers: HeaderMap = parts.headers.clone();
    let body_bytes = axum::body::to_bytes(body, usize::MAX)
        .await
        .map_err(|_| StatusCode::BAD_REQUEST)?;

    let mut out = state.http.request(method, url);
    for (k, v) in headers.iter() {
        if k == axum::http::header::HOST || k == axum::http::header::CONTENT_LENGTH {
            continue;
        }
        out = out.header(k, v);
    }

    let resp = out
        .body(body_bytes)
        .send()
        .await
        .map_err(|_| StatusCode::BAD_GATEWAY)?;

    let status = resp.status();
    let mut builder = Response::builder().status(status);
    for (k, v) in resp.headers().iter() {
        builder = builder.header(k, v);
    }

    let bytes = resp.bytes().await.map_err(|_| StatusCode::BAD_GATEWAY)?;
    let elapsed_ms = started.elapsed().as_millis();
    info!(
        method = %parts.method,
        path = %path,
        upstream = %route.target,
        status = %status.as_u16(),
        elapsed_ms = %elapsed_ms,
        "proxy_request"
    );

    builder
        .body(Body::from(bytes))
        .map_err(|_| StatusCode::BAD_GATEWAY)
}

async fn api_key_auth(req: Request<axum::body::Body>, next: Next) -> Result<Response, StatusCode> {
    let auth_header = req.headers().get("x-api-key").and_then(|v| v.to_str().ok());

    if let Some(key) = auth_header {
        let st = STATE.get().ok_or(StatusCode::INTERNAL_SERVER_ERROR)?;
        let expected = st.config.read().await.admin_api_key_sha256.clone();
        if db::sha256_hex(key) == expected {
            return Ok(next.run(req).await);
        }
    }

    error!("unauthorized_admin_api");
    Err(StatusCode::UNAUTHORIZED)
}
