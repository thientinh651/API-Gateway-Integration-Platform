//! Request transform, upstream retry, persistent DLQ (PostgreSQL) + background replay worker.

use std::collections::HashMap;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use axum::body::Bytes;
use axum::http::{HeaderMap, HeaderName, HeaderValue, Method, StatusCode};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use base64::{engine::general_purpose::STANDARD, Engine as _};
use sqlx::PgPool;
use uuid::Uuid;

use crate::RouteRow;

const MAX_QUEUE_ITEMS: usize = 500;
const RETRY_BACKOFF_MS: u64 = 150;
const DLQ_WORKER_INTERVAL_SECS: u64 = 60;
const DLQ_WORKER_BATCH: i64 = 10;
const DLQ_WORKER_MAX_AUTO_ATTEMPTS: u32 = 5;

pub const DLQ_STATUS_PENDING: &str = "pending";
pub const DLQ_STATUS_REPLAYED: &str = "replayed";
pub const DLQ_STATUS_FAILED_PERMANENT: &str = "failed_permanent";
const DLQ_WORKER_DEFAULT_TIMEOUT_SECS: u64 = 30;

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ExtensionToggles {
    pub transform_enabled: bool,
    pub retry_enabled: bool,
    pub queue_enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RouteProxyPolicy {
    pub transform_add_headers: HashMap<String, String>,
    pub transform_remove_headers: Vec<String>,
    pub retry_max: u32,
    pub retry_on_status: Vec<u16>,
    pub retry_on_timeout: bool,
    pub queue_on_failure: bool,
}

impl RouteProxyPolicy {
    pub fn from_row(row: &RouteRow) -> Self {
        let transform_add_headers =
            serde_json::from_str(&row.transform_add_headers).unwrap_or_default();
        let transform_remove_headers =
            serde_json::from_str(&row.transform_remove_headers).unwrap_or_default();
        Self {
            transform_add_headers,
            transform_remove_headers,
            retry_max: row.retry_max.max(0) as u32,
            retry_on_status: parse_status_list(&row.retry_on_status),
            retry_on_timeout: row.retry_on_timeout != 0,
            queue_on_failure: row.queue_on_failure != 0,
        }
    }
}

fn parse_status_list(raw: &str) -> Vec<u16> {
    raw.split(',')
        .filter_map(|s| s.trim().parse::<u16>().ok())
        .collect()
}

pub fn method_idempotent(method: &Method) -> bool {
    matches!(
        method.as_str(),
        "GET" | "HEAD" | "PUT" | "DELETE" | "OPTIONS" | "TRACE"
    )
}

pub fn apply_request_transform(
    headers: &mut HeaderMap,
    policy: &RouteProxyPolicy,
    global_transform: bool,
) {
    if !global_transform {
        return;
    }
    for name in &policy.transform_remove_headers {
        if let Ok(h) = HeaderName::from_bytes(name.as_bytes()) {
            headers.remove(h);
        }
    }
    for (k, v) in &policy.transform_add_headers {
        if let (Ok(hn), Ok(hv)) = (
            HeaderName::from_bytes(k.as_bytes()),
            HeaderValue::from_str(v),
        ) {
            headers.insert(hn, hv);
        }
    }
}

#[derive(Debug)]
enum UpstreamFailure {
    Timeout,
    Connection(String),
}

pub struct UpstreamResponse {
    pub status: StatusCode,
    pub headers: HeaderMap,
    pub body: Bytes,
    pub attempts: u32,
    pub queued_id: Option<String>,
}

async fn backoff(attempt: u32) {
    let ms = RETRY_BACKOFF_MS.saturating_mul(1 << attempt.min(4));
    tokio::time::sleep(Duration::from_millis(ms)).await;
}

async fn send_upstream_once(
    http: &Client,
    method: &Method,
    url: &str,
    headers: &HeaderMap,
    body: &Bytes,
    timeout_secs: u64,
) -> Result<(StatusCode, HeaderMap, Bytes), UpstreamFailure> {
    let mut req = http.request(method.clone(), url);
    for (k, v) in headers.iter() {
        if k == axum::http::header::HOST || k == axum::http::header::CONTENT_LENGTH {
            continue;
        }
        req = req.header(k, v);
    }
    let resp = req
        .timeout(Duration::from_secs(timeout_secs.max(1)))
        .body(body.clone())
        .send()
        .await
        .map_err(|e| {
            if e.is_timeout() {
                UpstreamFailure::Timeout
            } else {
                UpstreamFailure::Connection(e.to_string())
            }
        })?;
    let status = StatusCode::from_u16(resp.status().as_u16()).unwrap_or(StatusCode::BAD_GATEWAY);
    let mut out_headers = HeaderMap::new();
    for (k, v) in resp.headers().iter() {
        out_headers.insert(k.clone(), v.clone());
    }
    let bytes = resp
        .bytes()
        .await
        .map_err(|e| UpstreamFailure::Connection(e.to_string()))?;
    Ok((status, out_headers, bytes))
}

#[derive(Debug, Clone, Serialize)]
pub struct ProxyQueueItem {
    pub id: String,
    pub tenant_id: i64,
    pub route_id: i64,
    pub method: String,
    pub path: String,
    pub upstream_url: String,
    pub headers: HashMap<String, String>,
    #[serde(with = "base64_bytes")]
    pub body: Vec<u8>,
    pub failure_reason: String,
    pub retry_attempts: u32,
    pub created_at_unix: u64,
    pub status: String,
    pub replayed_at: Option<String>,
}

mod base64_bytes {
    use base64::{engine::general_purpose::STANDARD, Engine as _};
    use serde::{Deserialize, Deserializer, Serializer};

    pub fn serialize<S: Serializer>(v: &Vec<u8>, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&STANDARD.encode(v))
    }

    pub fn deserialize<'de, D: Deserializer<'de>>(d: D) -> Result<Vec<u8>, D::Error> {
        let s = String::deserialize(d)?;
        STANDARD.decode(s).map_err(serde::de::Error::custom)
    }
}

