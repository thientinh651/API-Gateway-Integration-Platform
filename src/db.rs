//! PostgreSQL persistence for routes, data-plane API key hashes, and admin API key hash.

use argon2::{
    password_hash::{rand_core::OsRng, PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Argon2,
};
use sha2::{Digest, Sha256};
use sqlx::postgres::PgPoolOptions;
use sqlx::PgPool;

use crate::{crypto, RouteRow, YamlBootstrap};

pub const ROUTE_SELECT: &str =
    "id, path, target, timeout_secs, rate_limit_per_min, tenant_id, transform_add_headers, transform_remove_headers, retry_max, retry_on_status, retry_on_timeout, queue_on_failure, allowed_methods";

/// Runtime credentials for data-plane auth.
#[derive(Debug, Clone, Default)]
pub struct ClientCredentials {
    pub legacy: Vec<LegacyClientKey>,
    pub hmac: Vec<HmacClientKey>,
    /// Disabled clients — 403 rõ ràng + giữ id cho transaction log.
    pub disabled_clients: Vec<DisabledClientKey>,
}

#[derive(Debug, Clone)]
pub struct DisabledClientKey {
    pub id: i64,
    pub api_key: String,
    pub tenant_id: i64,
}

#[derive(Debug, Clone)]
pub struct LegacyClientKey {
    pub id: i64,
    pub sha256_hex: String,
    pub tenant_id: i64,
    pub rate_limit_per_min: i32,
    pub allowed_route_ids: Vec<i64>,
}

#[derive(Debug, Clone)]
pub struct HmacClientKey {
    pub id: i64,
    pub api_key: String,
    pub secret: String,
    pub tenant_id: i64,
    pub rate_limit_per_min: i32,
    pub allowed_route_ids: Vec<i64>,
}

pub fn sha256_hex(s: &str) -> String {
    let d = Sha256::digest(s.as_bytes());
    format!("{d:x}")
}

/// Argon2id hash for admin console passwords (at rest only).
pub fn hash_password(password: &str) -> Result<String, argon2::password_hash::Error> {
    let salt = SaltString::generate(&mut OsRng);
    let hash = Argon2::default().hash_password(password.as_bytes(), &salt)?;
    Ok(hash.to_string())
}

pub fn verify_password(password: &str, password_hash: &str) -> bool {
    let Ok(parsed) = PasswordHash::new(password_hash) else {
        return false;
    };
    Argon2::default()
        .verify_password(password.as_bytes(), &parsed)
        .is_ok()
}

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct AdminUserRow {
    pub id: i64,
    pub username: String,
    pub password_hash: String,
    pub role: String,
    pub tenant_id: Option<i64>,
    pub is_active: i32,
    pub email: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize, sqlx::FromRow)]
pub struct AdminUserPublic {
    pub id: i64,
    pub username: String,
    pub role: String,
    pub tenant_id: i64,
    #[serde(serialize_with = "serialize_bool_from_i32")]
    pub is_active: i32,
    pub created_at: String,
    pub email: Option<String>,
}

fn serialize_bool_from_i32<S: serde::Serializer>(v: &i32, s: S) -> Result<S::Ok, S::Error> {
    s.serialize_bool(*v != 0)
}

pub async fn fetch_admin_user_by_username(
    pool: &PgPool,
    username: &str,
) -> Result<Option<AdminUserRow>, sqlx::Error> {
    sqlx::query_as::<_, AdminUserRow>(
        "SELECT id, username, password_hash, role, tenant_id, is_active, email FROM dashboard_users WHERE username = $1 LIMIT 1",
    )
    .bind(username)
    .fetch_optional(pool)
    .await
}

/// First boot: seed one admin from env (plain password hashed once, not stored in env after).
pub async fn bootstrap_admin_user_if_empty(pool: &PgPool) -> Result<(), sqlx::Error> {
    let n: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM dashboard_users")
        .fetch_one(pool)
        .await?;
    if n > 0 {
        return Ok(());
    }
    let username = std::env::var("ADMIN_USERNAME").unwrap_or_else(|_| "admin".into());
    let password = std::env::var("ADMIN_PASSWORD").unwrap_or_else(|_| "admin".into());
    let password_hash = hash_password(password.trim()).map_err(|e| {
        sqlx::Error::Configuration(format!("argon2 hash admin password: {e}").into())
    })?;
    let tenant_id = create_personal_tenant(pool, username.trim()).await?;
    let admin_email = std::env::var("ADMIN_EMAIL")
        .ok()
        .and_then(|e| {
            let t = e.trim();
            if t.is_empty() || !t.contains('@') {
                None
            } else {
                Some(t.to_ascii_lowercase())
            }
        });
    sqlx::query(
        "INSERT INTO dashboard_users (username, password_hash, role, tenant_id, is_active, email)
         VALUES ($1, $2, 'admin', $3, 1, $4)",
    )
    .bind(username.trim())
    .bind(&password_hash)
    .bind(tenant_id)
    .bind(admin_email.as_deref())
    .execute(pool)
    .await?;
    tracing::info!(
        username = %username.trim(),
        "bootstrapped dashboard_users from env (change password via DB/UI later)"
    );
    Ok(())
}

fn pg_pool_max_connections() -> u32 {
    std::env::var("PG_POOL_MAX")
        .ok()
        .and_then(|s| s.parse().ok())
        .filter(|&n| (1..=20).contains(&n))
        .unwrap_or(5)
}

pub async fn connect(database_url: &str) -> Result<PgPool, sqlx::Error> {
    let url = database_url.trim();
    if !url.starts_with("postgres://") && !url.starts_with("postgresql://") {
        return Err(sqlx::Error::Configuration(
            "DATABASE_URL must be postgres:// or postgresql://".into(),
        ));
    }
    let max = pg_pool_max_connections();
    tracing::info!(max_connections = max, "postgres pool");
    PgPoolOptions::new()
        .max_connections(max)
        .connect(url)
        .await
}

pub async fn migrate(pool: &PgPool) -> Result<(), sqlx::migrate::MigrateError> {
    sqlx::migrate!("./migrations").run(pool).await
}

/// If DB has no routes / no client keys, seed from `config.yaml` (one-time style import).
pub async fn bootstrap_from_yaml_if_empty(
    pool: &PgPool,
    yaml: &YamlBootstrap,
) -> Result<(), sqlx::Error> {
    let n_routes: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM gateway_routes")
        .fetch_one(pool)
        .await?;

    if n_routes == 0 {
        for r in yaml.routes.iter() {
            sqlx::query(
                "INSERT INTO gateway_routes (path, target, timeout_secs, rate_limit_per_min) VALUES ($1, $2, 30, 100)
                 ON CONFLICT(path) DO UPDATE SET target = excluded.target",
            )
            .bind(&r.path)
            .bind(&r.target)
            .execute(pool)
            .await?;
        }
    }

    let n_keys: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM gateway_client_keys")
        .fetch_one(pool)
        .await?;

    if n_keys == 0 {
        for plain in &yaml.api_keys {
            let h = sha256_hex(plain);
            sqlx::query(
                "INSERT INTO gateway_client_keys (name, secret_sha256_hex) VALUES ('imported', $1)",
            )
            .bind(&h)
            .execute(pool)
            .await?;
        }
    }

    Ok(())
}

/// Ensure admin API key hash exists (env `ADMIN_X_API_KEY` or default for dev).
pub async fn ensure_admin_setting(pool: &PgPool) -> Result<(), sqlx::Error> {
    let exists: Option<String> = sqlx::query_scalar(
        "SELECT v FROM gateway_settings WHERE k = 'admin_x_api_key_sha256' LIMIT 1",
    )
    .fetch_optional(pool)
    .await?;

    if exists.is_none() {
        let key = std::env::var("ADMIN_X_API_KEY").unwrap_or_else(|_| "key12345".into());
        let h = sha256_hex(key.trim());
        sqlx::query(
            "INSERT INTO gateway_settings (k, v) VALUES ('admin_x_api_key_sha256', $1)
             ON CONFLICT(k) DO NOTHING",
        )
        .bind(&h)
        .execute(pool)
        .await?;
    }

    Ok(())
}

pub async fn load_setting(pool: &PgPool, key: &str) -> Result<Option<String>, sqlx::Error> {
    sqlx::query_scalar("SELECT v FROM gateway_settings WHERE k = $1 LIMIT 1")
        .bind(key)
        .fetch_optional(pool)
        .await
}

pub async fn upsert_setting(pool: &PgPool, key: &str, value: &str) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO gateway_settings (k, v) VALUES ($1, $2)
         ON CONFLICT(k) DO UPDATE SET v = excluded.v",
    )
    .bind(key)
    .bind(value)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn ensure_default_tenant(pool: &PgPool) -> Result<(), sqlx::Error> {
    sqlx::query("INSERT INTO tenants (name) VALUES ('default') ON CONFLICT (name) DO NOTHING")
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn create_tenant(pool: &PgPool, name: &str) -> Result<i64, sqlx::Error> {
    sqlx::query_scalar("INSERT INTO tenants (name) VALUES ($1) RETURNING id")
        .bind(name)
        .fetch_one(pool)
        .await
}

fn personal_tenant_name(username: &str) -> String {
    format!("personal:{}", username.trim())
}

pub async fn create_personal_tenant(pool: &PgPool, username: &str) -> Result<i64, sqlx::Error> {
    let base = personal_tenant_name(username);
    if let Some(id) = sqlx::query_scalar("SELECT id FROM tenants WHERE name = $1")
        .bind(&base)
        .fetch_optional(pool)
        .await?
    {
        return Ok(id);
    }

    let mut name = base.clone();
    for attempt in 0..5 {
        match create_tenant(pool, &name).await {
            Ok(id) => return Ok(id),
            Err(sqlx::Error::Database(e)) if e.code().as_deref() == Some("23505") => {
                if name == base {
                    if let Some(id) = sqlx::query_scalar("SELECT id FROM tenants WHERE name = $1")
                        .bind(&base)
                        .fetch_optional(pool)
                        .await?
                    {
                        return Ok(id);
                    }
                }
                name = format!("{base}-{}", attempt + 2);
            }
            Err(e) => return Err(e),
        }
    }
    create_tenant(pool, &format!("{base}-{}", uuid::Uuid::new_v4())).await
}

pub async fn migrate_personal_admin_tenants(pool: &PgPool) -> Result<(), sqlx::Error> {
    migrate_workspace_isolation(pool).await
}

/// On-prem: gộp mọi user về tenant `default` (id 1), xóa membership collaborator.
pub async fn migrate_on_prem_organization(pool: &PgPool) -> Result<(), sqlx::Error> {
    let done: Option<String> = sqlx::query_scalar(
        "SELECT v FROM gateway_settings WHERE k = 'on_prem_org_v1'",
    )
    .fetch_optional(pool)
    .await?;
    if done.as_deref() == Some("done") {
        return Ok(());
    }

    ensure_default_tenant(pool).await?;
    sqlx::query("UPDATE dashboard_users SET tenant_id = 1 WHERE COALESCE(tenant_id, 1) != 1")
        .execute(pool)
        .await?;
    sqlx::query("DELETE FROM tenant_memberships")
        .execute(pool)
        .await?;

    for k in ["on_prem_org_v1", "workspace_isolation_v1"] {
        sqlx::query(
            "INSERT INTO gateway_settings (k, v) VALUES ($1, 'done')
             ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v",
        )
        .bind(k)
        .execute(pool)
        .await?;
    }

    tracing::info!("on-prem organization migration complete (single tenant)");
    Ok(())
}

/// Một admin giữ tenant 1 (dữ liệu hiện tại); mọi user khác → workspace riêng.
pub async fn migrate_workspace_isolation(pool: &PgPool) -> Result<(), sqlx::Error> {
    let done: Option<String> = sqlx::query_scalar(
        "SELECT v FROM gateway_settings WHERE k = 'workspace_isolation_v1'",
    )
    .fetch_optional(pool)
    .await?;
    if done.as_deref() == Some("done") {
        return Ok(());
    }

    let primary_id: i64 = sqlx::query_scalar(
        "SELECT COALESCE(
            (SELECT id FROM dashboard_users WHERE COALESCE(tenant_id, 1) = 1
                AND LOWER(TRIM(role)) = 'admin' ORDER BY id ASC LIMIT 1),
            (SELECT id FROM dashboard_users WHERE LOWER(TRIM(role)) = 'admin' ORDER BY id ASC LIMIT 1),
            1
        )",
    )
    .fetch_one(pool)
    .await?;

    sqlx::query("UPDATE dashboard_users SET tenant_id = 1 WHERE id = $1")
        .bind(primary_id)
        .execute(pool)
        .await?;

    let leavers: Vec<(i64, String)> = sqlx::query_as(
        "SELECT id, username FROM dashboard_users
         WHERE COALESCE(tenant_id, 1) = 1 AND id != $1",
    )
    .bind(primary_id)
    .fetch_all(pool)
    .await?;
    let moved = leavers.len();

    for (uid, username) in leavers {
        let tid = create_personal_tenant(pool, &username).await?;
        sqlx::query("UPDATE dashboard_users SET tenant_id = $1 WHERE id = $2")
            .bind(tid)
            .bind(uid)
            .execute(pool)
            .await?;
        sqlx::query(
            "UPDATE gateway_client_keys SET tenant_id = $1 WHERE owner_user_id = $2",
        )
        .bind(tid)
        .bind(uid)
        .execute(pool)
        .await?;
        tracing::info!(
            user_id = uid,
            username = %username,
            tenant_id = tid,
            "migrated user to personal workspace"
        );
    }

    sqlx::query(
        "INSERT INTO gateway_settings (k, v) VALUES ('workspace_isolation_v1', 'done')
         ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v",
    )
    .execute(pool)
    .await?;

    tracing::info!(
        primary_admin_id = primary_id,
        moved_users = moved,
        "workspace isolation migration complete"
    );
    Ok(())
}

