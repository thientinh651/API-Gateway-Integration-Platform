//! HTTP handlers: token audit, revoke, authorization code, third-party apps.

use axum::{
    extract::{Extension, Form, Path, Query},
    http::{HeaderMap, StatusCode},
    response::{Html, IntoResponse, Redirect, Response},
    Json,
};
use serde::Deserialize;
use sqlx::PgPool;

use crate::admin_auth::{self, write_audit, AdminCtx};
use crate::db;
use crate::identity;
use crate::oauth_authorize::{self, ThirdPartyApp};
use crate::oauth_tokens::{self, TokenAuditInsert, TokenRevocationStore};
use std::sync::Arc;

use crate::session::{self, SessionStore};

pub struct OAuthHandlerState {
    pub pool: PgPool,
    pub session_store: Arc<SessionStore>,
}

pub async fn record_issued_token(pool: &PgPool, headers: &HeaderMap, issued: &identity::IssuedToken) {
    let claims = &issued.claims;
    let user_id = claims
        .sub
        .strip_prefix("user:")
        .and_then(|s| s.parse().ok());
    let row = TokenAuditInsert {
        jti: claims.jti.clone(),
        tenant_id: claims.tenant_id,
        subject: claims.sub.clone(),
        token_type: claims.token_type.clone(),
        client_key_id: if claims.client_key_id > 0 {
            Some(claims.client_key_id)
        } else {
            None
        },
        user_id,
        grant_type: issued.grant_type.to_string(),
        scope: claims.scope.clone(),
        expires_at_unix: claims.exp as i64,
        source_ip: admin_auth::client_ip(headers),
        user_agent: headers
            .get(axum::http::header::USER_AGENT)
            .and_then(|v| v.to_str().ok())
            .map(str::to_string),
    };
    if let Err(e) = oauth_tokens::insert_token_audit(pool, &row).await {
        tracing::warn!(error = %e, "oauth token audit insert failed");
    }
}

pub fn revocation_store(session: &Arc<SessionStore>) -> TokenRevocationStore {
    TokenRevocationStore::from_session(session)
}

pub async fn revoke_bearer_token(
    pool: &PgPool,
    store: &TokenRevocationStore,
    token: &str,
) -> Result<(), &'static str> {
    let claims = identity::validate_access_token(token).map_err(|_| "invalid_token")?;
    let now = chrono::Utc::now().timestamp() as usize;
    let ttl = if claims.exp <= now {
        1
    } else {
        (claims.exp - now) as u64
    };
    oauth_tokens::revoke_jti_full(pool, store, &claims.jti, ttl)
        .await
        .map_err(|_| "revoke_failed")?;
    Ok(())
}

#[derive(Debug, Deserialize)]
pub struct OAuthRevokeForm {
    pub token: String,
}

pub async fn api_oauth_revoke(st: &OAuthHandlerState, body: OAuthRevokeForm) -> Response {
    let store = revocation_store(&st.session_store);
    match revoke_bearer_token(&st.pool, &store, body.token.trim()).await {
        Ok(()) => (StatusCode::OK, Json(serde_json::json!({ "status": "revoked" }))).into_response(),
        Err(code) => json_err(StatusCode::BAD_REQUEST, code, "Token revoke failed"),
    }
}

pub async fn api_oauth_logout_bearer(st: &OAuthHandlerState, headers: HeaderMap) -> Response {
    let token = crate::jwt_auth::bearer_from_headers(&headers).unwrap_or_default();
    if token.is_empty() {
        return json_err(
            StatusCode::UNAUTHORIZED,
            "missing_token",
            "Authorization: Bearer required",
        );
    }
    let store = revocation_store(&st.session_store);
    match revoke_bearer_token(&st.pool, &store, &token).await {
        Ok(()) => (StatusCode::OK, Json(serde_json::json!({ "status": "revoked" }))).into_response(),
        Err(code) => json_err(StatusCode::BAD_REQUEST, code, "Logout failed"),
    }
}

#[derive(Debug, Deserialize)]
pub struct ListTokensQuery {
    pub active_only: Option<bool>,
    pub limit: Option<i64>,
}