type QueueRow = (
    String,
    i64,
    i64,
    String,
    String,
    String,
    String,
    String,
    String,
    i32,
    i64,
    String,
    Option<String>,
);

fn row_to_item(r: QueueRow) -> Option<ProxyQueueItem> {
    let headers: HashMap<String, String> = serde_json::from_str(&r.6).unwrap_or_default();
    let body = STANDARD.decode(r.7).ok()?;
    Some(ProxyQueueItem {
        id: r.0,
        tenant_id: r.1,
        route_id: r.2,
        method: r.3,
        path: r.4,
        upstream_url: r.5,
        headers,
        body,
        failure_reason: r.8,
        retry_attempts: r.9.max(0) as u32,
        created_at_unix: r.10.max(0) as u64,
        status: if r.11.is_empty() {
            DLQ_STATUS_PENDING.into()
        } else {
            r.11
        },
        replayed_at: r.12,
    })
}

const QUEUE_SELECT: &str = "SELECT id, tenant_id, route_id, method, path, upstream_url, headers_json, body_b64, failure_reason, retry_attempts, created_at_unix, status, replayed_at::text";

#[derive(Clone)]
pub struct ProxyQueue {
    pool: PgPool,
}

impl ProxyQueue {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    pub async fn push(&self, item: ProxyQueueItem) {
        let headers_json = serde_json::to_string(&item.headers).unwrap_or_else(|_| "{}".into());
        let body_b64 = STANDARD.encode(&item.body);
        if let Err(e) = sqlx::query(
            "INSERT INTO gateway_proxy_queue (id, tenant_id, route_id, method, path, upstream_url, headers_json, body_b64, failure_reason, retry_attempts, created_at_unix, status)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)",
        )
        .bind(&item.id)
        .bind(item.tenant_id)
        .bind(item.route_id)
        .bind(&item.method)
        .bind(&item.path)
        .bind(&item.upstream_url)
        .bind(&headers_json)
        .bind(&body_b64)
        .bind(&item.failure_reason)
        .bind(item.retry_attempts as i32)
        .bind(item.created_at_unix as i64)
        .bind(DLQ_STATUS_PENDING)
        .execute(&self.pool)
        .await
        {
            tracing::warn!(error = %e, queue_id = %item.id, "proxy_queue push failed");
            return;
        }
        if let Ok(count) = sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM gateway_proxy_queue")
            .fetch_one(&self.pool)
            .await
        {
            if count as usize > MAX_QUEUE_ITEMS {
                let overflow = count as usize - MAX_QUEUE_ITEMS;
                let _ = sqlx::query(
                    "DELETE FROM gateway_proxy_queue WHERE id IN (
                        SELECT id FROM gateway_proxy_queue ORDER BY created_at ASC LIMIT $1
                    )",
                )
                .bind(overflow as i64)
                .execute(&self.pool)
                .await;
            }
        }
    }

    pub async fn list(&self, tenant_id: i64) -> Vec<ProxyQueueItem> {
        let sql = format!(
            "{QUEUE_SELECT} FROM gateway_proxy_queue WHERE tenant_id = $1 ORDER BY created_at ASC"
        );
        let rows = sqlx::query_as::<_, QueueRow>(&sql)
            .bind(tenant_id)
            .fetch_all(&self.pool)
            .await
            .unwrap_or_default();
        rows.into_iter().filter_map(row_to_item).collect()
    }

    pub async fn fetch_for_retry(&self, tenant_id: i64, id: &str) -> Option<ProxyQueueItem> {
        let sql = format!(
            "{QUEUE_SELECT} FROM gateway_proxy_queue WHERE tenant_id = $1 AND id = $2 AND status IN ('pending', 'failed_permanent')"
        );
        let row = sqlx::query_as::<_, QueueRow>(&sql)
            .bind(tenant_id)
            .bind(id)
            .fetch_optional(&self.pool)
            .await
            .ok()
            .flatten()?;
        row_to_item(row)
    }

    pub async fn take(&self, tenant_id: i64, id: &str) -> Option<ProxyQueueItem> {
        let sql = format!(
            "DELETE FROM gateway_proxy_queue WHERE tenant_id = $1 AND id = $2 RETURNING id, tenant_id, route_id, method, path, upstream_url, headers_json, body_b64, failure_reason, retry_attempts, created_at_unix, status, replayed_at::text"
        );
        let row = sqlx::query_as::<_, QueueRow>(&sql)
        .fetch_optional(&self.pool)
        .await
        .ok()
        .flatten()?;
        row_to_item(row)
    }

    pub async fn remove(&self, tenant_id: i64, id: &str) -> bool {
        sqlx::query("DELETE FROM gateway_proxy_queue WHERE tenant_id = $1 AND id = $2")
            .bind(tenant_id)
            .bind(id)
            .execute(&self.pool)
            .await
            .map(|r| r.rows_affected() > 0)
            .unwrap_or(false)
    }

    pub async fn remove_many(&self, tenant_id: i64, ids: &[String]) -> u64 {
        if ids.is_empty() {
            return 0;
        }
        sqlx::query("DELETE FROM gateway_proxy_queue WHERE tenant_id = $1 AND id = ANY($2)")
            .bind(tenant_id)
            .bind(ids)
            .execute(&self.pool)
            .await
            .map(|r| r.rows_affected())
            .unwrap_or(0)
    }

    /// Oldest pending items across tenants — for background DLQ worker.
    pub async fn list_oldest(&self, limit: i64) -> Vec<ProxyQueueItem> {
        let sql = format!(
            "{QUEUE_SELECT} FROM gateway_proxy_queue WHERE status = 'pending' ORDER BY created_at ASC LIMIT $1"
        );
        let rows = sqlx::query_as::<_, QueueRow>(&sql)
            .bind(limit)
            .fetch_all(&self.pool)
            .await
            .unwrap_or_default();
        rows.into_iter().filter_map(row_to_item).collect()
    }

    pub async fn update_attempts(&self, tenant_id: i64, id: &str, attempts: u32) -> bool {
        sqlx::query(
            "UPDATE gateway_proxy_queue SET retry_attempts = $3, status = 'pending' WHERE tenant_id = $1 AND id = $2",
        )
        .bind(tenant_id)
        .bind(id)
        .bind(attempts as i32)
        .execute(&self.pool)
        .await
        .map(|r| r.rows_affected() > 0)
        .unwrap_or(false)
    }

    pub async fn mark_replayed(&self, tenant_id: i64, id: &str) -> bool {
        sqlx::query(
            "UPDATE gateway_proxy_queue SET status = $3, replayed_at = NOW() WHERE tenant_id = $1 AND id = $2",
        )
        .bind(tenant_id)
        .bind(id)
        .bind(DLQ_STATUS_REPLAYED)
        .execute(&self.pool)
        .await
        .map(|r| r.rows_affected() > 0)
        .unwrap_or(false)
    }

    pub async fn mark_failed_permanent(&self, tenant_id: i64, id: &str) -> bool {
        sqlx::query(
            "UPDATE gateway_proxy_queue SET status = $3 WHERE tenant_id = $1 AND id = $2",
        )
        .bind(tenant_id)
        .bind(id)
        .bind(DLQ_STATUS_FAILED_PERMANENT)
        .execute(&self.pool)
        .await
        .map(|r| r.rows_affected() > 0)
        .unwrap_or(false)
    }

    pub async fn record_retry_failure(&self, tenant_id: i64, id: &str, attempts: u32) -> bool {
        let status = if attempts >= DLQ_WORKER_MAX_AUTO_ATTEMPTS {
            DLQ_STATUS_FAILED_PERMANENT
        } else {
            DLQ_STATUS_PENDING
        };
        sqlx::query(
            "UPDATE gateway_proxy_queue SET retry_attempts = $3, status = $4 WHERE tenant_id = $1 AND id = $2",
        )
        .bind(tenant_id)
        .bind(id)
        .bind(attempts as i32)
        .bind(status)
        .execute(&self.pool)
        .await
        .map(|r| r.rows_affected() > 0)
        .unwrap_or(false)
    }
}

