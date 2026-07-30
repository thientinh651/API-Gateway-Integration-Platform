//! Canonical data-plane API — clients speak unified schema; gateway transforms per provider.

use axum::http::StatusCode;
use axum::response::Response;

use crate::STATE;
use crate::integrations::{self, IntegrationProxyProvider, sf_request_raw_with_refresh};
use crate::json_error;
use crate::transform;

#[derive(Debug, Clone)]
pub struct CanonicalTarget {
    pub entity: String,
    pub id: Option<String>,
}

/// Paths: `{prefix}/canonical/contacts`, `{prefix}/canonical/contacts/{id}`
pub fn parse_canonical_path(data_plane_prefix: &str, path: &str) -> Option<CanonicalTarget> {
    let prefix = data_plane_prefix.trim_end_matches('/');
    if prefix.is_empty() {
        return None;
    }
    let base = format!("{prefix}/canonical");
    let rest = if path == base {
        return None;
    } else if let Some(r) = path.strip_prefix(&format!("{base}/")) {
        r
    } else {
        return None;
    };
    let mut parts = rest.split('/').filter(|s| !s.is_empty());
    let entity = parts.next()?.to_string();
    if entity != "contacts" {
        return None;
    }
    let id = parts.next().map(|s| s.to_string());
    if parts.next().is_some() {
        return None;
    }
    Some(CanonicalTarget { entity, id })
}

fn query_param<'a>(query: Option<&'a str>, key: &str) -> Option<&'a str> {
    let q = query?;
    for pair in q.split('&') {
        let mut kv = pair.splitn(2, '=');
        if kv.next()? == key {
            return kv.next();
        }
    }
    None
}

fn parse_target(query: Option<&str>) -> Result<IntegrationProxyProvider, &'static str> {
    match query_param(query, "target").unwrap_or("sf") {
        "sf" | "salesforce" => Ok(IntegrationProxyProvider::Salesforce),
        "zoho" | "zoho_projects" => Ok(IntegrationProxyProvider::Zoho),
        _ => Err("target must be sf or zoho"),
    }
}

const SF_CONTACT_FIELDS: &str = "Id,FirstName,LastName,Name,Email,Phone";

