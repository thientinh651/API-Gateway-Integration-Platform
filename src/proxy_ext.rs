//! Request transform, upstream retry, in-memory DLQ (Document.docx optional extensions).

use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use axum::body::Bytes;
use axum::http::{HeaderMap, HeaderName, HeaderValue, Method, StatusCode};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use tokio::sync::RwLock;
use uuid::Uuid;

use crate::RouteRow;

const MAX_QUEUE_ITEMS: usize = 500;
const RETRY_BACKOFF_MS: u64 = 150;

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

#[derive(Clone, Default)]
pub struct ProxyQueue {
    inner: Arc<RwLock<Vec<ProxyQueueItem>>>,
}

impl ProxyQueue {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(RwLock::new(Vec::new())),
        }
    }

    pub async fn push(&self, item: ProxyQueueItem) {
        let mut g = self.inner.write().await;
        if g.len() >= MAX_QUEUE_ITEMS {
            g.remove(0);
        }
        g.push(item);
    }

    pub async fn list(&self, tenant_id: i64) -> Vec<ProxyQueueItem> {
        let g = self.inner.read().await;
        g.iter()
            .filter(|i| i.tenant_id == tenant_id)
            .cloned()
            .collect()
    }

    pub async fn take(&self, tenant_id: i64, id: &str) -> Option<ProxyQueueItem> {
        let mut g = self.inner.write().await;
        if let Some(pos) = g
            .iter()
            .position(|i| i.tenant_id == tenant_id && i.id == id)
        {
            Some(g.remove(pos))
        } else {
            None
        }
    }

    pub async fn remove(&self, tenant_id: i64, id: &str) -> bool {
        self.take(tenant_id, id).await.is_some()
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