pub async fn backfill_admin_tenants(pool: &PgPool) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE dashboard_users SET tenant_id = 1 WHERE tenant_id IS NULL")
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn list_dashboard_users_for_tenant(
    pool: &PgPool,
    tenant_id: i64,
) -> Result<Vec<AdminUserPublic>, sqlx::Error> {
    sqlx::query_as::<_, AdminUserPublic>(
        "SELECT id, username, role, COALESCE(tenant_id, 1) AS tenant_id,
                CASE WHEN is_active = 0 THEN 0 ELSE 1 END AS is_active, created_at::text AS created_at,
                email
         FROM dashboard_users WHERE COALESCE(tenant_id, 1) = $1 ORDER BY username",
    )
    .bind(tenant_id)
    .fetch_all(pool)
    .await
}

#[derive(Debug, Clone, sqlx::FromRow, serde::Serialize)]
pub struct WorkspaceInfoRow {
    pub tenant_id: i64,
    pub name: String,
    pub role: String,
    pub is_home: bool,
}

pub async fn user_can_access_workspace(
    pool: &PgPool,
    user_id: i64,
    home_tenant_id: i64,
    workspace_tenant_id: i64,
) -> Result<bool, sqlx::Error> {
    if workspace_tenant_id == home_tenant_id {
        return Ok(true);
    }
    let n: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM tenant_memberships WHERE tenant_id = $1 AND user_id = $2",
    )
    .bind(workspace_tenant_id)
    .bind(user_id)
    .fetch_one(pool)
    .await?;
    Ok(n > 0)
}

pub async fn effective_workspace_role(
    pool: &PgPool,
    user_id: i64,
    home_tenant_id: i64,
    home_role: &str,
    workspace_tenant_id: i64,
) -> Result<String, sqlx::Error> {
    if workspace_tenant_id == home_tenant_id {
        return Ok(home_role.trim().to_ascii_lowercase());
    }
    let role: Option<String> = sqlx::query_scalar(
        "SELECT role FROM tenant_memberships WHERE tenant_id = $1 AND user_id = $2 LIMIT 1",
    )
    .bind(workspace_tenant_id)
    .bind(user_id)
    .fetch_optional(pool)
    .await?;
    Ok(role
        .unwrap_or_else(|| "viewer".into())
        .trim()
        .to_ascii_lowercase())
}

pub async fn list_accessible_workspaces(
    pool: &PgPool,
    user_id: i64,
    home_tenant_id: i64,
) -> Result<Vec<WorkspaceInfoRow>, sqlx::Error> {
    sqlx::query_as::<_, WorkspaceInfoRow>(
        "SELECT t.id AS tenant_id, t.name, LOWER(TRIM(u.role)) AS role, TRUE AS is_home
         FROM tenants t
         JOIN dashboard_users u ON u.id = $1 AND COALESCE(u.tenant_id, 1) = t.id
         UNION
         SELECT t.id AS tenant_id, t.name, LOWER(TRIM(m.role)) AS role, FALSE AS is_home
         FROM tenant_memberships m
         JOIN tenants t ON t.id = m.tenant_id
         WHERE m.user_id = $1 AND m.tenant_id != $2
         ORDER BY is_home DESC, name ASC",
    )
    .bind(user_id)
    .bind(home_tenant_id)
    .fetch_all(pool)
    .await
}

pub async fn upsert_tenant_membership(
    pool: &PgPool,
    tenant_id: i64,
    user_id: i64,
    role: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO tenant_memberships (tenant_id, user_id, role)
         VALUES ($1, $2, $3)
         ON CONFLICT (tenant_id, user_id) DO UPDATE SET role = EXCLUDED.role",
    )
    .bind(tenant_id)
    .bind(user_id)
    .bind(role)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn delete_tenant_membership(
    pool: &PgPool,
    tenant_id: i64,
    user_id: i64,
) -> Result<bool, sqlx::Error> {
    let r = sqlx::query("DELETE FROM tenant_memberships WHERE tenant_id = $1 AND user_id = $2")
        .bind(tenant_id)
        .bind(user_id)
        .execute(pool)
        .await?;
    Ok(r.rows_affected() > 0)
}

/// Thành viên workspace: chủ (home tenant) + khách được mời (membership).
pub async fn list_workspace_users(
    pool: &PgPool,
    workspace_tenant_id: i64,
) -> Result<Vec<AdminUserPublic>, sqlx::Error> {
    sqlx::query_as::<_, AdminUserPublic>(
        "SELECT u.id, u.username,
                COALESCE(m.role, u.role) AS role,
                COALESCE(u.tenant_id, 1) AS tenant_id,
                CASE WHEN u.is_active = 0 THEN 0 ELSE 1 END AS is_active,
                u.created_at::text AS created_at,
                u.email
         FROM dashboard_users u
         LEFT JOIN tenant_memberships m ON m.user_id = u.id AND m.tenant_id = $1
         WHERE COALESCE(u.tenant_id, 1) = $1
         UNION
         SELECT u.id, u.username, m.role, COALESCE(u.tenant_id, 1), CASE WHEN u.is_active = 0 THEN 0 ELSE 1 END,
                u.created_at::text, u.email
         FROM tenant_memberships m
         JOIN dashboard_users u ON u.id = m.user_id
         WHERE m.tenant_id = $1 AND COALESCE(u.tenant_id, 1) != $1
         ORDER BY username",
    )
    .bind(workspace_tenant_id)
    .fetch_all(pool)
    .await
}

pub async fn fetch_admin_user_by_id(
    pool: &PgPool,
    id: i64,
    tenant_id: i64,
) -> Result<Option<AdminUserRow>, sqlx::Error> {
    sqlx::query_as::<_, AdminUserRow>(
        "SELECT id, username, password_hash, role, tenant_id, is_active, email FROM dashboard_users
         WHERE id = $1 AND COALESCE(tenant_id, 1) = $2 LIMIT 1",
    )
    .bind(id)
    .bind(tenant_id)
    .fetch_optional(pool)
    .await
}

pub async fn insert_admin_user(
    pool: &PgPool,
    username: &str,
    password_hash: &str,
    role: &str,
    tenant_id: i64,
    email: Option<&str>,
) -> Result<i64, sqlx::Error> {
    sqlx::query_scalar(
        "INSERT INTO dashboard_users (username, password_hash, role, tenant_id, is_active, email)
         VALUES ($1, $2, $3, $4, 1, $5) RETURNING id",
    )
    .bind(username)
    .bind(password_hash)
    .bind(role)
    .bind(tenant_id)
    .bind(email)
    .fetch_one(pool)
    .await
}

pub async fn fetch_admin_user_by_email(
    pool: &PgPool,
    email: &str,
) -> Result<Option<AdminUserRow>, sqlx::Error> {
    sqlx::query_as::<_, AdminUserRow>(
        "SELECT id, username, password_hash, role, tenant_id, is_active, email
         FROM dashboard_users WHERE LOWER(TRIM(email)) = LOWER(TRIM($1)) AND is_active = 1 LIMIT 1",
    )
    .bind(email)
    .fetch_optional(pool)
    .await
}

pub async fn admin_email_taken(
    pool: &PgPool,
    email: &str,
    except_id: i64,
) -> Result<bool, sqlx::Error> {
    let n: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM dashboard_users WHERE LOWER(TRIM(email)) = LOWER(TRIM($1)) AND id <> $2",
    )
    .bind(email)
    .bind(except_id)
    .fetch_one(pool)
    .await?;
    Ok(n > 0)
}

pub async fn admin_username_taken(
    pool: &PgPool,
    username: &str,
    except_id: i64,
) -> Result<bool, sqlx::Error> {
    let n: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM dashboard_users WHERE username = $1 AND id <> $2",
    )
    .bind(username)
    .bind(except_id)
    .fetch_one(pool)
    .await?;
    Ok(n > 0)
}

/// Cập nhật hồ sơ cá nhân — không đổi role / is_active.
pub async fn update_own_profile(
    pool: &PgPool,
    id: i64,
    tenant_id: i64,
    username: &str,
    email: Option<Option<&str>>,
    password_hash: Option<&str>,
) -> Result<u64, sqlx::Error> {
    let affected = match (password_hash, email) {
        (Some(h), Some(em)) => {
            sqlx::query(
                "UPDATE dashboard_users SET username = $1, email = $2, password_hash = $3
                 WHERE id = $4 AND COALESCE(tenant_id, 1) = $5 AND is_active = 1",
            )
            .bind(username)
            .bind(em)
            .bind(h)
            .bind(id)
            .bind(tenant_id)
            .execute(pool)
            .await?
            .rows_affected()
        }
        (Some(h), None) => {
            sqlx::query(
                "UPDATE dashboard_users SET username = $1, password_hash = $2
                 WHERE id = $3 AND COALESCE(tenant_id, 1) = $4 AND is_active = 1",
            )
            .bind(username)
            .bind(h)
            .bind(id)
            .bind(tenant_id)
            .execute(pool)
            .await?
            .rows_affected()
        }
        (None, Some(em)) => {
            sqlx::query(
                "UPDATE dashboard_users SET username = $1, email = $2
                 WHERE id = $3 AND COALESCE(tenant_id, 1) = $4 AND is_active = 1",
            )
            .bind(username)
            .bind(em)
            .bind(id)
            .bind(tenant_id)
            .execute(pool)
            .await?
            .rows_affected()
        }
        (None, None) => {
            sqlx::query(
                "UPDATE dashboard_users SET username = $1
                 WHERE id = $2 AND COALESCE(tenant_id, 1) = $3 AND is_active = 1",
            )
            .bind(username)
            .bind(id)
            .bind(tenant_id)
            .execute(pool)
            .await?
            .rows_affected()
        }
    };
    Ok(affected)
}

