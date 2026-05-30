//! SQLite persistence for routes, data-plane API key hashes, and admin API key hash.

use argon2::{
    password_hash::{rand_core::OsRng, PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Argon2,
};
use sha2::{Digest, Sha256};
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::SqlitePool;
use std::path::PathBuf;

use crate::{crypto, RouteRow, YamlBootstrap};

/// Runtime credentials for data-plane auth.
#[derive(Debug, Clone, Default)]
pub struct ClientCredentials {
    pub legacy: Vec<LegacyClientKey>,
    pub hmac: Vec<HmacClientKey>,
}

#[derive(Debug, Clone)]
pub struct LegacyClientKey {
    pub sha256_hex: String,
    pub tenant_id: i64,
}

#[derive(Debug, Clone)]
pub struct HmacClientKey {
    pub api_key: String,
    pub secret: String,
    pub tenant_id: i64,
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
    pub is_active: i64,
}

#[derive(Debug, Clone, serde::Serialize, sqlx::FromRow)]
pub struct AdminUserPublic {
    pub id: i64,
    pub username: String,
    pub role: String,
    pub tenant_id: i64,
    #[serde(serialize_with = "serialize_bool_from_i64")]
    pub is_active: i64,
    pub created_at: String,
}

fn serialize_bool_from_i64<S: serde::Serializer>(v: &i64, s: S) -> Result<S::Ok, S::Error> {
    s.serialize_bool(*v != 0)
}

pub async fn fetch_admin_user_by_username(
    pool: &SqlitePool,
    username: &str,
) -> Result<Option<AdminUserRow>, sqlx::Error> {
    sqlx::query_as::<_, AdminUserRow>(
        "SELECT id, username, password_hash, role, tenant_id, is_active FROM admin_users WHERE username = ? LIMIT 1",
    )
    .bind(username)
    .fetch_optional(pool)
    .await
}

/// First boot: seed one admin from env (plain password hashed once, not stored in env after).
pub async fn bootstrap_admin_user_if_empty(pool: &SqlitePool) -> Result<(), sqlx::Error> {
    let n: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM admin_users")
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
    sqlx::query(
        "INSERT INTO admin_users (username, password_hash, role, tenant_id, is_active) VALUES (?, ?, 'admin', 1, 1)",
    )
    .bind(username.trim())
    .bind(&password_hash)
    .execute(pool)
    .await?;
    tracing::info!(
        username = %username.trim(),
        "bootstrapped admin_users from env (change password via DB/UI later)"
    );
    Ok(())
}

pub async fn connect(database_url: &str) -> Result<SqlitePool, sqlx::Error> {
    let d = database_url.trim();

    // In-memory URLs: keep sqlx default parsing.
    if d.contains(":memory:") || d.contains("mode=memory") {
        return SqlitePoolOptions::new()
            .max_connections(5)
            .connect(d)
            .await;
    }

    let rest = d
        .strip_prefix("sqlite://")
        .or_else(|| d.strip_prefix("sqlite:"))
        .ok_or_else(|| {
            sqlx::Error::Configuration(
                "DATABASE_URL must use sqlite: or sqlite:// for this gateway".into(),
            )
        })?;
    let file_part = rest.split('?').next().unwrap_or(rest);
    if file_part.is_empty() {
        return Err(sqlx::Error::Configuration("sqlite path is empty".into()));
    }

    let path = PathBuf::from(file_part);
    let abs = if path.is_absolute() {
        path
    } else {
        std::env::current_dir()
            .map_err(|e| {
                sqlx::Error::Io(std::io::Error::new(
                    std::io::ErrorKind::Other,
                    format!(
                        "cannot resolve sqlite path (cd into repo root where Cargo.toml lives): {e}"
                    ),
                ))
            })?
            .join(&path)
    };

    if let Some(parent) = abs.parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent).map_err(|e| {
                sqlx::Error::Io(std::io::Error::new(
                    std::io::ErrorKind::Other,
                    format!("create db parent dir {}: {e}", parent.display()),
                ))
            })?;
        }
    }

    let opts = SqliteConnectOptions::new()
        .filename(&abs)
        .create_if_missing(true);

    SqlitePoolOptions::new()
        .max_connections(5)
        .connect_with(opts)
        .await
}

