//! Sync worker → gateway loopback (`/v1/api/sf/*`, `/v1/api/zoho/*`) for transaction log + rate limit.

use reqwest::StatusCode;
use serde_json::Value;
use std::time::Duration;
use tokio::sync::RwLock;

use crate::db::{self, OAuthClientKey};
use crate::identity::{self, IssuedToken};
use crate::STATE;

pub use crate::db::{
    SYNC_WORKER_API_KEY, SYNC_WORKER_API_KEY_LEGACY, is_sync_worker_client_id,
};

#[derive(Clone)]
pub struct WorkerJwtState {
    pub access_token: String,
    pub expires_at_unix: u64,
    pub client: OAuthClientKey,
}

pub fn sync_worker_jwt_expires_secs() -> u64 {
    std::env::var("SYNC_WORKER_JWT_EXPIRES_SECS")
        .ok()
        .and_then(|s| s.parse().ok())
        .filter(|&n| n > 0)
        .unwrap_or(30 * 24 * 3600)
}

pub fn sync_worker_rate_limit_per_min() -> i32 {
    std::env::var("SYNC_WORKER_RATE_LIMIT_PER_MIN")
        .ok()
        .and_then(|s| s.parse().ok())
        .filter(|&n| n > 0)
        .unwrap_or(10_000)
}

fn gateway_loopback_base() -> String {
    std::env::var("GATEWAY_LOOPBACK_URL").unwrap_or_else(|_| {
        let port = std::env::var("PORT")
            .ok()
            .and_then(|p| p.parse().ok())
            .unwrap_or(3000);
        format!("http://127.0.0.1:{port}")
    })
}

fn data_plane_prefix() -> String {
    match std::env::var("DATA_PLANE_PREFIX") {
        Ok(s) if !s.is_empty() => s,
        Ok(_) => String::new(),
        Err(_) => "/v1/api".into(),
    }
}

fn issue_worker_token(client: &OAuthClientKey) -> Result<IssuedToken, String> {
    identity::issue_client_token_with_expires_secs(client, sync_worker_jwt_expires_secs())
}

pub async fn init_worker_jwt_state(
    pool: &sqlx::PgPool,
    tenant_id: i64,
) -> Result<WorkerJwtState, String> {
    let client = db::ensure_sync_worker_client_key(pool, tenant_id)
        .await
        .map_err(|e| format!("ensure sync worker client: {e}"))?;
    let issued = issue_worker_token(&client)?;
    tracing::info!(
        client_id = %client.client_id,
        expires_in = issued.response.expires_in,
        rate_limit_per_min = client.rate_limit_per_min,
        "sync worker JWT ready for gateway loopback"
    );
    Ok(WorkerJwtState {
        access_token: issued.response.access_token,
        expires_at_unix: issued.claims.exp as u64,
        client,
    })
}

async fn refresh_worker_jwt_if_needed(state: &crate::AppState) -> Result<String, String> {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    {
        let guard = state.worker_jwt.read().await;
        if !guard.access_token.is_empty() && guard.expires_at_unix > now + 300 {
            return Ok(guard.access_token.clone());
        }
    }
    let mut guard = state.worker_jwt.write().await;
    if !guard.access_token.is_empty() && guard.expires_at_unix > now + 300 {
        return Ok(guard.access_token.clone());
    }
    let creds = state.config.read().await.client_credentials.clone();
    let fresh_client = creds
        .oauth_clients
        .iter()
        .find(|c| is_sync_worker_client_id(&c.client_id))
        .cloned()
        .unwrap_or_else(|| guard.client.clone());
    let issued = issue_worker_token(&fresh_client)?;
    guard.access_token = issued.response.access_token.clone();
    guard.expires_at_unix = issued.claims.exp as u64;
    guard.client = fresh_client;
    tracing::info!(
        client_id = %guard.client.client_id,
        expires_at = guard.expires_at_unix,
        "sync worker JWT renewed"
    );
    Ok(guard.access_token.clone())
}

fn integration_loopback_url(provider: &str, path: &str, query: Option<&str>) -> Result<String, String> {
    let prefix = data_plane_prefix();
    if prefix.is_empty() {
        return Err("DATA_PLANE_PREFIX rỗng — không thể loopback integration proxy".into());
    }
    let base = gateway_loopback_base().trim_end_matches('/').to_string();
    let p = path.trim();
    let suffix = if p.is_empty() {
        String::new()
    } else if p.starts_with('/') {
        p.to_string()
    } else {
        format!("/{p}")
    };
    let mut url = format!("{base}{prefix}/{provider}{suffix}");
    if let Some(q) = query.filter(|s| !s.is_empty()) {
        if url.contains('?') {
            url.push('&');
        } else {
            url.push('?');
        }
        url.push_str(q);
    }
    Ok(url)
}

fn loopback_retryable(err: &str) -> bool {
    let e = err.to_ascii_lowercase();
    e.contains("connection refused")
        || e.contains("connect")
        || e.contains("timed out")
        || e.contains("timeout")
        || e.contains("broken pipe")
}

