//! Data-plane Bearer JWT validation.

use axum::http::{HeaderMap, StatusCode};

use crate::db::ClientCredentials;
use crate::identity::{self, TokenValidationError};
use crate::oauth_tokens::TokenRevocationStore;

#[derive(Debug, Clone)]
pub struct VerifiedClient {
    pub key_id: i64,
    pub tenant_id: i64,
    pub rate_limit_per_min: i32,
    pub allowed_route_ids: Vec<i64>,
    pub subject: String,
    pub token_type: String,
}

#[derive(Debug)]
pub enum TokenAuthFail {
    NoClientsConfigured,
    MissingToken,
    MalformedToken,
    ExpiredToken,
    InvalidIssuer,
    InvalidSignature,
    RevokedToken,
    StaleTokenVersion,
    ClientDisabled,
    ClientNotFound,
}

pub fn bearer_from_headers(headers: &HeaderMap) -> Option<String> {
    let auth = headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .trim();
    if auth.len() > 7 && auth[..7].eq_ignore_ascii_case("bearer ") {
        let token = auth[7..].trim();
        if !token.is_empty() {
            return Some(token.to_string());
        }
    }
    None
}

pub async fn verify_bearer(
    creds: &ClientCredentials,
    store: &TokenRevocationStore,
    token: &str,
) -> Result<VerifiedClient, TokenAuthFail> {
    let claims = identity::validate_access_token(token).map_err(|e| match e {
        TokenValidationError::Missing => TokenAuthFail::MissingToken,
        TokenValidationError::Malformed => TokenAuthFail::MalformedToken,
        TokenValidationError::Expired => TokenAuthFail::ExpiredToken,
        TokenValidationError::InvalidIssuer => TokenAuthFail::InvalidIssuer,
        TokenValidationError::InvalidSignature => TokenAuthFail::InvalidSignature,
        TokenValidationError::Revoked => TokenAuthFail::RevokedToken,
        TokenValidationError::StaleVersion => TokenAuthFail::StaleTokenVersion,
    })?;

    if !claims.jti.is_empty() && store.is_revoked(&claims.jti).await {
        return Err(TokenAuthFail::RevokedToken);
    }

    match claims.token_type.as_str() {
        "client" => verify_client_claims(creds, &claims),
        "user" => verify_user_claims(creds, &claims),
        _ => Err(TokenAuthFail::MalformedToken),
    }
}

fn verify_user_claims(
    creds: &ClientCredentials,
    claims: &identity::GatewayClaims,
) -> Result<VerifiedClient, TokenAuthFail> {
    let user_id = claims
        .sub
        .strip_prefix("user:")
        .and_then(|s| s.parse::<i64>().ok())
        .unwrap_or(0);
    let current = creds.user_token_versions.get(&user_id).copied().unwrap_or(0);
    if claims.tv != current {
        return Err(TokenAuthFail::StaleTokenVersion);
    }
    Ok(VerifiedClient {
        key_id: 0,
        tenant_id: claims.tenant_id,
        rate_limit_per_min: 0,
        allowed_route_ids: vec![],
        subject: claims.sub.clone(),
        token_type: "user".into(),
    })
}

fn verify_client_claims(
    creds: &ClientCredentials,
    claims: &identity::GatewayClaims,
) -> Result<VerifiedClient, TokenAuthFail> {
    let client_id = claims.sub.strip_prefix("client:").unwrap_or("");
    if creds
        .disabled_clients
        .iter()
        .any(|c| c.client_id == client_id)
    {
        return Err(TokenAuthFail::ClientDisabled);
    }

    let client = creds
        .oauth_clients
        .iter()
        .find(|c| c.id == claims.client_key_id || c.client_id == client_id)
        .ok_or(TokenAuthFail::ClientNotFound)?;

    if claims.tv != client.token_version {
        return Err(TokenAuthFail::StaleTokenVersion);
    }

    Ok(VerifiedClient {
        key_id: client.id,
        tenant_id: client.tenant_id,
        rate_limit_per_min: client.rate_limit_per_min,
        allowed_route_ids: client.allowed_route_ids.clone(),
        subject: claims.sub.clone(),
        token_type: "client".into(),
    })
}

pub fn client_allows_route(client: &VerifiedClient, route: &crate::RouteRow) -> bool {
    if client.tenant_id != route.tenant_id {
        return false;
    }
    if client.allowed_route_ids.is_empty() {
        return true;
    }
    client.allowed_route_ids.contains(&route.id)
}

pub fn identity_for_log(creds: &ClientCredentials, subject: &str) -> (Option<i64>, Option<i64>) {
    if subject.is_empty() {
        return (None, None);
    }
    if let Some(client_id) = subject.strip_prefix("client:") {
        if let Some(c) = creds.oauth_clients.iter().find(|c| c.client_id == client_id) {
            return (Some(c.id), Some(c.tenant_id));
        }
        if let Some(c) = creds
            .disabled_clients
            .iter()
            .find(|c| c.client_id == client_id)
        {
            return (Some(c.id), Some(c.tenant_id));
        }
    }
    (None, None)
}

