//! Admin session context, RBAC, and audit helpers.

use axum::http::{HeaderMap, Method, StatusCode};
use sqlx::SqlitePool;

use crate::db::{self, AdminUserRow};
use crate::{json_error, AdminSession};

#[derive(Clone, Debug)]
pub struct AdminCtx {
    pub user_id: i64,
    pub username: String,
    pub tenant_id: i64,
    pub role: String,
    pub via_api_key: bool,
}

impl AdminCtx {
    /// Dev/automation: `X-API-Key` matches gateway admin setting → full admin on tenant 1.
    pub fn from_admin_api_key() -> Self {
        Self {
            user_id: 0,
            username: "api-key".into(),
            tenant_id: 1,
            role: "admin".into(),
            via_api_key: true,
        }
    }

    pub fn from_user(row: &AdminUserRow) -> Self {
        Self {
            user_id: row.id,
            username: row.username.clone(),
            tenant_id: row.tenant_id.unwrap_or(1),
            role: row.role.clone(),
            via_api_key: false,
        }
    }

    pub fn is_admin(&self) -> bool {
        normalize_role(&self.role) == "admin"
    }
}

pub fn normalize_role(role: &str) -> String {
    role.trim().to_ascii_lowercase()
}

fn api_path(path: &str) -> &str {
    path.strip_prefix("/api").unwrap_or(path)
}

/// Operator/viewer restrictions on admin API (`req.uri().path()` may be `/routes` or `/api/routes`).
pub fn rbac_allow(method: &Method, path: &str, role: &str) -> bool {
    let role = normalize_role(role);
    let p = api_path(path);
    if role == "admin" {
        return true;
    }
    if role == "viewer" {
        return *method == Method::GET;
    }
    if p.starts_with("/users") {
        return false;
    }
    if p.starts_with("/integrations") {
        if p == "/integrations" && *method == Method::GET {
            return true;
        }
        if (p == "/integrations/salesforce/test" || p == "/integrations/zoho/test")
            && *method == Method::GET
        {
            return role == "admin";
        }
        if p.contains("/connect") || p.contains("/disconnect") || p.contains("/sync") {
            return false;
        }
        return *method == Method::GET;
    }
    if *method == Method::GET {
        return true;
    }
    if p.starts_with("/settings") {
        return false;
    }
    if p == "/reload-config" {
        return false;
    }
    if p == "/routes" && *method == Method::POST {
        return false;
    }
    if p.starts_with("/routes/") && *method == Method::DELETE {
        return false;
    }
    true
}

pub fn client_ip(headers: &HeaderMap) -> Option<String> {
    headers
        .get("x-forwarded-for")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.split(',').next().unwrap_or(s).trim().to_string())
        .or_else(|| {
            headers
                .get("x-real-ip")
                .and_then(|v| v.to_str().ok())
                .map(|s| s.to_string())
        })
}

pub async fn write_audit_event(
    pool: &SqlitePool,
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
    pool: &SqlitePool,
    ctx: &AdminCtx,
    action: &str,
    resource: &str,
    result: &str,
    source_ip: Option<&str>,
    details: Option<&str>,
) {
    write_audit_event(
        pool,
        ctx.tenant_id,
        &ctx.username,
        &ctx.role,
        action,
        resource,
        result,
        source_ip,
        details,
    )
    .await;
}

pub async fn write_audit_failure(
    pool: &SqlitePool,
    ctx: &AdminCtx,
    action: &str,
    resource: &str,
    source_ip: Option<&str>,
    details: Option<&str>,
) {
    write_audit(pool, ctx, action, resource, "failure", source_ip, details).await;
}

pub fn resolve_session_ctx(sessions: &dashmap::DashMap<String, AdminSession>, sid: &str) -> Option<AdminCtx> {
    let ent = sessions.get(sid)?;
    if ent.valid_until < std::time::Instant::now() {
        return None;
    }
    Some(AdminCtx {
        user_id: ent.user_id,
        username: ent.username.clone(),
        tenant_id: ent.tenant_id,
        role: ent.role.clone(),
        via_api_key: false,
    })
}

pub async fn load_user_ctx(pool: &SqlitePool, username: &str) -> Option<AdminCtx> {
    let row = db::fetch_admin_user_by_username(pool, username).await.ok()??;
    if row.is_active == 0 {
        return None;
    }
    Some(AdminCtx::from_user(&row))
}

pub fn forbidden_response() -> axum::response::Response {
    json_error(
        StatusCode::FORBIDDEN,
        "forbidden",
        "Không đủ quyền (RBAC)",
    )
}
