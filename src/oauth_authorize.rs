//! OAuth2 Authorization Code + consent for third-party apps.
#![allow(dead_code)]
#![allow(private_interfaces)]

use chrono::{Duration, Utc};
use sqlx::PgPool;

use crate::db;
use crate::identity::{self, GatewayClaims, OAuthTokenError, TokenResponse};

#[derive(Debug, Clone, sqlx::FromRow, serde::Serialize)]
pub struct ThirdPartyAppRow {
    pub id: i64,
    pub tenant_id: i64,
    pub client_id: String,
    pub name: String,
    pub redirect_uris_json: String,
    pub scopes: String,
    pub has_secret: bool,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Clone)]
pub struct ThirdPartyApp {
    pub id: i64,
    pub tenant_id: i64,
    pub client_id: String,
    pub secret: Option<String>,
    pub name: String,
    pub redirect_uris: Vec<String>,
    pub scopes: String,
}

pub fn parse_redirect_uris(json: &str) -> Vec<String> {
    serde_json::from_str::<Vec<String>>(json).unwrap_or_default()
}

pub fn normalize_redirect_uris(uris: &[String]) -> Vec<String> {
    let mut out = Vec::new();
    for u in uris {
        let t = u.trim();
        if t.is_empty() {
            continue;
        }
        if !out.iter().any(|x| x == t) {
            out.push(t.to_string());
        }
    }
    out
}

pub fn valid_redirect_uri(uri: &str) -> bool {
    let t = uri.trim();
    t.starts_with("https://")
        || t.starts_with("http://127.0.0.1")
        || t.starts_with("http://localhost")
}

pub async fn list_third_party_apps(
    pool: &PgPool,
    tenant_id: i64,
) -> Result<Vec<ThirdPartyAppRow>, sqlx::Error> {
    sqlx::query_as::<_, ThirdPartyAppRow>(
        "SELECT id, tenant_id, client_id, name, redirect_uris_json::text AS redirect_uris_json, scopes,
                (client_secret_encrypted IS NOT NULL AND client_secret_encrypted != '') AS has_secret,
                created_at
         FROM oauth_third_party_apps WHERE tenant_id = $1 ORDER BY id",
    )
    .bind(tenant_id)
    .fetch_all(pool)
    .await
}

pub async fn fetch_third_party_app(
    pool: &PgPool,
    client_id: &str,
) -> Result<Option<ThirdPartyApp>, sqlx::Error> {
    let row: Option<(i64, i64, String, Option<String>, String, String, String)> = sqlx::query_as(
        "SELECT id, tenant_id, client_id, client_secret_encrypted, name, redirect_uris_json::text AS redirect_uris_json, scopes
         FROM oauth_third_party_apps WHERE client_id = $1 LIMIT 1",
    )
    .bind(client_id)
    .fetch_optional(pool)
    .await?;

    Ok(row.map(
        |(id, tenant_id, client_id, enc, name, uris_json, scopes)| ThirdPartyApp {
            id,
            tenant_id,
            client_id,
            secret: enc
                .filter(|s| !s.is_empty())
                .and_then(|e| crate::crypto::decrypt_secret(&e).ok()),
            name,
            redirect_uris: parse_redirect_uris(&uris_json),
            scopes,
        },
    ))
}

pub async fn insert_third_party_app(
    pool: &PgPool,
    tenant_id: i64,
    name: &str,
    redirect_uris: &[String],
    with_secret: bool,
) -> Result<(String, Option<String>), sqlx::Error> {
    let client_id = db::random_api_key_id();
    let secret = if with_secret {
        Some(db::random_secret_key())
    } else {
        None
    };
    let enc = secret
        .as_ref()
        .map(|s| crate::crypto::encrypt_secret(s))
        .transpose()
        .map_err(|e| sqlx::Error::Protocol(format!("encrypt secret: {e}")))?;
    let uris_json = serde_json::to_string(redirect_uris).unwrap_or_else(|_| "[]".into());
    sqlx::query(
        "INSERT INTO oauth_third_party_apps (tenant_id, client_id, client_secret_encrypted, name, redirect_uris_json)
         VALUES ($1, $2, $3, $4, $5::jsonb)",
    )
    .bind(tenant_id)
    .bind(&client_id)
    .bind(&enc)
    .bind(name)
    .bind(&uris_json)
    .execute(pool)
    .await?;
    Ok((client_id, secret))
}

#[derive(Debug, Clone)]
pub struct ThirdPartyAppMeta {
    pub id: i64,
    pub client_id: String,
    pub name: String,
}