pub async fn fetch_dashboard_user_public_by_id(
    pool: &PgPool,
    id: i64,
) -> Result<Option<AdminUserPublic>, sqlx::Error> {
    sqlx::query_as::<_, AdminUserPublic>(
        "SELECT id, username, role, COALESCE(tenant_id, 1) AS tenant_id,
                CASE WHEN is_active = 0 THEN 0 ELSE 1 END AS is_active, created_at::text AS created_at,
                email
         FROM dashboard_users WHERE id = $1 LIMIT 1",
    )
    .bind(id)
    .fetch_optional(pool)
    .await
}

pub async fn fetch_dashboard_user_public(
    pool: &PgPool,
    id: i64,
    tenant_id: i64,
) -> Result<Option<AdminUserPublic>, sqlx::Error> {
    sqlx::query_as::<_, AdminUserPublic>(
        "SELECT id, username, role, COALESCE(tenant_id, 1) AS tenant_id,
                CASE WHEN is_active = 0 THEN 0 ELSE 1 END AS is_active, created_at::text AS created_at,
                email
         FROM dashboard_users WHERE id = $1 AND COALESCE(tenant_id, 1) = $2 LIMIT 1",
    )
    .bind(id)
    .bind(tenant_id)
    .fetch_optional(pool)
    .await
}

pub async fn fetch_admin_user_by_id_any(
    pool: &PgPool,
    id: i64,
) -> Result<Option<AdminUserRow>, sqlx::Error> {
    sqlx::query_as::<_, AdminUserRow>(
        "SELECT id, username, password_hash, role, tenant_id, is_active, email
         FROM dashboard_users WHERE id = $1 LIMIT 1",
    )
    .bind(id)
    .fetch_optional(pool)
    .await
}

pub async fn set_user_password(
    pool: &PgPool,
    user_id: i64,
    password_hash: &str,
) -> Result<u64, sqlx::Error> {
    let r = sqlx::query(
        "UPDATE dashboard_users SET password_hash = $1 WHERE id = $2 AND is_active = 1",
    )
    .bind(password_hash)
    .bind(user_id)
    .execute(pool)
    .await?;
    Ok(r.rows_affected())
}

pub async fn update_admin_user(
    pool: &PgPool,
    id: i64,
    tenant_id: i64,
    username: &str,
    role: &str,
    is_active: bool,
    email: Option<Option<&str>>,
    password_hash: Option<&str>,
) -> Result<u64, sqlx::Error> {
    let affected = match (password_hash, email) {
        (Some(h), Some(em)) => {
            sqlx::query(
                "UPDATE dashboard_users SET username = $1, role = $2, is_active = $3, email = $4, password_hash = $5
                 WHERE id = $6 AND COALESCE(tenant_id, 1) = $7",
            )
            .bind(username)
            .bind(role)
            .bind(if is_active { 1 } else { 0 })
            .bind(em)
            .bind(h)
            .bind(id)
            .bind(tenant_id)
            .execute(pool)
            .await?
            .rows_affected()
        }
        (Some(h), None) => {
            sqlx::query(
                "UPDATE dashboard_users SET username = $1, role = $2, is_active = $3, password_hash = $4
                 WHERE id = $5 AND COALESCE(tenant_id, 1) = $6",
            )
            .bind(username)
            .bind(role)
            .bind(if is_active { 1 } else { 0 })
            .bind(h)
            .bind(id)
            .bind(tenant_id)
            .execute(pool)
            .await?
            .rows_affected()
        }
        (None, Some(em)) => {
            sqlx::query(
                "UPDATE dashboard_users SET username = $1, role = $2, is_active = $3, email = $4
                 WHERE id = $5 AND COALESCE(tenant_id, 1) = $6",
            )
            .bind(username)
            .bind(role)
            .bind(if is_active { 1 } else { 0 })
            .bind(em)
            .bind(id)
            .bind(tenant_id)
            .execute(pool)
            .await?
            .rows_affected()
        }
        (None, None) => {
            sqlx::query(
                "UPDATE dashboard_users SET username = $1, role = $2, is_active = $3
                 WHERE id = $4 AND COALESCE(tenant_id, 1) = $5",
            )
            .bind(username)
            .bind(role)
            .bind(if is_active { 1 } else { 0 })
            .bind(id)
            .bind(tenant_id)
            .execute(pool)
            .await?
            .rows_affected()
        }
    };
    Ok(affected)
}

pub async fn delete_admin_user(
    pool: &PgPool,
    id: i64,
    tenant_id: i64,
) -> Result<u64, sqlx::Error> {
    let r = sqlx::query(
        "DELETE FROM dashboard_users WHERE id = $1 AND COALESCE(tenant_id, 1) = $2",
    )
    .bind(id)
    .bind(tenant_id)
    .execute(pool)
    .await?;
    Ok(r.rows_affected())
}

#[derive(Debug, Clone, serde::Serialize, sqlx::FromRow)]
pub struct AuditLogRow {
    pub id: i64,
    pub tenant_id: i64,
    pub actor: String,
    pub role: String,
    pub action: String,
    pub resource: String,
    pub result: String,
    pub source_ip: Option<String>,
    pub details: Option<String>,
    pub created_at: String,
}

pub async fn insert_audit_log(
    pool: &PgPool,
    tenant_id: i64,
    actor: &str,
    role: &str,
    action: &str,
    resource: &str,
    result: &str,
    source_ip: Option<&str>,
    details: Option<&str>,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO audit_logs (tenant_id, actor, role, action, resource, result, source_ip, details)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
    )
    .bind(tenant_id)
    .bind(actor)
    .bind(role)
    .bind(action)
    .bind(resource)
    .bind(result)
    .bind(source_ip)
    .bind(details)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn list_audit_logs(
    pool: &PgPool,
    tenant_id: i64,
    limit: i64,
) -> Result<Vec<AuditLogRow>, sqlx::Error> {
    sqlx::query_as::<_, AuditLogRow>(
        "SELECT id, tenant_id, actor, role, action, resource, result, source_ip, details, created_at::text AS created_at
         FROM audit_logs WHERE tenant_id = $1 ORDER BY id DESC LIMIT $2",
    )
    .bind(tenant_id)
    .bind(limit)
    .fetch_all(pool)
    .await
}

#[derive(Debug, Clone, serde::Serialize, sqlx::FromRow)]
pub struct TransactionLogRow {
    pub id: i64,
    pub tenant_id: Option<i64>,
    pub request_id: String,
    pub method: String,
    pub path: String,
    pub status: i32,
    pub duration_ms: i64,
    pub client_ip: Option<String>,
    pub api_key_masked: Option<String>,
    pub client_key_id: Option<i64>,
    pub outcome: String,
    pub reason: String,
    pub upstream: Option<String>,
    pub created_at: String,
}