pub async fn api_list_oauth_tokens(
    st: &OAuthHandlerState,
    ctx: &AdminCtx,
    q: ListTokensQuery,
) -> Response {
    if !ctx.is_admin() && !ctx.is_operator() {
        return admin_auth::forbidden_response();
    }
    let active_only = q.active_only.unwrap_or(true);
    let limit = q.limit.unwrap_or(100);
    match oauth_tokens::list_token_audit(&st.pool, ctx.tenant_id, active_only, limit).await {
        Ok(rows) => Json(serde_json::json!({ "tokens": rows })).into_response(),
        Err(e) => json_err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "internal_error",
            &format!("{e}"),
        ),
    }
}

pub async fn api_revoke_client_tokens(st: &OAuthHandlerState, ctx: &AdminCtx, id: i64) -> Response {
    let row = match db::fetch_client_key_meta_by_id(&st.pool, id, ctx.tenant_id).await {
        Ok(Some(r)) => r,
        Ok(None) => return json_err(StatusCode::NOT_FOUND, "not_found", "Client not found"),
        Err(e) => {
            return json_err(StatusCode::INTERNAL_SERVER_ERROR, "internal_error", &format!("{e}"));
        }
    };
    let client_id = row.api_key.unwrap_or_default();
    if client_id.is_empty() {
        return json_err(StatusCode::BAD_REQUEST, "invalid_client", "Missing client_id");
    }
    let subject = format!("client:{client_id}");
    if let Err(e) = db::bump_client_token_version(&st.pool, id, ctx.tenant_id).await {
        return json_err(StatusCode::INTERNAL_SERVER_ERROR, "internal_error", &format!("{e}"));
    }
    let _ = oauth_tokens::mark_subject_tokens_revoked_db(&st.pool, &subject).await;
    write_audit(
        &st.pool,
        ctx,
        "revoke_client_tokens",
        "client_key",
        "success",
        None,
        Some(&format!("id={id}")),
    )
    .await;
    Json(serde_json::json!({
        "status": "ok",
        "message": "All tokens for this client invalidated"
    }))
    .into_response()
}

#[derive(Debug, Deserialize)]
pub struct RevokeJtiBody {
    pub jti: String,
}

pub async fn api_revoke_token_jti(
    st: &OAuthHandlerState,
    ctx: &AdminCtx,
    body: RevokeJtiBody,
) -> Response {
    if !ctx.is_admin() && !ctx.is_operator() {
        return admin_auth::forbidden_response();
    }
    let jti = body.jti.trim();
    if jti.is_empty() {
        return json_err(StatusCode::BAD_REQUEST, "validation_failed", "jti required");
    }
    let expires = match oauth_tokens::fetch_token_expiry_by_jti(&st.pool, jti, ctx.tenant_id).await {
        Ok(v) => v,
        Err(e) => return json_err(StatusCode::INTERNAL_SERVER_ERROR, "internal_error", &format!("{e}")),
    };
    let Some(expires) = expires else {
        return json_err(StatusCode::NOT_FOUND, "not_found", "Token not found");
    };
    let ttl = (expires.timestamp() - chrono::Utc::now().timestamp()).max(1) as u64;
    let store = revocation_store(&st.session_store);
    if let Err(e) = oauth_tokens::revoke_jti_by_id(&st.pool, &store, jti, ttl).await {
        return json_err(StatusCode::INTERNAL_SERVER_ERROR, "revoke_failed", &e);
    }
    write_audit(
        &st.pool,
        ctx,
        "revoke_oauth_token",
        "oauth_token",
        "success",
        None,
        Some(jti),
    )
    .await;
    Json(serde_json::json!({ "status": "revoked", "jti": jti })).into_response()
}

#[derive(Debug, Deserialize)]
pub struct CreateOAuthAppBody {
    pub name: String,
    pub redirect_uris: Vec<String>,
    pub with_secret: Option<bool>,
}

