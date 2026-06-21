//! Data-plane Bearer JWT validation.

use axum::http::{HeaderMap, StatusCode};

use crate::db::ClientCredentials;
use crate::identity::{self, TokenValidationError};

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

pub fn verify_bearer(creds: &ClientCredentials, token: &str) -> Result<VerifiedClient, TokenAuthFail> {
    if creds.oauth_clients.is_empty() {
        // Still allow user tokens when no OAuth clients registered.
    }

    let claims = identity::validate_access_token(token).map_err(|e| match e {
        TokenValidationError::Missing => TokenAuthFail::MissingToken,
        TokenValidationError::Malformed => TokenAuthFail::MalformedToken,
        TokenValidationError::Expired => TokenAuthFail::ExpiredToken,
        TokenValidationError::InvalidIssuer => TokenAuthFail::InvalidIssuer,
        TokenValidationError::InvalidSignature => TokenAuthFail::InvalidSignature,
    })?;

    match claims.token_type.as_str() {
        "client" => verify_client_claims(creds, &claims),
        "user" => Ok(VerifiedClient {
            key_id: 0,
            tenant_id: claims.tenant_id,
            rate_limit_per_min: 0,
            allowed_route_ids: vec![],
            subject: claims.sub,
            token_type: "user".into(),
        }),
        _ => Err(TokenAuthFail::MalformedToken),
    }
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

    #[test]
    fn client_token_maps_to_verified_client() {
        let client = OAuthClientKey {
            id: 3,
            client_id: "avaso_pk_demo".into(),
            secret: "sk".into(),
            tenant_id: 1,
            rate_limit_per_min: 60,
            allowed_route_ids: vec![9],
        };
        let creds = ClientCredentials {
            oauth_clients: vec![client.clone()],
            disabled_clients: vec![],
        };
        let issued = identity::issue_client_token(&client).unwrap();
        let v = verify_bearer(&creds, &issued.access_token).unwrap();
        assert_eq!(v.key_id, 3);
        assert_eq!(v.allowed_route_ids, vec![9]);
    }

    #[test]
    fn disabled_client_rejected() {
        let creds = ClientCredentials {
            oauth_clients: vec![],
            disabled_clients: vec![DisabledClientKey {
                id: 1,
                client_id: "avaso_pk_off".into(),
                tenant_id: 1,
            }],
        };
        let client = OAuthClientKey {
            id: 1,
            client_id: "avaso_pk_off".into(),
            secret: "sk".into(),
            tenant_id: 1,
            rate_limit_per_min: 0,
            allowed_route_ids: vec![],
        };
        let issued = identity::issue_client_token(&client).unwrap();
        assert!(matches!(
            verify_bearer(&creds, &issued.access_token),
            Err(TokenAuthFail::ClientDisabled)
        ));
    }
}
