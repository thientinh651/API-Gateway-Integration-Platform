//! OAuth 2.0 token endpoint + JWT access tokens (RFC 6749 / RFC 7519).
#![allow(dead_code)]

use jsonwebtoken::{Algorithm, DecodingKey, EncodingKey, Header, Validation, decode, encode};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;

use crate::db::{self, AdminUserRow, OAuthClientKey};

pub const TOKEN_TYPE_BEARER: &str = "Bearer";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GatewayClaims {
    pub sub: String,
    pub iss: String,
    pub exp: usize,
    pub iat: usize,
    pub tenant_id: i64,
    /// `user` (password grant) | `client` (client_credentials)
    pub token_type: String,
    #[serde(default)]
    pub client_key_id: i64,
    #[serde(default)]
    pub role: Option<String>,
    #[serde(default)]
    pub scope: String,
    /// JWT ID — revoke từng token qua Redis blacklist.
    #[serde(default)]
    pub jti: String,
    /// Token generation; bump trên client/user → vô hiệu mọi JWT cũ.
    #[serde(default)]
    pub tv: i32,
}

#[derive(Debug, Clone)]
pub struct IssuedToken {
    pub response: TokenResponse,
    pub claims: GatewayClaims,
    pub grant_type: &'static str,
}

#[derive(Debug, Serialize, Clone)]
pub struct TokenResponse {
    pub access_token: String,
    pub token_type: &'static str,
    pub expires_in: u64,
}

#[derive(Debug, Deserialize)]
pub struct OAuthTokenForm {
    pub grant_type: String,
    pub username: Option<String>,
    pub password: Option<String>,
    pub client_id: Option<String>,
    pub client_secret: Option<String>,
    pub code: Option<String>,
    pub redirect_uri: Option<String>,
    pub code_verifier: Option<String>,
}

#[derive(Debug)]
pub enum OAuthTokenError {
    UnsupportedGrant,
    InvalidClient,
    InvalidGrant,
    InvalidRequest(&'static str),
    Internal(String),
}

impl OAuthTokenError {
    pub fn status(&self) -> axum::http::StatusCode {
        use axum::http::StatusCode;
        match self {
            Self::UnsupportedGrant => StatusCode::BAD_REQUEST,
            Self::InvalidClient | Self::InvalidGrant => StatusCode::UNAUTHORIZED,
            Self::InvalidRequest(_) => StatusCode::BAD_REQUEST,
            Self::Internal(_) => StatusCode::INTERNAL_SERVER_ERROR,
        }
    }

    pub fn error_code(&self) -> &'static str {
        match self {
            Self::UnsupportedGrant => "unsupported_grant_type",
            Self::InvalidClient => "invalid_client",
            Self::InvalidGrant => "invalid_grant",
            Self::InvalidRequest(_) => "invalid_request",
            Self::Internal(_) => "server_error",
        }
    }

    pub fn message(&self) -> String {
        match self {
            Self::UnsupportedGrant => {
                "Supported grant_type: password, client_credentials, authorization_code".into()
            }
            Self::InvalidClient => "Invalid client_id or client_secret".into(),
            Self::InvalidGrant => "Invalid username, password, or revoked client".into(),
            Self::InvalidRequest(m) => (*m).into(),
            Self::Internal(m) => m.clone(),
        }
    }
}

#[derive(Debug)]
pub enum TokenValidationError {
    Missing,
    Malformed,
    Expired,
    InvalidIssuer,
    InvalidSignature,
    Revoked,
    StaleVersion,
}

pub fn jwt_secret_bytes() -> Vec<u8> {
    let raw = std::env::var("JWT_SECRET").unwrap_or_else(|_| {
        tracing::warn!("JWT_SECRET unset — using dev default; set in production");
        "dev-only-jwt-secret-change-me-min-32-chars!!".into()
    });
    raw.into_bytes()
}

pub fn jwt_expires_secs() -> u64 {
    std::env::var("JWT_EXPIRES_SECS")
        .ok()
        .and_then(|s| s.parse().ok())
        .filter(|&n| n > 0)
        .unwrap_or(3600)
}

pub fn jwt_issuer() -> String {
    std::env::var("JWT_ISSUER").unwrap_or_else(|_| "avaso-gateway".into())
}

fn now_unix() -> usize {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as usize)
        .unwrap_or(0)
}

fn new_jti() -> String {
    uuid::Uuid::new_v4().to_string()
}