pub async fn api_create_oauth_app(st: &OAuthHandlerState, ctx: &AdminCtx, body: CreateOAuthAppBody) -> Response {
    if !ctx.is_admin() {
        return admin_auth::forbidden_response();
    }
    let name = body.name.trim();
    if name.is_empty() || body.redirect_uris.is_empty() {
        return json_err(
            StatusCode::BAD_REQUEST,
            "validation_failed",
            "name and redirect_uris required",
        );
    }
    match oauth_authorize::insert_third_party_app(
        &st.pool,
        ctx.tenant_id,
        name,
        &body.redirect_uris,
        body.with_secret.unwrap_or(true),
    )
    .await
    {
        Ok((client_id, secret)) => Json(serde_json::json!({
            "client_id": client_id,
            "client_secret": secret,
            "redirect_uris": body.redirect_uris,
            "grant_types": ["authorization_code"],
        }))
        .into_response(),
        Err(e) => json_err(StatusCode::INTERNAL_SERVER_ERROR, "internal_error", &format!("{e}")),
    }
}

pub async fn api_list_oauth_apps(st: &OAuthHandlerState, ctx: &AdminCtx) -> Response {
    if !ctx.is_admin() && !ctx.is_operator() {
        return admin_auth::forbidden_response();
    }
    match oauth_authorize::list_third_party_apps(&st.pool, ctx.tenant_id).await {
        Ok(rows) => Json(serde_json::json!({ "apps": rows })).into_response(),
        Err(e) => json_err(StatusCode::INTERNAL_SERVER_ERROR, "internal_error", &format!("{e}")),
    }
}

#[derive(Debug, Deserialize)]
pub struct AuthorizeQuery {
    pub client_id: String,
    pub redirect_uri: String,
    pub response_type: String,
    pub scope: Option<String>,
    pub state: Option<String>,
}

pub async fn oauth_authorize_get(st: &OAuthHandlerState, headers: HeaderMap, q: AuthorizeQuery) -> Response {
    if q.response_type != "code" {
        return json_err(
            StatusCode::BAD_REQUEST,
            "unsupported_response_type",
            "Only response_type=code supported",
        );
    }
    let Some(sid) = session::sid_from_cookie(&headers) else {
        return Redirect::to("/login.html").into_response();
    };
    let ctx = match admin_auth::resolve_session_ctx(&st.session_store, &st.pool, &sid).await {
        Ok(Some(c)) => c,
        Ok(None) => return json_err(StatusCode::UNAUTHORIZED, "unauthorized", "Login required"),
        Err(_) => return admin_auth::session_unavailable_response(),
    };
    let app = match oauth_authorize::fetch_third_party_app(&st.pool, q.client_id.trim()).await {
        Ok(Some(a)) => a,
        Ok(None) => return json_err(StatusCode::BAD_REQUEST, "invalid_client", "Unknown client_id"),
        Err(e) => return json_err(StatusCode::INTERNAL_SERVER_ERROR, "internal_error", &format!("{e}")),
    };
    if app.tenant_id != ctx.tenant_id {
        return admin_auth::forbidden_response();
    }
    if !oauth_authorize::redirect_uri_allowed(&app, q.redirect_uri.trim()) {
        return json_err(
            StatusCode::BAD_REQUEST,
            "invalid_redirect_uri",
            "redirect_uri not registered",
        );
    }
    let scope = q
        .scope
        .as_deref()
        .filter(|s| !s.is_empty())
        .unwrap_or(app.scopes.as_str());
    let has_consent = oauth_authorize::has_user_consent(&st.pool, ctx.user_id, &app.client_id, scope)
        .await
        .unwrap_or(false);
    if has_consent {
        return issue_code_redirect(&st.pool, &app, ctx.user_id, ctx.tenant_id, &q).await;
    }
    Html(consent_html(&app, &q, &ctx.username)).into_response()
}

#[derive(Debug, Deserialize)]
pub struct ConsentForm {
    pub client_id: String,
    pub redirect_uri: String,
    pub scope: String,
    pub state: Option<String>,
    pub action: String,
}