pub async fn insert_transaction_log(
    pool: &PgPool,
    tenant_id: Option<i64>,
    request_id: &str,
    method: &str,
    path: &str,
    status: i32,
    duration_ms: i64,
    client_ip: Option<&str>,
    api_key_masked: &str,
    client_key_id: Option<i64>,
    outcome: &str,
    reason: &str,
    upstream: Option<&str>,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO gateway_transaction_logs
         (tenant_id, request_id, method, path, status, duration_ms, client_ip, api_key_masked, client_key_id, outcome, reason, upstream)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)",
    )
    .bind(tenant_id)
    .bind(request_id)
    .bind(method)
    .bind(path)
    .bind(status)
    .bind(duration_ms)
    .bind(client_ip)
    .bind(api_key_masked)
    .bind(client_key_id)
    .bind(outcome)
    .bind(reason)
    .bind(upstream)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn list_transaction_logs(
    pool: &PgPool,
    tenant_id: i64,
    limit: i64,
    method: Option<&str>,
    status_min: Option<i64>,
    status_max: Option<i64>,
    outcome: Option<&str>,
    search: Option<&str>,
    reason: Option<&str>,
    client_key_id: Option<i64>,
) -> Result<Vec<TransactionLogRow>, sqlx::Error> {
    let lim = limit.clamp(1, 500);
    let mut n: i32 = 2;
    let mut sql = String::from(
        "SELECT id, tenant_id, request_id, method, path, status, duration_ms, client_ip, api_key_masked, client_key_id, outcome, reason, upstream, created_at::text AS created_at
         FROM gateway_transaction_logs WHERE tenant_id = $1",
    );
    if method.filter(|m| !m.is_empty() && *m != "all").is_some() {
        sql.push_str(&format!(" AND method = ${n}"));
        n += 1;
    }
    if status_min.is_some() {
        sql.push_str(&format!(" AND status >= ${n}"));
        n += 1;
    }
    if status_max.is_some() {
        sql.push_str(&format!(" AND status < ${n}"));
        n += 1;
    }
    if let Some(o) = outcome.filter(|o| !o.is_empty() && *o != "all") {
        if o == "success" {
            sql.push_str(" AND outcome = 'success'");
        } else if o == "failure" {
            sql.push_str(" AND outcome != 'success'");
        }
    }
    if search.filter(|s| !s.trim().is_empty()).is_some() {
        sql.push_str(&format!(
            " AND (path LIKE ${n} OR request_id LIKE ${n2} OR COALESCE(client_ip,'') LIKE ${n3} OR COALESCE(api_key_masked,'') LIKE ${n4})",
            n2 = n + 1,
            n3 = n + 2,
            n4 = n + 3
        ));
        n += 4;
    }
    if reason.filter(|r| !r.is_empty() && *r != "all").is_some() {
        sql.push_str(&format!(" AND reason = ${n}"));
        n += 1;
    }
    if client_key_id.is_some() {
        sql.push_str(&format!(" AND client_key_id = ${n}"));
        n += 1;
    }
    sql.push_str(&format!(" ORDER BY id DESC LIMIT ${n}"));

    let mut q = sqlx::query_as::<_, TransactionLogRow>(&sql).bind(tenant_id);
    if let Some(m) = method.filter(|m| !m.is_empty() && *m != "all") {
        q = q.bind(m.to_uppercase());
    }
    if let Some(smin) = status_min {
        q = q.bind(smin);
    }
    if let Some(smax) = status_max {
        q = q.bind(smax);
    }
    if let Some(s) = search.filter(|s| !s.trim().is_empty()) {
        let pat = format!("%{}%", s.trim());
        q = q.bind(pat.clone()).bind(pat.clone()).bind(pat.clone()).bind(pat);
    }
    if let Some(r) = reason.filter(|r| !r.is_empty() && *r != "all") {
        q = q.bind(r);
    }
    if let Some(cid) = client_key_id {
        q = q.bind(cid);
    }
    q.bind(lim).fetch_all(pool).await
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct ClientKeyTrafficStats {
    pub hours: i32,
    pub total: i64,
    pub success: i64,
    pub denied: i64,
    pub upstream_error: i64,
    pub avg_duration_ms: f64,
    pub top_paths: Vec<(String, i64)>,
}

pub async fn client_key_traffic_stats(
    pool: &PgPool,
    tenant_id: i64,
    client_key_id: i64,
    hours: i32,
) -> Result<ClientKeyTrafficStats, sqlx::Error> {
    let hours = hours.clamp(1, 168);
    let exists: Option<i64> = sqlx::query_scalar(
        "SELECT id FROM gateway_client_keys WHERE id = $1 AND tenant_id = $2",
    )
    .bind(client_key_id)
    .bind(tenant_id)
    .fetch_optional(pool)
    .await?;
    if exists.is_none() {
        return Ok(ClientKeyTrafficStats {
            hours,
            total: 0,
            success: 0,
            denied: 0,
            upstream_error: 0,
            avg_duration_ms: 0.0,
            top_paths: vec![],
        });
    }

    let interval = format!("{hours} hours");
    let total: i64 = sqlx::query_scalar(&format!(
        "SELECT COUNT(*) FROM gateway_transaction_logs
         WHERE tenant_id = $1 AND client_key_id = $2 AND created_at >= NOW() - INTERVAL '{}'",
        interval
    ))
    .bind(tenant_id)
    .bind(client_key_id)
    .fetch_one(pool)
    .await?;

    let success: i64 = sqlx::query_scalar(&format!(
        "SELECT COUNT(*) FROM gateway_transaction_logs
         WHERE tenant_id = $1 AND client_key_id = $2 AND created_at >= NOW() - INTERVAL '{}'
           AND outcome = 'success'",
        interval
    ))
    .bind(tenant_id)
    .bind(client_key_id)
    .fetch_one(pool)
    .await?;

    let denied: i64 = sqlx::query_scalar(&format!(
        "SELECT COUNT(*) FROM gateway_transaction_logs
         WHERE tenant_id = $1 AND client_key_id = $2 AND created_at >= NOW() - INTERVAL '{}'
           AND outcome = 'denied'",
        interval
    ))
    .bind(tenant_id)
    .bind(client_key_id)
    .fetch_one(pool)
    .await?;

    let upstream_error: i64 = sqlx::query_scalar(&format!(
        "SELECT COUNT(*) FROM gateway_transaction_logs
         WHERE tenant_id = $1 AND client_key_id = $2 AND created_at >= NOW() - INTERVAL '{}'
           AND outcome = 'upstream_error'",
        interval
    ))
    .bind(tenant_id)
    .bind(client_key_id)
    .fetch_one(pool)
    .await?;

    let avg_duration_ms: Option<f64> = sqlx::query_scalar(&format!(
        "SELECT AVG(duration_ms)::float8 FROM gateway_transaction_logs
         WHERE tenant_id = $1 AND client_key_id = $2 AND created_at >= NOW() - INTERVAL '{}'",
        interval
    ))
    .bind(tenant_id)
    .bind(client_key_id)
    .fetch_optional(pool)
    .await?;

    let top_paths: Vec<(String, i64)> = sqlx::query_as(&format!(
        "SELECT path, COUNT(*) AS cnt FROM gateway_transaction_logs
         WHERE tenant_id = $1 AND client_key_id = $2 AND created_at >= NOW() - INTERVAL '{}'
         GROUP BY path ORDER BY cnt DESC LIMIT 5",
        interval
    ))
    .bind(tenant_id)
    .bind(client_key_id)
    .fetch_all(pool)
    .await?;

    Ok(ClientKeyTrafficStats {
        hours,
        total,
        success,
        denied,
        upstream_error,
        avg_duration_ms: avg_duration_ms.unwrap_or(0.0),
        top_paths,
    })
}

#[derive(Debug, Clone, serde::Serialize, sqlx::FromRow)]
pub struct ClientKeyTrafficSummaryRow {
    pub client_key_id: i64,
    pub total: i64,
}

pub async fn client_keys_traffic_summary_24h(
    pool: &PgPool,
    tenant_id: i64,
) -> Result<Vec<ClientKeyTrafficSummaryRow>, sqlx::Error> {
    sqlx::query_as(
        "SELECT client_key_id, COUNT(*)::bigint AS total
         FROM gateway_transaction_logs
         WHERE tenant_id = $1 AND client_key_id IS NOT NULL
           AND created_at >= NOW() - INTERVAL '24 hours'
         GROUP BY client_key_id
         ORDER BY total DESC",
    )
    .bind(tenant_id)
    .fetch_all(pool)
    .await
}

#[derive(Debug, Clone, serde::Serialize, sqlx::FromRow)]
pub struct ClientTrafficTopRow {
    pub client_key_id: i64,
    pub name: String,
    pub total: i64,
}

pub async fn client_traffic_top_24h(
    pool: &PgPool,
    tenant_id: i64,
    limit: i64,
) -> Result<Vec<ClientTrafficTopRow>, sqlx::Error> {
    let lim = limit.clamp(1, 20);
    sqlx::query_as(
        "SELECT k.id AS client_key_id, k.name, COUNT(*)::bigint AS total
         FROM gateway_transaction_logs t
         INNER JOIN gateway_client_keys k ON k.id = t.client_key_id
         WHERE t.tenant_id = $1 AND t.client_key_id IS NOT NULL
           AND t.created_at >= NOW() - INTERVAL '24 hours'
         GROUP BY k.id, k.name
         ORDER BY total DESC
         LIMIT $2",
    )
    .bind(tenant_id)
    .bind(lim)
    .fetch_all(pool)
    .await
}

pub async fn list_audit_logs_filtered(
    pool: &PgPool,
    tenant_id: i64,
    limit: i64,
    result: Option<&str>,
    search: Option<&str>,
) -> Result<Vec<AuditLogRow>, sqlx::Error> {
    let lim = limit.clamp(1, 500);
    let mut n: i32 = 2;
    let mut sql = String::from(
        "SELECT id, tenant_id, actor, role, action, resource, result, source_ip, details, created_at::text AS created_at
         FROM audit_logs WHERE tenant_id = $1",
    );
    if result.filter(|r| !r.is_empty() && *r != "all").is_some() {
        sql.push_str(&format!(" AND result = ${n}"));
        n += 1;
    }
    if search.filter(|s| !s.trim().is_empty()).is_some() {
        sql.push_str(&format!(
            " AND (actor LIKE ${n} OR action LIKE ${n2} OR resource LIKE ${n3} OR COALESCE(details,'') LIKE ${n4})",
            n2 = n + 1,
            n3 = n + 2,
            n4 = n + 3
        ));
        n += 4;
    }
    sql.push_str(&format!(" ORDER BY id DESC LIMIT ${n}"));

    let mut q = sqlx::query_as::<_, AuditLogRow>(&sql).bind(tenant_id);
    if let Some(r) = result.filter(|r| !r.is_empty() && *r != "all") {
        q = q.bind(r);
    }
    if let Some(s) = search.filter(|s| !s.trim().is_empty()) {
        let pat = format!("%{}%", s.trim());
        q = q.bind(pat.clone()).bind(pat.clone()).bind(pat.clone()).bind(pat);
    }
    q.bind(lim).fetch_all(pool).await
}

pub async fn list_routes_for_tenant(
    pool: &PgPool,
    tenant_id: i64,
) -> Result<Vec<RouteRow>, sqlx::Error> {
    sqlx::query_as::<_, RouteRow>(
        &format!("SELECT {ROUTE_SELECT} FROM gateway_routes WHERE tenant_id = $1 ORDER BY path"),
    )
    .bind(tenant_id)
    .fetch_all(pool)
    .await
}

pub async fn fetch_route_by_id_tenant(
    pool: &PgPool,
    id: i64,
    tenant_id: i64,
) -> Result<Option<RouteRow>, sqlx::Error> {
    sqlx::query_as::<_, RouteRow>(
        &format!("SELECT {ROUTE_SELECT} FROM gateway_routes WHERE id = $1 AND tenant_id = $2"),
    )
    .bind(id)
    .bind(tenant_id)
    .fetch_optional(pool)
    .await
}

pub async fn load_route_rows(pool: &PgPool) -> Result<Vec<RouteRow>, sqlx::Error> {
    sqlx::query_as::<_, RouteRow>(
        &format!("SELECT {ROUTE_SELECT} FROM gateway_routes ORDER BY path"),
    )
    .fetch_all(pool)
    .await
}

pub async fn load_client_key_hashes(pool: &PgPool) -> Result<Vec<String>, sqlx::Error> {
    sqlx::query_scalar("SELECT secret_sha256_hex FROM gateway_client_keys ORDER BY id")
        .fetch_all(pool)
        .await
}

pub async fn load_admin_hash(pool: &PgPool) -> Result<String, sqlx::Error> {
    sqlx::query_scalar(
        "SELECT v FROM gateway_settings WHERE k = 'admin_x_api_key_sha256' LIMIT 1",
    )
    .fetch_one(pool)
    .await
}

#[derive(Debug, Clone, serde::Serialize, sqlx::FromRow)]
pub struct ClientKeyMeta {
    pub id: i64,
    pub name: String,
    pub api_key: Option<String>,
    pub auth_mode: String,
    pub integration_type: String,
    pub tenant_id: i64,
    pub status: String,
    pub rate_limit_per_min: i32,
    #[serde(default)]
    pub allowed_route_ids: Vec<i64>,
    pub last_used_at: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct RouteAclSummaryRow {
    pub route_id: i64,
    pub client_count: i64,
    pub client_names: Vec<String>,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct RouteAclClientRow {
    pub id: i64,
    pub name: String,
    pub status: String,
}

pub async fn list_client_keys(
    pool: &PgPool,
    tenant_id: i64,
) -> Result<Vec<ClientKeyMeta>, sqlx::Error> {
    list_client_keys_scoped(pool, tenant_id, None, true).await
}

/// Admin: toàn tenant. Operator: chỉ key do mình tạo (`owner_user_id`).
pub async fn list_client_keys_scoped(
    pool: &PgPool,
    tenant_id: i64,
    owner_user_id: Option<i64>,
    admin_sees_all: bool,
) -> Result<Vec<ClientKeyMeta>, sqlx::Error> {
    if admin_sees_all || owner_user_id.is_none() {
        sqlx::query_as::<_, ClientKeyMeta>(
            "SELECT k.id, k.name, k.api_key,
                    CASE WHEN k.secret_encrypted IS NOT NULL AND k.secret_encrypted != '' THEN 'hmac'
                         ELSE 'legacy' END AS auth_mode,
                    COALESCE(k.integration_type, 'app') AS integration_type,
                    k.tenant_id,
                    COALESCE(k.status, 'active') AS status,
                    COALESCE(k.rate_limit_per_min, 0) AS rate_limit_per_min,
                    COALESCE(
                        (SELECT array_agg(r.route_id ORDER BY r.route_id)
                         FROM gateway_client_key_routes r WHERE r.client_key_id = k.id),
                        ARRAY[]::BIGINT[]
                    ) AS allowed_route_ids,
                    k.last_used_at::text AS last_used_at
             FROM gateway_client_keys k WHERE k.tenant_id = $1 ORDER BY k.id",
        )
        .bind(tenant_id)
        .fetch_all(pool)
        .await
    } else {
        let uid = owner_user_id.unwrap_or(0);
        sqlx::query_as::<_, ClientKeyMeta>(
            "SELECT k.id, k.name, k.api_key,
                    CASE WHEN k.secret_encrypted IS NOT NULL AND k.secret_encrypted != '' THEN 'hmac'
                         ELSE 'legacy' END AS auth_mode,
                    COALESCE(k.integration_type, 'app') AS integration_type,
                    k.tenant_id,
                    COALESCE(k.status, 'active') AS status,
                    COALESCE(k.rate_limit_per_min, 0) AS rate_limit_per_min,
                    COALESCE(
                        (SELECT array_agg(r.route_id ORDER BY r.route_id)
                         FROM gateway_client_key_routes r WHERE r.client_key_id = k.id),
                        ARRAY[]::BIGINT[]
                    ) AS allowed_route_ids,
                    k.last_used_at::text AS last_used_at
             FROM gateway_client_keys k WHERE k.tenant_id = $1 AND k.owner_user_id = $2 ORDER BY k.id",
        )
        .bind(tenant_id)
        .bind(uid)
        .fetch_all(pool)
        .await
    }
}

pub async fn fetch_client_key_owner(
    pool: &PgPool,
    id: i64,
    tenant_id: i64,
) -> Result<Option<i64>, sqlx::Error> {
    sqlx::query_scalar(
        "SELECT owner_user_id FROM gateway_client_keys WHERE id = $1 AND tenant_id = $2 LIMIT 1",
    )
    .bind(id)
    .bind(tenant_id)
    .fetch_optional(pool)
    .await
}

pub async fn load_client_credentials(pool: &PgPool) -> Result<ClientCredentials, sqlx::Error> {
    let rows: Vec<(
        i64,
        Option<String>,
        Option<String>,
        Option<String>,
        i64,
        String,
        i32,
    )> = sqlx::query_as(
        "SELECT id, api_key, secret_encrypted, secret_sha256_hex, tenant_id,
                COALESCE(status, 'active'), COALESCE(rate_limit_per_min, 0)
         FROM gateway_client_keys ORDER BY id",
    )
    .fetch_all(pool)
    .await?;

    let allowlists = load_all_client_key_route_allowlists(pool).await?;

    let mut creds = ClientCredentials::default();
    for (id, api_key, secret_enc, legacy_hash, tenant_id, status, rate_limit_per_min) in rows {
        let allowed_route_ids = allowlists.get(&id).cloned().unwrap_or_default();
        if status != "active" {
            if let Some(k) = api_key.filter(|s| !s.is_empty()) {
                creds.disabled_clients.push(DisabledClientKey {
                    id,
                    api_key: k,
                    tenant_id,
                });
            }
            continue;
        }
        if let Some(enc) = secret_enc.filter(|s| !s.is_empty()) {
            if let Some(key_id) = api_key.filter(|s| !s.is_empty()) {
                match crypto::decrypt_secret(&enc) {
                    Ok(secret) => creds.hmac.push(HmacClientKey {
                        id,
                        api_key: key_id,
                        secret,
                        tenant_id,
                        rate_limit_per_min,
                        allowed_route_ids,
                    }),
                    Err(e) => tracing::error!(api_key = %key_id, error = %e, "skip hmac key: decrypt failed"),
                }
            }
        } else if let Some(h) = legacy_hash.filter(|s| !s.is_empty()) {
            creds.legacy.push(LegacyClientKey {
                id,
                sha256_hex: h,
                tenant_id,
                rate_limit_per_min,
                allowed_route_ids,
            });
        }
    }
    Ok(creds)
}

async fn load_all_client_key_route_allowlists(
    pool: &PgPool,
) -> Result<std::collections::HashMap<i64, Vec<i64>>, sqlx::Error> {
    let rows: Vec<(i64, i64)> = sqlx::query_as(
        "SELECT client_key_id, route_id FROM gateway_client_key_routes ORDER BY client_key_id, route_id",
    )
    .fetch_all(pool)
    .await?;
    let mut map: std::collections::HashMap<i64, Vec<i64>> = std::collections::HashMap::new();
    for (cid, rid) in rows {
        map.entry(cid).or_default().push(rid);
    }
    Ok(map)
}

pub async fn fetch_client_key_routes(
    pool: &PgPool,
    client_key_id: i64,
    tenant_id: i64,
) -> Result<Option<Vec<i64>>, sqlx::Error> {
    let exists: Option<i64> = sqlx::query_scalar(
        "SELECT id FROM gateway_client_keys WHERE id = $1 AND tenant_id = $2 LIMIT 1",
    )
    .bind(client_key_id)
    .bind(tenant_id)
    .fetch_optional(pool)
    .await?;
    if exists.is_none() {
        return Ok(None);
    }
    let rows: Vec<i64> = sqlx::query_scalar(
        "SELECT route_id FROM gateway_client_key_routes WHERE client_key_id = $1 ORDER BY route_id",
    )
    .bind(client_key_id)
    .fetch_all(pool)
    .await?;
    Ok(Some(rows))
}

pub async fn set_client_key_routes(
    pool: &PgPool,
    client_key_id: i64,
    tenant_id: i64,
    route_ids: &[i64],
) -> Result<bool, sqlx::Error> {
    let exists: Option<i64> = sqlx::query_scalar(
        "SELECT id FROM gateway_client_keys WHERE id = $1 AND tenant_id = $2 LIMIT 1",
    )
    .bind(client_key_id)
    .bind(tenant_id)
    .fetch_optional(pool)
    .await?;
    if exists.is_none() {
        return Ok(false);
    }
    let mut tx = pool.begin().await?;
    sqlx::query("DELETE FROM gateway_client_key_routes WHERE client_key_id = $1")
        .bind(client_key_id)
        .execute(&mut *tx)
        .await?;
    for rid in route_ids {
        let ok: Option<i64> = sqlx::query_scalar(
            "SELECT id FROM gateway_routes WHERE id = $1 AND tenant_id = $2 LIMIT 1",
        )
        .bind(rid)
        .bind(tenant_id)
        .fetch_optional(&mut *tx)
        .await?;
        if ok.is_some() {
            sqlx::query(
                "INSERT INTO gateway_client_key_routes (client_key_id, route_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
            )
            .bind(client_key_id)
            .bind(rid)
            .execute(&mut *tx)
            .await?;
        }
    }
    tx.commit().await?;
    Ok(true)
}

/// Rotate HMAC secret; returns public api_key when updated.
pub async fn rotate_client_key_secret(
    pool: &PgPool,
    id: i64,
    tenant_id: i64,
    new_secret: &str,
) -> Result<Option<String>, sqlx::Error> {
    let enc = crypto::encrypt_secret(new_secret).map_err(|e| {
        sqlx::Error::Configuration(format!("encrypt secret: {e}").into())
    })?;
    sqlx::query_scalar(
        "UPDATE gateway_client_keys SET secret_encrypted = $3
         WHERE id = $1 AND tenant_id = $2
           AND api_key IS NOT NULL
           AND secret_encrypted IS NOT NULL AND secret_encrypted != ''
         RETURNING api_key",
    )
    .bind(id)
    .bind(tenant_id)
    .bind(&enc)
    .fetch_optional(pool)
    .await
}

pub async fn update_client_key_registry(
    pool: &PgPool,
    id: i64,
    tenant_id: i64,
    status: Option<&str>,
    rate_limit_per_min: Option<i32>,
) -> Result<u64, sqlx::Error> {
    match (status, rate_limit_per_min) {
        (Some(s), Some(rl)) => {
            let r = sqlx::query(
                "UPDATE gateway_client_keys SET status = $3, rate_limit_per_min = $4 WHERE id = $1 AND tenant_id = $2",
            )
            .bind(id)
            .bind(tenant_id)
            .bind(s)
            .bind(rl)
            .execute(pool)
            .await?;
            Ok(r.rows_affected())
        }
        (Some(s), None) => {
            let r = sqlx::query(
                "UPDATE gateway_client_keys SET status = $3 WHERE id = $1 AND tenant_id = $2",
            )
            .bind(id)
            .bind(tenant_id)
            .bind(s)
            .execute(pool)
            .await?;
            Ok(r.rows_affected())
        }
        (None, Some(rl)) => {
            let r = sqlx::query(
                "UPDATE gateway_client_keys SET rate_limit_per_min = $3 WHERE id = $1 AND tenant_id = $2",
            )
            .bind(id)
            .bind(tenant_id)
            .bind(rl)
            .execute(pool)
            .await?;
            Ok(r.rows_affected())
        }
        (None, None) => Ok(0),
    }
}

pub async fn bulk_update_client_key_status(
    pool: &PgPool,
    tenant_id: i64,
    ids: &[i64],
    status: &str,
    owner_user_id: Option<i64>,
) -> Result<u64, sqlx::Error> {
    if ids.is_empty() {
        return Ok(0);
    }
    let r = sqlx::query(
        "UPDATE gateway_client_keys SET status = $3
         WHERE tenant_id = $1 AND id = ANY($2)
           AND ($4::bigint IS NULL OR owner_user_id = $4)",
    )
    .bind(tenant_id)
    .bind(ids)
    .bind(status)
    .bind(owner_user_id)
    .execute(pool)
    .await?;
    Ok(r.rows_affected())
}

pub async fn insert_route(
    pool: &PgPool,
    path: &str,
    target: &str,
    timeout_secs: i32,
    rate_limit_per_min: i32,
    tenant_id: i64,
    transform_add_headers: &str,
    transform_remove_headers: &str,
    retry_max: i32,
    retry_on_status: &str,
    retry_on_timeout: i32,
    queue_on_failure: i32,
    allowed_methods: &str,
) -> Result<RouteRow, sqlx::Error> {
    sqlx::query_as::<_, RouteRow>(
        &format!(
            "INSERT INTO gateway_routes (path, target, timeout_secs, rate_limit_per_min, tenant_id, transform_add_headers, transform_remove_headers, retry_max, retry_on_status, retry_on_timeout, queue_on_failure, allowed_methods)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         RETURNING {ROUTE_SELECT}"
        ),
    )
    .bind(path)
    .bind(target)
    .bind(timeout_secs)
    .bind(rate_limit_per_min)
    .bind(tenant_id)
    .bind(transform_add_headers)
    .bind(transform_remove_headers)
    .bind(retry_max)
    .bind(retry_on_status)
    .bind(retry_on_timeout)
    .bind(queue_on_failure)
    .bind(allowed_methods)
    .fetch_one(pool)
    .await
}

pub async fn fetch_route_by_id(pool: &PgPool, id: i64) -> Result<Option<RouteRow>, sqlx::Error> {
    sqlx::query_as::<_, RouteRow>(
        &format!("SELECT {ROUTE_SELECT} FROM gateway_routes WHERE id = $1"),
    )
    .bind(id)
    .fetch_optional(pool)
    .await
}

pub async fn update_route(
    pool: &PgPool,
    id: i64,
    tenant_id: i64,
    path: &str,
    target: &str,
    timeout_secs: i32,
    rate_limit_per_min: i32,
    transform_add_headers: &str,
    transform_remove_headers: &str,
    retry_max: i32,
    retry_on_status: &str,
    retry_on_timeout: i32,
    queue_on_failure: i32,
    allowed_methods: &str,
) -> Result<u64, sqlx::Error> {
    let r = sqlx::query(
        "UPDATE gateway_routes SET path = $1, target = $2, timeout_secs = $3, rate_limit_per_min = $4,
         transform_add_headers = $5, transform_remove_headers = $6, retry_max = $7, retry_on_status = $8,
         retry_on_timeout = $9, queue_on_failure = $10, allowed_methods = $11
         WHERE id = $12 AND tenant_id = $13",
    )
    .bind(path)
    .bind(target)
    .bind(timeout_secs)
    .bind(rate_limit_per_min)
    .bind(transform_add_headers)
    .bind(transform_remove_headers)
    .bind(retry_max)
    .bind(retry_on_status)
    .bind(retry_on_timeout)
    .bind(queue_on_failure)
    .bind(allowed_methods)
    .bind(id)
    .bind(tenant_id)
    .execute(pool)
    .await?;
    Ok(r.rows_affected())
}

pub async fn delete_route(pool: &PgPool, id: i64, tenant_id: i64) -> Result<u64, sqlx::Error> {
    let r = sqlx::query("DELETE FROM gateway_routes WHERE id = $1 AND tenant_id = $2")
        .bind(id)
        .bind(tenant_id)
        .execute(pool)
        .await?;
    Ok(r.rows_affected())
}

fn random_token(prefix: &str, len: usize) -> String {
    use rand::Rng;
    let mut rng = rand::thread_rng();
    const ALPH: &[u8] = b"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    let tail: String = (0..len)
        .map(|_| ALPH[rng.gen_range(0..ALPH.len())] as char)
        .collect();
    format!("{prefix}{tail}")
}

/// Legacy single-token key (SHA-256 at rest, no HMAC).
pub fn random_client_api_key() -> String {
    random_token("avaso_", 36)
}

pub fn random_api_key_id() -> String {
    random_token("avaso_pk_", 24)
}

pub fn random_secret_key() -> String {
    random_token("avaso_sk_", 40)
}

pub async fn insert_client_key_legacy(
    pool: &PgPool,
    name: &str,
    plain: &str,
) -> Result<i64, sqlx::Error> {
    let h = sha256_hex(plain);
    sqlx::query_scalar(
        "INSERT INTO gateway_client_keys (name, secret_sha256_hex) VALUES ($1, $2) RETURNING id",
    )
    .bind(name)
    .bind(&h)
    .fetch_one(pool)
    .await
}

/// API_KEY (public) + SECRET_KEY (encrypted) for HMAC-SHA256.
pub async fn insert_client_key_hmac(
    pool: &PgPool,
    name: &str,
    api_key: &str,
    secret_key: &str,
    tenant_id: i64,
    integration_type: &str,
    owner_user_id: i64,
    rate_limit_per_min: i32,
) -> Result<i64, sqlx::Error> {
    let enc = crypto::encrypt_secret(secret_key).map_err(|e| {
        sqlx::Error::Configuration(format!("encrypt secret: {e}").into())
    })?;
    let sha_placeholder = format!("hmac:{}", sha256_hex(api_key));
    sqlx::query_scalar(
        "INSERT INTO gateway_client_keys (name, api_key, secret_encrypted, secret_sha256_hex, tenant_id, integration_type, owner_user_id, status, rate_limit_per_min)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'active', $8) RETURNING id",
    )
    .bind(name)
    .bind(api_key)
    .bind(&enc)
    .bind(&sha_placeholder)
    .bind(tenant_id)
    .bind(integration_type)
    .bind(owner_user_id)
    .bind(rate_limit_per_min)
    .fetch_one(pool)
    .await
}

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct IntegrationRow {
    pub id: i64,
    pub tenant_id: i64,
    pub provider: String,
    pub status: String,
    pub config_encrypted: Option<String>,
    pub last_sync_at: Option<String>,
    pub last_error: Option<String>,
    pub updated_at: String,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct IntegrationPublic {
    pub id: i64,
    pub provider: String,
    pub status: String,
    pub last_sync_at: Option<String>,
    pub last_error: Option<String>,
    pub updated_at: String,
    #[serde(default)]
    pub label: String,
    #[serde(default)]
    pub available: bool,
    /// Token demo (seed script) — không gọi API SF/Zoho thật.
    #[serde(default)]
    pub is_demo: bool,
}

impl From<IntegrationRow> for IntegrationPublic {
    fn from(r: IntegrationRow) -> Self {
        let label = match r.provider.as_str() {
            "salesforce" => "Salesforce",
            "zoho_projects" => "Zoho Projects",
            "zoho_office" => "Zoho Office Integrator",
            other => other,
        }
        .to_string();
        Self {
            id: r.id,
            provider: r.provider,
            status: r.status,
            last_sync_at: r.last_sync_at,
            last_error: r.last_error,
            updated_at: r.updated_at,
            label,
            available: true,
            is_demo: false,
        }
    }
}

pub async fn ensure_integration_row(
    pool: &PgPool,
    tenant_id: i64,
    provider: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO integrations (tenant_id, provider, status) VALUES ($1, $2, 'disconnected')
         ON CONFLICT (tenant_id, provider) DO NOTHING",
    )
    .bind(tenant_id)
    .bind(provider)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn delete_integration_entity_links(
    pool: &PgPool,
    tenant_id: i64,
) -> Result<u64, sqlx::Error> {
    let r = sqlx::query("DELETE FROM integration_entity_links WHERE tenant_id = $1")
        .bind(tenant_id)
        .execute(pool)
        .await?;
    Ok(r.rows_affected())
}

pub async fn list_integrations(
    pool: &PgPool,
    tenant_id: i64,
) -> Result<Vec<IntegrationPublic>, sqlx::Error> {
    let rows = sqlx::query_as::<_, IntegrationRow>(
        "SELECT id, tenant_id, provider, status, config_encrypted, last_sync_at::text AS last_sync_at, last_error, updated_at::text AS updated_at
         FROM integrations WHERE tenant_id = $1 ORDER BY provider",
    )
    .bind(tenant_id)
    .fetch_all(pool)
    .await?;
    Ok(rows.into_iter().map(Into::into).collect())
}

pub async fn fetch_integration(
    pool: &PgPool,
    tenant_id: i64,
    provider: &str,
) -> Result<Option<IntegrationRow>, sqlx::Error> {
    sqlx::query_as::<_, IntegrationRow>(
        "SELECT id, tenant_id, provider, status, config_encrypted, last_sync_at::text AS last_sync_at, last_error, updated_at::text AS updated_at
         FROM integrations WHERE tenant_id = $1 AND provider = $2 LIMIT 1",
    )
    .bind(tenant_id)
    .bind(provider)
    .fetch_optional(pool)
    .await
}

pub async fn set_integration_status(
    pool: &PgPool,
    tenant_id: i64,
    provider: &str,
    status: &str,
    last_error: Option<&str>,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO integrations (tenant_id, provider, status, last_error, updated_at)
         VALUES ($1, $2, $3, $4, NOW())
         ON CONFLICT(tenant_id, provider) DO UPDATE SET
           status = excluded.status,
           last_error = excluded.last_error,
           updated_at = NOW()",
    )
    .bind(tenant_id)
    .bind(provider)
    .bind(status)
    .bind(last_error)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn upsert_integration_config(
    pool: &PgPool,
    tenant_id: i64,
    provider: &str,
    status: &str,
    config_encrypted: &str,
    last_error: Option<&str>,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO integrations (tenant_id, provider, status, config_encrypted, last_error, updated_at)
         VALUES ($1, $2, $3, $4, $5, NOW())
         ON CONFLICT(tenant_id, provider) DO UPDATE SET
           status = excluded.status,
           config_encrypted = excluded.config_encrypted,
           last_error = excluded.last_error,
           updated_at = NOW()",
    )
    .bind(tenant_id)
    .bind(provider)
    .bind(status)
    .bind(config_encrypted)
    .bind(last_error)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn clear_integration(
    pool: &PgPool,
    tenant_id: i64,
    provider: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "UPDATE integrations SET status = 'disconnected', config_encrypted = NULL, last_error = NULL,
         updated_at = NOW() WHERE tenant_id = $1 AND provider = $2",
    )
    .bind(tenant_id)
    .bind(provider)
    .execute(pool)
    .await?;
    Ok(())
}

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct IntegrationProviderConfigRow {
    pub id: i64,
    pub tenant_id: i64,
    pub provider: String,
    pub config_encrypted: String,
    pub updated_by: String,
    pub updated_at: String,
}

pub async fn fetch_integration_provider_config(
    pool: &PgPool,
    tenant_id: i64,
    provider: &str,
) -> Result<Option<IntegrationProviderConfigRow>, sqlx::Error> {
    sqlx::query_as::<_, IntegrationProviderConfigRow>(
        "SELECT id, tenant_id, provider, config_encrypted, updated_by, updated_at::text AS updated_at
         FROM integration_provider_configs
         WHERE tenant_id = $1 AND provider = $2 LIMIT 1",
    )
    .bind(tenant_id)
    .bind(provider)
    .fetch_optional(pool)
    .await
}

pub async fn upsert_integration_provider_config(
    pool: &PgPool,
    tenant_id: i64,
    provider: &str,
    config_encrypted: &str,
    updated_by: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO integration_provider_configs (tenant_id, provider, config_encrypted, updated_by, updated_at)
         VALUES ($1, $2, $3, $4, NOW())
         ON CONFLICT(tenant_id, provider) DO UPDATE SET
           config_encrypted = excluded.config_encrypted,
           updated_by = excluded.updated_by,
           updated_at = NOW()",
    )
    .bind(tenant_id)
    .bind(provider)
    .bind(config_encrypted)
    .bind(updated_by)
    .execute(pool)
    .await?;
    Ok(())
}

#[derive(Debug, Clone, serde::Serialize, sqlx::FromRow)]
pub struct IntegrationSnapshotRow {
    pub id: i64,
    pub tenant_id: i64,
    pub provider: String,
    pub entity_type: String,
    pub payload_json: String,
    pub record_count: i64,
    pub fetched_at: String,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct IntegrationSnapshotSummary {
    pub provider: String,
    pub entity_type: String,
    pub record_count: i64,
    pub fetched_at: String,
}

pub async fn insert_integration_snapshot(
    pool: &PgPool,
    tenant_id: i64,
    provider: &str,
    entity_type: &str,
    payload_json: &str,
    record_count: i64,
) -> Result<i64, sqlx::Error> {
    sqlx::query_scalar(
        "INSERT INTO integration_snapshots (tenant_id, provider, entity_type, payload_json, record_count, fetched_at)
         VALUES ($1, $2, $3, $4, $5, NOW()) RETURNING id",
    )
    .bind(tenant_id)
    .bind(provider)
    .bind(entity_type)
    .bind(payload_json)
    .bind(record_count)
    .fetch_one(pool)
    .await
}

/// Keep newest `keep` rows per (tenant, provider, entity_type).
pub async fn prune_integration_snapshots(
    pool: &PgPool,
    tenant_id: i64,
    provider: &str,
    entity_type: &str,
    keep: i64,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "DELETE FROM integration_snapshots
         WHERE tenant_id = $1 AND provider = $2 AND entity_type = $3
           AND id NOT IN (
             SELECT id FROM integration_snapshots
             WHERE tenant_id = $4 AND provider = $5 AND entity_type = $6
             ORDER BY fetched_at DESC, id DESC
             LIMIT $7
           )",
    )
    .bind(tenant_id)
    .bind(provider)
    .bind(entity_type)
    .bind(tenant_id)
    .bind(provider)
    .bind(entity_type)
    .bind(keep)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn list_integration_snapshot_summaries(
    pool: &PgPool,
    tenant_id: i64,
    provider: Option<&str>,
) -> Result<Vec<IntegrationSnapshotSummary>, sqlx::Error> {
    let rows = if let Some(p) = provider {
        sqlx::query_as::<_, IntegrationSnapshotRow>(
            "SELECT id, tenant_id, provider, entity_type, payload_json, record_count, fetched_at::text AS fetched_at
             FROM integration_snapshots
             WHERE tenant_id = $1 AND provider = $2
             ORDER BY fetched_at DESC, id DESC",
        )
        .bind(tenant_id)
        .bind(p)
        .fetch_all(pool)
        .await?
    } else {
        sqlx::query_as::<_, IntegrationSnapshotRow>(
            "SELECT id, tenant_id, provider, entity_type, payload_json, record_count, fetched_at::text AS fetched_at
             FROM integration_snapshots
             WHERE tenant_id = $1
             ORDER BY fetched_at DESC, id DESC",
        )
        .bind(tenant_id)
        .fetch_all(pool)
        .await?
    };
    let mut out = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for r in rows {
        let key = format!("{}:{}", r.provider, r.entity_type);
        if seen.insert(key) {
            out.push(IntegrationSnapshotSummary {
                provider: r.provider,
                entity_type: r.entity_type,
                record_count: r.record_count,
                fetched_at: r.fetched_at,
            });
        }
    }
    Ok(out)
}

pub async fn fetch_latest_integration_snapshot(
    pool: &PgPool,
    tenant_id: i64,
    provider: &str,
    entity_type: &str,
) -> Result<Option<IntegrationSnapshotRow>, sqlx::Error> {
    sqlx::query_as::<_, IntegrationSnapshotRow>(
        "SELECT id, tenant_id, provider, entity_type, payload_json, record_count, fetched_at::text AS fetched_at
         FROM integration_snapshots
         WHERE tenant_id = $1 AND provider = $2 AND entity_type = $3
         ORDER BY fetched_at DESC, id DESC
         LIMIT 1",
    )
    .bind(tenant_id)
    .bind(provider)
    .bind(entity_type)
    .fetch_optional(pool)
    .await
}

pub async fn touch_integration_last_sync(
    pool: &PgPool,
    tenant_id: i64,
    provider: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "UPDATE integrations SET last_sync_at = NOW(), updated_at = NOW()
         WHERE tenant_id = $1 AND provider = $2",
    )
    .bind(tenant_id)
    .bind(provider)
    .execute(pool)
    .await?;
    Ok(())
}

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct OAuthPendingRow {
    pub state: String,
    pub tenant_id: i64,
    pub provider: String,
    pub actor: String,
    pub role: String,
    pub pkce_verifier: Option<String>,
    pub expires_at: String,
}

pub async fn insert_oauth_pending(
    pool: &PgPool,
    state: &str,
    tenant_id: i64,
    provider: &str,
    actor: &str,
    role: &str,
    pkce_verifier: Option<&str>,
    ttl_secs: i64,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO oauth_pending_states (state, tenant_id, provider, actor, role, pkce_verifier, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW() + ($7::bigint * INTERVAL '1 second'))",
    )
    .bind(state)
    .bind(tenant_id)
    .bind(provider)
    .bind(actor)
    .bind(role)
    .bind(pkce_verifier)
    .bind(ttl_secs)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn take_oauth_pending(
    pool: &PgPool,
    state: &str,
    provider: &str,
) -> Result<Option<OAuthPendingRow>, sqlx::Error> {
    let row = sqlx::query_as::<_, OAuthPendingRow>(
        "SELECT state, tenant_id, provider, actor, role, pkce_verifier, expires_at::text AS expires_at
         FROM oauth_pending_states
         WHERE state = $1 AND provider = $2
           AND expires_at > NOW()
         LIMIT 1",
    )
    .bind(state)
    .bind(provider)
    .fetch_optional(pool)
    .await?;
    if row.is_some() {
        delete_oauth_pending(pool, state, provider).await?;
    }
    Ok(row)
}

pub async fn delete_oauth_pending(
    pool: &PgPool,
    state: &str,
    provider: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query("DELETE FROM oauth_pending_states WHERE state = $1 AND provider = $2")
        .bind(state)
        .bind(provider)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn purge_expired_oauth_pending(pool: &PgPool) -> Result<(), sqlx::Error> {
    sqlx::query("DELETE FROM oauth_pending_states WHERE expires_at <= NOW()")
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn fetch_client_key_meta_by_id(
    pool: &PgPool,
    id: i64,
    tenant_id: i64,
) -> Result<Option<ClientKeyMeta>, sqlx::Error> {
    sqlx::query_as::<_, ClientKeyMeta>(
        "SELECT k.id, k.name, k.api_key,
                CASE WHEN k.secret_encrypted IS NOT NULL AND k.secret_encrypted != '' THEN 'hmac'
                     ELSE 'legacy' END AS auth_mode,
                COALESCE(k.integration_type, 'app') AS integration_type,
                k.tenant_id,
                COALESCE(k.status, 'active') AS status,
                COALESCE(k.rate_limit_per_min, 0) AS rate_limit_per_min,
                COALESCE(
                    (SELECT array_agg(r.route_id ORDER BY r.route_id)
                     FROM gateway_client_key_routes r WHERE r.client_key_id = k.id),
                    ARRAY[]::BIGINT[]
                ) AS allowed_route_ids,
                k.last_used_at::text AS last_used_at
         FROM gateway_client_keys k WHERE k.id = $1 AND k.tenant_id = $2 LIMIT 1",
    )
    .bind(id)
    .bind(tenant_id)
    .fetch_optional(pool)
    .await
}

pub async fn touch_client_key_last_used(pool: &PgPool, key_id: i64) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE gateway_client_keys SET last_used_at = NOW() WHERE id = $1")
        .bind(key_id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn count_client_keys_by_status(
    pool: &PgPool,
    tenant_id: i64,
) -> Result<(i64, i64), sqlx::Error> {
    let active: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM gateway_client_keys WHERE tenant_id = $1 AND COALESCE(status, 'active') = 'active'",
    )
    .bind(tenant_id)
    .fetch_one(pool)
    .await?;
    let disabled: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM gateway_client_keys WHERE tenant_id = $1 AND status = 'disabled'",
    )
    .bind(tenant_id)
    .fetch_one(pool)
    .await?;
    Ok((active, disabled))
}

pub async fn route_acl_summary(
    pool: &PgPool,
    tenant_id: i64,
) -> Result<Vec<RouteAclSummaryRow>, sqlx::Error> {
    let rows: Vec<(i64, i64, Option<Vec<String>>)> = sqlx::query_as(
        "SELECT r.route_id, COUNT(*)::bigint,
                array_agg(k.name ORDER BY k.name) AS names
         FROM gateway_client_key_routes r
         INNER JOIN gateway_client_keys k ON k.id = r.client_key_id
         WHERE k.tenant_id = $1
         GROUP BY r.route_id
         ORDER BY r.route_id",
    )
    .bind(tenant_id)
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|(route_id, client_count, names)| RouteAclSummaryRow {
            route_id,
            client_count,
            client_names: names.unwrap_or_default(),
        })
        .collect())
}

pub async fn list_clients_for_route(
    pool: &PgPool,
    route_id: i64,
    tenant_id: i64,
) -> Result<Vec<RouteAclClientRow>, sqlx::Error> {
    sqlx::query_as::<_, (i64, String, String)>(
        "SELECT k.id, k.name, COALESCE(k.status, 'active')
         FROM gateway_client_key_routes r
         INNER JOIN gateway_client_keys k ON k.id = r.client_key_id
         WHERE r.route_id = $1 AND k.tenant_id = $2
         ORDER BY k.name",
    )
    .bind(route_id)
    .bind(tenant_id)
    .fetch_all(pool)
    .await
    .map(|rows| {
        rows.into_iter()
            .map(|(id, name, status)| RouteAclClientRow { id, name, status })
            .collect()
    })
}

pub async fn traffic_denial_reasons_24h(
    pool: &PgPool,
    tenant_id: i64,
    limit: i64,
) -> Result<Vec<(String, i64)>, sqlx::Error> {
    sqlx::query_as(&format!(
        "SELECT COALESCE(NULLIF(reason, ''), 'unknown') AS reason, COUNT(*) AS cnt
         FROM gateway_transaction_logs
         WHERE {} AND outcome = 'denied'
         GROUP BY reason
         ORDER BY cnt DESC
         LIMIT $2",
        tx_log_tenant_filter()
    ))
    .bind(tenant_id)
    .bind(limit)
    .fetch_all(pool)
    .await
}

pub async fn count_client_keys_for_tenant(pool: &PgPool, tenant_id: i64) -> Result<i64, sqlx::Error> {
    sqlx::query_scalar("SELECT COUNT(*) FROM gateway_client_keys WHERE tenant_id = $1")
        .bind(tenant_id)
        .fetch_one(pool)
        .await
}

pub async fn audit_counts_24h(pool: &PgPool, tenant_id: i64) -> Result<(i64, i64, i64), sqlx::Error> {
    let total: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM audit_logs WHERE tenant_id = $1 AND created_at >= NOW() - INTERVAL '1 day'",
    )
    .bind(tenant_id)
    .fetch_one(pool)
    .await?;
    let success: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM audit_logs WHERE tenant_id = $1 AND created_at >= NOW() - INTERVAL '1 day' AND result = 'success'",
    )
    .bind(tenant_id)
    .fetch_one(pool)
    .await?;
    let failure: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM audit_logs WHERE tenant_id = $1 AND created_at >= NOW() - INTERVAL '1 day' AND result = 'failure'",
    )
    .bind(tenant_id)
    .fetch_one(pool)
    .await?;
    Ok((total, success, failure))
}

