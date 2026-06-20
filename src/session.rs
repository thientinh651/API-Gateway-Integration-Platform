//! Admin browser session store — Redis-backed (pattern production-lite).
//!
//! - Session data tách khỏi RAM gateway, dùng chung HA
//! - Sliding TTL (touch mỗi request hợp lệ)
//! - Revalidate user từ PostgreSQL định kỳ (role/disable/password revoke)
//! - Index theo user_id để revoke all sessions

use redis::aio::ConnectionManager;
use redis::AsyncCommands;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};
use tracing::{error, warn};

pub const SESSION_COOKIE: &str = "gw_sid";
pub const SESSION_MAX_AGE_SECS: u64 = 86400;
const KEY_PREFIX: &str = "gw:session:";
const USER_INDEX_PREFIX: &str = "gw:user_sessions:";

pub fn db_recheck_secs() -> i64 {
    std::env::var("SESSION_DB_RECHECK_SECS")
        .ok()
        .and_then(|s| s.parse().ok())
        .filter(|&n| n > 0)
        .unwrap_or(60)
}

fn now_unix() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

pub fn now_unix_ts() -> i64 {
    now_unix()
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct SessionRecord {
    pub user_id: i64,
    pub username: String,
    /// Workspace sở hữu (tenant cá nhân).
    #[serde(default)]
    pub home_tenant_id: i64,
    /// Workspace đang thao tác (active) — tương thích field cũ `tenant_id`.
    pub tenant_id: i64,
    pub role: String,
    /// Unix timestamp — lần cuối đối chiếu dashboard_users.
    #[serde(default)]
    pub last_db_check: i64,
}

impl SessionRecord {
    pub fn normalize_legacy(&mut self) {
        if self.home_tenant_id <= 0 {
            self.home_tenant_id = self.tenant_id;
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SessionStoreStatus {
    Up,
    Down,
}

#[derive(Debug)]
pub enum SessionError {
    Unavailable,
    NotFound,
    InvalidData,
}

impl std::fmt::Display for SessionError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Unavailable => write!(f, "session store unavailable"),
            Self::NotFound => write!(f, "session not found"),
            Self::InvalidData => write!(f, "invalid session data"),
        }
    }
}

#[derive(Clone)]
pub struct SessionStore {
    redis: ConnectionManager,
}

impl SessionStore {
    pub async fn connect(redis_url: &str) -> Result<Self, redis::RedisError> {
        let client = redis::Client::open(redis_url)?;
        let redis = ConnectionManager::new(client).await?;
        Ok(Self { redis })
    }

    fn session_key(sid: &str) -> String {
        format!("{KEY_PREFIX}{sid}")
    }

    fn user_index_key(user_id: i64) -> String {
        format!("{USER_INDEX_PREFIX}{user_id}")
    }

    pub fn redis(&self) -> ConnectionManager {
        self.redis.clone()
    }

    pub async fn ping(&self) -> SessionStoreStatus {
        let mut conn = self.redis.clone();
        match redis::cmd("PING").query_async::<String>(&mut conn).await {
            Ok(_) => SessionStoreStatus::Up,
            Err(e) => {
                warn!(error = %e, "redis ping failed");
                SessionStoreStatus::Down
            }
        }
    }

    pub async fn get(&self, sid: &str) -> Result<Option<SessionRecord>, SessionError> {
        if sid.trim().is_empty() {
            return Err(SessionError::NotFound);
        }
        let mut conn = self.redis.clone();
        let raw: Option<String> = conn
            .get(Self::session_key(sid))
            .await
            .map_err(|e| {
                error!(error = %e, "redis session get failed");
                SessionError::Unavailable
            })?;
        let Some(json) = raw else {
            return Ok(None);
        };
        let mut rec: SessionRecord = serde_json::from_str(&json).map_err(|e| {
            error!(error = %e, "session json corrupt");
            SessionError::InvalidData
        })?;
        rec.normalize_legacy();
        Ok(Some(rec))
    }

    async fn set_raw(&self, sid: &str, record: &SessionRecord) -> Result<(), SessionError> {
        let json = serde_json::to_string(record).map_err(|_| SessionError::InvalidData)?;
        let mut conn = self.redis.clone();
        conn.set_ex(Self::session_key(sid), json, SESSION_MAX_AGE_SECS)
            .await
            .map_err(|e| {
                error!(error = %e, "redis session set failed");
                SessionError::Unavailable
            })
    }

    /// Tạo session mới + index theo user (login).
    pub async fn create(&self, sid: &str, mut record: SessionRecord) -> Result<(), SessionError> {
        record.last_db_check = now_unix();
        self.set_raw(sid, &record).await?;
        let mut conn = self.redis.clone();
        let idx = Self::user_index_key(record.user_id);
        redis::cmd("SADD")
            .arg(&idx)
            .arg(sid)
            .query_async::<()>(&mut conn)
            .await
            .map_err(|e| {
                error!(error = %e, "redis session index sadd failed");
                SessionError::Unavailable
            })?;
        redis::cmd("EXPIRE")
            .arg(&idx)
            .arg(SESSION_MAX_AGE_SECS as i64)
            .query_async::<()>(&mut conn)
            .await
            .map_err(|e| {
                error!(error = %e, "redis session index expire failed");
                SessionError::Unavailable
            })?;
        Ok(())
    }

    pub async fn save(&self, sid: &str, record: &SessionRecord) -> Result<(), SessionError> {
        self.set_raw(sid, record).await
    }

    pub async fn delete(&self, sid: &str) -> Result<(), SessionError> {
        let mut conn = self.redis.clone();
        conn.del(Self::session_key(sid)).await.map_err(|e| {
            error!(error = %e, "redis session delete failed");
            SessionError::Unavailable
        })
    }

    /// Xóa session + bỏ khỏi index user.
    pub async fn destroy(&self, sid: &str, user_id: i64) -> Result<(), SessionError> {
        self.delete(sid).await?;
        let mut conn = self.redis.clone();
        redis::cmd("SREM")
            .arg(Self::user_index_key(user_id))
            .arg(sid)
            .query_async::<()>(&mut conn)
            .await
            .map_err(|e| {
                error!(error = %e, "redis session index srem failed");
                SessionError::Unavailable
            })?;
        Ok(())
    }

    pub async fn destroy_by_sid(&self, sid: &str) -> Result<(), SessionError> {
        match self.get(sid).await? {
            Some(rec) => self.destroy(sid, rec.user_id).await,
            None => self.delete(sid).await,
        }
    }

    /// Logout mọi thiết bị / sau đổi mật khẩu / vô hiệu hóa user.
    pub async fn revoke_all_for_user(&self, user_id: i64) -> Result<(), SessionError> {
        let mut conn = self.redis.clone();
        let idx = Self::user_index_key(user_id);
        let sids: Vec<String> = conn.smembers(&idx).await.map_err(|e| {
            error!(error = %e, "redis smembers user sessions failed");
            SessionError::Unavailable
        })?;
        for sid in &sids {
            if let Err(e) = self.delete(sid).await {
                warn!(error = %e, user_id, "revoke session delete failed");
            }
        }
        redis::cmd("DEL")
            .arg(&idx)
            .query_async::<()>(&mut conn)
            .await
            .map_err(|e| {
                error!(error = %e, "redis del user session index failed");
                SessionError::Unavailable
            })?;
        Ok(())
    }

    /// Gia hạn TTL session (sliding window).
    pub async fn touch(&self, sid: &str) -> Result<(), SessionError> {
        let mut conn = self.redis.clone();
        redis::cmd("EXPIRE")
            .arg(Self::session_key(sid))
            .arg(SESSION_MAX_AGE_SECS as i64)
            .query_async::<()>(&mut conn)
            .await
            .map_err(|e| {
                error!(error = %e, "redis session touch failed");
                SessionError::Unavailable
            })
    }
}

pub fn redis_url_from_env() -> String {
    std::env::var("REDIS_URL")
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "redis://127.0.0.1:6379".into())
}

