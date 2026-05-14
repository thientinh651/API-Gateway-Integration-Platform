//! SQLite persistence for routes, data-plane API key hashes, and admin API key hash.

use sha2::{Digest, Sha256};
use sqlx::sqlite::SqlitePoolOptions;
use sqlx::SqlitePool;

use crate::{RouteConfig, YamlBootstrap};

pub fn sha256_hex(s: &str) -> String {
    let d = Sha256::digest(s.as_bytes());
    format!("{d:x}")
}

pub async fn connect(database_url: &str) -> Result<SqlitePool, sqlx::Error> {
    if let Some(path) = database_url.strip_prefix("sqlite:") {
        if let Some(parent) = std::path::Path::new(path).parent() {
            if !parent.as_os_str().is_empty() {
                std::fs::create_dir_all(parent).map_err(|e| {
                    sqlx::Error::Io(std::io::Error::new(
                        std::io::ErrorKind::Other,
                        format!("create db parent dir: {e}"),
                    ))
                })?;
            }
        }
    }

    SqlitePoolOptions::new()
        .max_connections(5)
        .connect(database_url)
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
        for r in &yaml.routes {
            sqlx::query(
                "INSERT INTO gateway_routes (path, target) VALUES (?, ?)
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
        let key = std::env::var("ADMIN_X_API_KEY").unwrap_or_else(|_| "avaso-secret-2026".into());
        let h = sha256_hex(&key.trim());
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

pub async fn load_routes(pool: &SqlitePool) -> Result<Vec<RouteConfig>, sqlx::Error> {
    sqlx::query_as::<_, RouteConfig>("SELECT path, target FROM gateway_routes ORDER BY path")
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