pub async fn canonical_data_plane_proxy(
    tenant_id: i64,
    method: &str,
    path: &str,
    query: Option<&str>,
    body: &[u8],
    _content_type: Option<&str>,
    data_plane_prefix: &str,
) -> Response {
    let Some(target) = parse_canonical_path(data_plane_prefix, path) else {
        return json_error(StatusCode::NOT_FOUND, "not_found", "Unknown canonical path");
    };
    if target.entity != "contacts" {
        return json_error(
            StatusCode::NOT_FOUND,
            "not_found",
            "Unknown canonical entity",
        );
    }

    let provider = match parse_target(query) {
        Ok(p) => p,
        Err(msg) => {
            return json_error(StatusCode::BAD_REQUEST, "bad_request", msg);
        }
    };

    let Some(st) = STATE.get() else {
        return json_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "internal_error",
            "state not initialized",
        );
    };

    match (
        method.to_uppercase().as_str(),
        provider,
        target.id.as_deref(),
    ) {
        ("GET", IntegrationProxyProvider::Salesforce, None) => {
            let soql = format!("SELECT+{SF_CONTACT_FIELDS}+FROM+Contact+LIMIT+50");
            match sf_request_raw_with_refresh(
                &st.pool,
                tenant_id,
                "GET",
                "/query",
                Some(&format!("q={soql}")),
                None,
                None,
            )
            .await
            {
                Ok((status, bytes, _ct)) if status.is_success() => {
                    match transform::salesforce_query_to_canonical_contacts(&bytes) {
                        Ok(out) => integration_proxy_http_json(out),
                        Err(e) => json_error(StatusCode::BAD_GATEWAY, "transform_failed", &e),
                    }
                }
                Ok((status, bytes, _)) => integration_proxy_http_response(status, bytes, None),
                Err(e) => json_error(StatusCode::BAD_GATEWAY, "integration_proxy_failed", &e),
            }
        }
        ("GET", IntegrationProxyProvider::Salesforce, Some(id)) => {
            let sf_path = format!("/sobjects/Contact/{id}");
            match sf_request_raw_with_refresh(
                &st.pool, tenant_id, "GET", &sf_path, None, None, None,
            )
            .await
            {
                Ok((status, bytes, _)) if status.is_success() => {
                    match transform::salesforce_record_to_canonical_contact_bytes(&bytes) {
                        Ok(out) => integration_proxy_http_json(out),
                        Err(e) => json_error(StatusCode::BAD_GATEWAY, "transform_failed", &e),
                    }
                }
                Ok((status, bytes, _)) => integration_proxy_http_response(status, bytes, None),
                Err(e) => json_error(StatusCode::BAD_GATEWAY, "integration_proxy_failed", &e),
            }
        }
        ("POST", IntegrationProxyProvider::Salesforce, None) => {
            let canonical: serde_json::Value = match serde_json::from_slice(body) {
                Ok(v) => v,
                Err(e) => {
                    return json_error(
                        StatusCode::BAD_REQUEST,
                        "bad_request",
                        &format!("invalid json: {e}"),
                    );
                }
            };
            let payload = transform::canonical_to_salesforce_contact(&canonical);
            let bytes = serde_json::to_vec(&payload).unwrap_or_default();
            match sf_request_raw_with_refresh(
                &st.pool,
                tenant_id,
                "POST",
                "/sobjects/Contact",
                None,
                Some(&bytes),
                Some("application/json"),
            )
            .await
            {
                Ok((status, bytes, ct)) if status.is_success() => {
                    if let Ok(created) = serde_json::from_slice::<serde_json::Value>(&bytes) {
                        if let Some(new_id) = created.get("id").and_then(|v| v.as_str()) {
                            let sf_path = format!("/sobjects/Contact/{new_id}");
                            if let Ok((_, rec, _)) = sf_request_raw_with_refresh(
                                &st.pool, tenant_id, "GET", &sf_path, None, None, None,
                            )
                            .await
                            {
                                if let Ok(out) =
                                    transform::salesforce_record_to_canonical_contact_bytes(&rec)
                                {
                                    return integration_proxy_http_json(out);
                                }
                            }
                        }
                    }
                    integration_proxy_http_response(status, bytes, ct)
                }
                Ok((status, bytes, ct)) => integration_proxy_http_response(status, bytes, ct),
                Err(e) => json_error(StatusCode::BAD_GATEWAY, "integration_proxy_failed", &e),
            }
        }
        ("GET", IntegrationProxyProvider::Zoho, None) => {
            // List tasks from first project as contact-like entities (transform out).
            match integrations::list_zoho_tasks_as_canonical_contacts(&st.pool, tenant_id).await {
                Ok(out) => integration_proxy_http_json(out),
                Err(e) => json_error(StatusCode::BAD_GATEWAY, "integration_proxy_failed", &e),
            }
        }
        ("POST", IntegrationProxyProvider::Zoho, None) => {
            let canonical: serde_json::Value = match serde_json::from_slice(body) {
                Ok(v) => v,
                Err(e) => {
                    return json_error(
                        StatusCode::BAD_REQUEST,
                        "bad_request",
                        &format!("invalid json: {e}"),
                    );
                }
            };
            match integrations::create_zoho_task_from_canonical_contact(
                &st.pool, tenant_id, &canonical,
            )
            .await
            {
                Ok(out) => integration_proxy_http_json(out),
                Err(e) => json_error(StatusCode::BAD_GATEWAY, "integration_proxy_failed", &e),
            }
        }
        _ => json_error(
            StatusCode::METHOD_NOT_ALLOWED,
            "method_not_allowed",
            "Canonical contacts: GET list/id (target=sf|zoho), POST create",
        ),
    }
}

fn integration_proxy_http_json(bytes: Vec<u8>) -> Response {
    integration_proxy_http_response(
        reqwest::StatusCode::OK,
        bytes,
        Some("application/json".to_string()),
    )
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
    } else {
        builder = builder.header(axum::http::header::CONTENT_TYPE, "application/json");
    }
    builder
        .body(axum::body::Body::from(body))
        .unwrap_or_else(|_| {
            json_error(
                StatusCode::INTERNAL_SERVER_ERROR,
                "internal_error",
                "failed to build response",
            )
        })
}