pub async fn migrate(pool: &SqlitePool) -> Result<(), sqlx::migrate::MigrateError> {
    sqlx::migrate!("./migrations").run(pool).await
}

/// If DB has no routes / no client keys, seed from `config.yaml` (one-time style import).
pub async fn bootstrap_from_yaml_if_empty(
    pool: &SqlitePool,
    yaml: &YamlBootstrap,
) -> Result<(), sqlx::Error> {
    let n_routes: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM gateway_routes")
        .fetch_one(pool)
        .await?;

    if n_routes == 0 {
        for r in yaml.routes.iter() {
            sqlx::query(
                "INSERT INTO gateway_routes (path, target, timeout_secs, rate_limit_per_min) VALUES (?, ?, 30, 100)
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
                "INSERT OR IGNORE INTO gateway_client_keys (name, secret_sha256_hex) VALUES ('imported', ?)",
            )
            .bind(&h)
            .execute(pool)
            .await?;
        }
    }

    Ok(())
}

/// Ensure admin API key hash exists (env `ADMIN_X_API_KEY` or default for dev).
pub async fn ensure_admin_setting(pool: &SqlitePool) -> Result<(), sqlx::Error> {
    let exists: Option<String> = sqlx::query_scalar(
        "SELECT v FROM gateway_settings WHERE k = 'admin_x_api_key_sha256' LIMIT 1",
    )
    .fetch_optional(pool)
    .await?;

    if exists.is_none() {
        let key = std::env::var("ADMIN_X_API_KEY").unwrap_or_else(|_| "key12345".into());
        let h = sha256_hex(key.trim());
        sqlx::query(
            "INSERT INTO gateway_settings (k, v) VALUES ('admin_x_api_key_sha256', ?)
             ON CONFLICT(k) DO NOTHING",
        )
        .bind(&h)
        .execute(pool)
        .await?;
    }

    Ok(())
}

pub async fn load_setting(pool: &SqlitePool, key: &str) -> Result<Option<String>, sqlx::Error> {
    sqlx::query_scalar("SELECT v FROM gateway_settings WHERE k = ? LIMIT 1")
        .bind(key)
        .fetch_optional(pool)
        .await
}