fn now_unix() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// Global DLQ bật → mọi route; tắt global thì chỉ route có `queue_on_failure`.
fn dlq_enabled(toggles: &ExtensionToggles, policy: &RouteProxyPolicy) -> bool {
    toggles.queue_enabled || policy.queue_on_failure
}

/// HTTP status đủ điều kiện vào DLQ sau khi hết retry (5xx hoặc status trong retry_on_status).
fn is_queueable_http_status(
    status: StatusCode,
    policy: &RouteProxyPolicy,
    retry_allowed: bool,
) -> bool {
    if status.is_success() {
        return false;
    }
    let code = status.as_u16();
    if code >= 500 {
        return true;
    }
    retry_allowed && policy.retry_on_status.contains(&code)
}

pub async fn forward_with_policy(
    http: &Client,
    method: &Method,
    url: &str,
    mut headers: HeaderMap,
    body: Bytes,
    timeout_secs: u64,
    policy: &RouteProxyPolicy,
    toggles: &ExtensionToggles,
    queue: &ProxyQueue,
    tenant_id: i64,
    route: &RouteRow,
    client_path: &str,
) -> UpstreamResponse {
    apply_request_transform(&mut headers, policy, toggles.transform_enabled);

    let retry_allowed =
        toggles.retry_enabled && policy.retry_max > 0 && method_idempotent(method);
    let max_attempts = if retry_allowed {
        1 + policy.retry_max
    } else {
        1
    };

    let mut last_status = StatusCode::BAD_GATEWAY;
    let mut last_headers = HeaderMap::new();
    let mut last_body = Bytes::new();
    let mut last_reason = String::from("upstream_error");
    let mut attempts = 0u32;

    for attempt in 0..max_attempts {
        attempts = attempt + 1;
        if attempt > 0 {
            backoff(attempt - 1).await;
        }
        match send_upstream_once(http, method, url, &headers, &body, timeout_secs).await {
            Ok((status, hdrs, bytes)) => {
                last_status = status;
                last_headers = hdrs;
                last_body = bytes;
                let code = status.as_u16();
                if retry_allowed
                    && attempt + 1 < max_attempts
                    && policy.retry_on_status.contains(&code)
                {
                    last_reason = format!("retry_on_status:{code}");
                    continue;
                }
                if !is_queueable_http_status(status, policy, retry_allowed) {
                    return UpstreamResponse {
                        status,
                        headers: last_headers,
                        body: last_body,
                        attempts,
                        queued_id: None,
                    };
                }
                last_reason = format!("upstream_status:{code}");
                break;
            }
            Err(UpstreamFailure::Timeout) => {
                last_status = StatusCode::GATEWAY_TIMEOUT;
                last_reason = "upstream_timeout".into();
                if retry_allowed
                    && policy.retry_on_timeout
                    && attempt + 1 < max_attempts
                {
                    continue;
                }
            }
            Err(UpstreamFailure::Connection(e)) => {
                last_status = StatusCode::BAD_GATEWAY;
                last_reason = format!("upstream_connection:{e}");
                if retry_allowed && attempt + 1 < max_attempts {
                    continue;
                }
            }
        }
    }

    let mut queued_id = None;
    if dlq_enabled(toggles, policy) {
        let id = Uuid::new_v4().to_string();
        let headers_map: HashMap<String, String> = headers
            .iter()
            .filter_map(|(k, v)| v.to_str().ok().map(|s| (k.as_str().to_string(), s.to_string())))
            .collect();
        queue
            .push(ProxyQueueItem {
                id: id.clone(),
                tenant_id,
                route_id: route.id,
                method: method.as_str().to_string(),
                path: client_path.to_string(),
                upstream_url: url.to_string(),
                headers: headers_map,
                body: body.to_vec(),
                failure_reason: last_reason.clone(),
                retry_attempts: attempts,
                created_at_unix: now_unix(),
                status: DLQ_STATUS_PENDING.into(),
                replayed_at: None,
            })
            .await;
        queued_id = Some(id);
    }

    UpstreamResponse {
        status: last_status,
        headers: last_headers,
        body: last_body,
        attempts,
        queued_id,
    }
}

