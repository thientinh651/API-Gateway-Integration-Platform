//! PostgreSQL persistence for routes, data-plane API key hashes, and admin API key hash.
#![allow(dead_code)]

use argon2::{
    Argon2,
    password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString, rand_core::OsRng},
};
use sha2::{Digest, Sha256};
use sqlx::PgPool;
use sqlx::postgres::PgPoolOptions;

use crate::{RouteRow, YamlBootstrap, crypto};

pub const ROUTE_SELECT: &str = "id, path, target, timeout_secs, rate_limit_per_min, tenant_id, transform_add_headers, transform_remove_headers, retry_max, retry_on_status, retry_on_timeout, queue_on_failure, allowed_methods";

/// Runtime credentials for data-plane OAuth2 client_credentials.
#[derive(Debug, Clone, Default)]
pub struct ClientCredentials {
    pub oauth_clients: Vec<OAuthClientKey>,
    /// Disabled clients — 403 rõ ràng + giữ id cho transaction log.
    pub disabled_clients: Vec<DisabledClientKey>,
    /// user_id → token_version (JWT user grant / authorization_code).
    pub user_token_versions: std::collections::HashMap<i64, i32>,
}

#[derive(Debug, Clone)]
pub struct DisabledClientKey {
    pub id: i64,
    pub client_id: String,
    pub tenant_id: i64,
}

