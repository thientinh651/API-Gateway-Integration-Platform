//! OTP quên mật khẩu — Redis + SMTP (tuỳ chọn).

use redis::aio::ConnectionManager;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tracing::{info, warn};

const OTP_TTL_SECS: u64 = 600;
const TICKET_TTL_SECS: u64 = 600;
const RATE_LIMIT_SECS: u64 = 900;
const MAX_SEND_PER_WINDOW: i64 = 5;
const MAX_VERIFY_ATTEMPTS: u32 = 5;

#[derive(Debug, Serialize, Deserialize)]
struct OtpRecord {
    user_id: i64,
    otp_hash: String,
    attempts: u32,
}

fn otp_hash(username: &str, otp: &str) -> String {
    let mut h = Sha256::new();
    h.update(username.trim().to_ascii_lowercase().as_bytes());
    h.update(b":");
    h.update(otp.as_bytes());
    hex::encode(h.finalize())
}

fn redis_key(username: &str) -> String {
    format!("gw:pwdreset:{}", username.trim().to_ascii_lowercase())
}

fn rate_key(username: &str) -> String {
    format!("gw:pwdreset:rate:{}", username.trim().to_ascii_lowercase())
}

pub fn generate_otp() -> String {
    format!("{:06}", rand::random::<u32>() % 1_000_000)
}

pub fn normalize_email(raw: &str) -> Option<String> {
    let e = raw.trim().to_ascii_lowercase();
    if e.is_empty() || e.len() > 254 {
        return None;
    }
    let (local, domain) = e.split_once('@')?;
    if local.is_empty()
        || domain.is_empty()
        || local.contains(' ')
        || domain.contains(' ')
        || !domain.contains('.')
        || domain.starts_with('.')
        || domain.ends_with('.')
    {
        return None;
    }
    Some(e)
}

pub fn password_reset_dev_log() -> bool {
    std::env::var("PASSWORD_RESET_DEV_LOG")
        .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
        .unwrap_or(false)
}

pub fn brevo_configured() -> bool {
    std::env::var("BREVO_API_KEY")
        .map(|k| !k.trim().is_empty())
        .unwrap_or(false)
}

pub fn smtp_configured() -> bool {
    let host = std::env::var("SMTP_HOST").unwrap_or_default();
    let user = std::env::var("SMTP_USER").unwrap_or_default();
    let pass = std::env::var("SMTP_PASS").unwrap_or_default();
    !host.trim().is_empty() && !user.trim().is_empty() && !pass.trim().is_empty()
}

/// `email` | `dev_log` | `none`
pub fn otp_delivery_mode() -> &'static str {
    if brevo_configured() || smtp_configured() {
        "email"
    } else if password_reset_dev_log() {
        "dev_log"
    } else {
        "none"
    }
}

pub fn mask_email(email: &str) -> String {
    let e = email.trim();
    let Some((local, domain)) = e.split_once('@') else {
        return "***".into();
    };
    if local.is_empty() || domain.is_empty() {
        return "***".into();
    }
    let head: String = local.chars().take(2).collect();
    format!("{head}***@{domain}")
}

