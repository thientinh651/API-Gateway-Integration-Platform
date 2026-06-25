//! Admin session context, RBAC, tenant isolation, and audit helpers.

use axum::http::{HeaderMap, Method, StatusCode};
use std::net::SocketAddr;
use sqlx::PgPool;

use crate::db::{self, AdminUserRow};
use crate::json_error;
use crate::session::{self, SessionError, SessionStore};

/// Resolved client IP for current request (set by middleware).
#[derive(Clone, Debug)]
pub struct ResolvedClientIp(pub Option<String>);

#[derive(Clone, Debug)]
pub struct AdminCtx {
    pub user_id: i64,
    pub username: String,
    pub home_tenant_id: i64,
    pub tenant_id: i64,
    pub role: String,
    pub via_api_key: bool,
    pub client_ip: Option<String>,
}

impl AdminCtx {
    pub fn from_user(row: &AdminUserRow) -> Self {
        let home = row.tenant_id.unwrap_or(1);
        Self {
            user_id: row.id,
            username: row.username.clone(),
            home_tenant_id: home,
            tenant_id: home,
            role: row.role.clone(),
            via_api_key: false,
            client_ip: None,
        }
    }

    pub fn is_admin(&self) -> bool {
        normalize_role(&self.role) == "admin"
    }

    pub fn is_operator(&self) -> bool {
        normalize_role(&self.role) == "operator"
    }

    pub fn is_viewer(&self) -> bool {
        normalize_role(&self.role) == "viewer"
    }

    /// Chỉ khi `ALLOW_ADMIN_API_KEY=1` — automation/curl, không dùng UI.
    pub fn from_automation_api_key() -> Self {
        Self {
            user_id: 0,
            username: "api-key".into(),
            home_tenant_id: 1,
            tenant_id: 1,
            role: "admin".into(),
            via_api_key: true,
            client_ip: None,
        }
    }
}

pub fn normalize_role(role: &str) -> String {
    role.trim().to_ascii_lowercase()
}

fn api_path(path: &str) -> &str {
    path.strip_prefix("/api").unwrap_or(path)
}

fn is_get(method: &Method) -> bool {
    *method == Method::GET || *method == Method::HEAD
}

fn is_write(method: &Method) -> bool {
    matches!(
        *method,
        Method::POST | Method::PUT | Method::PATCH | Method::DELETE
    )
}

/// Automation only — tắt mặc định; không bypass tenant/user thật.
pub fn admin_api_key_enabled() -> bool {
    std::env::var("ALLOW_ADMIN_API_KEY")
        .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
        .unwrap_or(false)
}

/// Mặc định on-prem (một tổ chức / instance). SaaS: `DEPLOYMENT_MODE=saas`.
pub fn on_prem_single_org() -> bool {
    !std::env::var("DEPLOYMENT_MODE")
        .map(|v| v.trim().eq_ignore_ascii_case("saas"))
        .unwrap_or(false)
}

pub fn workspace_collaboration_enabled() -> bool {
    !on_prem_single_org()
}

/// Đăng ký công khai — chỉ khi bật env; on-prem mặc định tắt (admin tạo user).
pub fn viewer_registration_enabled() -> bool {
    std::env::var("ALLOW_VIEWER_REGISTRATION")
        .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
        .unwrap_or(false)
}