pub async fn fetch_third_party_app_meta(
    pool: &PgPool,
    id: i64,
    tenant_id: i64,
) -> Result<Option<ThirdPartyAppMeta>, sqlx::Error> {
    let row: Option<(i64, String, String)> = sqlx::query_as(
        "SELECT id, client_id, name FROM oauth_third_party_apps
         WHERE id = $1 AND tenant_id = $2 LIMIT 1",
    )
    .bind(id)
    .bind(tenant_id)
    .fetch_optional(pool)
    .await?;
    Ok(row.map(|(id, client_id, name)| ThirdPartyAppMeta {
        id,
        client_id,
        name,
    }))
}

/// Chi tiết audit log — đọc được ngay trên UI (không chỉ id số).
pub fn audit_app_details(meta: &ThirdPartyAppMeta, extra: Option<&str>) -> String {
    let mut s = format!(
        "app=\"{}\" client_id={} id={}",
        meta.name, meta.client_id, meta.id
    );
    if let Some(e) = extra.filter(|x| !x.is_empty()) {
        s.push(' ');
        s.push_str(e);
    }
    s
}

pub async fn update_third_party_app(
    pool: &PgPool,
    id: i64,
    tenant_id: i64,
    name: &str,
    redirect_uris: &[String],
) -> Result<bool, sqlx::Error> {
    let uris_json = serde_json::to_string(redirect_uris).unwrap_or_else(|_| "[]".into());
    let r = sqlx::query(
        "UPDATE oauth_third_party_apps SET name = $3, redirect_uris_json = $4::jsonb
         WHERE id = $1 AND tenant_id = $2",
    )
    .bind(id)
    .bind(tenant_id)
    .bind(name)
    .bind(&uris_json)
    .execute(pool)
    .await?;
    Ok(r.rows_affected() > 0)
}

pub async fn rotate_third_party_app_secret(
    pool: &PgPool,
    id: i64,
    tenant_id: i64,
) -> Result<Option<String>, sqlx::Error> {
    let secret = db::random_secret_key();
    let enc = crate::crypto::encrypt_secret(&secret)
        .map_err(|e| sqlx::Error::Protocol(format!("encrypt secret: {e}")))?;
    let r = sqlx::query(
        "UPDATE oauth_third_party_apps SET client_secret_encrypted = $3
         WHERE id = $1 AND tenant_id = $2",
    )
    .bind(id)
    .bind(tenant_id)
    .bind(&enc)
    .execute(pool)
    .await?;
    if r.rows_affected() == 0 {
        return Ok(None);
    }
    Ok(Some(secret))
}

pub async fn delete_third_party_app(
    pool: &PgPool,
    id: i64,
    tenant_id: i64,
) -> Result<Option<ThirdPartyAppMeta>, sqlx::Error> {
    let Some(meta) = fetch_third_party_app_meta(pool, id, tenant_id).await? else {
        return Ok(None);
    };
    sqlx::query("DELETE FROM oauth_user_consents WHERE app_client_id = $1")
        .bind(&meta.client_id)
        .execute(pool)
        .await?;
    sqlx::query("DELETE FROM oauth_authorization_codes WHERE app_client_id = $1")
        .bind(&meta.client_id)
        .execute(pool)
        .await?;
    let r = sqlx::query("DELETE FROM oauth_third_party_apps WHERE id = $1 AND tenant_id = $2")
        .bind(id)
        .bind(tenant_id)
        .execute(pool)
        .await?;
    if r.rows_affected() == 0 {
        return Ok(None);
    }
    Ok(Some(meta))
}

pub fn redirect_uri_allowed(app: &ThirdPartyApp, redirect_uri: &str) -> bool {
    app.redirect_uris.iter().any(|u| u == redirect_uri)
}

pub async fn has_user_consent(
    pool: &PgPool,
    user_id: i64,
    app_client_id: &str,
    scope: &str,
) -> Result<bool, sqlx::Error> {
    let row: Option<String> = sqlx::query_scalar(
        "SELECT scope FROM oauth_user_consents WHERE user_id = $1 AND app_client_id = $2",
    )
    .bind(user_id)
    .bind(app_client_id)
    .fetch_optional(pool)
    .await?;
    Ok(row.as_deref() == Some(scope))
}