pub async fn replay_queue_item(
    http: &Client,
    item: &ProxyQueueItem,
    timeout_secs: u64,
) -> Result<(StatusCode, Vec<u8>), String> {
    let method = Method::from_bytes(item.method.as_bytes()).map_err(|e| e.to_string())?;
    let mut headers = HeaderMap::new();
    for (k, v) in &item.headers {
        if let (Ok(hn), Ok(hv)) = (
            HeaderName::from_bytes(k.as_bytes()),
            HeaderValue::from_str(v),
        ) {
            headers.insert(hn, hv);
        }
    }
    let body = Bytes::from(item.body.clone());
    match send_upstream_once(http, &method, &item.upstream_url, &headers, &body, timeout_secs).await
    {
        Ok((status, _, bytes)) => Ok((status, bytes.to_vec())),
        Err(UpstreamFailure::Timeout) => Err("upstream_timeout".into()),
        Err(UpstreamFailure::Connection(e)) => Err(e),
    }
}

async fn route_timeout_secs(pool: &PgPool, route_id: i64) -> u64 {
    sqlx::query_scalar::<_, i32>("SELECT timeout_secs FROM gateway_routes WHERE id = $1")
        .bind(route_id)
        .fetch_optional(pool)
        .await
        .ok()
        .flatten()
        .map(|t| t.max(1) as u64)
        .unwrap_or(DLQ_WORKER_DEFAULT_TIMEOUT_SECS)
}