pub async fn init_session_store() -> Arc<SessionStore> {
    let url = redis_url_from_env();
    match SessionStore::connect(&url).await {
        Ok(store) => {
            tracing::info!(redis_url = %mask_redis_url(&url), "session store connected (redis)");
            Arc::new(store)
        }
        Err(e) => {
            panic!(
                "cannot connect Redis session store at {}: {e}. Set REDIS_URL or start redis.",
                mask_redis_url(&url)
            );
        }
    }
}

fn mask_redis_url(url: &str) -> String {
    if let Some(at) = url.find('@') {
        if let Some(scheme) = url.find("://") {
            return format!("{}://***@{}", &url[..scheme + 3], &url[at + 1..]);
        }
    }
    url.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn session_record_roundtrip_json() {
        let r = SessionRecord {
            user_id: 1,
            username: "admin".into(),
            tenant_id: 1,
            home_tenant_id: 1,
            role: "admin".into(),
            last_db_check: 1_700_000_000,
        };
        let j = serde_json::to_string(&r).unwrap();
        let back: SessionRecord = serde_json::from_str(&j).unwrap();
        assert_eq!(r, back);
    }

    #[test]
    fn legacy_session_json_without_last_db_check_defaults_zero() {
        let j = r#"{"user_id":1,"username":"a","tenant_id":1,"role":"admin"}"#;
        let back: SessionRecord = serde_json::from_str(j).unwrap();
        assert_eq!(back.last_db_check, 0);
    }
}