pub async fn save_user_consent(
    pool: &PgPool,
    user_id: i64,
    app_client_id: &str,
    scope: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO oauth_user_consents (user_id, app_client_id, scope, granted_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (user_id, app_client_id) DO UPDATE SET scope = EXCLUDED.scope, granted_at = NOW()",
    )
    .bind(user_id)
    .bind(app_client_id)
    .bind(scope)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn create_authorization_code(
    pool: &PgPool,
    app_client_id: &str,
    tenant_id: i64,
    user_id: i64,
    redirect_uri: &str,
    scope: &str,
    code_challenge: &str,
    code_challenge_method: &str,
) -> Result<String, sqlx::Error> {
    let code = format!("ac_{}", uuid::Uuid::new_v4());
    let expires = Utc::now() + Duration::minutes(10);
    //code_challenge_method: S256
    sqlx::query(
        "INSERT INTO oauth_authorization_codes (code, app_client_id, user_id, tenant_id, redirect_uri, scope, expires_at, code_challenge, code_challenge_method)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)",
    )
    .bind(&code)
    .bind(app_client_id)
    .bind(user_id)
    .bind(tenant_id)
    .bind(redirect_uri)
    .bind(scope)
    .bind(expires)
    .bind(code_challenge)
    .bind(code_challenge_method)
    .execute(pool)
    .await?;
    Ok(code)
}

pub(crate) struct AuthCodeRow {
    app_client_id: String,
    user_id: i64,
    tenant_id: i64,
    redirect_uri: String,
    scope: String,
    code_challenge: String,
    code_challenge_method: String,
    expires_at: chrono::DateTime<chrono::Utc>,
}

pub async fn consume_authorization_code(
    pool: &PgPool,
    code: &str,
    client_id: &str,
    redirect_uri: &str,
) -> Result<AuthCodeRow, OAuthTokenError> {
    let row: Option<(
        String,
        i64,
        i64,
        String,
        String,
        Option<chrono::DateTime<chrono::Utc>>,
        Option<String>,
        String,
        chrono::DateTime<chrono::Utc>,
    )> = sqlx::query_as(
        "SELECT app_client_id, user_id, tenant_id, redirect_uri, scope, used_at,
                code_challenge, COALESCE(code_challenge_method, 'S256'), expires_at
         FROM oauth_authorization_codes WHERE code = $1 LIMIT 1",
    )
    .bind(code)
    .fetch_optional(pool)
    .await
    .map_err(|e| OAuthTokenError::Internal(format!("{e}")))?;

    let Some((
        app_client_id,
        user_id,
        tenant_id,
        stored_uri,
        scope,
        used_at,
        code_challenge,
        code_challenge_method,
        expires_at,
    )) = row
    else {
        return Err(OAuthTokenError::InvalidGrant);
    };
    if used_at.is_some() {
        return Err(OAuthTokenError::InvalidGrant);
    }
    if expires_at < Utc::now() {
        return Err(OAuthTokenError::InvalidGrant);
    }
    let code_challenge = code_challenge.unwrap_or_default();
    if code_challenge.is_empty() {
        return Err(OAuthTokenError::InvalidGrant);
    }
    if app_client_id != client_id {
        return Err(OAuthTokenError::InvalidClient);
    }
    if stored_uri != redirect_uri {
        return Err(OAuthTokenError::InvalidRequest("redirect_uri mismatch"));
    }

    sqlx::query("UPDATE oauth_authorization_codes SET used_at = NOW() WHERE code = $1")
        .bind(code)
        .execute(pool)
        .await
        .map_err(|e| OAuthTokenError::Internal(format!("{e}")))?;

    Ok(AuthCodeRow {
        app_client_id,
        user_id,
        tenant_id,
        redirect_uri: stored_uri,
        scope,
        code_challenge,
        code_challenge_method,
        expires_at,
    })
}

pub async fn exchange_authorization_code(
    pool: &PgPool,
    code: &str,
    client_id: &str,
    client_secret: &str,
    redirect_uri: &str,
    code_verifier: &str,
) -> Result<(TokenResponse, GatewayClaims), OAuthTokenError> {
    let app = fetch_third_party_app(pool, client_id)
        .await
        .map_err(|e| OAuthTokenError::Internal(format!("{e}")))?
        .ok_or(OAuthTokenError::InvalidClient)?;

    let secret_ok = match (&app.secret, client_secret.is_empty()) {
        (Some(expected), _) => expected == client_secret,
        (None, true) => true,
        (None, false) => false,
    };
    if !secret_ok {
        return Err(OAuthTokenError::InvalidClient);
    }

    let consumed = consume_authorization_code(pool, code, client_id, redirect_uri).await?;

    if consumed.code_challenge_method != crate::pkce::METHOD_S256 {
        return Err(OAuthTokenError::InvalidGrant);
    }
    if !crate::pkce::verify_s256(code_verifier, &consumed.code_challenge) {
        return Err(OAuthTokenError::InvalidGrant);
    }

    let user = db::fetch_admin_user_by_id_any(pool, consumed.user_id)
        .await
        .map_err(|e| OAuthTokenError::Internal(format!("{e}")))?
        .ok_or(OAuthTokenError::InvalidGrant)?;

    if !user.is_active {
        return Err(OAuthTokenError::InvalidGrant);
    }

    identity::issue_user_token_with_version(&user, user.token_version, &consumed.scope)
        .map(|issued| (issued.response, issued.claims))
        .map_err(OAuthTokenError::Internal)
}
