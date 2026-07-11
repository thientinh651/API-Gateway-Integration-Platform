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
    let redirect_uris = oauth_authorize::normalize_redirect_uris(&body.redirect_uris);
    if name.is_empty() || redirect_uris.is_empty() {
        return json_err(
            StatusCode::BAD_REQUEST,
            "validation_failed",
            "name and redirect_uris required",
        );
    }
    if redirect_uris.iter().any(|u| !oauth_authorize::valid_redirect_uri(u)) {
        return json_err(
            StatusCode::BAD_REQUEST,
            "validation_failed",
            "redirect_uris phải là https:// hoặc http://localhost",
        );
    }
    match oauth_authorize::insert_third_party_app(
        &st.pool,
        ctx.tenant_id,
        name,
        &redirect_uris,
        body.with_secret.unwrap_or(true),
    )
    .await
    {
        Ok((client_id, secret)) => {
            write_audit(
                &st.pool,
                ctx,
                "create_oauth_app",
                "oauth_third_party_app",
                "success",
                None,
                Some(&format!(
                    "app=\"{}\" client_id={} uris={}",
                    name,
                    client_id,
                    redirect_uris.len()
                )),
            )
            .await;
            Json(serde_json::json!({
                "client_id": client_id,
                "client_secret": secret,
                "redirect_uris": redirect_uris,
                "grant_types": ["authorization_code"],
            }))
            .into_response()
        }
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
pub struct UpdateOAuthAppBody {
    pub name: String,
    pub redirect_uris: Vec<String>,
    pub rotate_secret: Option<bool>,
}

pub async fn api_update_oauth_app(
    st: &OAuthHandlerState,
    ctx: &AdminCtx,
    id: i64,
    body: UpdateOAuthAppBody,
) -> Response {
    if !ctx.is_admin() {
        return admin_auth::forbidden_response();
    }
    let name = body.name.trim();
    let redirect_uris = oauth_authorize::normalize_redirect_uris(&body.redirect_uris);
    if name.is_empty() || redirect_uris.is_empty() {
        return json_err(
            StatusCode::BAD_REQUEST,
            "validation_failed",
            "name and redirect_uris required",
        );
    }
    if redirect_uris.iter().any(|u| !oauth_authorize::valid_redirect_uri(u)) {
        return json_err(
            StatusCode::BAD_REQUEST,
            "validation_failed",
            "redirect_uris phải là https:// hoặc http://localhost",
        );
    }
    let client_id = match oauth_authorize::fetch_third_party_app_meta(&st.pool, id, ctx.tenant_id).await {
        Ok(Some(m)) => m.client_id,
        Ok(None) => return json_err(StatusCode::NOT_FOUND, "oauth_app_not_found", "App OAuth không tồn tại"),
        Err(e) => return json_err(StatusCode::INTERNAL_SERVER_ERROR, "internal_error", &format!("{e}")),
    };
    match oauth_authorize::update_third_party_app(&st.pool, id, ctx.tenant_id, name, &redirect_uris).await {
        Ok(true) => {}
        Ok(false) => return json_err(StatusCode::NOT_FOUND, "oauth_app_not_found", "App OAuth không tồn tại"),
        Err(e) => return json_err(StatusCode::INTERNAL_SERVER_ERROR, "internal_error", &format!("{e}")),
    }
    let mut new_secret: Option<String> = None;
    let rotate = body.rotate_secret.unwrap_or(false);
    if rotate {
        match oauth_authorize::rotate_third_party_app_secret(&st.pool, id, ctx.tenant_id).await {
            Ok(Some(s)) => new_secret = Some(s),
            Ok(None) => return json_err(StatusCode::NOT_FOUND, "oauth_app_not_found", "App OAuth không tồn tại"),
            Err(e) => return json_err(StatusCode::INTERNAL_SERVER_ERROR, "internal_error", &format!("{e}")),
        }
    }
    let meta = oauth_authorize::ThirdPartyAppMeta {
        id,
        client_id,
        name: name.to_string(),
    };
    let uris_extra = format!("uris={}", redirect_uris.len());
    let details = if rotate {
        oauth_authorize::audit_app_details(&meta, Some("rotate_secret=true"))
    } else {
        oauth_authorize::audit_app_details(&meta, Some(&uris_extra))
    };
    write_audit(
        &st.pool,
        ctx,
        "update_oauth_app",
        "oauth_third_party_app",
        "success",
        None,
        Some(&details),
    )
    .await;
    Json(serde_json::json!({
        "status": "ok",
        "id": id,
        "name": name,
        "redirect_uris": redirect_uris,
        "client_secret": new_secret,
    }))
    .into_response()
}

pub async fn api_delete_oauth_app(st: &OAuthHandlerState, ctx: &AdminCtx, id: i64) -> Response {
    if !ctx.is_admin() {
        return admin_auth::forbidden_response();
    }
    match oauth_authorize::delete_third_party_app(&st.pool, id, ctx.tenant_id).await {
        Ok(Some(meta)) => {
            let details = oauth_authorize::audit_app_details(&meta, None);
            write_audit(
                &st.pool,
                ctx,
                "delete_oauth_app",
                "oauth_third_party_app",
                "success",
                None,
                Some(&details),
            )
            .await;
            Json(serde_json::json!({
                "status": "deleted",
                "id": id,
                "name": meta.name,
                "client_id": meta.client_id,
            }))
            .into_response()
        }
        Ok(None) => json_err(StatusCode::NOT_FOUND, "oauth_app_not_found", "App OAuth không tồn tại"),
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
    pub code_challenge: String,
    pub code_challenge_method: Option<String>,
}

fn validate_pkce_authorize(q: &AuthorizeQuery) -> Result<(), Response> {
    let challenge = q.code_challenge.trim();
    if challenge.is_empty() {
        return Err(oauth_browser_err(
            StatusCode::BAD_REQUEST,
            "invalid_request",
            "Thiếu code_challenge (PKCE)",
            "App thứ 3 phải gửi code_challenge (S256) khi gọi /oauth/authorize. Liên hệ nhà phát triển app.",
            None,
        ));
    }
    let method = q
        .code_challenge_method
        .as_deref()
        .unwrap_or(crate::pkce::METHOD_S256)
        .trim();
    if method != crate::pkce::METHOD_S256 {
        return Err(oauth_browser_err(
            StatusCode::BAD_REQUEST,
            "invalid_request",
            "Chỉ hỗ trợ code_challenge_method=S256",
            "Cập nhật app thứ 3 dùng PKCE S256 (không dùng plain).",
            Some(&format!("Nhận được: {method}")),
        ));
    }
    if !crate::pkce::valid_challenge(challenge) {
        return Err(oauth_browser_err(
            StatusCode::BAD_REQUEST,
            "invalid_request",
            "code_challenge không hợp lệ",
            "code_challenge phải là chuỗi base64url 43 ký tự (SHA-256 của verifier). Kiểm tra thư viện PKCE phía app.",
            None,
        ));
    }
    Ok(())
}

/// Rebuild `/oauth/authorize?...` so login can return here after session created.
fn build_authorize_return_path(q: &AuthorizeQuery) -> String {
    let method = q
        .code_challenge_method
        .as_deref()
        .unwrap_or(crate::pkce::METHOD_S256)
        .trim();
    let mut pairs: Vec<(&str, &str)> = vec![
        ("response_type", q.response_type.trim()),
        ("client_id", q.client_id.trim()),
        ("redirect_uri", q.redirect_uri.trim()),
        ("code_challenge", q.code_challenge.trim()),
        ("code_challenge_method", method),
    ];
    if let Some(scope) = q.scope.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        pairs.push(("scope", scope));
    }
    if let Some(state) = q.state.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        pairs.push(("state", state));
    }
    let qs = pairs
        .iter()
        .map(|(k, v)| format!("{}={}", urlencoding::encode(k), urlencoding::encode(v)))
        .collect::<Vec<_>>()
        .join("&");
    format!("/oauth/authorize?{qs}")
}