pub fn token_auth_to_response(err: TokenAuthFail) -> (StatusCode, &'static str, &'static str) {
    match err {
        TokenAuthFail::NoClientsConfigured => (
            StatusCode::SERVICE_UNAVAILABLE,
            "service_unavailable",
            "No OAuth clients configured; register a client or use a user token",
        ),
        TokenAuthFail::MissingToken => (
            StatusCode::UNAUTHORIZED,
            "missing_token",
            "Missing Authorization: Bearer token",
        ),
        TokenAuthFail::MalformedToken => (
            StatusCode::UNAUTHORIZED,
            "invalid_token",
            "Malformed or unsupported access token",
        ),
        TokenAuthFail::ExpiredToken => (
            StatusCode::UNAUTHORIZED,
            "token_expired",
            "Access token expired",
        ),
        TokenAuthFail::InvalidIssuer => (
            StatusCode::UNAUTHORIZED,
            "invalid_token",
            "Access token issuer mismatch",
        ),
        TokenAuthFail::InvalidSignature => (
            StatusCode::UNAUTHORIZED,
            "invalid_token",
            "Access token signature invalid",
        ),
        TokenAuthFail::RevokedToken => (
            StatusCode::UNAUTHORIZED,
            "token_revoked",
            "Access token has been revoked",
        ),
        TokenAuthFail::StaleTokenVersion => (
            StatusCode::UNAUTHORIZED,
            "token_revoked",
            "Access token invalidated — please obtain a new token",
        ),
        TokenAuthFail::ClientDisabled => (
            StatusCode::FORBIDDEN,
            "client_key_disabled",
            "OAuth client is disabled",
        ),
        TokenAuthFail::ClientNotFound => (
            StatusCode::UNAUTHORIZED,
            "invalid_token",
            "OAuth client no longer registered",
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{ClientCredentials, DisabledClientKey, OAuthClientKey};
    use crate::oauth_tokens::TokenRevocationStore;

    #[test]
    fn bearer_header_parsing() {
        let mut h = HeaderMap::new();
        assert!(bearer_from_headers(&h).is_none());
        h.insert(
            axum::http::header::AUTHORIZATION,
            "Bearer eyJ.test".parse().unwrap(),
        );
        assert_eq!(bearer_from_headers(&h).as_deref(), Some("eyJ.test"));
    }

    fn test_oauth_client(id: i64, client_id: &str) -> OAuthClientKey {
        OAuthClientKey {
            id,
            client_id: client_id.into(),
            secret_hash: crate::db::hash_client_secret("avaso_sk_test").expect("hash"),
            tenant_id: 1,
            rate_limit_per_min: 60,
            allowed_route_ids: vec![9],
            token_version: 0,
        }
    }

    #[tokio::test]
    async fn client_token_maps_to_verified_client() {
        let client = test_oauth_client(3, "avaso_pk_demo");
        let creds = ClientCredentials {
            oauth_clients: vec![client.clone()],
            disabled_clients: vec![],
            user_token_versions: std::collections::HashMap::new(),
        };
        let issued = identity::issue_client_token(&client).unwrap();
        let store = TokenRevocationStore::noop();
        let v = verify_bearer(&creds, &store, &issued.access_token).await.unwrap();
        assert_eq!(v.key_id, 3);
        assert_eq!(v.allowed_route_ids, vec![9]);
    }

    #[tokio::test]
    async fn stale_client_token_version_rejected() {
        let client = OAuthClientKey {
            allowed_route_ids: vec![],
            ..test_oauth_client(3, "avaso_pk_demo")
        };
        let issued = identity::issue_client_token(&client).unwrap();
        let creds = ClientCredentials {
            oauth_clients: vec![OAuthClientKey {
                token_version: 1,
                ..client
            }],
            disabled_clients: vec![],
            user_token_versions: std::collections::HashMap::new(),
        };
        let store = TokenRevocationStore::noop();
        assert!(matches!(
            verify_bearer(&creds, &store, &issued.access_token).await,
            Err(TokenAuthFail::StaleTokenVersion)
        ));
    }

    #[tokio::test]
    async fn disabled_client_rejected() {
        let creds = ClientCredentials {
            oauth_clients: vec![],
            disabled_clients: vec![DisabledClientKey {
                id: 1,
                client_id: "avaso_pk_off".into(),
                tenant_id: 1,
            }],
            user_token_versions: std::collections::HashMap::new(),
        };
        let client = OAuthClientKey {
            id: 1,
            client_id: "avaso_pk_off".into(),
            secret_hash: crate::db::hash_client_secret("x").expect("hash"),
            tenant_id: 1,
            rate_limit_per_min: 0,
            allowed_route_ids: vec![],
            token_version: 0,
        };
        let issued = identity::issue_client_token(&client).unwrap();
        let store = TokenRevocationStore::noop();
        assert!(matches!(
            verify_bearer(&creds, &store, &issued.access_token).await,
            Err(TokenAuthFail::ClientDisabled)
        ));
    }
}