fn ticket_key(token: &str) -> String {
    format!("gw:pwdreset:ticket:{}", token.trim())
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ResetTicket {
    pub user_id: i64,
    pub username: String,
}

async fn redis_incr_rate(conn: &mut ConnectionManager, username: &str) -> Result<bool, redis::RedisError> {
    let key = rate_key(username);
    let n: i64 = redis::cmd("INCR").arg(&key).query_async(conn).await?;
    if n == 1 {
        let _: () = redis::cmd("EXPIRE")
            .arg(&key)
            .arg(RATE_LIMIT_SECS)
            .query_async(conn)
            .await?;
    }
    Ok(n <= MAX_SEND_PER_WINDOW)
}

pub async fn store_otp(
    conn: &mut ConnectionManager,
    username: &str,
    user_id: i64,
    otp: &str,
) -> Result<(), redis::RedisError> {
    let rec = OtpRecord {
        user_id,
        otp_hash: otp_hash(username, otp),
        attempts: 0,
    };
    let payload = serde_json::to_string(&rec).unwrap_or_default();
    let key = redis_key(username);
    let _: () = redis::cmd("SETEX")
        .arg(&key)
        .arg(OTP_TTL_SECS)
        .arg(payload)
        .query_async(conn)
        .await?;
    Ok(())
}

pub enum VerifyOtpResult {
    Ok(i64),
    NotFound,
    WrongOtp,
    TooManyAttempts,
}

pub async fn verify_otp(
    conn: &mut ConnectionManager,
    username: &str,
    otp: &str,
) -> Result<VerifyOtpResult, redis::RedisError> {
    let key = redis_key(username);
    let raw: Option<String> = redis::cmd("GET").arg(&key).query_async(conn).await?;
    let Some(raw) = raw else {
        return Ok(VerifyOtpResult::NotFound);
    };
    let mut rec: OtpRecord = serde_json::from_str(&raw).unwrap_or(OtpRecord {
        user_id: 0,
        otp_hash: String::new(),
        attempts: 0,
    });
    if rec.attempts >= MAX_VERIFY_ATTEMPTS {
        let _: () = redis::cmd("DEL").arg(&key).query_async(conn).await?;
        return Ok(VerifyOtpResult::TooManyAttempts);
    }
    if rec.otp_hash != otp_hash(username, otp) {
        rec.attempts += 1;
        let payload = serde_json::to_string(&rec).unwrap_or_default();
        let ttl: i64 = redis::cmd("TTL").arg(&key).query_async(conn).await?;
        let ttl = if ttl > 0 { ttl as u64 } else { OTP_TTL_SECS };
        let _: () = redis::cmd("SETEX")
            .arg(&key)
            .arg(ttl)
            .arg(payload)
            .query_async(conn)
            .await?;
        return Ok(VerifyOtpResult::WrongOtp);
    }
    let _: () = redis::cmd("DEL").arg(&key).query_async(conn).await?;
    Ok(VerifyOtpResult::Ok(rec.user_id))
}

/// Xác minh OTP → phát reset_token (Redis TTL 10 phút), xóa OTP.
pub async fn verify_otp_and_create_ticket(
    conn: &mut ConnectionManager,
    username: &str,
    otp: &str,
) -> Result<Result<String, VerifyOtpResult>, redis::RedisError> {
    match verify_otp(conn, username, otp).await? {
        VerifyOtpResult::Ok(user_id) => {
            let token = uuid::Uuid::new_v4().to_string();
            let ticket = ResetTicket {
                user_id,
                username: username.trim().to_string(),
            };
            let payload = serde_json::to_string(&ticket).unwrap_or_default();
            let _: () = redis::cmd("SETEX")
                .arg(ticket_key(&token))
                .arg(TICKET_TTL_SECS)
                .arg(payload)
                .query_async(conn)
                .await?;
            Ok(Ok(token))
        }
        other => Ok(Err(other)),
    }
}

pub async fn consume_reset_ticket(
    conn: &mut ConnectionManager,
    token: &str,
) -> Result<Option<ResetTicket>, redis::RedisError> {
    let key = ticket_key(token);
    let raw: Option<String> = redis::cmd("GET").arg(&key).query_async(conn).await?;
    let Some(raw) = raw else {
        return Ok(None);
    };
    let _: () = redis::cmd("DEL").arg(&key).query_async(conn).await?;
    let ticket: ResetTicket = serde_json::from_str(&raw).unwrap_or(ResetTicket {
        user_id: 0,
        username: String::new(),
    });
    if ticket.user_id <= 0 || ticket.username.is_empty() {
        return Ok(None);
    }
    Ok(Some(ticket))
}

pub async fn issue_password_reset_otp(
    conn: &mut ConnectionManager,
    username: &str,
    user_id: i64,
    email: &str,
) -> Result<(), PasswordResetError> {
    let allowed = redis_incr_rate(conn, username)
        .await
        .map_err(|e| {
            warn!(error = %e, "redis rate limit failed");
            PasswordResetError::MailUnavailable
        })?;
    if !allowed {
        return Err(PasswordResetError::RateLimited);
    }
    let otp = generate_otp();
    store_otp(conn, username, user_id, &otp)
        .await
        .map_err(|e| {
            warn!(error = %e, "redis store otp failed");
            PasswordResetError::MailUnavailable
        })?;
    if brevo_configured() {
        send_otp_via_brevo(email, username, &otp).await?;
    } else if smtp_configured() {
        send_otp_email(email, username, &otp).await?;
    } else if password_reset_dev_log() {
        info!(
            username = %username,
            email = %email,
            otp = %otp,
            "PASSWORD_RESET_DEV_LOG: OTP (chưa cấu hình Brevo/SMTP)"
        );
    } else {
        warn!(username = %username, "password reset: Brevo/SMTP và DEV_LOG đều tắt — OTP không gửi được");
        return Err(PasswordResetError::MailUnavailable);
    }
    Ok(())
}

#[derive(Debug)]
pub enum PasswordResetError {
    RateLimited,
    MailUnavailable,
    MailSend(String),
}

impl std::fmt::Display for PasswordResetError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::RateLimited => write!(f, "rate limited"),
            Self::MailUnavailable => write!(f, "mail unavailable"),
            Self::MailSend(e) => write!(f, "mail send: {e}"),
        }
    }
}