pub async fn upsert_setting(pool: &SqlitePool, key: &str, value: &str) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO gateway_settings (k, v) VALUES (?, ?)
         ON CONFLICT(k) DO UPDATE SET v = excluded.v",
    )
    .bind(key)
    .bind(value)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn ensure_default_tenant(pool: &SqlitePool) -> Result<(), sqlx::Error> {
    sqlx::query("INSERT OR IGNORE INTO tenants (name) VALUES ('default')")
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn backfill_admin_tenants(pool: &SqlitePool) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE admin_users SET tenant_id = 1 WHERE tenant_id IS NULL")
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn list_admin_users_for_tenant(
    pool: &SqlitePool,
    tenant_id: i64,
) -> Result<Vec<AdminUserPublic>, sqlx::Error> {
    sqlx::query_as::<_, AdminUserPublic>(
        "SELECT id, username, role, COALESCE(tenant_id, 1) AS tenant_id,
                CASE WHEN is_active = 0 THEN 0 ELSE 1 END AS is_active, created_at
         FROM admin_users WHERE COALESCE(tenant_id, 1) = ? ORDER BY username",
    )
    .bind(tenant_id)
    .fetch_all(pool)
    .await
}

pub async fn fetch_admin_user_by_id(
    pool: &SqlitePool,
    id: i64,
    tenant_id: i64,
) -> Result<Option<AdminUserRow>, sqlx::Error> {
    sqlx::query_as::<_, AdminUserRow>(
        "SELECT id, username, password_hash, role, tenant_id, is_active FROM admin_users
         WHERE id = ? AND COALESCE(tenant_id, 1) = ? LIMIT 1",
    )
    .bind(id)
    .bind(tenant_id)
    .fetch_optional(pool)
    .await
}

pub async fn insert_admin_user(
    pool: &SqlitePool,
    username: &str,
    password_hash: &str,
    role: &str,
    tenant_id: i64,
) -> Result<i64, sqlx::Error> {
    sqlx::query(
        "INSERT INTO admin_users (username, password_hash, role, tenant_id, is_active)
         VALUES (?, ?, ?, ?, 1)",
    )
    .bind(username)
    .bind(password_hash)
    .bind(role)
    .bind(tenant_id)
    .execute(pool)
    .await?;
    Ok(sqlx::query_scalar("SELECT last_insert_rowid()")
        .fetch_one(pool)
        .await?)
}

pub async fn update_admin_user(
    pool: &SqlitePool,
    id: i64,
    tenant_id: i64,
    username: &str,
    role: &str,
    is_active: bool,
    password_hash: Option<&str>,
) -> Result<u64, sqlx::Error> {
    let affected = if let Some(h) = password_hash {
        sqlx::query(
            "UPDATE admin_users SET username = ?, role = ?, is_active = ?, password_hash = ?
             WHERE id = ? AND COALESCE(tenant_id, 1) = ?",
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
    } else {
        sqlx::query(
            "UPDATE admin_users SET username = ?, role = ?, is_active = ?
             WHERE id = ? AND COALESCE(tenant_id, 1) = ?",
        )
        .bind(username)
        .bind(role)
        .bind(if is_active { 1 } else { 0 })
        .bind(id)
        .bind(tenant_id)
        .execute(pool)
        .await?
        .rows_affected()
    };
    Ok(affected)
}

pub async fn delete_admin_user(
    pool: &SqlitePool,
    id: i64,
    tenant_id: i64,
) -> Result<u64, sqlx::Error> {
    let r = sqlx::query(
        "DELETE FROM admin_users WHERE id = ? AND COALESCE(tenant_id, 1) = ?",
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
    pool: &SqlitePool,
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
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
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
    pool: &SqlitePool,
    tenant_id: i64,
    limit: i64,
) -> Result<Vec<AuditLogRow>, sqlx::Error> {
    sqlx::query_as::<_, AuditLogRow>(
        "SELECT id, tenant_id, actor, role, action, resource, result, source_ip, details, created_at
         FROM audit_logs WHERE tenant_id = ? ORDER BY id DESC LIMIT ?",
    )
    .bind(tenant_id)
    .bind(limit)
    .fetch_all(pool)
    .await
}

pub async fn list_routes_for_tenant(
    pool: &SqlitePool,
    tenant_id: i64,
) -> Result<Vec<RouteRow>, sqlx::Error> {
    sqlx::query_as::<_, RouteRow>(
        "SELECT id, path, target, timeout_secs, rate_limit_per_min, tenant_id
         FROM gateway_routes WHERE tenant_id = ? ORDER BY path",
    )
    .bind(tenant_id)
    .fetch_all(pool)
    .await
}

pub async fn fetch_route_by_id_tenant(
    pool: &SqlitePool,
    id: i64,
    tenant_id: i64,
) -> Result<Option<RouteRow>, sqlx::Error> {
    sqlx::query_as::<_, RouteRow>(
        "SELECT id, path, target, timeout_secs, rate_limit_per_min, tenant_id
         FROM gateway_routes WHERE id = ? AND tenant_id = ?",
    )
    .bind(id)
    .bind(tenant_id)
    .fetch_optional(pool)
    .await
}

pub async fn load_route_rows(pool: &SqlitePool) -> Result<Vec<RouteRow>, sqlx::Error> {
    sqlx::query_as::<_, RouteRow>(
        "SELECT id, path, target, timeout_secs, rate_limit_per_min, tenant_id FROM gateway_routes ORDER BY path",
    )
    .fetch_all(pool)
    .await
}

pub async fn load_client_key_hashes(pool: &SqlitePool) -> Result<Vec<String>, sqlx::Error> {
    sqlx::query_scalar("SELECT secret_sha256_hex FROM gateway_client_keys ORDER BY id")
        .fetch_all(pool)
        .await
}

pub async fn load_admin_hash(pool: &SqlitePool) -> Result<String, sqlx::Error> {
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
}

pub async fn list_client_keys(
    pool: &SqlitePool,
    tenant_id: i64,
) -> Result<Vec<ClientKeyMeta>, sqlx::Error> {
    sqlx::query_as::<_, ClientKeyMeta>(
        "SELECT id, name, api_key,
                CASE WHEN secret_encrypted IS NOT NULL AND secret_encrypted != '' THEN 'hmac'
                     ELSE 'legacy' END AS auth_mode,
                COALESCE(integration_type, 'app') AS integration_type,
                tenant_id
         FROM gateway_client_keys WHERE tenant_id = ? ORDER BY id",
    )
    .bind(tenant_id)
    .fetch_all(pool)
    .await
}

pub async fn load_client_credentials(pool: &SqlitePool) -> Result<ClientCredentials, sqlx::Error> {
    let rows: Vec<(Option<String>, Option<String>, Option<String>, i64)> = sqlx::query_as(
        "SELECT api_key, secret_encrypted, secret_sha256_hex, tenant_id FROM gateway_client_keys ORDER BY id",
    )
    .fetch_all(pool)
    .await?;

    let mut creds = ClientCredentials::default();
    for (api_key, secret_enc, legacy_hash, tenant_id) in rows {
        if let Some(enc) = secret_enc.filter(|s| !s.is_empty()) {
            if let Some(id) = api_key.filter(|s| !s.is_empty()) {
                match crypto::decrypt_secret(&enc) {
                    Ok(secret) => creds.hmac.push(HmacClientKey {
                        api_key: id,
                        secret,
                        tenant_id,
                    }),
                    Err(e) => tracing::error!(api_key = %id, error = %e, "skip hmac key: decrypt failed"),
                }
            }
        } else if let Some(h) = legacy_hash.filter(|s| !s.is_empty()) {
            creds.legacy.push(LegacyClientKey {
                sha256_hex: h,
                tenant_id,
            });
        }
    }
    Ok(creds)
}

pub async fn insert_route(
    pool: &SqlitePool,
    path: &str,
    target: &str,
    timeout_secs: i32,
    rate_limit_per_min: i32,
    tenant_id: i64,
) -> Result<RouteRow, sqlx::Error> {
    sqlx::query_as::<_, RouteRow>(
        "INSERT INTO gateway_routes (path, target, timeout_secs, rate_limit_per_min, tenant_id)
         VALUES (?, ?, ?, ?, ?)
         RETURNING id, path, target, timeout_secs, rate_limit_per_min, tenant_id",
    )
    .bind(path)
    .bind(target)
    .bind(timeout_secs)
    .bind(rate_limit_per_min)
    .bind(tenant_id)
    .fetch_one(pool)
    .await
}

pub async fn fetch_route_by_id(pool: &SqlitePool, id: i64) -> Result<Option<RouteRow>, sqlx::Error> {
    sqlx::query_as::<_, RouteRow>(
        "SELECT id, path, target, timeout_secs, rate_limit_per_min, tenant_id FROM gateway_routes WHERE id = ?",
    )
    .bind(id)
    .fetch_optional(pool)
    .await
}

pub async fn update_route(
    pool: &SqlitePool,
    id: i64,
    tenant_id: i64,
    path: &str,
    target: &str,
    timeout_secs: i32,
    rate_limit_per_min: i32,
) -> Result<u64, sqlx::Error> {
    let r = sqlx::query(
        "UPDATE gateway_routes SET path = ?, target = ?, timeout_secs = ?, rate_limit_per_min = ?
         WHERE id = ? AND tenant_id = ?",
    )
    .bind(path)
    .bind(target)
    .bind(timeout_secs)
    .bind(rate_limit_per_min)
    .bind(id)
    .bind(tenant_id)
    .execute(pool)
    .await?;
    Ok(r.rows_affected())
}

pub async fn delete_route(pool: &SqlitePool, id: i64, tenant_id: i64) -> Result<u64, sqlx::Error> {
    let r = sqlx::query("DELETE FROM gateway_routes WHERE id = ? AND tenant_id = ?")
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
    pool: &SqlitePool,
    name: &str,
    plain: &str,
) -> Result<i64, sqlx::Error> {
    let h = sha256_hex(plain);
    sqlx::query(
        "INSERT INTO gateway_client_keys (name, secret_sha256_hex) VALUES (?, ?)",
    )
    .bind(name)
    .bind(&h)
    .execute(pool)
    .await?;
    Ok(sqlx::query_scalar("SELECT last_insert_rowid()")
        .fetch_one(pool)
        .await?)
}

/// API_KEY (public) + SECRET_KEY (encrypted) for HMAC-SHA256.
pub async fn insert_client_key_hmac(
    pool: &SqlitePool,
    name: &str,
    api_key: &str,
    secret_key: &str,
    tenant_id: i64,
    integration_type: &str,
) -> Result<i64, sqlx::Error> {
    let enc = crypto::encrypt_secret(secret_key).map_err(|e| {
        sqlx::Error::Configuration(format!("encrypt secret: {e}").into())
    })?;
    // UNIQUE on secret_sha256_hex — HMAC rows use placeholder (auth uses secret_encrypted).
    let sha_placeholder = format!("hmac:{}", sha256_hex(api_key));
    sqlx::query(
        "INSERT INTO gateway_client_keys (name, api_key, secret_encrypted, secret_sha256_hex, tenant_id, integration_type)
         VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(name)
    .bind(api_key)
    .bind(&enc)
    .bind(&sha_placeholder)
    .bind(tenant_id)
    .bind(integration_type)
    .execute(pool)
    .await?;
    Ok(sqlx::query_scalar("SELECT last_insert_rowid()")
        .fetch_one(pool)
        .await?)
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
}

impl From<IntegrationRow> for IntegrationPublic {
    fn from(r: IntegrationRow) -> Self {
        let label = match r.provider.as_str() {
            "salesforce" => "Salesforce",
            "zoho_projects" => "Zoho Projects",
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
        }
    }
}

pub async fn list_integrations(
    pool: &SqlitePool,
    tenant_id: i64,
) -> Result<Vec<IntegrationPublic>, sqlx::Error> {
    let rows = sqlx::query_as::<_, IntegrationRow>(
        "SELECT id, tenant_id, provider, status, config_encrypted, last_sync_at, last_error, updated_at
         FROM integrations WHERE tenant_id = ? ORDER BY provider",
    )
    .bind(tenant_id)
    .fetch_all(pool)
    .await?;
    Ok(rows.into_iter().map(Into::into).collect())
}

pub async fn fetch_integration(
    pool: &SqlitePool,
    tenant_id: i64,
    provider: &str,
) -> Result<Option<IntegrationRow>, sqlx::Error> {
    sqlx::query_as::<_, IntegrationRow>(
        "SELECT id, tenant_id, provider, status, config_encrypted, last_sync_at, last_error, updated_at
         FROM integrations WHERE tenant_id = ? AND provider = ? LIMIT 1",
    )
    .bind(tenant_id)
    .bind(provider)
    .fetch_optional(pool)
    .await
}

pub async fn set_integration_status(
    pool: &SqlitePool,
    tenant_id: i64,
    provider: &str,
    status: &str,
    last_error: Option<&str>,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO integrations (tenant_id, provider, status, last_error, updated_at)
         VALUES (?, ?, ?, ?, datetime('now'))
         ON CONFLICT(tenant_id, provider) DO UPDATE SET
           status = excluded.status,
           last_error = excluded.last_error,
           updated_at = datetime('now')",
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
    pool: &SqlitePool,
    tenant_id: i64,
    provider: &str,
    status: &str,
    config_encrypted: &str,
    last_error: Option<&str>,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO integrations (tenant_id, provider, status, config_encrypted, last_error, updated_at)
         VALUES (?, ?, ?, ?, ?, datetime('now'))
         ON CONFLICT(tenant_id, provider) DO UPDATE SET
           status = excluded.status,
           config_encrypted = excluded.config_encrypted,
           last_error = excluded.last_error,
           updated_at = datetime('now')",
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
    pool: &SqlitePool,
    tenant_id: i64,
    provider: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "UPDATE integrations SET status = 'disconnected', config_encrypted = NULL, last_error = NULL,
         updated_at = datetime('now') WHERE tenant_id = ? AND provider = ?",
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
    pool: &SqlitePool,
    tenant_id: i64,
    provider: &str,
) -> Result<Option<IntegrationProviderConfigRow>, sqlx::Error> {
    sqlx::query_as::<_, IntegrationProviderConfigRow>(
        "SELECT id, tenant_id, provider, config_encrypted, updated_by, updated_at
         FROM integration_provider_configs
         WHERE tenant_id = ? AND provider = ? LIMIT 1",
    )
    .bind(tenant_id)
    .bind(provider)
    .fetch_optional(pool)
    .await
}

pub async fn upsert_integration_provider_config(
    pool: &SqlitePool,
    tenant_id: i64,
    provider: &str,
    config_encrypted: &str,
    updated_by: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO integration_provider_configs (tenant_id, provider, config_encrypted, updated_by, updated_at)
         VALUES (?, ?, ?, ?, datetime('now'))
         ON CONFLICT(tenant_id, provider) DO UPDATE SET
           config_encrypted = excluded.config_encrypted,
           updated_by = excluded.updated_by,
           updated_at = datetime('now')",
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
    pool: &SqlitePool,
    tenant_id: i64,
    provider: &str,
    entity_type: &str,
    payload_json: &str,
    record_count: i64,
) -> Result<i64, sqlx::Error> {
    let r = sqlx::query(
        "INSERT INTO integration_snapshots (tenant_id, provider, entity_type, payload_json, record_count, fetched_at)
         VALUES (?, ?, ?, ?, ?, datetime('now'))",
    )
    .bind(tenant_id)
    .bind(provider)
    .bind(entity_type)
    .bind(payload_json)
    .bind(record_count)
    .execute(pool)
    .await?;
    Ok(r.last_insert_rowid())
}

/// Keep newest `keep` rows per (tenant, provider, entity_type).
pub async fn prune_integration_snapshots(
    pool: &SqlitePool,
    tenant_id: i64,
    provider: &str,
    entity_type: &str,
    keep: i64,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "DELETE FROM integration_snapshots
         WHERE tenant_id = ? AND provider = ? AND entity_type = ?
           AND id NOT IN (
             SELECT id FROM integration_snapshots
             WHERE tenant_id = ? AND provider = ? AND entity_type = ?
             ORDER BY fetched_at DESC, id DESC
             LIMIT ?
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
    pool: &SqlitePool,
    tenant_id: i64,
    provider: Option<&str>,
) -> Result<Vec<IntegrationSnapshotSummary>, sqlx::Error> {
    let rows = if let Some(p) = provider {
        sqlx::query_as::<_, IntegrationSnapshotRow>(
            "SELECT id, tenant_id, provider, entity_type, payload_json, record_count, fetched_at
             FROM integration_snapshots
             WHERE tenant_id = ? AND provider = ?
             ORDER BY fetched_at DESC, id DESC",
        )
        .bind(tenant_id)
        .bind(p)
        .fetch_all(pool)
        .await?
    } else {
        sqlx::query_as::<_, IntegrationSnapshotRow>(
            "SELECT id, tenant_id, provider, entity_type, payload_json, record_count, fetched_at
             FROM integration_snapshots
             WHERE tenant_id = ?
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
    pool: &SqlitePool,
    tenant_id: i64,
    provider: &str,
    entity_type: &str,
) -> Result<Option<IntegrationSnapshotRow>, sqlx::Error> {
    sqlx::query_as::<_, IntegrationSnapshotRow>(
        "SELECT id, tenant_id, provider, entity_type, payload_json, record_count, fetched_at
         FROM integration_snapshots
         WHERE tenant_id = ? AND provider = ? AND entity_type = ?
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
    pool: &SqlitePool,
    tenant_id: i64,
    provider: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "UPDATE integrations SET last_sync_at = datetime('now'), updated_at = datetime('now')
         WHERE tenant_id = ? AND provider = ?",
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
    pool: &SqlitePool,
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
         VALUES (?, ?, ?, ?, ?, ?, datetime('now', '+' || ? || ' seconds'))",
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
    pool: &SqlitePool,
    state: &str,
    provider: &str,
) -> Result<Option<OAuthPendingRow>, sqlx::Error> {
    let row = sqlx::query_as::<_, OAuthPendingRow>(
        "SELECT state, tenant_id, provider, actor, role, pkce_verifier, expires_at
         FROM oauth_pending_states
         WHERE state = ? AND provider = ?
           AND expires_at > datetime('now')
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
    pool: &SqlitePool,
    state: &str,
    provider: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query("DELETE FROM oauth_pending_states WHERE state = ? AND provider = ?")
        .bind(state)
        .bind(provider)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn purge_expired_oauth_pending(pool: &SqlitePool) -> Result<(), sqlx::Error> {
    sqlx::query("DELETE FROM oauth_pending_states WHERE expires_at <= datetime('now')")
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn count_client_keys_for_tenant(pool: &SqlitePool, tenant_id: i64) -> Result<i64, sqlx::Error> {
    sqlx::query_scalar("SELECT COUNT(*) FROM gateway_client_keys WHERE tenant_id = ?")
        .bind(tenant_id)
        .fetch_one(pool)
        .await
}

pub async fn audit_counts_24h(pool: &SqlitePool, tenant_id: i64) -> Result<(i64, i64, i64), sqlx::Error> {
    let total: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM audit_logs WHERE tenant_id = ? AND created_at >= datetime('now', '-1 day')",
    )
    .bind(tenant_id)
    .fetch_one(pool)
    .await?;
    let success: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM audit_logs WHERE tenant_id = ? AND created_at >= datetime('now', '-1 day') AND result = 'success'",
    )
    .bind(tenant_id)
    .fetch_one(pool)
    .await?;
    let failure: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM audit_logs WHERE tenant_id = ? AND created_at >= datetime('now', '-1 day') AND result = 'failure'",
    )
    .bind(tenant_id)
    .fetch_one(pool)
    .await?;
    Ok((total, success, failure))
}

pub async fn list_integration_snapshots_recent(
    pool: &SqlitePool,
    tenant_id: i64,
    limit: i64,
) -> Result<Vec<IntegrationSnapshotRow>, sqlx::Error> {
    sqlx::query_as::<_, IntegrationSnapshotRow>(
        "SELECT id, tenant_id, provider, entity_type, payload_json, record_count, fetched_at
         FROM integration_snapshots
         WHERE tenant_id = ?
         ORDER BY fetched_at DESC, id DESC
         LIMIT ?",
    )
    .bind(tenant_id)
    .bind(limit)
    .fetch_all(pool)
    .await
}

pub async fn delete_client_key(
    pool: &SqlitePool,
    id: i64,
    tenant_id: i64,
) -> Result<u64, sqlx::Error> {
    let r = sqlx::query("DELETE FROM gateway_client_keys WHERE id = ? AND tenant_id = ?")
        .bind(id)
        .bind(tenant_id)
        .execute(pool)
        .await?;
    Ok(r.rows_affected())
}