pub async fn list_integration_snapshots_recent(
    pool: &PgPool,
    tenant_id: i64,
    limit: i64,
) -> Result<Vec<IntegrationSnapshotRow>, sqlx::Error> {
    sqlx::query_as::<_, IntegrationSnapshotRow>(
        "SELECT id, tenant_id, provider, entity_type, payload_json, record_count, fetched_at::text AS fetched_at
         FROM integration_snapshots
         WHERE tenant_id = $1
         ORDER BY fetched_at DESC, id DESC
         LIMIT $2",
    )
    .bind(tenant_id)
    .bind(limit)
    .fetch_all(pool)
    .await
}

pub async fn delete_client_key(
    pool: &PgPool,
    id: i64,
    tenant_id: i64,
) -> Result<u64, sqlx::Error> {
    let r = sqlx::query("DELETE FROM gateway_client_keys WHERE id = $1 AND tenant_id = $2")
        .bind(id)
        .bind(tenant_id)
        .execute(pool)
        .await?;
    Ok(r.rows_affected())
}

pub async fn audit_top_actions_24h(
    pool: &PgPool,
    tenant_id: i64,
    limit: i64,
) -> Result<Vec<(String, i64)>, sqlx::Error> {
    sqlx::query_as::<_, (String, i64)>(
        "SELECT action, COUNT(*) AS cnt
         FROM audit_logs
         WHERE tenant_id = $1 AND created_at >= NOW() - INTERVAL '1 day'
         GROUP BY action
         ORDER BY cnt DESC
         LIMIT $2",
    )
    .bind(tenant_id)
    .bind(limit)
    .fetch_all(pool)
    .await
}

