//! Token-bucket rate limiting — local DashMap + Redis (distributed when available).
#![allow(dead_code)]

use dashmap::DashMap;
use redis::Script;
use redis::aio::ConnectionManager;
use std::sync::Arc;
use std::time::{Instant, SystemTime, UNIX_EPOCH};
use tracing::warn;

use crate::db;

/// `POST /oauth/token` — theo client_id (khi có).
pub const OAUTH_TOKEN_CLIENT_PER_MIN: u32 = 20;

/// `POST /oauth/token` — theo IP nguồn.
pub const OAUTH_TOKEN_IP_PER_MIN: u32 = 50;

const RL_KEY_PREFIX: &str = "gw:rl:";
const RL_TTL_SECS: u64 = 120;

const TOKEN_BUCKET_LUA: &str = r#"
local key = KEYS[1]
local now = tonumber(ARGV[1])
local rps = tonumber(ARGV[2])
local burst = tonumber(ARGV[3])
local ttl = tonumber(ARGV[4])

local tokens_s = redis.call('HGET', key, 't')
local last_s = redis.call('HGET', key, 'l')
local tokens = tokens_s and tonumber(tokens_s) or burst
local last = last_s and tonumber(last_s) or now

local elapsed = now - last
if elapsed > 0 then
  tokens = math.min(burst, tokens + elapsed * rps)
end
last = now

if tokens >= 1 then
  tokens = tokens - 1
  redis.call('HSET', key, 't', tokens, 'l', last)
  redis.call('EXPIRE', key, ttl)
  return math.floor(tokens)
else
  redis.call('HSET', key, 't', tokens, 'l', last)
  redis.call('EXPIRE', key, ttl)
  local needed = 1 - tokens
  local retry = math.ceil(needed / rps)
  if retry < 1 then retry = 1 end
  return -retry
end
"#;

#[derive(Debug, Clone, Copy)]
pub struct RateLimitInfo {
    /// Giá trị hiển thị header Limit (req/phút hoặc RPS global).
    pub limit: u32,
    /// Token còn lại trong bucket sau thao tác.
    pub remaining: u32,
    /// Unix timestamp khi bucket đầy lại / token kế tiếp.
    pub reset_unix: u64,
}

#[derive(Debug, Clone, Copy)]
pub enum ConsumeOutcome {
    Allowed(RateLimitInfo),
    Denied {
        info: RateLimitInfo,
        retry_after_secs: u64,
    },
}

#[derive(Debug, Clone)]
struct TokenBucket {
    tokens: f64,
    last_refill: Instant,
}

impl TokenBucket {
    fn new(now: Instant, burst: u32) -> Self {
        Self {
            tokens: burst as f64,
            last_refill: now,
        }
    }

    fn take(&mut self, now: Instant, rps: f64, burst: u32) -> bool {
        let elapsed = now.duration_since(self.last_refill);
        let refill = elapsed.as_secs_f64() * rps;
        self.tokens = (self.tokens + refill).min(burst as f64);
        self.last_refill = now;
        if self.tokens >= 1.0 {
            self.tokens -= 1.0;
            true
        } else {
            false
        }
    }

    fn retry_after_secs(&self, rps: f64) -> u64 {
        if self.tokens >= 1.0 {
            return 1;
        }
        let needed = 1.0 - self.tokens;
        let secs = if rps > 0.0 { needed / rps } else { 60.0 };
        secs.ceil().max(1.0) as u64
    }
}

fn now_unix_f64() -> f64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs_f64())
        .unwrap_or(0.0)
}

fn reset_unix_when_full(now: f64, tokens: f64, rps: f64, burst: u32) -> u64 {
    if tokens >= burst as f64 {
        return now as u64;
    }
    let needed = burst as f64 - tokens;
    let secs = if rps > 0.0 { needed / rps } else { 60.0 };
    (now + secs.ceil()).max(now + 1.0) as u64
}

fn info_from_bucket(limit_header: u32, remaining_floor: u32, reset_unix: u64) -> RateLimitInfo {
    RateLimitInfo {
        limit: limit_header,
        remaining: remaining_floor,
        reset_unix,
    }
}