/// Viewer: không client keys, logs, queue, users, settings, integrations, proxy mutate.
pub fn rbac_allow(method: &Method, path: &str, role: &str) -> bool {
    let role = normalize_role(role);
    let p = api_path(path);
    let get = is_get(method);
    let write = is_write(method);

    if role == "admin" {
        return true;
    }

    if role == "viewer" {
        if write {
            if p == "/workspace/switch" && *method == Method::POST {
                return true;
            }
            return false;
        }
        if p.starts_with("/client-keys")
            || p.starts_with("/users")
            || p.starts_with("/settings")
            || p.starts_with("/crypto/")
            || p.starts_with("/transaction-logs")
            || p.starts_with("/audit-logs")
            || p.starts_with("/proxy-queue")
            || p.starts_with("/integrations")
            || p.starts_with("/workspace/members")
            || p == "/reload-config"
        {
            return false;
        }
        return get
            && (p == "/routes"
                || p.starts_with("/routes/")
                || p == "/dashboard/stats"
                || p == "/middleware/status"
                || p == "/me"
                || p == "/ping"
                || p == "/workspace/memberships");
    }

    // operator — vận hành trong tenant, không quản trị user/settings/integrations
    if p.starts_with("/users")
        || p.starts_with("/settings")
        || p.starts_with("/integrations")
        || p.starts_with("/workspace/members")
        || p == "/reload-config"
    {
        return false;
    }
    if p.starts_with("/audit-logs") || p.starts_with("/transaction-logs") {
        return get;
    }
    if p.starts_with("/client-keys") || p.starts_with("/crypto/") {
        if p == "/crypto/public-key" && get {
            return true;
        }
        if p == "/client-keys" && get {
            return true;
        }
        if p == "/client-keys" && *method == Method::POST {
            return true;
        }
        if p == "/client-keys/bulk-status" && *method == Method::POST {
            return true;
        }
        if p == "/client-keys/traffic-summary" && get {
            return true;
        }
        if p == "/client-keys/encrypted" && *method == Method::POST {
            return true;
        }
        if p.starts_with("/client-keys/") && *method == Method::DELETE {
            return true;
        }
        if p.starts_with("/client-keys/") && *method == Method::PATCH {
            return true;
        }
        if p.starts_with("/client-keys/") && get && p != "/client-keys/encrypted" {
            return true;
        }
        if p.ends_with("/routes") && p.starts_with("/client-keys/") && (*method == Method::PUT || get) {
            return true;
        }
        if p.ends_with("/rotate") && p.starts_with("/client-keys/") && *method == Method::POST {
            return true;
        }
        if p.ends_with("/traffic") && p.starts_with("/client-keys/") && get {
            return true;
        }
        if p.ends_with("/revoke-tokens") && p.starts_with("/client-keys/") && *method == Method::POST {
            return true;
        }
        if p == "/oauth/tokens" && get {
            return true;
        }
        if p == "/oauth/tokens/revoke" && *method == Method::POST {
            return true;
        }
        if p == "/oauth/apps" && get {
            return true;
        }
        if p == "/routes/acl-summary" && get {
            return true;
        }
        if p.starts_with("/routes/") && p.ends_with("/clients") && get {
            return true;
        }
        return false;
    }
    if p == "/middleware/status" && get {
        return true;
    }
    if get {
        return true;
    }
    if p.starts_with("/proxy-queue") {
        return *method == Method::POST || *method == Method::DELETE;
    }
    if p == "/routes" && *method == Method::POST {
        return false;
    }
    if p.starts_with("/routes/") && *method == Method::DELETE {
        return false;
    }
    write
}

pub fn can_access_client_keys(role: &str) -> bool {
    let r = normalize_role(role);
    r == "admin" || r == "operator"
}

pub fn can_manage_client_keys(role: &str) -> bool {
    can_access_client_keys(role)
}

fn first_ip_from_list(value: &str) -> String {
    value.split(',').next().unwrap_or(value).trim().to_string()
}

pub fn client_ip_from_proxy_headers(headers: &HeaderMap) -> Option<String> {
    if let Some(v) = headers.get("x-forwarded-for").and_then(|v| v.to_str().ok()) {
        let ip = first_ip_from_list(v);
        if !ip.is_empty() {
            return Some(ip);
        }
    }
    if let Some(v) = headers.get("x-real-ip").and_then(|v| v.to_str().ok()) {
        let ip = v.trim().to_string();
        if !ip.is_empty() {
            return Some(ip);
        }
    }
    if let Some(v) = headers.get("cf-connecting-ip").and_then(|v| v.to_str().ok()) {
        let ip = v.trim().to_string();
        if !ip.is_empty() {
            return Some(ip);
        }
    }
    if let Some(v) = headers.get("forwarded").and_then(|v| v.to_str().ok()) {
        for part in v.split(';') {
            let part = part.trim();
            if let Some(rest) = part.strip_prefix("for=") {
                let ip = rest.trim_matches('"').trim();
                if !ip.is_empty() && ip != "unknown" {
                    return Some(ip.to_string());
                }
            }
        }
    }
    None
}