fn encode_claims(claims: &GatewayClaims) -> Result<String, String> {
    encode(
        &Header::new(Algorithm::HS256),
        claims,
        &EncodingKey::from_secret(&jwt_secret_bytes()),
    )
    .map_err(|e| format!("jwt encode: {e}"))
}

pub fn issue_user_token(user: &AdminUserRow) -> Result<TokenResponse, String> {
    Ok(issue_user_token_with_version(user, user.token_version, "proxy:invoke")?.response)
}

pub fn issue_user_token_with_version(
    user: &AdminUserRow,
    token_version: i32,
    scope: &str,
) -> Result<IssuedToken, String> {
    if !user.is_active {
        return Err("account disabled".into());
    }
    let tenant_id = user.tenant_id.unwrap_or(1);
    let now = now_unix();
    let exp = now + jwt_expires_secs() as usize;
    let claims = GatewayClaims {
        sub: format!("user:{}", user.id),
        iss: jwt_issuer(),
        exp,
        iat: now,
        tenant_id,
        token_type: "user".into(),
        client_key_id: 0,
        role: Some(user.role.clone()),
        scope: scope.to_string(),
        jti: new_jti(),
        tv: token_version,
    };
    let access_token = encode_claims(&claims)?;
    Ok(IssuedToken {
        response: TokenResponse {
            access_token,
            token_type: TOKEN_TYPE_BEARER,
            expires_in: jwt_expires_secs(),
        },
        claims,
        grant_type: "password",
    })
}

pub fn issue_client_token(client: &OAuthClientKey) -> Result<TokenResponse, String> {
    Ok(issue_client_token_with_version(client)?.response)
}

/// Tạo JWT access token
pub fn issue_client_token_with_version(client: &OAuthClientKey) -> Result<IssuedToken, String> {
    issue_client_token_with_expires_secs(client, jwt_expires_secs())
}

pub fn issue_client_token_with_expires_secs(
    client: &OAuthClientKey,
    expires_secs: u64,
) -> Result<IssuedToken, String> {
    let now = now_unix();
    let exp = now + expires_secs as usize;
    // Tạo JWT access token
    let claims = GatewayClaims {
        sub: format!("client:{}", client.client_id),
        iss: jwt_issuer(),
        exp,
        iat: now,
        tenant_id: client.tenant_id,
        token_type: "client".into(),
        client_key_id: client.id,
        role: None,
        scope: "proxy:invoke".into(),
        jti: new_jti(),
        tv: client.token_version,
    };
    let access_token = encode_claims(&claims)?;
    Ok(IssuedToken {
        response: TokenResponse {
            access_token: access_token.clone(),
            token_type: TOKEN_TYPE_BEARER,
            expires_in: expires_secs,
        },
        claims,
        grant_type: "client_credentials",
    })
}

pub fn validate_access_token(token: &str) -> Result<GatewayClaims, TokenValidationError> {
    let token = token.trim();
    if token.is_empty() {
        return Err(TokenValidationError::Missing);
    }
    let mut validation = Validation::new(Algorithm::HS256);
    validation.set_issuer(&[jwt_issuer()]);
    validation.validate_exp = true;

    let data = decode::<GatewayClaims>(
        token,
        &DecodingKey::from_secret(&jwt_secret_bytes()),
        &validation,
    )
    .map_err(|e| {
        use jsonwebtoken::errors::ErrorKind;
        match e.kind() {
            ErrorKind::ExpiredSignature => TokenValidationError::Expired,
            ErrorKind::InvalidIssuer => TokenValidationError::InvalidIssuer,
            ErrorKind::InvalidSignature => TokenValidationError::InvalidSignature,
            _ => TokenValidationError::Malformed,
        }
    })?;
    Ok(data.claims)
}

/// Đổi grant lấy access token
pub async fn exchange_token(
    pool: &PgPool,
    creds: &db::ClientCredentials,
    form: OAuthTokenForm,
) -> Result<IssuedToken, OAuthTokenError> {
    let grant = form.grant_type.trim();
    match grant {
        "password" => password_grant(pool, form).await,
        "client_credentials" => client_credentials_grant(creds, form),
        "authorization_code" => authorization_code_grant(pool, form).await,
        // grant_type không hỗ trợ
        // 400 unsupported_grant_type
        _ => Err(OAuthTokenError::UnsupportedGrant),
    }
}