/// Chuyển req/phút → (rps, burst tính toán). Burst = max(1, per_min/10), capped bởi per_min.
pub fn per_min_to_bucket(per_min: i32) -> (f64, u32) {
    let per_min = per_min.max(1) as u32;
    let burst = (per_min / 10).max(1).min(per_min);
    (per_min as f64 / 60.0, burst)
}

/// Áp chế độ burst toàn hệ thống (Settings → burst_enabled).
pub fn effective_burst(calculated_burst: u32, burst_enabled: bool) -> u32 {
    if burst_enabled {
        calculated_burst.max(1)
    } else {
        1
    }
}

/// Token endpoint — burst = quota phút (không áp BURST_FLOOR=3).
/// Tránh chặn nhầm khi test/refresh token liên tiếp; vẫn giới hạn theo phút.
pub fn oauth_token_bucket(per_min: i32) -> (f64, u32) {
    let per_min = per_min.max(1) as u32;
    (per_min as f64 / 60.0, per_min)
}

pub fn bucket_key(tenant_id: i64, scope: &str, subject: &str) -> String {
    let key_part = if subject.is_empty() {
        "anon".to_string()
    } else {
        db::sha256_hex(subject)
    };
    format!("{tenant_id}:{scope}:{key_part}")
}

#[derive(Clone)]
pub struct RateLimiter {
    local: Arc<DashMap<String, TokenBucket>>,
    redis: Option<ConnectionManager>,
}

impl RateLimiter {
    pub fn new(redis: ConnectionManager) -> Self {
        Self {
            local: Arc::new(DashMap::new()),
            redis: Some(redis),
        }
    }

    #[cfg(test)]
    fn local_only() -> Self {
        Self {
            local: Arc::new(DashMap::new()),
            redis: None,
        }
    }

    fn redis_key(key: &str) -> String {
        format!("{RL_KEY_PREFIX}{}", db::sha256_hex(key))
    }

    async fn try_consume_redis(
        &self,
        redis: &ConnectionManager,
        key: &str,
        rps: f64,
        burst: u32,
        limit_header: u32,
    ) -> Option<ConsumeOutcome> {
        let now = now_unix_f64();
        let redis_key = Self::redis_key(key);
        let script = Script::new(TOKEN_BUCKET_LUA);
        let mut conn = redis.clone();
        let result: Result<i64, redis::RedisError> = script
            .key(&redis_key)
            .arg(now)
            .arg(rps)
            .arg(burst)
            .arg(RL_TTL_SECS)
            .invoke_async(&mut conn)
            .await;
        match result {
            Ok(v) if v >= 0 => Some(ConsumeOutcome::Allowed(info_from_bucket(
                limit_header,
                v as u32,
                reset_unix_when_full(now, v as f64, rps, burst),
            ))),
            Ok(v) => {
                let retry = v.unsigned_abs().max(1);
                Some(ConsumeOutcome::Denied {
                    info: info_from_bucket(limit_header, 0, (now as u64) + retry),
                    retry_after_secs: retry,
                })
            }
            Err(e) => {
                warn!(error = %e, key, "redis rate limit failed — fallback local");
                None
            }
        }
    }

    fn try_consume_local(
        &self,
        key: &str,
        rps: f64,
        burst: u32,
        limit_header: u32,
    ) -> ConsumeOutcome {
        let now = Instant::now();
        let now_unix = now_unix_f64();
        let mut entry = self
            .local
            .entry(key.to_string())
            .or_insert_with(|| TokenBucket::new(now, burst));
        let bucket = entry.value_mut();
        if bucket.take(now, rps, burst) {
            let remaining = bucket.tokens.floor() as u32;
            ConsumeOutcome::Allowed(info_from_bucket(
                limit_header,
                remaining,
                reset_unix_when_full(now_unix, bucket.tokens, rps, burst),
            ))
        } else {
            let retry = bucket.retry_after_secs(rps);
            ConsumeOutcome::Denied {
                info: info_from_bucket(limit_header, 0, now_unix as u64 + retry),
                retry_after_secs: retry,
            }
        }
    }