#[derive(Debug, Clone)]
pub struct OAuthClientKey {
    pub id: i64,
    pub client_id: String,
    /// Argon2id PHC string — verify at token endpoint; never store plaintext.
    pub secret_hash: String,
    pub tenant_id: i64,
    pub rate_limit_per_min: i32,
    pub allowed_route_ids: Vec<i64>,
    pub token_version: i32,
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

/// Argon2id one-way hash for OAuth2 `client_secret` (at rest only).
pub fn hash_client_secret(secret: &str) -> Result<String, argon2::password_hash::Error> {
    hash_password(secret)
}

/// Tìm client và so khớp secret_hash
pub fn verify_client_secret(secret: &str, secret_hash: &str) -> bool {
    verify_password(secret, secret_hash)
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
    #[sqlx(default)]
    pub token_version: i32,
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
        "SELECT id, username, password_hash, role, tenant_id, is_active, email, COALESCE(token_version, 0) AS token_version FROM dashboard_users WHERE username = $1 LIMIT 1",
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
    let admin_email = std::env::var("ADMIN_EMAIL").ok().and_then(|e| {
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
        // Pool cạn → trả lỗi sạch sau 10s thay vì treo 30s (mặc định) tới nginx → 502.
        .acquire_timeout(std::time::Duration::from_secs(10))
        // Thu hồi connection nhàn rỗi / cũ, tránh dùng phải conn chết sau khi Postgres restart.
        .idle_timeout(std::time::Duration::from_secs(300))
        .max_lifetime(std::time::Duration::from_secs(1800))
        .test_before_acquire(true)
        .connect(url)
        .await
}

pub async fn migrate(pool: &PgPool) -> Result<(), sqlx::migrate::MigrateError> {
    sqlx::migrate!("./migrations").run(pool).await
}

/// If DB has no routes / no client keys, seed from `config.yaml` (empty DB only).
/// Production DB đã có data → hàm no-op, không ghi đè.
pub async fn bootstrap_from_yaml_if_empty(
    pool: &PgPool,
    yaml: &YamlBootstrap,
) -> Result<(), sqlx::Error> {
    let default_tenant_id: i64 = sqlx::query_scalar(
        "SELECT id FROM tenants WHERE name = 'default' ORDER BY id LIMIT 1",
    )
    .fetch_optional(pool)
    .await?
    .unwrap_or(1);

    let admin_owner_id: Option<i64> = sqlx::query_scalar(
        "SELECT id FROM dashboard_users WHERE role = 'admin' AND is_active = 1 ORDER BY id LIMIT 1",
    )
    .fetch_optional(pool)
    .await?;

    let n_routes: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM gateway_routes")
        .fetch_one(pool)
        .await?;

    if n_routes == 0 {
        // Unique index: (tenant_id, path) — migration tenant_isolation
        for r in yaml.routes.iter() {
            sqlx::query(
                "INSERT INTO gateway_routes (path, target, timeout_secs, rate_limit_per_min, tenant_id)
                 VALUES ($1, $2, 30, 100, $3)
                 ON CONFLICT (tenant_id, path) DO UPDATE SET target = EXCLUDED.target",
            )
            .bind(&r.path)
            .bind(&r.target)
            .bind(default_tenant_id)
            .execute(pool)
            .await?;
        }
        tracing::info!(
            count = yaml.routes.len(),
            tenant_id = default_tenant_id,
            "bootstrapped gateway_routes from config.yaml"
        );
    }

    let n_keys: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM gateway_client_keys")
        .fetch_one(pool)
        .await?;

    if n_keys == 0 {
        for plain in &yaml.api_keys {
            let name = if plain.trim().is_empty() {
                "bootstrap".into()
            } else {
                plain.trim().to_string()
            };
            let client_id = random_api_key_id();
            let secret = random_secret_key();
            let _ = insert_oauth_client(
                pool,
                &name,
                &client_id,
                &secret,
                default_tenant_id,
                "app",
                admin_owner_id,
                0,
            )
            .await?;
            tracing::info!(
                client_id = %client_id,
                name = %name,
                owner_user_id = ?admin_owner_id,
                "Bootstrap OAuth client from config.yaml — save client_secret from dashboard"
            );
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
    let done: Option<String> =
        sqlx::query_scalar("SELECT v FROM gateway_settings WHERE k = 'on_prem_org_v1'")
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
    let done: Option<String> =
        sqlx::query_scalar("SELECT v FROM gateway_settings WHERE k = 'workspace_isolation_v1'")
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
        sqlx::query("UPDATE gateway_client_keys SET tenant_id = $1 WHERE owner_user_id = $2")
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

pub async fn count_active_admins_in_tenant(
    pool: &PgPool,
    tenant_id: i64,
) -> Result<i64, sqlx::Error> {
    sqlx::query_scalar(
        "SELECT COUNT(*) FROM dashboard_users
         WHERE COALESCE(tenant_id, 1) = $1
           AND is_active <> 0
           AND LOWER(TRIM(role)) = 'admin'",
    )
    .bind(tenant_id)
    .fetch_one(pool)
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
        "SELECT id, username, password_hash, role, tenant_id, is_active, email, COALESCE(token_version, 0) AS token_version FROM dashboard_users
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
    let n: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM dashboard_users WHERE username = $1 AND id <> $2")
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
        (Some(h), Some(em)) => sqlx::query(
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
        .rows_affected(),
        (Some(h), None) => sqlx::query(
            "UPDATE dashboard_users SET username = $1, password_hash = $2
                 WHERE id = $3 AND COALESCE(tenant_id, 1) = $4 AND is_active = 1",
        )
        .bind(username)
        .bind(h)
        .bind(id)
        .bind(tenant_id)
        .execute(pool)
        .await?
        .rows_affected(),
        (None, Some(em)) => sqlx::query(
            "UPDATE dashboard_users SET username = $1, email = $2
                 WHERE id = $3 AND COALESCE(tenant_id, 1) = $4 AND is_active = 1",
        )
        .bind(username)
        .bind(em)
        .bind(id)
        .bind(tenant_id)
        .execute(pool)
        .await?
        .rows_affected(),
        (None, None) => sqlx::query(
            "UPDATE dashboard_users SET username = $1
                 WHERE id = $2 AND COALESCE(tenant_id, 1) = $3 AND is_active = 1",
        )
        .bind(username)
        .bind(id)
        .bind(tenant_id)
        .execute(pool)
        .await?
        .rows_affected(),
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
        "SELECT id, username, password_hash, role, tenant_id, is_active, email, COALESCE(token_version, 0) AS token_version
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

pub async fn delete_admin_user(pool: &PgPool, id: i64, tenant_id: i64) -> Result<u64, sqlx::Error> {
    let r =
        sqlx::query("DELETE FROM dashboard_users WHERE id = $1 AND COALESCE(tenant_id, 1) = $2")
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
    /// Tên đăng ký trong Client Registry (JOIN); ưu tiên hiển thị UI thay vì api_key_masked.
    pub client_name: Option<String>,
    pub outcome: String,
    pub reason: String,
    pub upstream: Option<String>,
    pub route_id: Option<i64>,
    pub created_at: String,
}

/// Full request/response capture for a single proxied transaction.
/// Bodies are already truncated + sensitive headers redacted by the caller.
#[derive(Debug, Clone, Default)]
pub struct TransactionDetail {
    pub route_id: Option<i64>,
    pub upstream_url: Option<String>,
    pub req_headers: Option<String>,
    pub req_body: Option<String>,
    pub req_bytes: Option<i64>,
    pub req_truncated: bool,
    pub resp_headers: Option<String>,
    pub resp_body: Option<String>,
    pub resp_bytes: Option<i64>,
    pub resp_truncated: bool,
}

#[derive(Debug, Clone, serde::Serialize, sqlx::FromRow)]
pub struct TransactionDetailRow {
    pub id: i64,
    pub request_id: String,
    pub method: String,
    pub path: String,
    pub status: i32,
    pub duration_ms: i64,
    pub client_ip: Option<String>,
    pub api_key_masked: Option<String>,
    pub client_key_id: Option<i64>,
    pub client_name: Option<String>,
    pub outcome: String,
    pub reason: String,
    pub upstream: Option<String>,
    pub upstream_url: Option<String>,
    pub route_id: Option<i64>,
    pub req_headers: Option<String>,
    pub req_body: Option<String>,
    pub req_bytes: Option<i64>,
    pub req_truncated: Option<bool>,
    pub resp_headers: Option<String>,
    pub resp_body: Option<String>,
    pub resp_bytes: Option<i64>,
    pub resp_truncated: Option<bool>,
    pub created_at: String,
}

#[allow(clippy::too_many_arguments)]
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
    detail: Option<&TransactionDetail>,
) -> Result<(), sqlx::Error> {
    let d = detail.cloned().unwrap_or_default();
    sqlx::query(
        "INSERT INTO gateway_transaction_logs
         (tenant_id, request_id, method, path, status, duration_ms, client_ip, api_key_masked, client_key_id, outcome, reason, upstream,
          route_id, upstream_url, req_headers, req_body, req_bytes, req_truncated, resp_headers, resp_body, resp_bytes, resp_truncated)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22)",
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
    .bind(d.route_id)
    .bind(d.upstream_url)
    .bind(d.req_headers)
    .bind(d.req_body)
    .bind(d.req_bytes)
    .bind(d.req_truncated)
    .bind(d.resp_headers)
    .bind(d.resp_body)
    .bind(d.resp_bytes)
    .bind(d.resp_truncated)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn get_transaction_detail(
    pool: &PgPool,
    tenant_id: i64,
    id: i64,
    include_unattributed: bool,
) -> Result<Option<TransactionDetailRow>, sqlx::Error> {
    sqlx::query_as::<_, TransactionDetailRow>(
        "SELECT t.id, t.request_id, t.method, t.path, t.status, t.duration_ms, t.client_ip, t.api_key_masked,
                t.client_key_id, k.name AS client_name, t.outcome, t.reason, t.upstream, t.upstream_url, t.route_id,
                t.req_headers, t.req_body, t.req_bytes, t.req_truncated,
                t.resp_headers, t.resp_body, t.resp_bytes, t.resp_truncated,
                t.created_at::text AS created_at
         FROM gateway_transaction_logs t
         LEFT JOIN gateway_client_keys k ON k.id = t.client_key_id
         WHERE t.id = $1 AND (t.tenant_id = $2 OR ($3 AND t.tenant_id IS NULL))",
    )
    .bind(id)
    .bind(tenant_id)
    .bind(include_unattributed)
    .fetch_optional(pool)
    .await
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
    date_from: Option<&str>,
    date_to: Option<&str>,
    before_id: Option<i64>,
    include_unattributed: bool,
) -> Result<Vec<TransactionLogRow>, sqlx::Error> {
    let lim = limit.clamp(1, 500);
    let mut n: i32 = 2;
    // Denied/edge rejections (sai key, token hết hạn, replay, rate-limit) được ghi với
    // tenant_id = NULL vì chưa xác định được tenant. Admin cần thấy các lượt gọi này để
    // tracking bên ngoài gọi vào gateway → include khi include_unattributed = true.
    let tenant_clause = if include_unattributed {
        "WHERE (t.tenant_id = $1 OR t.tenant_id IS NULL)"
    } else {
        "WHERE t.tenant_id = $1"
    };
    let mut sql = format!(
        "SELECT t.id, t.tenant_id, t.request_id, t.method, t.path, t.status, t.duration_ms, t.client_ip,
                t.api_key_masked, t.client_key_id, k.name AS client_name, t.outcome, t.reason, t.upstream,
                t.route_id, t.created_at::text AS created_at
         FROM gateway_transaction_logs t
         LEFT JOIN gateway_client_keys k ON k.id = t.client_key_id
         {tenant_clause}"
    );
    if method.filter(|m| !m.is_empty() && *m != "all").is_some() {
        sql.push_str(&format!(" AND t.method = ${n}"));
        n += 1;
    }
    if status_min.is_some() {
        sql.push_str(&format!(" AND t.status >= ${n}"));
        n += 1;
    }
    if status_max.is_some() {
        sql.push_str(&format!(" AND t.status < ${n}"));
        n += 1;
    }
    if let Some(o) = outcome.filter(|o| !o.is_empty() && *o != "all") {
        if o == "success" {
            sql.push_str(" AND t.outcome = 'success'");
        } else if o == "failure" {
            sql.push_str(" AND t.outcome != 'success'");
        }
    }
    if search.filter(|s| !s.trim().is_empty()).is_some() {
        sql.push_str(&format!(
            " AND (t.path LIKE ${n} OR t.request_id LIKE ${n2} OR COALESCE(t.client_ip,'') LIKE ${n3} OR COALESCE(t.api_key_masked,'') LIKE ${n4} OR COALESCE(k.name,'') LIKE ${n5})",
            n2 = n + 1,
            n3 = n + 2,
            n4 = n + 3,
            n5 = n + 4
        ));
        n += 5;
    }
    if reason.filter(|r| !r.is_empty() && *r != "all").is_some() {
        sql.push_str(&format!(" AND t.reason = ${n}"));
        n += 1;
    }
    if client_key_id.is_some() {
        sql.push_str(&format!(" AND t.client_key_id = ${n}"));
        n += 1;
    }
    if date_from.filter(|d| !d.trim().is_empty()).is_some() {
        sql.push_str(&format!(" AND t.created_at::date >= ${n}::date"));
        n += 1;
    }
    if date_to.filter(|d| !d.trim().is_empty()).is_some() {
        sql.push_str(&format!(" AND t.created_at::date <= ${n}::date"));
        n += 1;
    }
    // Keyset pagination: chỉ lấy bản ghi cũ hơn con trỏ (id giảm dần). Ổn định khi có log
    // mới chèn vào giữa các lần "Tải thêm" — không lệch/trùng như OFFSET.
    if before_id.filter(|id| *id > 0).is_some() {
        sql.push_str(&format!(" AND t.id < ${n}"));
        n += 1;
    }
    sql.push_str(&format!(" ORDER BY t.id DESC LIMIT ${n}"));

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
        q = q
            .bind(pat.clone())
            .bind(pat.clone())
            .bind(pat.clone())
            .bind(pat.clone())
            .bind(pat);
    }
    if let Some(r) = reason.filter(|r| !r.is_empty() && *r != "all") {
        q = q.bind(r);
    }
    if let Some(cid) = client_key_id {
        q = q.bind(cid);
    }
    if let Some(d) = date_from.filter(|d| !d.trim().is_empty()) {
        q = q.bind(d.trim().to_string());
    }
    if let Some(d) = date_to.filter(|d| !d.trim().is_empty()) {
        q = q.bind(d.trim().to_string());
    }
    if let Some(bid) = before_id.filter(|id| *id > 0) {
        q = q.bind(bid);
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
    let hours = hours.clamp(1, 744);
    let exists: Option<i64> =
        sqlx::query_scalar("SELECT id FROM gateway_client_keys WHERE id = $1 AND tenant_id = $2")
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

    let (total, success, denied, upstream_error, avg_duration_ms): (
        i64,
        i64,
        i64,
        i64,
        Option<f64>,
    ) = sqlx::query_as(
        "SELECT
            COUNT(*)::bigint AS total,
            COUNT(*) FILTER (WHERE outcome = 'success')::bigint AS success,
            COUNT(*) FILTER (WHERE outcome = 'denied')::bigint AS denied,
            COUNT(*) FILTER (WHERE outcome = 'upstream_error')::bigint AS upstream_error,
            AVG(duration_ms)::float8 AS avg_duration_ms
         FROM gateway_transaction_logs
         WHERE tenant_id = $1
           AND client_key_id = $2
           AND created_at >= NOW() - ($3::bigint * INTERVAL '1 hour')",
    )
    .bind(tenant_id)
    .bind(client_key_id)
    .bind(i64::from(hours))
    .fetch_one(pool)
    .await?;

    let top_paths: Vec<(String, i64)> = sqlx::query_as(
        "SELECT COALESCE(NULLIF(path, ''), '(không rõ)') AS path, COUNT(*)::bigint AS cnt
         FROM gateway_transaction_logs
         WHERE tenant_id = $1
           AND client_key_id = $2
           AND created_at >= NOW() - ($3::bigint * INTERVAL '1 hour')
         GROUP BY path
         ORDER BY cnt DESC
         LIMIT 5",
    )
    .bind(tenant_id)
    .bind(client_key_id)
    .bind(i64::from(hours))
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

pub async fn client_traffic_top(
    pool: &PgPool,
    tenant_id: i64,
    hours: i32,
    limit: i64,
) -> Result<Vec<ClientTrafficTopRow>, sqlx::Error> {
    let hours = hours.clamp(1, 744);
    let lim = limit.clamp(1, 20);
    sqlx::query_as(
        "SELECT k.id AS client_key_id, k.name, COUNT(*)::bigint AS total
         FROM gateway_transaction_logs t
         INNER JOIN gateway_client_keys k ON k.id = t.client_key_id
         WHERE t.tenant_id = $1 AND t.client_key_id IS NOT NULL
           AND t.created_at >= NOW() - ($2::bigint * INTERVAL '1 hour')
         GROUP BY k.id, k.name
         ORDER BY total DESC
         LIMIT $3",
    )
    .bind(tenant_id)
    .bind(i64::from(hours))
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
    date_from: Option<&str>,
    date_to: Option<&str>,
    before_id: Option<i64>,
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
    if date_from.filter(|d| !d.trim().is_empty()).is_some() {
        sql.push_str(&format!(" AND created_at::date >= ${n}::date"));
        n += 1;
    }
    if date_to.filter(|d| !d.trim().is_empty()).is_some() {
        sql.push_str(&format!(" AND created_at::date <= ${n}::date"));
        n += 1;
    }
    if before_id.filter(|id| *id > 0).is_some() {
        sql.push_str(&format!(" AND id < ${n}"));
        n += 1;
    }
    sql.push_str(&format!(" ORDER BY id DESC LIMIT ${n}"));

    let mut q = sqlx::query_as::<_, AuditLogRow>(&sql).bind(tenant_id);
    if let Some(r) = result.filter(|r| !r.is_empty() && *r != "all") {
        q = q.bind(r);
    }
    if let Some(s) = search.filter(|s| !s.trim().is_empty()) {
        let pat = format!("%{}%", s.trim());
        q = q
            .bind(pat.clone())
            .bind(pat.clone())
            .bind(pat.clone())
            .bind(pat);
    }
    if let Some(d) = date_from.filter(|d| !d.trim().is_empty()) {
        q = q.bind(d.trim().to_string());
    }
    if let Some(d) = date_to.filter(|d| !d.trim().is_empty()) {
        q = q.bind(d.trim().to_string());
    }
    if let Some(bid) = before_id.filter(|id| *id > 0) {
        q = q.bind(bid);
    }
    q.bind(lim).fetch_all(pool).await
}

pub async fn list_routes_for_tenant(
    pool: &PgPool,
    tenant_id: i64,
) -> Result<Vec<RouteRow>, sqlx::Error> {
    sqlx::query_as::<_, RouteRow>(&format!(
        "SELECT {ROUTE_SELECT} FROM gateway_routes WHERE tenant_id = $1 ORDER BY path"
    ))
    .bind(tenant_id)
    .fetch_all(pool)
    .await
}

pub async fn fetch_route_by_id_tenant(
    pool: &PgPool,
    id: i64,
    tenant_id: i64,
) -> Result<Option<RouteRow>, sqlx::Error> {
    sqlx::query_as::<_, RouteRow>(&format!(
        "SELECT {ROUTE_SELECT} FROM gateway_routes WHERE id = $1 AND tenant_id = $2"
    ))
    .bind(id)
    .bind(tenant_id)
    .fetch_optional(pool)
    .await
}

pub async fn load_route_rows(pool: &PgPool) -> Result<Vec<RouteRow>, sqlx::Error> {
    sqlx::query_as::<_, RouteRow>(&format!(
        "SELECT {ROUTE_SELECT} FROM gateway_routes ORDER BY path"
    ))
    .fetch_all(pool)
    .await
}

pub async fn load_client_key_hashes(pool: &PgPool) -> Result<Vec<String>, sqlx::Error> {
    sqlx::query_scalar("SELECT secret_sha256_hex FROM gateway_client_keys ORDER BY id")
        .fetch_all(pool)
        .await
}

pub async fn load_admin_hash(pool: &PgPool) -> Result<String, sqlx::Error> {
    sqlx::query_scalar("SELECT v FROM gateway_settings WHERE k = 'admin_x_api_key_sha256' LIMIT 1")
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
                    CASE WHEN (k.secret_hash IS NOT NULL AND k.secret_hash != '')
                              OR (k.secret_encrypted IS NOT NULL AND k.secret_encrypted != '') THEN 'oauth_client'
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
                    CASE WHEN (k.secret_hash IS NOT NULL AND k.secret_hash != '')
                              OR (k.secret_encrypted IS NOT NULL AND k.secret_encrypted != '') THEN 'oauth_client'
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

pub async fn backfill_client_secret_hashes(pool: &PgPool) -> Result<u64, sqlx::Error> {
    let rows: Vec<(i64, String)> = sqlx::query_as(
        "SELECT id, secret_encrypted FROM gateway_client_keys
         WHERE secret_encrypted IS NOT NULL AND secret_encrypted != ''
           AND (secret_hash IS NULL OR secret_hash = '')",
    )
    .fetch_all(pool)
    .await?;
    let mut migrated = 0u64;
    for (id, enc) in rows {
        let Ok(plain) = crypto::decrypt_secret(&enc) else {
            tracing::error!(client_key_id = id, "skip secret backfill: decrypt failed");
            continue;
        };
        match hash_client_secret(&plain) {
            Ok(hash) => {
                sqlx::query(
                    "UPDATE gateway_client_keys SET secret_hash = $1, secret_encrypted = NULL WHERE id = $2",
                )
                .bind(&hash)
                .bind(id)
                .execute(pool)
                .await?;
                migrated += 1;
            }
            Err(e) => {
                tracing::error!(client_key_id = id, error = %e, "hash client secret backfill failed")
            }
        }
    }
    if migrated > 0 {
        tracing::info!(
            count = migrated,
            "migrated OAuth client secrets to Argon2id"
        );
    }
    Ok(migrated)
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
        i32,
    )> = sqlx::query_as(
        "SELECT id, api_key, secret_encrypted, secret_hash, tenant_id,
                COALESCE(status, 'active'), COALESCE(rate_limit_per_min, 0), COALESCE(token_version, 0)
         FROM gateway_client_keys ORDER BY id",
    )
    .fetch_all(pool)
    .await?;

    let allowlists = load_all_client_key_route_allowlists(pool).await?;
    let user_token_versions = load_user_token_versions(pool).await?;

    let mut creds = ClientCredentials::default();
    creds.user_token_versions = user_token_versions;
    for (
        id,
        api_key,
        secret_enc,
        secret_hash,
        tenant_id,
        status,
        rate_limit_per_min,
        token_version,
    ) in rows
    {
        let allowed_route_ids = allowlists.get(&id).cloned().unwrap_or_default();
        if status != "active" {
            if let Some(k) = api_key.filter(|s| !s.is_empty()) {
                creds.disabled_clients.push(DisabledClientKey {
                    id,
                    client_id: k,
                    tenant_id,
                });
            }
            continue;
        }
        let Some(client_id) = api_key.filter(|s| !s.is_empty()) else {
            continue;
        };
        let resolved_hash = if let Some(h) = secret_hash.filter(|s| !s.is_empty()) {
            h
        } else if let Some(enc) = secret_enc.filter(|s| !s.is_empty()) {
            match crypto::decrypt_secret(&enc) {
                Ok(plain) => match hash_client_secret(&plain) {
                    Ok(h) => {
                        if let Err(e) = sqlx::query(
                            "UPDATE gateway_client_keys SET secret_hash = $1, secret_encrypted = NULL WHERE id = $2",
                        )
                        .bind(&h)
                        .bind(id)
                        .execute(pool)
                        .await
                        {
                            tracing::error!(client_id = %client_id, error = %e, "inline secret hash migration failed");
                        }
                        h
                    }
                    Err(e) => {
                        tracing::error!(client_id = %client_id, error = %e, "skip oauth client: hash failed");
                        continue;
                    }
                },
                Err(e) => {
                    tracing::error!(client_id = %client_id, error = %e, "skip oauth client: decrypt failed");
                    continue;
                }
            }
        } else {
            continue;
        };
        creds.oauth_clients.push(OAuthClientKey {
            id,
            client_id,
            secret_hash: resolved_hash,
            tenant_id,
            rate_limit_per_min,
            allowed_route_ids,
            token_version,
        });
    }
    Ok(creds)
}

pub async fn load_user_token_versions(
    pool: &PgPool,
) -> Result<std::collections::HashMap<i64, i32>, sqlx::Error> {
    let rows: Vec<(i64, i32)> =
        sqlx::query_as("SELECT id, COALESCE(token_version, 0) FROM dashboard_users")
            .fetch_all(pool)
            .await?;
    Ok(rows.into_iter().collect())
}

pub async fn bump_client_token_version(
    pool: &PgPool,
    client_key_id: i64,
    tenant_id: i64,
) -> Result<i32, sqlx::Error> {
    let row: Option<i32> = sqlx::query_scalar(
        "UPDATE gateway_client_keys SET token_version = COALESCE(token_version, 0) + 1
         WHERE id = $1 AND tenant_id = $2
         RETURNING token_version",
    )
    .bind(client_key_id)
    .bind(tenant_id)
    .fetch_optional(pool)
    .await?;
    row.ok_or_else(|| sqlx::Error::RowNotFound)
}

pub async fn bump_user_token_version(pool: &PgPool, user_id: i64) -> Result<i32, sqlx::Error> {
    let row: Option<i32> = sqlx::query_scalar(
        "UPDATE dashboard_users SET token_version = COALESCE(token_version, 0) + 1
         WHERE id = $1
         RETURNING token_version",
    )
    .bind(user_id)
    .fetch_optional(pool)
    .await?;
    row.ok_or_else(|| sqlx::Error::RowNotFound)
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

/// Resolve route ids → paths (tenant-scoped), preserving request order when possible.
pub async fn fetch_route_paths_for_ids(
    pool: &PgPool,
    tenant_id: i64,
    route_ids: &[i64],
) -> Result<Vec<String>, sqlx::Error> {
    if route_ids.is_empty() {
        return Ok(Vec::new());
    }
    let rows: Vec<(i64, String)> = sqlx::query_as(
        "SELECT id, path FROM gateway_routes WHERE tenant_id = $1 AND id = ANY($2)",
    )
    .bind(tenant_id)
    .bind(route_ids)
    .fetch_all(pool)
    .await?;
    let mut by_id: std::collections::HashMap<i64, String> =
        rows.into_iter().collect();
    Ok(route_ids
        .iter()
        .filter_map(|id| by_id.remove(id))
        .collect())
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
    let valid_route_ids: std::collections::HashSet<i64> =
        sqlx::query_scalar("SELECT id FROM gateway_routes WHERE tenant_id = $1 AND id = ANY($2)")
            .bind(tenant_id)
            .bind(route_ids)
            .fetch_all(&mut *tx)
            .await?
            .into_iter()
            .collect();
    for rid in route_ids {
        if valid_route_ids.contains(rid) {
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

/// Rotate OAuth client_secret; returns public client_id when updated.
pub async fn rotate_client_key_secret(
    pool: &PgPool,
    id: i64,
    tenant_id: i64,
    new_secret: &str,
) -> Result<Option<String>, sqlx::Error> {
    let hash = hash_client_secret(new_secret)
        .map_err(|e| sqlx::Error::Configuration(format!("hash client secret: {e}").into()))?;
    sqlx::query_scalar(
        "UPDATE gateway_client_keys SET secret_hash = $3, secret_encrypted = NULL
         WHERE id = $1 AND tenant_id = $2
           AND api_key IS NOT NULL
           AND (secret_hash IS NOT NULL AND secret_hash != ''
                OR secret_encrypted IS NOT NULL AND secret_encrypted != '')
         RETURNING api_key",
    )
    .bind(id)
    .bind(tenant_id)
    .bind(&hash)
    .fetch_optional(pool)
    .await
}

pub async fn update_client_key_registry(
    pool: &PgPool,
    id: i64,
    tenant_id: i64,
    name: Option<&str>,
    status: Option<&str>,
    rate_limit_per_min: Option<i32>,
) -> Result<u64, sqlx::Error> {
    match (name, status, rate_limit_per_min) {
        (Some(name), Some(s), Some(rl)) => {
            let r = sqlx::query(
                "UPDATE gateway_client_keys SET name = $3, status = $4, rate_limit_per_min = $5 WHERE id = $1 AND tenant_id = $2",
            )
            .bind(id)
            .bind(tenant_id)
            .bind(name)
            .bind(s)
            .bind(rl)
            .execute(pool)
            .await?;
            Ok(r.rows_affected())
        }
        (Some(name), Some(s), None) => {
            let r = sqlx::query(
                "UPDATE gateway_client_keys SET name = $3, status = $4 WHERE id = $1 AND tenant_id = $2",
            )
            .bind(id)
            .bind(tenant_id)
            .bind(name)
            .bind(s)
            .execute(pool)
            .await?;
            Ok(r.rows_affected())
        }
        (Some(name), None, Some(rl)) => {
            let r = sqlx::query(
                "UPDATE gateway_client_keys SET name = $3, rate_limit_per_min = $4 WHERE id = $1 AND tenant_id = $2",
            )
            .bind(id)
            .bind(tenant_id)
            .bind(name)
            .bind(rl)
            .execute(pool)
            .await?;
            Ok(r.rows_affected())
        }
        (Some(name), None, None) => {
            let r = sqlx::query(
                "UPDATE gateway_client_keys SET name = $3 WHERE id = $1 AND tenant_id = $2",
            )
            .bind(id)
            .bind(tenant_id)
            .bind(name)
            .execute(pool)
            .await?;
            Ok(r.rows_affected())
        }
        (None, Some(s), Some(rl)) => {
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
        (None, Some(s), None) => {
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
        (None, None, Some(rl)) => {
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
        (None, None, None) => Ok(0),
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
    retry_on_status: &[i32],
    retry_on_timeout: i32,
    queue_on_failure: i32,
    allowed_methods: &[String],
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
    sqlx::query_as::<_, RouteRow>(&format!(
        "SELECT {ROUTE_SELECT} FROM gateway_routes WHERE id = $1"
    ))
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
    retry_on_status: &[i32],
    retry_on_timeout: i32,
    queue_on_failure: i32,
    allowed_methods: &[String],
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

/// OAuth2 `client_id` prefix — identifier, not a cryptographic public key.
pub const OAUTH_CLIENT_ID_PREFIX: &str = "avaso_cid_";
/// Legacy Stripe-style prefix — still accepted for existing clients.
pub const OAUTH_CLIENT_ID_PREFIX_LEGACY: &str = "avaso_pk_";
/// OAuth2 `client_secret` prefix.
pub const OAUTH_CLIENT_SECRET_PREFIX: &str = "avaso_csec_";
/// Legacy secret prefix — still accepted until rotated.
pub const OAUTH_CLIENT_SECRET_PREFIX_LEGACY: &str = "avaso_sk_";

/// OAuth2 `client_id` — prefix `avaso_cid_`.
pub fn random_oauth_client_id() -> String {
    random_token(OAUTH_CLIENT_ID_PREFIX, 24)
}

/// OAuth2 `client_secret` — prefix `avaso_csec_`; stored as Argon2id hash only.
pub fn random_oauth_client_secret() -> String {
    random_token(OAUTH_CLIENT_SECRET_PREFIX, 40)
}

/// Alias — prefer [`random_oauth_client_id`].
pub fn random_api_key_id() -> String {
    random_oauth_client_id()
}

/// Alias — prefer [`random_oauth_client_secret`].
pub fn random_secret_key() -> String {
    random_oauth_client_secret()
}

pub fn is_oauth_client_id(client_id: &str) -> bool {
    client_id.starts_with(OAUTH_CLIENT_ID_PREFIX)
        || client_id.starts_with(OAUTH_CLIENT_ID_PREFIX_LEGACY)
}

/// OAuth2 client_id for sync worker loopback (canonical).
pub const SYNC_WORKER_API_KEY: &str = "avaso_cid_sync_worker";
/// Pre-rename sync worker client_id — migrated in place on ensure.
pub const SYNC_WORKER_API_KEY_LEGACY: &str = "avaso_pk_sync_worker";
pub const SYNC_WORKER_DISPLAY_NAME: &str = "sync-worker";

pub fn is_sync_worker_client_id(client_id: &str) -> bool {
    client_id == SYNC_WORKER_API_KEY || client_id == SYNC_WORKER_API_KEY_LEGACY
}

/// OAuth client cố định cho sync worker loopback — rate limit cao, empty ACL (= mọi data-plane path).
pub async fn ensure_sync_worker_client_key(
    pool: &PgPool,
    tenant_id: i64,
) -> Result<OAuthClientKey, sqlx::Error> {
    let rate_limit = std::env::var("SYNC_WORKER_RATE_LIMIT_PER_MIN")
        .ok()
        .and_then(|s| s.parse().ok())
        .filter(|&n| n > 0)
        .unwrap_or(10_000);

    type Row = (i64, String, Option<String>, i64, i32, i32);

    let mut existing = sqlx::query_as::<_, Row>(
        "SELECT id, api_key, secret_hash, tenant_id, rate_limit_per_min, COALESCE(token_version, 0)
         FROM gateway_client_keys WHERE api_key = $1 AND tenant_id = $2",
    )
    .bind(SYNC_WORKER_API_KEY)
    .bind(tenant_id)
    .fetch_optional(pool)
    .await?;

    if existing.is_none() {
        if let Some((id, _api_key, secret_hash, tid, rl, tv)) = sqlx::query_as::<_, Row>(
            "SELECT id, api_key, secret_hash, tenant_id, rate_limit_per_min, COALESCE(token_version, 0)
             FROM gateway_client_keys WHERE api_key = $1 AND tenant_id = $2",
        )
        .bind(SYNC_WORKER_API_KEY_LEGACY)
        .bind(tenant_id)
        .fetch_optional(pool)
        .await?
        {
            sqlx::query(
                "UPDATE gateway_client_keys SET api_key = $1 WHERE id = $2 AND tenant_id = $3",
            )
            .bind(SYNC_WORKER_API_KEY)
            .bind(id)
            .bind(tenant_id)
            .execute(pool)
            .await?;
            tracing::info!(
                from = SYNC_WORKER_API_KEY_LEGACY,
                to = SYNC_WORKER_API_KEY,
                "migrated sync worker client_id prefix"
            );
            existing = Some((
                id,
                SYNC_WORKER_API_KEY.to_string(),
                secret_hash,
                tid,
                rl,
                tv,
            ));
        }
    }

    if let Some((id, api_key, secret_hash, tid, _rl, tv)) = existing {
        let hash = if let Some(h) = secret_hash.filter(|s| !s.is_empty()) {
            h
        } else {
            return Err(sqlx::Error::Configuration(
                "sync worker client missing secret_hash — restart gateway to run migration".into(),
            ));
        };
        sqlx::query(
            "UPDATE gateway_client_keys
             SET name = $1, rate_limit_per_min = $2, status = 'active', integration_type = 'salesforce'
             WHERE id = $3",
        )
        .bind(SYNC_WORKER_DISPLAY_NAME)
        .bind(rate_limit)
        .bind(id)
        .execute(pool)
        .await?;
        return Ok(OAuthClientKey {
            id,
            client_id: api_key,
            secret_hash: hash,
            tenant_id: tid,
            rate_limit_per_min: rate_limit,
            allowed_route_ids: vec![],
            token_version: tv,
        });
    }

    let owner_user_id = sqlx::query_scalar::<_, i64>(
        "SELECT id FROM dashboard_users WHERE is_active = 1 ORDER BY id LIMIT 1",
    )
    .fetch_optional(pool)
    .await?;

    let secret = random_oauth_client_secret();
    let id = insert_oauth_client(
        pool,
        SYNC_WORKER_DISPLAY_NAME,
        SYNC_WORKER_API_KEY,
        &secret,
        tenant_id,
        "salesforce",
        owner_user_id,
        rate_limit,
    )
    .await?;
    let secret_hash = sqlx::query_scalar::<_, String>(
        "SELECT secret_hash FROM gateway_client_keys WHERE id = $1",
    )
    .bind(id)
    .fetch_one(pool)
    .await?;
    tracing::info!(
        client_id = SYNC_WORKER_API_KEY,
        rate_limit_per_min = rate_limit,
        "created sync worker OAuth client for gateway loopback"
    );
    Ok(OAuthClientKey {
        id,
        client_id: SYNC_WORKER_API_KEY.into(),
        secret_hash,
        tenant_id,
        rate_limit_per_min: rate_limit,
        allowed_route_ids: vec![],
        token_version: 0,
    })
}

pub async fn insert_oauth_client(
    pool: &PgPool,
    name: &str,
    api_key: &str,
    secret_key: &str,
    tenant_id: i64,
    integration_type: &str,
    owner_user_id: Option<i64>,
    rate_limit_per_min: i32,
) -> Result<i64, sqlx::Error> {
    let hash = hash_client_secret(secret_key)
        .map_err(|e| sqlx::Error::Configuration(format!("hash client secret: {e}").into()))?;
    let unique_row = format!("argon2id:{}", sha256_hex(api_key));
    // owner_user_id NULL hợp lệ (FK ON DELETE SET NULL); không insert 0 giả.
    let owner = owner_user_id.filter(|&id| id > 0);
    sqlx::query_scalar(
        "INSERT INTO gateway_client_keys (name, api_key, secret_encrypted, secret_hash, secret_sha256_hex, tenant_id, integration_type, owner_user_id, status, rate_limit_per_min)
         VALUES ($1, $2, NULL, $3, $4, $5, $6, $7, 'active', $8) RETURNING id",
    )
    .bind(name)
    .bind(api_key)
    .bind(&hash)
    .bind(&unique_row)
    .bind(tenant_id)
    .bind(integration_type)
    .bind(owner)
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

#[derive(Debug, Clone, sqlx::FromRow)]
struct IntegrationPublicRow {
    id: i64,
    provider: String,
    status: String,
    last_sync_at: Option<String>,
    last_error: Option<String>,
    updated_at: String,
}

impl From<IntegrationPublicRow> for IntegrationPublic {
    fn from(r: IntegrationPublicRow) -> Self {
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
    let rows = sqlx::query_as::<_, IntegrationPublicRow>(
        "SELECT id, provider, status, last_sync_at::text AS last_sync_at, last_error, updated_at::text AS updated_at
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

#[derive(Debug, Clone, serde::Serialize, sqlx::FromRow)]
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
    if let Some(p) = provider {
        sqlx::query_as::<_, IntegrationSnapshotSummary>(
            "SELECT DISTINCT ON (provider, entity_type)
                provider,
                entity_type,
                record_count,
                fetched_at::text AS fetched_at
             FROM integration_snapshots
             WHERE tenant_id = $1 AND provider = $2
             ORDER BY provider, entity_type, fetched_at DESC, id DESC",
        )
        .bind(tenant_id)
        .bind(p)
        .fetch_all(pool)
        .await
    } else {
        sqlx::query_as::<_, IntegrationSnapshotSummary>(
            "SELECT DISTINCT ON (provider, entity_type)
                provider,
                entity_type,
                record_count,
                fetched_at::text AS fetched_at
             FROM integration_snapshots
             WHERE tenant_id = $1
             ORDER BY provider, entity_type, fetched_at DESC, id DESC",
        )
        .bind(tenant_id)
        .fetch_all(pool)
        .await
    }
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
                CASE WHEN k.secret_encrypted IS NOT NULL AND k.secret_encrypted != '' THEN 'oauth_client'
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

/// Shared filter: $1 = tenant_id, $2 = hours (window length as bigint).
fn tx_log_window_filter() -> &'static str {
    "tenant_id = $1 AND created_at >= NOW() - ($2::bigint * INTERVAL '1 hour')"
}

pub async fn traffic_denial_reasons(
    pool: &PgPool,
    tenant_id: i64,
    hours: i32,
    limit: i64,
) -> Result<Vec<(String, i64)>, sqlx::Error> {
    let hours = hours.clamp(1, 744);
    sqlx::query_as(&format!(
        "SELECT COALESCE(NULLIF(reason, ''), 'unknown') AS reason, COUNT(*) AS cnt
         FROM gateway_transaction_logs
         WHERE {} AND outcome = 'denied'
         GROUP BY reason
         ORDER BY cnt DESC
         LIMIT $3",
        tx_log_window_filter()
    ))
    .bind(tenant_id)
    .bind(i64::from(hours))
    .bind(limit)
    .fetch_all(pool)
    .await
}

pub async fn count_client_keys_for_tenant(
    pool: &PgPool,
    tenant_id: i64,
) -> Result<i64, sqlx::Error> {
    sqlx::query_scalar("SELECT COUNT(*) FROM gateway_client_keys WHERE tenant_id = $1")
        .bind(tenant_id)
        .fetch_one(pool)
        .await
}

pub async fn audit_counts(
    pool: &PgPool,
    tenant_id: i64,
    hours: i32,
) -> Result<(i64, i64, i64), sqlx::Error> {
    let hours = hours.clamp(1, 744);
    let total: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM audit_logs
         WHERE tenant_id = $1 AND created_at >= NOW() - ($2::bigint * INTERVAL '1 hour')",
    )
    .bind(tenant_id)
    .bind(i64::from(hours))
    .fetch_one(pool)
    .await?;
    let success: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM audit_logs
         WHERE tenant_id = $1 AND created_at >= NOW() - ($2::bigint * INTERVAL '1 hour')
           AND result = 'success'",
    )
    .bind(tenant_id)
    .bind(i64::from(hours))
    .fetch_one(pool)
    .await?;
    let failure: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM audit_logs
         WHERE tenant_id = $1 AND created_at >= NOW() - ($2::bigint * INTERVAL '1 hour')
           AND result = 'failure'",
    )
    .bind(tenant_id)
    .bind(i64::from(hours))
    .fetch_one(pool)
    .await?;
    Ok((total, success, failure))
}

pub async fn list_integration_snapshots_recent(
    pool: &PgPool,
    tenant_id: i64,
    limit: i64,
) -> Result<Vec<IntegrationSnapshotSummary>, sqlx::Error> {
    sqlx::query_as::<_, IntegrationSnapshotSummary>(
        "SELECT provider, entity_type, record_count, fetched_at::text AS fetched_at
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

pub async fn delete_client_key(pool: &PgPool, id: i64, tenant_id: i64) -> Result<u64, sqlx::Error> {
    let r = sqlx::query("DELETE FROM gateway_client_keys WHERE id = $1 AND tenant_id = $2")
        .bind(id)
        .bind(tenant_id)
        .execute(pool)
        .await?;
    Ok(r.rows_affected())
}

pub async fn audit_top_actions(
    pool: &PgPool,
    tenant_id: i64,
    hours: i32,
    limit: i64,
) -> Result<Vec<(String, i64)>, sqlx::Error> {
    let hours = hours.clamp(1, 744);
    sqlx::query_as::<_, (String, i64)>(
        "SELECT action, COUNT(*) AS cnt
         FROM audit_logs
         WHERE tenant_id = $1 AND created_at >= NOW() - ($2::bigint * INTERVAL '1 hour')
         GROUP BY action
         ORDER BY cnt DESC
         LIMIT $3",
    )
    .bind(tenant_id)
    .bind(i64::from(hours))
    .bind(limit)
    .fetch_all(pool)
    .await
}

/// Bucket label format for time-series charts depending on window length.
fn series_bucket_parts(hours: i32) -> (&'static str, &'static str) {
    if hours <= 1 {
        ("minute", "HH24:MI")
    } else if hours <= 24 {
        ("hour", "HH24:00")
    } else {
        ("day", "DD/MM")
    }
}

pub async fn audit_series(
    pool: &PgPool,
    tenant_id: i64,
    hours: i32,
) -> Result<Vec<(String, i64)>, sqlx::Error> {
    let hours = hours.clamp(1, 744);
    let (trunc, fmt) = series_bucket_parts(hours);
    let sql = format!(
        "SELECT to_char(date_trunc('{trunc}', created_at AT TIME ZONE 'UTC'), '{fmt}') AS bucket,
                COUNT(*) AS cnt
         FROM audit_logs
         WHERE tenant_id = $1 AND created_at >= NOW() - ($2::bigint * INTERVAL '1 hour')
         GROUP BY date_trunc('{trunc}', created_at AT TIME ZONE 'UTC')
         ORDER BY date_trunc('{trunc}', created_at AT TIME ZONE 'UTC')"
    );
    sqlx::query_as::<_, (String, i64)>(&sql)
        .bind(tenant_id)
        .bind(i64::from(hours))
        .fetch_all(pool)
        .await
}

pub async fn traffic_outcome_counts(
    pool: &PgPool,
    tenant_id: i64,
    hours: i32,
) -> Result<(i64, i64, i64, i64, i64, f64), sqlx::Error> {
    let hours = hours.clamp(1, 744);
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
        tx_log_window_filter()
    ))
    .bind(tenant_id)
    .bind(i64::from(hours))
    .fetch_one(pool)
    .await?;
    Ok((row.0, row.1, row.2, row.3, row.4, row.5.unwrap_or(0.0)))
}

pub async fn traffic_status_buckets(
    pool: &PgPool,
    tenant_id: i64,
    hours: i32,
) -> Result<Vec<(String, i64)>, sqlx::Error> {
    let hours = hours.clamp(1, 744);
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
        tx_log_window_filter()
    ))
    .bind(tenant_id)
    .bind(i64::from(hours))
    .fetch_all(pool)
    .await
}

pub async fn traffic_series(
    pool: &PgPool,
    tenant_id: i64,
    hours: i32,
) -> Result<Vec<(String, i64)>, sqlx::Error> {
    let hours = hours.clamp(1, 744);
    let (trunc, fmt) = series_bucket_parts(hours);
    let sql = format!(
        "SELECT to_char(date_trunc('{trunc}', created_at AT TIME ZONE 'UTC'), '{fmt}') AS bucket,
                COUNT(*) AS cnt
         FROM gateway_transaction_logs
         WHERE {}
         GROUP BY date_trunc('{trunc}', created_at AT TIME ZONE 'UTC')
         ORDER BY date_trunc('{trunc}', created_at AT TIME ZONE 'UTC')",
        tx_log_window_filter()
    );
    sqlx::query_as::<_, (String, i64)>(&sql)
        .bind(tenant_id)
        .bind(i64::from(hours))
        .fetch_all(pool)
        .await
}

pub async fn traffic_top_paths(
    pool: &PgPool,
    tenant_id: i64,
    hours: i32,
    limit: i64,
) -> Result<Vec<(String, i64)>, sqlx::Error> {
    let hours = hours.clamp(1, 744);
    sqlx::query_as(&format!(
        "SELECT COALESCE(NULLIF(path, ''), '(không rõ)') AS path, COUNT(*) AS cnt
         FROM gateway_transaction_logs
         WHERE {}
         GROUP BY path
         ORDER BY cnt DESC
         LIMIT $3",
        tx_log_window_filter()
    ))
    .bind(tenant_id)
    .bind(i64::from(hours))
    .bind(limit)
    .fetch_all(pool)
    .await
}

pub async fn traffic_method_counts(
    pool: &PgPool,
    tenant_id: i64,
    hours: i32,
) -> Result<Vec<(String, i64)>, sqlx::Error> {
    let hours = hours.clamp(1, 744);
    sqlx::query_as(&format!(
        "SELECT method, COUNT(*) AS cnt
         FROM gateway_transaction_logs
         WHERE {}
         GROUP BY method
         ORDER BY cnt DESC",
        tx_log_window_filter()
    ))
    .bind(tenant_id)
    .bind(i64::from(hours))
    .fetch_all(pool)
    .await
}

pub async fn ping(pool: &PgPool) -> bool {
    sqlx::query("SELECT 1").execute(pool).await.is_ok()
}

pub async fn ping_timed(pool: &PgPool) -> (bool, u128) {
    let start = std::time::Instant::now();
    let ok = ping(pool).await;
    (ok, start.elapsed().as_millis())
}

#[derive(Debug, Clone, Default)]
pub struct SyncLogInsert {
    pub event_type: Option<String>,
    pub flow_type: Option<String>,
    pub source_provider: Option<String>,
    pub target_provider: Option<String>,
    pub correlation_id: Option<String>,
    pub metadata_json: Option<String>,
}

#[derive(Debug, Clone, sqlx::FromRow, serde::Serialize)]
pub struct SyncLogRow {
    pub id: i64,
    pub tenant_id: i64,
    pub status: String,
    pub message: String,
    pub error_detail: Option<String>,
    pub event_type: Option<String>,
    pub flow_type: Option<String>,
    pub source_provider: Option<String>,
    pub target_provider: Option<String>,
    pub correlation_id: Option<String>,
    pub metadata_json: Option<String>,
    pub created_at: String,
}

pub async fn insert_sync_log(
    pool: &PgPool,
    tenant_id: i64,
    status: &str,
    message: &str,
    error_detail: Option<&str>,
    meta: SyncLogInsert,
) -> Result<i64, sqlx::Error> {
    let row: (i64,) = sqlx::query_as(
        "INSERT INTO sync_logs (
            tenant_id, status, message, error_detail,
            event_type, flow_type, source_provider, target_provider,
            correlation_id, metadata_json
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING id",
    )
    .bind(tenant_id)
    .bind(status)
    .bind(message)
    .bind(error_detail)
    .bind(meta.event_type)
    .bind(meta.flow_type)
    .bind(meta.source_provider)
    .bind(meta.target_provider)
    .bind(meta.correlation_id)
    .bind(meta.metadata_json)
    .fetch_one(pool)
    .await?;
    Ok(row.0)
}

pub async fn latest_pipeline_sync_at(
    pool: &PgPool,
    tenant_id: i64,
) -> Result<Option<String>, sqlx::Error> {
    sqlx::query_scalar(
        "SELECT created_at::text FROM sync_logs
         WHERE tenant_id = $1 AND event_type = 'pipeline_completed'
         ORDER BY id DESC
         LIMIT 1",
    )
    .bind(tenant_id)
    .fetch_optional(pool)
    .await
}

pub async fn list_sync_logs(
    pool: &PgPool,
    tenant_id: i64,
    limit: i64,
) -> Result<Vec<SyncLogRow>, sqlx::Error> {
    sqlx::query_as::<_, SyncLogRow>(
        "SELECT id, tenant_id, status, message, error_detail,
                event_type, flow_type, source_provider, target_provider,
                correlation_id, metadata_json,
                created_at::text AS created_at
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

pub async fn prune_sync_logs(
    pool: &PgPool,
    tenant_id: i64,
    retain: i64,
) -> Result<(), sqlx::Error> {
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
    pub flow_type: String,
    pub source_provider: String,
    pub source_entity_type: String,
    pub source_id: String,
    pub target_provider: String,
    pub target_entity_type: String,
    pub target_id: String,
    pub target_name: Option<String>,
}

pub async fn fetch_entity_link(
    pool: &PgPool,
    tenant_id: i64,
    flow_type: &str,
    source_provider: &str,
    source_entity_type: &str,
    source_id: &str,
) -> Result<Option<EntityLinkRow>, sqlx::Error> {
    sqlx::query_as::<_, EntityLinkRow>(
        "SELECT flow_type, source_provider, source_entity_type, source_id,
                target_provider, target_entity_type, target_id, target_name
         FROM integration_entity_links
         WHERE tenant_id = $1
           AND flow_type = $2
           AND source_provider = $3
           AND source_entity_type = $4
           AND source_id = $5",
    )
    .bind(tenant_id)
    .bind(flow_type)
    .bind(source_provider)
    .bind(source_entity_type)
    .bind(source_id)
    .fetch_optional(pool)
    .await
}

pub async fn list_entity_links(
    pool: &PgPool,
    tenant_id: i64,
) -> Result<Vec<EntityLinkRow>, sqlx::Error> {
    sqlx::query_as::<_, EntityLinkRow>(
        "SELECT flow_type, source_provider, source_entity_type, source_id,
                target_provider, target_entity_type, target_id, target_name
         FROM integration_entity_links
         WHERE tenant_id = $1",
    )
    .bind(tenant_id)
    .fetch_all(pool)
    .await
}

pub async fn delete_entity_link(
    pool: &PgPool,
    tenant_id: i64,
    flow_type: &str,
    source_provider: &str,
    source_entity_type: &str,
    source_id: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "DELETE FROM integration_entity_links
         WHERE tenant_id = $1
           AND flow_type = $2
           AND source_provider = $3
           AND source_entity_type = $4
           AND source_id = $5",
    )
    .bind(tenant_id)
    .bind(flow_type)
    .bind(source_provider)
    .bind(source_entity_type)
    .bind(source_id)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn upsert_entity_link(
    pool: &PgPool,
    tenant_id: i64,
    flow_type: &str,
    source_provider: &str,
    source_entity_type: &str,
    source_id: &str,
    target_provider: &str,
    target_entity_type: &str,
    target_id: &str,
    target_name: Option<&str>,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO integration_entity_links (
            tenant_id, flow_type,
            source_provider, source_entity_type, source_id,
            target_provider, target_entity_type, target_id, target_name,
            last_synced_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
         ON CONFLICT (tenant_id, flow_type, source_provider, source_entity_type, source_id)
         DO UPDATE SET
           target_provider = excluded.target_provider,
           target_entity_type = excluded.target_entity_type,
           target_id = excluded.target_id,
           target_name = excluded.target_name,
           last_synced_at = NOW()",
    )
    .bind(tenant_id)
    .bind(flow_type)
    .bind(source_provider)
    .bind(source_entity_type)
    .bind(source_id)
    .bind(target_provider)
    .bind(target_entity_type)
    .bind(target_id)
    .bind(target_name)
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
    pub flow_type: String,
    pub source_provider: String,
    pub source_entity_type: String,
    pub source_id: String,
    pub target_provider: String,
    pub target_entity_type: String,
    pub target_id: String,
    pub target_name: Option<String>,
    pub last_synced_at: String,
}

pub async fn list_entity_links_public(
    pool: &PgPool,
    tenant_id: i64,
) -> Result<Vec<EntityLinkPublic>, sqlx::Error> {
    sqlx::query_as::<_, EntityLinkPublic>(
        "SELECT flow_type, source_provider, source_entity_type, source_id,
                target_provider, target_entity_type, target_id, target_name,
                last_synced_at::text AS last_synced_at
         FROM integration_entity_links
         WHERE tenant_id = $1
         ORDER BY last_synced_at DESC",
    )
    .bind(tenant_id)
    .fetch_all(pool)
    .await
}

#[derive(Debug, Clone, sqlx::FromRow, serde::Serialize)]
pub struct IntegrationProviderRow {
    pub id: String,
    pub display_name: String,
    pub auth_type: String,
    pub capabilities_json: String,
}

#[derive(Debug, Clone, sqlx::FromRow, serde::Serialize)]
pub struct IntegrationFlowTypeRow {
    pub id: String,
    pub display_name: String,
    pub source_provider: String,
    pub target_provider: String,
    pub description: Option<String>,
    pub enabled: i32,
}

pub async fn list_integration_providers(
    pool: &PgPool,
) -> Result<Vec<IntegrationProviderRow>, sqlx::Error> {
    sqlx::query_as::<_, IntegrationProviderRow>(
        "SELECT id, display_name, auth_type, capabilities_json
         FROM integration_providers
         ORDER BY id",
    )
    .fetch_all(pool)
    .await
}

pub async fn list_integration_flow_types(
    pool: &PgPool,
) -> Result<Vec<IntegrationFlowTypeRow>, sqlx::Error> {
    sqlx::query_as::<_, IntegrationFlowTypeRow>(
        "SELECT id, display_name, source_provider, target_provider, description, enabled
         FROM integration_flow_types
         WHERE enabled = 1
         ORDER BY id",
    )
    .fetch_all(pool)
    .await
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
    fn client_secret_hash_and_verify() {
        let hash = hash_client_secret("avaso_csec_demo_secret_value").expect("hash");
        assert!(hash.starts_with("$argon2"));
        assert!(verify_client_secret("avaso_csec_demo_secret_value", &hash));
        assert!(!verify_client_secret("wrong", &hash));
        assert!(is_oauth_client_id("avaso_cid_abc"));
        assert!(is_oauth_client_id("avaso_pk_legacy"));
        assert!(!is_oauth_client_id("other"));
    }
}