pub async fn integration_request_via_gateway(
    method: &str,
    provider: &str,
    path: &str,
    query: Option<&str>,
    body: Option<&[u8]>,
    content_type: Option<&str>,
) -> Result<(StatusCode, Vec<u8>), String> {
    let st = STATE.get().ok_or_else(|| "state not initialized".to_string())?;
    let url = integration_loopback_url(provider, path, query)?;
    let max_attempts = 3u32;
    let mut last_err = String::new();

    for attempt in 1..=max_attempts {
        let token = refresh_worker_jwt_if_needed(st).await?;
        let req_method = reqwest::Method::from_bytes(method.as_bytes())
            .map_err(|_| format!("unsupported method {method}"))?;
        let mut req = st.http.request(req_method, &url).bearer_auth(&token);
        if let Some(ct) = content_type {
            req = req.header(reqwest::header::CONTENT_TYPE, ct);
        }
        if let Some(b) = body.filter(|b| !b.is_empty()) {
            req = req.body(b.to_vec());
        }

        let res = match req.send().await {
            Ok(r) => r,
            Err(e) => {
                last_err = format!("gateway loopback http: {e}");
                if loopback_retryable(&last_err) && attempt < max_attempts {
                    tokio::time::sleep(Duration::from_millis(400 * u64::from(attempt))).await;
                    continue;
                }
                tracing::error!(url = %url, error = %last_err, attempt, "sync worker gateway loopback failed");
                return Err(last_err);
            }
        };

        let status = res.status();
        let bytes = res
            .bytes()
            .await
            .map_err(|e| format!("gateway loopback body: {e}"))?
            .to_vec();

        if status == StatusCode::UNAUTHORIZED && attempt < max_attempts {
            tracing::warn!(url = %url, "sync worker JWT rejected — renew and retry");
            {
                let mut guard = st.worker_jwt.write().await;
                guard.expires_at_unix = 0;
            }
            continue;
        }

        if !status.is_success() {
            let preview = String::from_utf8_lossy(&bytes[..bytes.len().min(400)]);
            tracing::warn!(
                url = %url,
                status = status.as_u16(),
                body = %preview,
                "sync worker gateway loopback upstream error"
            );
        }
        return Ok((status, bytes));
    }
    Err(if last_err.is_empty() {
        "gateway loopback failed after retries".into()
    } else {
        last_err
    })
}

pub async fn sf_get_via_gateway(path: &str) -> Result<Value, String> {
    let (status, bytes) = integration_request_via_gateway("GET", "sf", path, None, None, None).await?;
    let text = String::from_utf8_lossy(&bytes).to_string();
    if !status.is_success() {
        return Err(format!("SF via gateway HTTP {}: {}", status.as_u16(), text));
    }
    serde_json::from_str(&text).map_err(|e| format!("SF via gateway json: {e} — body: {text}"))
}

pub async fn zoho_get_via_gateway(path: &str, query: Option<&str>) -> Result<Value, String> {
    let (status, bytes) =
        integration_request_via_gateway("GET", "zoho", path, query, None, None).await?;
    let text = String::from_utf8_lossy(&bytes).to_string();
    if !status.is_success() {
        return Err(format!("Zoho via gateway HTTP {}: {}", status.as_u16(), text));
    }
    serde_json::from_str(&text).map_err(|e| format!("Zoho via gateway json: {e} — body: {text}"))
}

pub async fn zoho_post_via_gateway(path: &str, body: &Value) -> Result<Value, String> {
    let payload = serde_json::to_vec(body).map_err(|e| format!("serialize: {e}"))?;
    let (status, bytes) = integration_request_via_gateway(
        "POST",
        "zoho",
        path,
        None,
        Some(&payload),
        Some("application/json"),
    )
    .await?;
    let text = String::from_utf8_lossy(&bytes).to_string();
    if !status.is_success() {
        return Err(crate::integrations::compact_zoho_api_error(status, &text));
    }
    if text.trim().is_empty() {
        return Ok(Value::Object(serde_json::Map::new()));
    }
    serde_json::from_str(&text).map_err(|e| format!("json: {e} — body: {text}"))
}

pub async fn zoho_put_via_gateway(path: &str, body: &Value) -> Result<Value, String> {
    let payload = serde_json::to_vec(body).map_err(|e| format!("serialize: {e}"))?;
    let (status, bytes) = integration_request_via_gateway(
        "PUT",
        "zoho",
        path,
        None,
        Some(&payload),
        Some("application/json"),
    )
    .await?;
    let text = String::from_utf8_lossy(&bytes).to_string();
    if !status.is_success() {
        return Err(crate::integrations::compact_zoho_api_error(status, &text));
    }
    if text.trim().is_empty() {
        return Ok(Value::Object(serde_json::Map::new()));
    }
    serde_json::from_str(&text).map_err(|e| format!("json: {e} — body: {text}"))
}
