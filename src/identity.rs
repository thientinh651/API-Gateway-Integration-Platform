//! OAuth 2.0 token endpoint + JWT access tokens (RFC 6749 / RFC 7519).

use jsonwebtoken::{decode, encode, Algorithm, DecodingKey, EncodingKey, Header, Validation};
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
}

#[derive(Debug, Serialize)]
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
                "Supported grant_type: password, client_credentials".into()
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

fn encode_claims(claims: &GatewayClaims) -> Result<String, String> {
    encode(
        &Header::new(Algorithm::HS256),
        claims,
        &EncodingKey::from_secret(&jwt_secret_bytes()),
    )
    .map_err(|e| format!("jwt encode: {e}"))
}

pub fn issue_user_token(user: &AdminUserRow) -> Result<TokenResponse, String> {
    if user.is_active == 0 {
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
        scope: "proxy:invoke".into(),
    };
    let access_token = encode_claims(&claims)?;
    Ok(TokenResponse {
        access_token,
        token_type: TOKEN_TYPE_BEARER,
        expires_in: jwt_expires_secs(),
    })
}

pub fn issue_client_token(client: &OAuthClientKey) -> Result<TokenResponse, String> {
    let now = now_unix();
    let exp = now + jwt_expires_secs() as usize;
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
    };
    let access_token = encode_claims(&claims)?;
    Ok(TokenResponse {
        access_token,
        token_type: TOKEN_TYPE_BEARER,
        expires_in: jwt_expires_secs(),
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

pub async fn exchange_token(
    pool: &PgPool,
    creds: &db::ClientCredentials,
    form: OAuthTokenForm,
) -> Result<TokenResponse, OAuthTokenError> {
    let grant = form.grant_type.trim();
    match grant {
        "password" => password_grant(pool, form).await,
        "client_credentials" => client_credentials_grant(creds, form),
        _ => Err(OAuthTokenError::UnsupportedGrant),
    }
}

async fn password_grant(pool: &PgPool, form: OAuthTokenForm) -> Result<TokenResponse, OAuthTokenError> {
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

    issue_user_token(&user).map_err(OAuthTokenError::Internal)
}

fn client_credentials_grant(
    creds: &db::ClientCredentials,
    form: OAuthTokenForm,
) -> Result<TokenResponse, OAuthTokenError> {
    let client_id = form
        .client_id
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or(OAuthTokenError::InvalidRequest("client_id required"))?;
    let client_secret = form
        .client_secret
        .as_deref()
        .ok_or(OAuthTokenError::InvalidRequest("client_secret required"))?;

    if creds
        .disabled_clients
        .iter()
        .any(|c| c.client_id == client_id)
    {
        return Err(OAuthTokenError::InvalidGrant);
    }

    let client = creds
        .oauth_clients
        .iter()
        .find(|c| c.client_id == client_id && c.secret == client_secret)
        .ok_or(OAuthTokenError::InvalidClient)?;

    issue_client_token(client).map_err(OAuthTokenError::Internal)
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
            is_active: 1,
            email: None,
        };
        let issued = issue_user_token(&user).expect("issue");
        let claims = validate_access_token(&issued.access_token).expect("valid");
        assert_eq!(claims.token_type, "user");
        assert_eq!(claims.tenant_id, 1);
        assert_eq!(claims.sub, "user:42");
    }

    #[test]
    fn client_token_roundtrip() {
        let client = OAuthClientKey {
            id: 7,
            client_id: "avaso_pk_test".into(),
            secret: "avaso_sk_test".into(),
            tenant_id: 1,
            rate_limit_per_min: 100,
            allowed_route_ids: vec![1, 2],
        };
        let issued = issue_client_token(&client).expect("issue");
        let claims = validate_access_token(&issued.access_token).expect("valid");
        assert_eq!(claims.token_type, "client");
        assert_eq!(claims.client_key_id, 7);
    }
}