pub async fn audit_hourly_24h(pool: &PgPool, tenant_id: i64) -> Result<Vec<(String, i64)>, sqlx::Error> {
    sqlx::query_as::<_, (String, i64)>(
        "SELECT to_char(created_at AT TIME ZONE 'UTC', 'HH24:00') AS hour, COUNT(*) AS cnt
         FROM audit_logs
         WHERE tenant_id = $1 AND created_at >= NOW() - INTERVAL '1 day'
         GROUP BY hour
         ORDER BY hour",
    )
    .bind(tenant_id)
    .fetch_all(pool)
    .await
}

fn tx_log_tenant_filter() -> &'static str {
    "tenant_id = $1 AND created_at >= NOW() - INTERVAL '1 day'"
}

pub async fn traffic_outcome_counts_24h(
    pool: &PgPool,
    tenant_id: i64,
) -> Result<(i64, i64, i64, i64, i64, f64), sqlx::Error> {
    let row: (i64, i64, i64, i64, i64, Option<f64>) = sqlx::query_as(&format!(
        "SELECT
            COUNT(*) AS total,
            COALESCE(SUM(CASE WHEN outcome = 'success' THEN 1 ELSE 0 END), 0),
            COALESCE(SUM(CASE WHEN outcome = 'denied' THEN 1 ELSE 0 END), 0),
            COALESCE(SUM(CASE WHEN outcome = 'upstream_error' THEN 1 ELSE 0 END), 0),
            COALESCE(SUM(CASE WHEN outcome = 'queued' THEN 1 ELSE 0 END), 0),
            AVG(duration_ms::double precision)
         FROM gateway_transaction_logs
         WHERE {}",
        tx_log_tenant_filter()
    ))
    .bind(tenant_id)
    .fetch_one(pool)
    .await?;
    Ok((row.0, row.1, row.2, row.3, row.4, row.5.unwrap_or(0.0)))
}