fn otp_email_body(username: &str, otp: &str) -> String {
    format!(
        "Xin chào {username},\n\nMã OTP đặt lại mật khẩu AVASO Gateway: {otp}\n\nMã có hiệu lực 10 phút. Nếu không yêu cầu, bỏ qua email này.\n"
    )
}

pub async fn send_otp_via_brevo(to: &str, username: &str, otp: &str) -> Result<(), PasswordResetError> {
    let api_key = std::env::var("BREVO_API_KEY").unwrap_or_default();

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| PasswordResetError::MailSend(e.to_string()))?;

    let body = if let Some(template_id) = std::env::var("BREVO_TEMPLATE_ID")
        .ok()
        .and_then(|s| s.trim().parse::<u64>().ok())
    {
        serde_json::json!({
            "to": [{ "email": to }],
            "templateId": template_id,
            "params": {
                "OTP": otp,
                "USERNAME": username,
            },
        })
    } else {
        let from_email = std::env::var("BREVO_FROM_EMAIL").unwrap_or_default();
        let from_name = std::env::var("BREVO_FROM_NAME").unwrap_or_else(|_| "AVASO Gateway".into());
        if from_email.trim().is_empty() {
            return Err(PasswordResetError::MailSend(
                "BREVO_FROM_EMAIL hoặc BREVO_TEMPLATE_ID cần được cấu hình".into(),
            ));
        }
        serde_json::json!({
            "sender": { "name": from_name, "email": from_email },
            "to": [{ "email": to }],
            "subject": "AVASO Gateway — mã OTP đặt lại mật khẩu",
            "textContent": otp_email_body(username, otp),
        })
    };

    let resp = client
        .post("https://api.brevo.com/v3/smtp/email")
        .header("api-key", api_key)
        .header("accept", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| PasswordResetError::MailSend(e.to_string()))?;

    if resp.status().is_success() {
        return Ok(());
    }
    let status = resp.status();
    let detail = resp.text().await.unwrap_or_default();
    Err(PasswordResetError::MailSend(format!("Brevo {status}: {detail}")))
}

pub async fn send_otp_email(to: &str, username: &str, otp: &str) -> Result<(), PasswordResetError> {
    use lettre::message::header::ContentType;
    use lettre::message::Mailbox;
    use lettre::transport::smtp::authentication::Credentials;
    use lettre::transport::smtp::Error as SmtpError;
    use lettre::{AsyncSmtpTransport, AsyncTransport, Message, Tokio1Executor};

    let host = std::env::var("SMTP_HOST").unwrap_or_default();
    let port: u16 = std::env::var("SMTP_PORT")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(587);
    let user = std::env::var("SMTP_USER").unwrap_or_default();
    let pass = std::env::var("SMTP_PASS").unwrap_or_default();
    let from_addr = std::env::var("SMTP_FROM")
        .unwrap_or_else(|_| "noreply@avaso-gateway.local".into());

    let from: Mailbox = from_addr.parse().map_err(|e| PasswordResetError::MailSend(format!("{e}")))?;
    let to_mb: Mailbox = to.parse().map_err(|e| PasswordResetError::MailSend(format!("{e}")))?;

    let body = otp_email_body(username, otp);

    let email = Message::builder()
        .from(from)
        .to(to_mb)
        .subject("AVASO Gateway — mã OTP đặt lại mật khẩu")
        .header(ContentType::TEXT_PLAIN)
        .body(body)
        .map_err(|e| PasswordResetError::MailSend(e.to_string()))?;

    let mailer: AsyncSmtpTransport<Tokio1Executor> = if user.is_empty() {
        AsyncSmtpTransport::<Tokio1Executor>::builder_dangerous(&host)
            .port(port)
            .build()
    } else {
        AsyncSmtpTransport::<Tokio1Executor>::relay(&host)
            .map_err(|e| PasswordResetError::MailSend(e.to_string()))?
            .port(port)
            .credentials(Credentials::new(user, pass))
            .build()
    };

    mailer
        .send(email)
        .await
        .map_err(|e: SmtpError| PasswordResetError::MailSend(e.to_string()))?;
    Ok(())
}