pub async fn oauth_consent_post(st: &OAuthHandlerState, form: ConsentForm, headers: HeaderMap) -> Response {
    let Some(sid) = session::sid_from_cookie(&headers) else {
        return json_err(StatusCode::UNAUTHORIZED, "unauthorized", "Login required");
    };
    let ctx = match admin_auth::resolve_session_ctx(&st.session_store, &st.pool, &sid).await {
        Ok(Some(c)) => c,
        Ok(None) => return json_err(StatusCode::UNAUTHORIZED, "unauthorized", "Login required"),
        Err(_) => return admin_auth::session_unavailable_response(),
    };
    let app = match oauth_authorize::fetch_third_party_app(&st.pool, form.client_id.trim()).await {
        Ok(Some(a)) => a,
        _ => return json_err(StatusCode::BAD_REQUEST, "invalid_client", "Unknown client"),
    };
    if form.action != "approve" {
        let mut url = form.redirect_uri.clone();
        let sep = if url.contains('?') { '&' } else { '?' };
        url.push_str(&format!("{sep}error=access_denied"));
        if let Some(st) = form.state.filter(|s| !s.is_empty()) {
            url.push_str(&format!("&state={}", urlencoding::encode(&st)));
        }
        return Redirect::to(&url).into_response();
    }
    let _ = oauth_authorize::save_user_consent(
        &st.pool,
        ctx.user_id,
        &app.client_id,
        form.scope.trim(),
    )
    .await;
    let q = AuthorizeQuery {
        client_id: form.client_id,
        redirect_uri: form.redirect_uri,
        response_type: "code".into(),
        scope: Some(form.scope),
        state: form.state,
    };
    issue_code_redirect(&st.pool, &app, ctx.user_id, ctx.tenant_id, &q).await
}

async fn issue_code_redirect(
    pool: &PgPool,
    app: &ThirdPartyApp,
    user_id: i64,
    tenant_id: i64,
    q: &AuthorizeQuery,
) -> Response {
    let scope = q
        .scope
        .as_deref()
        .filter(|s| !s.is_empty())
        .unwrap_or(app.scopes.as_str());
    let code = match oauth_authorize::create_authorization_code(
        pool,
        &app.client_id,
        tenant_id,
        user_id,
        q.redirect_uri.trim(),
        scope,
    )
    .await
    {
        Ok(c) => c,
        Err(e) => {
            return json_err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "internal_error",
                &format!("{e}"),
            );
        }
    };
    let mut url = q.redirect_uri.trim().to_string();
    let sep = if url.contains('?') { '&' } else { '?' };
    url.push_str(&format!("{sep}code={}", urlencoding::encode(&code)));
    if let Some(st) = q.state.as_deref().filter(|s| !s.is_empty()) {
        url.push_str(&format!("&state={}", urlencoding::encode(st)));
    }
    Redirect::to(&url).into_response()
}

fn consent_html(app: &ThirdPartyApp, q: &AuthorizeQuery, username: &str) -> String {
    let scope = q
        .scope
        .as_deref()
        .filter(|s| !s.is_empty())
        .unwrap_or(app.scopes.as_str());
    let state = q.state.as_deref().unwrap_or("");
    format!(
        r#"<!DOCTYPE html><html lang="vi"><head><meta charset="utf-8"/><title>Ủy quyền OAuth</title>
<style>body{{font-family:system-ui;background:#0f172a;color:#e2e8f0;display:flex;min-height:100vh;align-items:center;justify-content:center}}
.card{{background:#1e293b;border:1px solid #334155;border-radius:12px;padding:2rem;max-width:420px;width:100%}}
button{{padding:.6rem 1rem;border-radius:8px;border:none;cursor:pointer;margin-right:.5rem}}
.approve{{background:#f97316;color:#fff}}.deny{{background:#475569;color:#fff}}</style></head>
<body><div class="card"><h1>Cho phép truy cập?</h1>
<p><strong>{name}</strong> muốn quyền <code>{scope}</code> thay mặt <strong>{username}</strong>.</p>
<form method="post" action="/oauth/consent">
<input type="hidden" name="client_id" value="{cid}"/>
<input type="hidden" name="redirect_uri" value="{uri}"/>
<input type="hidden" name="scope" value="{scope}"/>
<input type="hidden" name="state" value="{state}"/>
<button class="approve" name="action" value="approve">Cho phép</button>
<button class="deny" name="action" value="deny">Từ chối</button>
</form></div></body></html>"#,
        name = html_escape(&app.name),
        scope = html_escape(scope),
        username = html_escape(username),
        cid = html_escape(&app.client_id),
        uri = html_escape(q.redirect_uri.trim()),
        state = html_escape(state),
    )
}

fn html_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

fn json_err(status: StatusCode, error: &str, message: &str) -> Response {
    (
        status,
        Json(serde_json::json!({ "error": error, "message": message })),
    )
        .into_response()
}