pub async fn traffic_status_buckets_24h(
    pool: &PgPool,
    tenant_id: i64,
) -> Result<Vec<(String, i64)>, sqlx::Error> {
    sqlx::query_as(&format!(
        "SELECT bucket, COUNT(*) AS cnt FROM (
            SELECT CASE
                WHEN status >= 200 AND status < 300 THEN '2xx'
                WHEN status >= 300 AND status < 400 THEN '3xx'
                WHEN status >= 400 AND status < 500 THEN '4xx'
                WHEN status >= 500 THEN '5xx'
                ELSE 'other'
            END AS bucket
            FROM gateway_transaction_logs
            WHERE {}
        ) GROUP BY bucket ORDER BY bucket",
        tx_log_tenant_filter()
    ))
    .bind(tenant_id)
    .fetch_all(pool)
    .await
}

pub async fn traffic_hourly_24h(pool: &PgPool, tenant_id: i64) -> Result<Vec<(String, i64)>, sqlx::Error> {
    sqlx::query_as(&format!(
        "SELECT to_char(created_at AT TIME ZONE 'UTC', 'HH24:00') AS hour, COUNT(*) AS cnt
         FROM gateway_transaction_logs
         WHERE {}
         GROUP BY hour
         ORDER BY hour",
        tx_log_tenant_filter()
    ))
    .bind(tenant_id)
    .fetch_all(pool)
    .await
}