/// Proxy headers first; optional TCP peer when headers missing (direct / dev).
pub fn resolve_client_ip(headers: &HeaderMap, peer: Option<SocketAddr>) -> Option<String> {
    if let Some(ip) = client_ip_from_proxy_headers(headers) {
        return Some(ip);
    }
    peer.map(|addr| addr.ip().to_string())
}

pub fn client_ip(headers: &HeaderMap) -> Option<String> {
    client_ip_from_proxy_headers(headers)
}

pub fn client_ip_from_extensions(
    headers: &HeaderMap,
    extensions: &axum::http::Extensions,
) -> Option<String> {
    extensions
        .get::<ResolvedClientIp>()
        .and_then(|r| r.0.clone())
        .or_else(|| client_ip_from_proxy_headers(headers))
}

pub async fn write_audit_event(
    pool: &PgPool,
    tenant_id: i64,
    actor: &str,
    role: &str,
    action: &str,
    resource: &str,
    result: &str,
    source_ip: Option<&str>,
    details: Option<&str>,
) {
    if let Err(e) = db::insert_audit_log(
        pool,
        tenant_id,
        actor,
        role,
        action,
        resource,
        result,
        source_ip,
        details,
    )
    .await
    {
        tracing::warn!(error = %e, action, result, "audit log insert failed");
    }
}

pub async fn write_audit(
    pool: &PgPool,
    ctx: &AdminCtx,
    action: &str,
    resource: &str,
    result: &str,
    source_ip: Option<&str>,
    details: Option<&str>,
) {
    let ip = source_ip.or(ctx.client_ip.as_deref());
    write_audit_event(
        pool,
        ctx.tenant_id,
        &ctx.username,
        &ctx.role,
        action,
        resource,
        result,
        ip,
        details,
    )
    .await;
}

pub async fn write_audit_failure(
    pool: &PgPool,
    ctx: &AdminCtx,
    action: &str,
    resource: &str,
    source_ip: Option<&str>,
    details: Option<&str>,
) {
    write_audit(pool, ctx, action, resource, "failure", source_ip, details).await;
}

pub async fn resolve_session_ctx(
    store: &SessionStore,
    pool: &PgPool,
    sid: &str,
) -> Result<Option<AdminCtx>, SessionError> {
    let Some(mut rec) = store.get(sid).await? else {
        return Ok(None);
    };

    let now = session::now_unix_ts();
    let recheck = session::db_recheck_secs();
    if now.saturating_sub(rec.last_db_check) >= recheck {
        match db::fetch_admin_user_by_id_any(pool, rec.user_id).await {
            Ok(Some(user)) if user.is_active != 0 => {
                rec.normalize_legacy();
                let home = user.tenant_id.unwrap_or(1);
                rec.home_tenant_id = home;
                rec.username = user.username;
                if on_prem_single_org() {
                    rec.tenant_id = home;
                    rec.role = user.role.clone();
                } else {
                    if !db::user_can_access_workspace(pool, rec.user_id, home, rec.tenant_id)
                        .await
                        .unwrap_or(false)
                    {
                        rec.tenant_id = home;
                    }
                    rec.role = db::effective_workspace_role(
                        pool,
                        rec.user_id,
                        home,
                        &user.role,
                        rec.tenant_id,
                    )
                    .await
                    .unwrap_or_else(|_| user.role.clone());
                }
                rec.last_db_check = now;
                store.save(sid, &rec).await?;
            }
            _ => {
                let _ = store.destroy(sid, rec.user_id).await;
                return Ok(None);
            }
        }
    }

    store.touch(sid).await?;

    rec.normalize_legacy();
    Ok(Some(AdminCtx {
        user_id: rec.user_id,
        username: rec.username,
        home_tenant_id: rec.home_tenant_id,
        tenant_id: rec.tenant_id,
        role: rec.role,
        via_api_key: false,
        client_ip: None,
    }))
}