/// SPA `/login` + `return_to` (relative path only) — Google-like continue after auth.
fn redirect_to_login_with_return(q: &AuthorizeQuery) -> Response {
    let return_to = build_authorize_return_path(q);
    let loc = format!(
        "/login?return_to={}",
        urlencoding::encode(&return_to)
    );
    Redirect::to(&loc).into_response()
}

pub async fn oauth_authorize_get(st: &OAuthHandlerState, headers: HeaderMap, q: AuthorizeQuery) -> Response {
    if q.response_type != "code" {
        return oauth_browser_err(
            StatusCode::BAD_REQUEST,
            "unsupported_response_type",
            "Chỉ hỗ trợ response_type=code",
            "App thứ 3 phải dùng Authorization Code (response_type=code).",
            Some(&format!("Nhận được: {}", q.response_type.trim())),
        );
    }
    if let Err(resp) = validate_pkce_authorize(&q) {
        return resp;
    }
    let Some(sid) = session::sid_from_cookie(&headers) else {
        return redirect_to_login_with_return(&q);
    };
    let ctx = match admin_auth::resolve_session_ctx(&st.session_store, &st.pool, &sid).await {
        Ok(Some(c)) => c,
        Ok(None) => return redirect_to_login_with_return(&q),
        Err(_) => {
            return oauth_browser_err(
                StatusCode::SERVICE_UNAVAILABLE,
                "session_store_unavailable",
                "Không đọc được phiên đăng nhập",
                "Thử lại sau vài giây. Nếu vẫn lỗi, liên hệ admin hệ thống (Redis/session).",
                None,
            );
        }
    };
    let app = match oauth_authorize::fetch_third_party_app(&st.pool, q.client_id.trim()).await {
        Ok(Some(a)) => a,
        Ok(None) => {
            return oauth_browser_err(
                StatusCode::BAD_REQUEST,
                "invalid_client",
                "Client ID không tồn tại",
                "Kiểm tra client_id trên app thứ 3, hoặc nhờ admin đăng ký lại app tại Dashboard → Auth → App OAuth.",
                Some(&format!("client_id: {}", q.client_id.trim())),
            );
        }
        Err(e) => {
            return oauth_browser_err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "internal_error",
                "Lỗi máy chủ khi tải app OAuth",
                "Thử lại sau. Nếu kéo dài, báo admin gateway.",
                Some(&format!("{e}")),
            );
        }
    };
    if app.tenant_id != ctx.tenant_id {
        return oauth_browser_err(
            StatusCode::FORBIDDEN,
            "forbidden",
            "Tài khoản không thuộc workspace của app này",
            "Đăng nhập bằng user cùng workspace (tenant) với app OAuth, hoặc nhờ admin thêm bạn vào workspace đó.",
            Some(&format!("Đang đăng nhập: {}", ctx.username)),
        );
    }
    if !oauth_authorize::redirect_uri_allowed(&app, q.redirect_uri.trim()) {
        let registered = if app.redirect_uris.is_empty() {
            "(chưa có URI nào)".to_string()
        } else {
            app.redirect_uris.join("\n")
        };
        return oauth_browser_err(
            StatusCode::BAD_REQUEST,
            "invalid_redirect_uri",
            "Redirect URI chưa được đăng ký",
            "Admin mở Dashboard → Auth → App OAuth → Sửa app, thêm đúng URI mà app thứ 3 đang gửi (khớp từng ký tự, gồm http/https và path).",
            Some(&format!(
                "URI nhận được:\n{}\n\nURI đã đăng ký:\n{}",
                q.redirect_uri.trim(),
                registered
            )),
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
    pub code_challenge: String,
    pub code_challenge_method: Option<String>,
    pub action: String,
}

pub async fn oauth_consent_post(st: &OAuthHandlerState, form: ConsentForm, headers: HeaderMap) -> Response {
    let Some(sid) = session::sid_from_cookie(&headers) else {
        return oauth_browser_err(
            StatusCode::UNAUTHORIZED,
            "unauthorized",
            "Phiên đăng nhập đã hết",
            "Đóng tab này, mở lại luồng đăng nhập từ app thứ 3, rồi đăng nhập lại trên gateway.",
            None,
        );
    };
    let ctx = match admin_auth::resolve_session_ctx(&st.session_store, &st.pool, &sid).await {
        Ok(Some(c)) => c,
        Ok(None) => {
            return oauth_browser_err(
                StatusCode::UNAUTHORIZED,
                "unauthorized",
                "Phiên đăng nhập không còn hiệu lực",
                "Mở lại authorize từ app thứ 3 và đăng nhập lại.",
                None,
            );
        }
        Err(_) => {
            return oauth_browser_err(
                StatusCode::SERVICE_UNAVAILABLE,
                "session_store_unavailable",
                "Không đọc được phiên đăng nhập",
                "Thử lại sau vài giây. Nếu vẫn lỗi, liên hệ admin hệ thống.",
                None,
            );
        }
    };
    let app = match oauth_authorize::fetch_third_party_app(&st.pool, form.client_id.trim()).await {
        Ok(Some(a)) => a,
        _ => {
            return oauth_browser_err(
                StatusCode::BAD_REQUEST,
                "invalid_client",
                "Client ID không tồn tại",
                "App có thể đã bị xóa. Nhờ admin kiểm tra Dashboard → Auth → App OAuth.",
                Some(&format!("client_id: {}", form.client_id.trim())),
            );
        }
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
    let scope = form.scope.trim().to_string();
    let q = AuthorizeQuery {
        client_id: form.client_id,
        redirect_uri: form.redirect_uri,
        response_type: "code".into(),
        scope: Some(scope.clone()),
        state: form.state,
        code_challenge: form.code_challenge,
        code_challenge_method: form.code_challenge_method,
    };
    if let Err(resp) = validate_pkce_authorize(&q) {
        return resp;
    }
    let _ = oauth_authorize::save_user_consent(
        &st.pool,
        ctx.user_id,
        &app.client_id,
        scope.trim(),
    )
    .await;
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
        q.code_challenge.trim(),
        q.code_challenge_method
            .as_deref()
            .unwrap_or(crate::pkce::METHOD_S256),
    )
    .await
    {
        Ok(c) => c,
        Err(e) => {
            return oauth_browser_err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "internal_error",
                "Không tạo được mã ủy quyền",
                "Thử lại từ app thứ 3. Nếu lỗi lặp lại, báo admin gateway.",
                Some(&format!("{e}")),
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

fn oauth_page_shell(title: &str, body: &str) -> String {
    format!(
        r#"<!DOCTYPE html><html lang="vi"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>{title}</title>
<style>
body{{font-family:system-ui,-apple-system,sans-serif;background:#0f172a;color:#e2e8f0;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;padding:1rem}}
.card{{background:#1e293b;border:1px solid #334155;border-radius:12px;padding:2rem;max-width:480px;width:100%;box-sizing:border-box}}
h1{{font-size:1.25rem;margin:0 0 .75rem;color:#fff}}
p{{margin:.5rem 0;line-height:1.5;font-size:.95rem}}
.hint{{background:#0f172a;border:1px solid #334155;border-radius:8px;padding:.75rem 1rem;margin:1rem 0;font-size:.875rem;color:#cbd5e1}}
.hint strong{{color:#fbbf24;display:block;margin-bottom:.35rem}}
.detail{{font-family:ui-monospace,monospace;font-size:.75rem;white-space:pre-wrap;word-break:break-all;color:#94a3b8;background:#0f172a;border-radius:8px;padding:.75rem;margin:1rem 0;border:1px solid #1e293b}}
.code{{display:inline-block;font-family:ui-monospace,monospace;font-size:.75rem;color:#94a3b8;margin-bottom:.5rem}}
.actions{{display:flex;flex-wrap:wrap;gap:.5rem;margin-top:1.25rem}}
a.btn,button{{display:inline-block;padding:.6rem 1rem;border-radius:8px;border:none;cursor:pointer;text-decoration:none;font-size:.875rem}}
.primary{{background:#f97316;color:#fff}}.secondary{{background:#475569;color:#fff}}
.approve{{background:#f97316;color:#fff}}.deny{{background:#475569;color:#fff}}
</style></head>
<body><div class="card">{body}</div></body></html>"#,
        title = html_escape(title),
        body = body,
    )
}

/// Browser-facing OAuth errors — HTML + cách khắc phục (không redirect về app khi URI/client sai).
fn oauth_browser_err(
    status: StatusCode,
    error: &str,
    title: &str,
    fix: &str,
    detail: Option<&str>,
) -> Response {
    let detail_html = detail
        .map(|d| format!(r#"<pre class="detail">{}</pre>"#, html_escape(d)))
        .unwrap_or_default();
    let body = format!(
        r#"<p class="code">{code}</p>
<h1>{title}</h1>
<div class="hint"><strong>Cách khắc phục</strong>{fix}</div>
{detail}
<div class="actions">
<a class="btn primary" href="/auth?tab=apps">Mở App OAuth (Dashboard)</a>
<a class="btn secondary" href="/">Về trang chủ</a>
</div>"#,
        code = html_escape(error),
        title = html_escape(title),
        fix = html_escape(fix),
        detail = detail_html,
    );
    (status, Html(oauth_page_shell(title, &body))).into_response()
}

fn consent_html(app: &ThirdPartyApp, q: &AuthorizeQuery, username: &str) -> String {
    let scope = q
        .scope
        .as_deref()
        .filter(|s| !s.is_empty())
        .unwrap_or(app.scopes.as_str());
    let state = q.state.as_deref().unwrap_or("");
    let challenge_method = q
        .code_challenge_method
        .as_deref()
        .unwrap_or(crate::pkce::METHOD_S256);
    let body = format!(
        r#"<h1>Cho phép truy cập?</h1>
<p><strong>{name}</strong> muốn quyền <code>{scope}</code> thay mặt <strong>{username}</strong>.</p>
<p style="font-size:12px;color:#94a3b8">PKCE <code>{pkce_method}</code> — code challenge đã xác thực.</p>
<form method="post" action="/oauth/consent">
<input type="hidden" name="client_id" value="{cid}"/>
<input type="hidden" name="redirect_uri" value="{uri}"/>
<input type="hidden" name="scope" value="{scope}"/>
<input type="hidden" name="state" value="{state}"/>
<input type="hidden" name="code_challenge" value="{challenge}"/>
<input type="hidden" name="code_challenge_method" value="{pkce_method}"/>
<button class="approve" name="action" value="approve">Cho phép</button>
<button class="deny" name="action" value="deny">Từ chối</button>
</form>"#,
        name = html_escape(&app.name),
        scope = html_escape(scope),
        username = html_escape(username),
        cid = html_escape(&app.client_id),
        uri = html_escape(q.redirect_uri.trim()),
        state = html_escape(state),
        challenge = html_escape(q.code_challenge.trim()),
        pkce_method = html_escape(challenge_method),
    );
    oauth_page_shell("Ủy quyền OAuth", &body)
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