    /// Tiêu thụ 1 token. Redis trước; lỗi Redis → local bucket.
    pub async fn try_consume(
        &self,
        key: &str,
        rps: f64,
        burst: u32,
        limit_header: u32,
    ) -> ConsumeOutcome {
        if let Some(redis) = self.redis.as_ref() {
            if let Some(res) = self
                .try_consume_redis(redis, key, rps, burst, limit_header)
                .await
            {
                return res;
            }
        }
        self.try_consume_local(key, rps, burst, limit_header)
    }

    pub async fn try_consume_per_min(&self, key: &str, per_min: u32) -> ConsumeOutcome {
        let (rps, burst) = per_min_to_bucket(per_min as i32);
        self.try_consume(key, rps, burst, per_min).await
    }

    /// Rate limit cho `POST /oauth/token` — IP + client_id (nếu có).
    pub async fn check_oauth_token_endpoint(
        &self,
        client_id: Option<&str>,
        ip: Option<&str>,
    ) -> Result<(), u64> {
        if let Some(ip) = ip.map(str::trim).filter(|s| !s.is_empty()) {
            let key = format!("oauth:token:ip:{}", db::sha256_hex(ip));
            let (rps, burst) = oauth_token_bucket(OAUTH_TOKEN_IP_PER_MIN as i32);
            if let ConsumeOutcome::Denied {
                retry_after_secs, ..
            } = self
                .try_consume(&key, rps, burst, OAUTH_TOKEN_IP_PER_MIN)
                .await
            {
                return Err(retry_after_secs);
            }
        }
        if let Some(cid) = client_id.map(str::trim).filter(|s| !s.is_empty()) {
            let key = format!("oauth:token:client:{}", db::sha256_hex(cid));
            let (rps, burst) = oauth_token_bucket(OAUTH_TOKEN_CLIENT_PER_MIN as i32);
            if let ConsumeOutcome::Denied {
                retry_after_secs, ..
            } = self
                .try_consume(&key, rps, burst, OAUTH_TOKEN_CLIENT_PER_MIN)
                .await
            {
                return Err(retry_after_secs);
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[test]
    fn per_min_burst_scales() {
        let (_, burst10) = per_min_to_bucket(10);
        assert_eq!(burst10, 1);
        let (_, burst60) = per_min_to_bucket(60);
        assert_eq!(burst60, 6);
        let (_, burst100) = per_min_to_bucket(100);
        assert_eq!(burst100, 10);
        let (_, burst2) = per_min_to_bucket(2);
        assert_eq!(burst2, 1);
    }

    #[test]
    fn effective_burst_modes() {
        assert_eq!(effective_burst(10, true), 10);
        assert_eq!(effective_burst(10, false), 1);
        assert_eq!(effective_burst(0, true), 1);
    }

    #[test]
    fn token_bucket_allows_burst_then_limits() {
        let start = Instant::now();
        let mut bucket = TokenBucket::new(start, 2);
        assert!(bucket.take(start, 100.0, 2));
        assert!(bucket.take(start, 100.0, 2));
        assert!(!bucket.take(start, 100.0, 2));
        let later = start + Duration::from_secs(1);
        assert!(bucket.take(later, 1.0, 2));
    }

    #[tokio::test]
    async fn oauth_token_endpoint_limits_local() {
        let rl = RateLimiter::local_only();
        let ip = "203.0.113.99";
        let (_, burst) = oauth_token_bucket(OAUTH_TOKEN_IP_PER_MIN as i32);
        for _ in 0..burst {
            rl.check_oauth_token_endpoint(None, Some(ip))
                .await
                .expect("under burst");
        }
        assert!(rl.check_oauth_token_endpoint(None, Some(ip)).await.is_err());
    }

    #[test]
    fn oauth_token_bucket_allows_full_minute_burst() {
        let (_, burst) = oauth_token_bucket(20);
        assert_eq!(burst, 20);
        let (_, burst50) = oauth_token_bucket(50);
        assert_eq!(burst50, 50);
    }
}
