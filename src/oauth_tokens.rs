//! JWT lifecycle: Redis revoke blacklist, PostgreSQL audit log.
#![allow(dead_code)]

use redis::AsyncCommands;
use redis::aio::ConnectionManager;
use sqlx::PgPool;
use std::sync::Arc;
use tracing::{error, warn};

use crate::session::SessionStore;

const REVOKED_PREFIX: &str = "gw:jwt:revoked:";

#[derive(Clone)]
pub struct TokenRevocationStore {
    redis: Option<ConnectionManager>,
}

impl TokenRevocationStore {
    pub fn from_session(session: &Arc<SessionStore>) -> Self {
        Self {
            redis: Some(session.redis()),
        }
    }

    /// Unit tests — skip Redis (blacklist always empty).
    pub fn noop() -> Self {
        Self { redis: None }
    }

    pub async fn is_revoked(&self, jti: &str) -> bool {
        if jti.is_empty() {
            return false;
        }
        let Some(redis) = self.redis.clone() else {
            return false;
        };
        let key = format!("{REVOKED_PREFIX}{jti}");
        let mut conn = redis;
        match conn.exists(&key).await {
            Ok(exists) => exists,
            Err(e) => {
                warn!(error = %e, "redis jwt revoke check failed — fail open");
                false
            }
        }
    }

    pub async fn revoke_jti(&self, jti: &str, ttl_secs: u64) -> Result<(), String> {
        if jti.is_empty() {
            return Ok(());
        }
        let Some(redis) = self.redis.clone() else {
            return Ok(());
        };
        let key = format!("{REVOKED_PREFIX}{jti}");
        let mut conn = redis;
        conn.set_ex(&key, "1", ttl_secs.max(1))
            .await
            .map_err(|e| format!("redis revoke jti: {e}"))
    }
}

#[derive(Debug, Clone)]
pub struct TokenAuditInsert {
    pub jti: String,
    pub tenant_id: i64,
    pub subject: String,
    pub token_type: String,
    pub client_key_id: Option<i64>,
    pub user_id: Option<i64>,
    pub grant_type: String,
    pub scope: String,
    pub expires_at_unix: i64,
    pub source_ip: Option<String>,
    pub user_agent: Option<String>,
}

/// Lưu oauth_access_tokens
/// Đã lưu token
pub async fn insert_token_audit(pool: &PgPool, row: &TokenAuditInsert) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO oauth_access_tokens
         (jti, tenant_id, subject, token_type, client_key_id, user_id, grant_type, scope, expires_at, source_ip, user_agent)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, to_timestamp($9), $10, $11)
         ON CONFLICT (jti) DO NOTHING",
    )
    .bind(&row.jti)
    .bind(row.tenant_id)
    .bind(&row.subject)
    .bind(&row.token_type)
    .bind(row.client_key_id)
    .bind(row.user_id)
    .bind(&row.grant_type)
    .bind(&row.scope)
    .bind(row.expires_at_unix)
    .bind(&row.source_ip)
    .bind(&row.user_agent)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn mark_jti_revoked_db(pool: &PgPool, jti: &str) -> Result<(), sqlx::Error> {
    sqlx::query(
        "UPDATE oauth_access_tokens SET revoked_at = NOW() WHERE jti = $1 AND revoked_at IS NULL",
    )
    .bind(jti)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn mark_subject_tokens_revoked_db(
    pool: &PgPool,
    subject: &str,
) -> Result<u64, sqlx::Error> {
    let r = sqlx::query(
        "UPDATE oauth_access_tokens SET revoked_at = NOW() WHERE subject = $1 AND revoked_at IS NULL",
    )
    .bind(subject)
    .execute(pool)
    .await?;
    Ok(r.rows_affected())
}

#[derive(Debug, Clone, sqlx::FromRow, serde::Serialize)]
pub struct OAuthTokenAuditRow {
    pub jti: String,
    pub subject: String,
    pub token_type: String,
    pub grant_type: String,
    pub scope: String,
    pub issued_at: chrono::DateTime<chrono::Utc>,
    pub expires_at: chrono::DateTime<chrono::Utc>,
    pub revoked_at: Option<chrono::DateTime<chrono::Utc>>,
    pub source_ip: Option<String>,
    pub client_key_id: Option<i64>,
    pub user_id: Option<i64>,
}

pub async fn list_token_audit(
    pool: &PgPool,
    tenant_id: i64,
    active_only: bool,
    limit: i64,
) -> Result<Vec<OAuthTokenAuditRow>, sqlx::Error> {
    let lim = limit.clamp(1, 500);
    if active_only {
        sqlx::query_as::<_, OAuthTokenAuditRow>(
            "SELECT jti, subject, token_type, grant_type, scope, issued_at, expires_at, revoked_at, source_ip, client_key_id, user_id
             FROM oauth_access_tokens
             WHERE tenant_id = $1 AND revoked_at IS NULL AND expires_at > NOW()
             ORDER BY issued_at DESC
             LIMIT $2",
        )
        .bind(tenant_id)
        .bind(lim)
        .fetch_all(pool)
        .await
    } else {
        sqlx::query_as::<_, OAuthTokenAuditRow>(
            "SELECT jti, subject, token_type, grant_type, scope, issued_at, expires_at, revoked_at, source_ip, client_key_id, user_id
             FROM oauth_access_tokens
             WHERE tenant_id = $1
             ORDER BY issued_at DESC
             LIMIT $2",
        )
        .bind(tenant_id)
        .bind(lim)
        .fetch_all(pool)
        .await
    }
}

pub async fn fetch_token_expiry_by_jti(
    pool: &PgPool,
    jti: &str,
    tenant_id: i64,
) -> Result<Option<chrono::DateTime<chrono::Utc>>, sqlx::Error> {
    sqlx::query_scalar(
        "SELECT expires_at FROM oauth_access_tokens WHERE jti = $1 AND tenant_id = $2 LIMIT 1",
    )
    .bind(jti)
    .bind(tenant_id)
    .fetch_optional(pool)
    .await
}

pub async fn revoke_jti_by_id(
    pool: &PgPool,
    store: &TokenRevocationStore,
    jti: &str,
    ttl_secs: u64,
) -> Result<(), String> {
    if let Err(e) = mark_jti_revoked_db(pool, jti).await {
        error!(error = %e, jti, "mark jti revoked in db failed");
    }
    store.revoke_jti(jti, ttl_secs).await
}

pub async fn revoke_jti_full(
    pool: &PgPool,
    store: &TokenRevocationStore,
    jti: &str,
    ttl_secs: u64,
) -> Result<(), String> {
    revoke_jti_by_id(pool, store, jti, ttl_secs).await
}