pub fn session_unavailable_response() -> axum::response::Response {
    json_error(
        StatusCode::SERVICE_UNAVAILABLE,
        "session_store_unavailable",
        "Session store (Redis) không khả dụng — thử lại sau",
    )
}

pub fn forbidden_response() -> axum::response::Response {
    json_error(
        StatusCode::FORBIDDEN,
        "forbidden",
        "Không đủ quyền (RBAC)",
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::Method;

    fn allow(method: Method, path: &str, role: &str) -> bool {
        rbac_allow(&method, path, role)
    }

    #[test]
    fn normalize_role_lowercase() {
        assert_eq!(normalize_role(" Admin "), "admin");
    }

    #[test]
    fn admin_full_access() {
        assert!(allow(Method::DELETE, "/api/users/1", "admin"));
        assert!(allow(Method::POST, "/api/routes", "admin"));
        assert!(allow(Method::GET, "/api/client-keys", "admin"));
    }

    #[test]
    fn viewer_read_only_own_scope() {
        assert!(allow(Method::GET, "/api/routes", "viewer"));
        assert!(!allow(Method::POST, "/api/routes", "viewer"));
        assert!(!allow(Method::GET, "/api/client-keys", "viewer"));
        assert!(!allow(Method::GET, "/api/transaction-logs", "viewer"));
        assert!(!allow(Method::GET, "/api/audit-logs", "viewer"));
        assert!(!allow(Method::GET, "/api/proxy-queue", "viewer"));
    }

    #[test]
    fn operator_no_users_settings_integrations() {
        assert!(allow(Method::GET, "/api/routes", "operator"));
        assert!(allow(Method::POST, "/api/client-keys", "operator"));
        assert!(!allow(Method::GET, "/api/users", "operator"));
        assert!(!allow(Method::PUT, "/api/settings", "operator"));
        assert!(!allow(Method::GET, "/api/integrations", "operator"));
        assert!(!allow(Method::GET, "/api/integrations/salesforce/test", "operator"));
        assert!(!allow(Method::POST, "/api/integrations/salesforce/sync", "operator"));
    }

    #[test]
    fn viewer_no_integrations() {
        assert!(!allow(Method::GET, "/api/integrations", "viewer"));
        assert!(!allow(Method::GET, "/api/integrations/bridge", "viewer"));
    }

    #[test]
    fn viewer_registration_default_off() {
        unsafe {
            std::env::remove_var("ALLOW_VIEWER_REGISTRATION");
            assert!(!super::viewer_registration_enabled());
            std::env::set_var("ALLOW_VIEWER_REGISTRATION", "1");
            assert!(super::viewer_registration_enabled());
            std::env::remove_var("ALLOW_VIEWER_REGISTRATION");
        }
    }

    #[test]
    fn client_ip_from_forwarded() {
        let mut h = HeaderMap::new();
        h.insert("x-forwarded-for", "203.0.113.1, 10.0.0.1".parse().unwrap());
        assert_eq!(client_ip_from_proxy_headers(&h).as_deref(), Some("203.0.113.1"));
    }

    #[test]
    fn resolve_client_ip_peer_fallback() {
        let h = HeaderMap::new();
        let peer: SocketAddr = "198.51.100.9:54321".parse().unwrap();
        assert_eq!(
            resolve_client_ip(&h, Some(peer)).as_deref(),
            Some("198.51.100.9")
        );
    }
}