pub async fn traffic_top_paths_24h(
    pool: &PgPool,
    tenant_id: i64,
    limit: i64,
) -> Result<Vec<(String, i64)>, sqlx::Error> {
    sqlx::query_as(&format!(
        "SELECT path, COUNT(*) AS cnt
         FROM gateway_transaction_logs
         WHERE {}
         GROUP BY path
         ORDER BY cnt DESC
         LIMIT $2",
        tx_log_tenant_filter()
    ))
    .bind(tenant_id)
    .bind(limit)
    .fetch_all(pool)
    .await
}

pub async fn traffic_method_counts_24h(
    pool: &PgPool,
    tenant_id: i64,
) -> Result<Vec<(String, i64)>, sqlx::Error> {
    sqlx::query_as(&format!(
        "SELECT method, COUNT(*) AS cnt
         FROM gateway_transaction_logs
         WHERE {}
         GROUP BY method
         ORDER BY cnt DESC",
        tx_log_tenant_filter()
    ))
    .bind(tenant_id)
    .fetch_all(pool)
    .await
}

pub async fn ping(pool: &PgPool) -> bool {
    sqlx::query("SELECT 1").execute(pool).await.is_ok()
}

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct IntegrationBridgeRow {
    pub enabled: i32,
    pub direction: String,
    pub mappings_json: String,
}

pub async fn fetch_integration_bridge(
    pool: &PgPool,
    tenant_id: i64,
) -> Result<Option<IntegrationBridgeRow>, sqlx::Error> {
    sqlx::query_as::<_, IntegrationBridgeRow>(
        "SELECT enabled, direction, mappings_json FROM integration_bridge_config WHERE tenant_id = $1",
    )
    .bind(tenant_id)
    .fetch_optional(pool)
    .await
}

pub async fn upsert_integration_bridge(
    pool: &PgPool,
    tenant_id: i64,
    enabled: bool,
    direction: &str,
    mappings_json: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO integration_bridge_config (tenant_id, enabled, direction, mappings_json, updated_at)
         VALUES ($1, $2, $3, $4, NOW())
         ON CONFLICT(tenant_id) DO UPDATE SET
           enabled = excluded.enabled,
           direction = excluded.direction,
           mappings_json = excluded.mappings_json,
           updated_at = NOW()",
    )
    .bind(tenant_id)
    .bind(if enabled { 1i64 } else { 0 })
    .bind(direction)
    .bind(mappings_json)
    .execute(pool)
    .await?;
    Ok(())
}

#[derive(Debug, Clone, sqlx::FromRow, serde::Serialize)]
pub struct SyncLogRow {
    pub id: i64,
    pub tenant_id: i64,
    pub status: String,
    pub message: String,
    pub error_detail: Option<String>,
    pub created_at: String,
}

pub async fn insert_sync_log(
    pool: &PgPool,
    tenant_id: i64,
    status: &str,
    message: &str,
    error_detail: Option<&str>,
) -> Result<i64, sqlx::Error> {
    let row: (i64,) = sqlx::query_as(
        "INSERT INTO sync_logs (tenant_id, status, message, error_detail)
         VALUES ($1, $2, $3, $4)
         RETURNING id",
    )
    .bind(tenant_id)
    .bind(status)
    .bind(message)
    .bind(error_detail)
    .fetch_one(pool)
    .await?;
    Ok(row.0)
}

pub async fn list_sync_logs(
    pool: &PgPool,
    tenant_id: i64,
    limit: i64,
) -> Result<Vec<SyncLogRow>, sqlx::Error> {
    sqlx::query_as::<_, SyncLogRow>(
        "SELECT id, tenant_id, status, message, error_detail, created_at::text AS created_at
         FROM sync_logs
         WHERE tenant_id = $1
         ORDER BY id DESC
         LIMIT $2",
    )
    .bind(tenant_id)
    .bind(limit)
    .fetch_all(pool)
    .await
}

pub async fn prune_sync_logs(pool: &PgPool, tenant_id: i64, retain: i64) -> Result<(), sqlx::Error> {
    sqlx::query(
        "DELETE FROM sync_logs
         WHERE tenant_id = $1
           AND id NOT IN (
             SELECT id FROM sync_logs
             WHERE tenant_id = $1
             ORDER BY id DESC
             LIMIT $2
           )",
    )
    .bind(tenant_id)
    .bind(retain)
    .execute(pool)
    .await?;
    Ok(())
}

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct EntityLinkRow {
    pub sf_entity_type: String,
    pub sf_id: String,
    pub zoho_id: String,
    pub zoho_name: Option<String>,
}

pub async fn fetch_entity_link(
    pool: &PgPool,
    tenant_id: i64,
    sf_entity_type: &str,
    sf_id: &str,
) -> Result<Option<EntityLinkRow>, sqlx::Error> {
    sqlx::query_as::<_, EntityLinkRow>(
        "SELECT sf_entity_type, sf_id, zoho_id, zoho_name
         FROM integration_entity_links
         WHERE tenant_id = $1 AND sf_entity_type = $2 AND sf_id = $3",
    )
    .bind(tenant_id)
    .bind(sf_entity_type)
    .bind(sf_id)
    .fetch_optional(pool)
    .await
}

pub async fn upsert_entity_link(
    pool: &PgPool,
    tenant_id: i64,
    sf_entity_type: &str,
    sf_id: &str,
    zoho_id: &str,
    zoho_name: Option<&str>,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO integration_entity_links
           (tenant_id, sf_entity_type, sf_id, zoho_entity_type, zoho_id, zoho_name, last_synced_at)
         VALUES ($1, $2, $3, 'project', $4, $5, NOW())
         ON CONFLICT (tenant_id, sf_entity_type, sf_id) DO UPDATE SET
           zoho_id = excluded.zoho_id,
           zoho_name = excluded.zoho_name,
           last_synced_at = NOW()",
    )
    .bind(tenant_id)
    .bind(sf_entity_type)
    .bind(sf_id)
    .bind(zoho_id)
    .bind(zoho_name)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn list_tenant_ids(pool: &PgPool) -> Result<Vec<i64>, sqlx::Error> {
    sqlx::query_scalar("SELECT id FROM tenants ORDER BY id")
        .fetch_all(pool)
        .await
}

#[derive(Debug, Clone, sqlx::FromRow, serde::Serialize)]
pub struct EntityLinkPublic {
    pub sf_entity_type: String,
    pub sf_id: String,
    pub zoho_id: String,
    pub zoho_name: Option<String>,
    pub last_synced_at: String,
    pub document_id: Option<i64>,
    pub document_filename: Option<String>,
}

pub async fn list_entity_links_public(
    pool: &PgPool,
    tenant_id: i64,
) -> Result<Vec<EntityLinkPublic>, sqlx::Error> {
    sqlx::query_as::<_, EntityLinkPublic>(
        "SELECT el.sf_entity_type, el.sf_id, el.zoho_id, el.zoho_name,
                el.last_synced_at::text AS last_synced_at,
                d.id AS document_id, d.filename AS document_filename
         FROM integration_entity_links el
         LEFT JOIN integration_documents d
           ON d.tenant_id = el.tenant_id
          AND d.sf_entity_type = el.sf_entity_type
          AND d.sf_id = el.sf_id
         WHERE el.tenant_id = $1
         ORDER BY el.last_synced_at DESC",
    )
    .bind(tenant_id)
    .fetch_all(pool)
    .await
}

#[derive(Debug, Clone, sqlx::FromRow, serde::Serialize)]
pub struct IntegrationDocumentRow {
    pub id: i64,
    pub sf_entity_type: String,
    pub sf_id: String,
    pub zoho_project_id: Option<String>,
    pub filename: String,
    pub content_type: String,
    pub file_size: i64,
    pub source_provider: String,
    pub created_at: String,
}

pub async fn list_integration_documents(
    pool: &PgPool,
    tenant_id: i64,
    limit: i64,
) -> Result<Vec<IntegrationDocumentRow>, sqlx::Error> {
    sqlx::query_as::<_, IntegrationDocumentRow>(
        "SELECT id, sf_entity_type, sf_id, zoho_project_id, filename, content_type,
                file_size, source_provider, created_at::text AS created_at
         FROM integration_documents
         WHERE tenant_id = $1
         ORDER BY id DESC
         LIMIT $2",
    )
    .bind(tenant_id)
    .bind(limit)
    .fetch_all(pool)
    .await
}

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct IntegrationDocumentFile {
    pub id: i64,
    pub filename: String,
    pub content_type: String,
    pub storage_path: String,
}

pub async fn fetch_integration_document_file(
    pool: &PgPool,
    tenant_id: i64,
    document_id: i64,
) -> Result<Option<IntegrationDocumentFile>, sqlx::Error> {
    sqlx::query_as::<_, IntegrationDocumentFile>(
        "SELECT id, filename, content_type, storage_path
         FROM integration_documents
         WHERE tenant_id = $1 AND id = $2",
    )
    .bind(tenant_id)
    .bind(document_id)
    .fetch_optional(pool)
    .await
}

pub async fn fetch_integration_document_by_sf(
    pool: &PgPool,
    tenant_id: i64,
    sf_entity_type: &str,
    sf_id: &str,
) -> Result<Option<IntegrationDocumentRow>, sqlx::Error> {
    sqlx::query_as::<_, IntegrationDocumentRow>(
        "SELECT id, sf_entity_type, sf_id, zoho_project_id, filename, content_type,
                file_size, source_provider, created_at::text AS created_at
         FROM integration_documents
         WHERE tenant_id = $1 AND sf_entity_type = $2 AND sf_id = $3
         LIMIT 1",
    )
    .bind(tenant_id)
    .bind(sf_entity_type)
    .bind(sf_id)
    .fetch_optional(pool)
    .await
}

pub async fn upsert_integration_document(
    pool: &PgPool,
    tenant_id: i64,
    sf_entity_type: &str,
    sf_id: &str,
    zoho_project_id: Option<&str>,
    filename: &str,
    content_type: &str,
    storage_path: &str,
    file_size: i64,
    source_provider: &str,
) -> Result<i64, sqlx::Error> {
    let id: i64 = sqlx::query_scalar(
        "INSERT INTO integration_documents
           (tenant_id, sf_entity_type, sf_id, zoho_project_id, filename, content_type,
            storage_path, file_size, source_provider)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (tenant_id, sf_entity_type, sf_id, source_provider) DO UPDATE SET
           zoho_project_id = excluded.zoho_project_id,
           filename = excluded.filename,
           content_type = excluded.content_type,
           storage_path = excluded.storage_path,
           file_size = excluded.file_size,
           created_at = NOW()
         RETURNING id",
    )
    .bind(tenant_id)
    .bind(sf_entity_type)
    .bind(sf_id)
    .bind(zoho_project_id)
    .bind(filename)
    .bind(content_type)
    .bind(storage_path)
    .bind(file_size)
    .bind(source_provider)
    .fetch_one(pool)
    .await?;
    Ok(id)
}

pub async fn delete_integration_documents(
    pool: &PgPool,
    tenant_id: i64,
) -> Result<Vec<String>, sqlx::Error> {
    let paths: Vec<String> = sqlx::query_scalar(
        "SELECT storage_path FROM integration_documents WHERE tenant_id = $1",
    )
    .bind(tenant_id)
    .fetch_all(pool)
    .await?;
    sqlx::query("DELETE FROM integration_documents WHERE tenant_id = $1")
        .bind(tenant_id)
        .execute(pool)
        .await?;
    Ok(paths)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sha256_hex_known() {
        assert_eq!(
            sha256_hex("hello"),
            "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"
        );
    }

    #[test]
    fn password_hash_and_verify() {
        let hash = hash_password("Str0ng!Pass").expect("hash");
        assert!(hash.starts_with("$argon2"));
        assert!(verify_password("Str0ng!Pass", &hash));
        assert!(!verify_password("wrong", &hash));
    }
}