async fn authorization_code_grant(
    pool: &PgPool,
    form: OAuthTokenForm,
) -> Result<IssuedToken, OAuthTokenError> {
    let code = form
        .code
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or(OAuthTokenError::InvalidRequest("code required"))?;
    let client_id = form
        .client_id
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or(OAuthTokenError::InvalidRequest("client_id required"))?;
    let redirect_uri = form
        .redirect_uri
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or(OAuthTokenError::InvalidRequest("redirect_uri required"))?;
    let client_secret = form.client_secret.as_deref().unwrap_or("");
    let code_verifier = form
        .code_verifier
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or(OAuthTokenError::InvalidRequest(
            "code_verifier required (PKCE)",
        ))?;
    if !crate::pkce::valid_verifier(code_verifier) {
        return Err(OAuthTokenError::InvalidRequest("invalid code_verifier"));
    }

    let (response, claims) = crate::oauth_authorize::exchange_authorization_code(
        pool,
        code,
        client_id,
        client_secret,
        redirect_uri,
        code_verifier,
    )
    .await?;
    Ok(IssuedToken {
        response,
        claims,
        grant_type: "authorization_code",
    })
}

async fn password_grant(
    pool: &PgPool,
    form: OAuthTokenForm,
) -> Result<IssuedToken, OAuthTokenError> {
    let username = form
        .username
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or(OAuthTokenError::InvalidRequest("username required"))?;
    let password = form
        .password
        .as_deref()
        .ok_or(OAuthTokenError::InvalidRequest("password required"))?;

    let user = db::fetch_admin_user_by_username(pool, username)
        .await
        .map_err(|e| OAuthTokenError::Internal(format!("{e}")))?
        .ok_or(OAuthTokenError::InvalidGrant)?;

    if !db::verify_password(password, &user.password_hash) {
        return Err(OAuthTokenError::InvalidGrant);
    }

    issue_user_token_with_version(&user, user.token_version, "proxy:invoke")
        .map_err(OAuthTokenError::Internal)
}

/// Cấp token theo client_credentials
fn client_credentials_grant(
    creds: &db::ClientCredentials,
    form: OAuthTokenForm,
) -> Result<IssuedToken, OAuthTokenError> {
    let client_id = form
        .client_id
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        // Thiếu client_id hoặc client_secret
        // 400 invalid_request
        .ok_or(OAuthTokenError::InvalidRequest("client_id required"))?;
    let client_secret = form
        .client_secret
        .as_deref()
        // Thiếu client_id hoặc client_secret
        // 400 invalid_request
        .ok_or(OAuthTokenError::InvalidRequest("client_secret required"))?;

    if creds
        .disabled_clients
        .iter()
        .any(|c| c.client_id == client_id)
    {
        // Client bị khóa trong disabled_clients
        // 400 invalid_grant
        return Err(OAuthTokenError::InvalidGrant);
    }

    // Tìm client và so khớp secret_hash
    let client = creds
        .oauth_clients
        .iter()
        .find(|c| {
            c.client_id == client_id && db::verify_client_secret(client_secret, &c.secret_hash)
        })
        // Không tìm thấy client hoặc secret sai
        // 401 invalid_client
        .ok_or(OAuthTokenError::InvalidClient)?;

    // Client hợp lệ và secret đúng
    // Tạo JWT access token
    issue_client_token_with_version(client).map_err(OAuthTokenError::Internal)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn user_token_roundtrip() {
        let user = AdminUserRow {
            id: 42,
            username: "demo".into(),
            password_hash: String::new(),
            role: "operator".into(),
            tenant_id: Some(1),
            is_active: true,
            email: None,
            token_version: 0,
        };
        let issued = issue_user_token(&user).expect("issue");
        let claims = validate_access_token(&issued.access_token).expect("valid");
        assert_eq!(claims.token_type, "user");
        assert_eq!(claims.tenant_id, 1);
        assert_eq!(claims.sub, "user:42");
    }

    #[test]
    fn client_token_roundtrip() {
        let hash = db::hash_client_secret("avaso_csec_test").expect("hash");
        let client = OAuthClientKey {
            id: 7,
            client_id: "avaso_cid_test".into(),
            secret_hash: hash,
            tenant_id: 1,
            rate_limit_per_min: 100,
            allowed_route_ids: vec![1, 2],
            token_version: 0,
        };
        let issued = issue_client_token(&client).expect("issue");
        let claims = validate_access_token(&issued.access_token).expect("valid");
        assert_eq!(claims.token_type, "client");
        assert_eq!(claims.client_key_id, 7);
    }
}