/// Background worker: tự replay DLQ khi `runtime_queue_enabled` bật (PostgreSQL-backed).
pub fn spawn_dlq_replay_worker(pool: PgPool) {
    if std::env::var("DLQ_WORKER_DISABLED")
        .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
        .unwrap_or(false)
    {
        tracing::info!("DLQ auto-replay worker disabled (DLQ_WORKER_DISABLED)");
        return;
    }
    tokio::spawn(async move {
        let queue = ProxyQueue::new(pool.clone());
        let http = Client::new();
        let mut ticker = tokio::time::interval(Duration::from_secs(DLQ_WORKER_INTERVAL_SECS));
        ticker.tick().await;
        tracing::info!(
            interval_secs = DLQ_WORKER_INTERVAL_SECS,
            "DLQ auto-replay worker started (PostgreSQL queue)"
        );
        loop {
            ticker.tick().await;
            let queue_enabled = match crate::STATE.get() {
                Some(st) => st.config.read().await.settings.extensions.queue_enabled,
                None => false,
            };
            if !queue_enabled {
                continue;
            }
            let items = queue.list_oldest(DLQ_WORKER_BATCH).await;
            for item in items {
                if item.retry_attempts >= DLQ_WORKER_MAX_AUTO_ATTEMPTS {
                    let _ = queue
                        .mark_failed_permanent(item.tenant_id, &item.id)
                        .await;
                    continue;
                }
                let timeout = route_timeout_secs(&pool, item.route_id).await;
                match replay_queue_item(&http, &item, timeout).await {
                    Ok((status, _)) if status.is_success() => {
                        let _ = queue.mark_replayed(item.tenant_id, &item.id).await;
                        tracing::info!(queue_id = %item.id, "dlq_worker replay success");
                    }
                    Ok((status, _)) => {
                        let next = item.retry_attempts + 1;
                        let _ = queue
                            .record_retry_failure(item.tenant_id, &item.id, next)
                            .await;
                        tracing::warn!(
                            queue_id = %item.id,
                            status = status.as_u16(),
                            attempts = next,
                            "dlq_worker replay upstream failure"
                        );
                    }
                    Err(e) => {
                        let next = item.retry_attempts + 1;
                        let _ = queue
                            .record_retry_failure(item.tenant_id, &item.id, next)
                            .await;
                        tracing::warn!(
                            queue_id = %item.id,
                            error = %e,
                            attempts = next,
                            "dlq_worker replay error"
                        );
                    }
                }
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn policy_with_retry_status() -> RouteProxyPolicy {
        RouteProxyPolicy {
            transform_add_headers: HashMap::new(),
            transform_remove_headers: vec![],
            retry_max: 2,
            retry_on_status: vec![502, 503, 504],
            retry_on_timeout: true,
            queue_on_failure: false,
        }
    }

    #[test]
    fn dlq_global_on_without_per_route() {
        let toggles = ExtensionToggles {
            queue_enabled: true,
            ..Default::default()
        };
        let policy = RouteProxyPolicy {
            queue_on_failure: false,
            ..policy_with_retry_status()
        };
        assert!(dlq_enabled(&toggles, &policy));
    }

    #[test]
    fn dlq_per_route_when_global_off() {
        let toggles = ExtensionToggles::default();
        let policy = RouteProxyPolicy {
            queue_on_failure: true,
            ..policy_with_retry_status()
        };
        assert!(dlq_enabled(&toggles, &policy));
    }

    #[test]
    fn dlq_off_when_both_off() {
        let toggles = ExtensionToggles::default();
        let policy = RouteProxyPolicy {
            queue_on_failure: false,
            ..policy_with_retry_status()
        };
        assert!(!dlq_enabled(&toggles, &policy));
    }

    #[test]
    fn queueable_http_5xx() {
        let policy = policy_with_retry_status();
        assert!(is_queueable_http_status(
            StatusCode::SERVICE_UNAVAILABLE,
            &policy,
            true
        ));
    }

    #[test]
    fn not_queueable_2xx_or_404() {
        let policy = policy_with_retry_status();
        assert!(!is_queueable_http_status(StatusCode::OK, &policy, true));
        assert!(!is_queueable_http_status(StatusCode::NOT_FOUND, &policy, true));
    }
}
