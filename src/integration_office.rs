//! Zoho Office Integrator — merge SF deal data into contract PDF.

use axum::{
    body::Body,
    http::{header, StatusCode},
    response::{IntoResponse, Response},
};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use std::path::{Path, PathBuf};

use crate::admin_auth::{write_audit, AdminCtx};
use crate::crypto::{decrypt_integration_config, encrypt_integration_config};
use crate::db;
use crate::integrations::{gateway_public_base_url, mask_secret_for_ui};
use crate::{json_error, STATE};

pub const ZOHO_OFFICE_PROVIDER: &str = "zoho_office";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ZohoOfficeProviderConfig {
    pub api_key: String,
    #[serde(default = "default_office_api_domain")]
    pub api_domain: String,
    #[serde(default = "default_template_path")]
    pub template_path: String,
    #[serde(default = "default_office_enabled")]
    pub enabled: bool,
}

fn default_office_api_domain() -> String {
    "api.office-integrator.com".into()
}

fn default_template_path() -> String {
    "templates/hop-dong-vip.docx".into()
}

fn default_office_enabled() -> bool {
    true
}

#[derive(Debug, Serialize)]
pub struct ZohoOfficeConfigPublic {
    pub api_domain: String,
    pub template_path: String,
    pub enabled: bool,
    pub has_api_key: bool,
    pub api_key_masked: Option<String>,
    pub updated_by: Option<String>,
    pub updated_at: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct ZohoOfficeConfigWriteBody {
    pub api_key: String,
    pub api_domain: String,
    pub template_path: String,
    pub enabled: bool,
}

#[derive(Debug, Clone)]
pub struct DealDocumentContext {
    pub sf_id: String,
    pub opportunity_name: String,
    pub customer_name: String,
    pub amount: f64,
    pub close_date: Option<String>,
    pub contact_name: String,
    pub contact_email: String,
    pub industry: String,
    pub product_type: String,
    pub zoho_project_id: String,
}

pub async fn office_provider_config(
    pool: &PgPool,
    tenant_id: i64,
) -> Option<ZohoOfficeProviderConfig> {
    if let Ok(Some(row)) =
        db::fetch_integration_provider_config(pool, tenant_id, ZOHO_OFFICE_PROVIDER).await
    {
        if let Ok(json) = decrypt_integration_config(&row.config_encrypted) {
            if let Ok(mut cfg) = serde_json::from_str::<ZohoOfficeProviderConfig>(&json) {
                if cfg.api_key.trim().is_empty() {
                    if let Ok(key) = std::env::var("ZOHO_OFFICE_API_KEY") {
                        let k = key.trim().to_string();
                        if !k.is_empty() {
                            cfg.api_key = k;
                        }
                    }
                }
                if !cfg.api_key.trim().is_empty() && cfg.enabled {
                    return Some(cfg);
                }
            }
        }
    }
    if let Ok(key) = std::env::var("ZOHO_OFFICE_API_KEY") {
        let k = key.trim().to_string();
        if !k.is_empty() {
            return Some(ZohoOfficeProviderConfig {
                api_key: k,
                api_domain: std::env::var("ZOHO_OFFICE_API_DOMAIN")
                    .unwrap_or_else(|_| default_office_api_domain()),
                template_path: std::env::var("ZOHO_OFFICE_TEMPLATE_PATH")
                    .unwrap_or_else(|_| default_template_path()),
                enabled: true,
            });
        }
    }
    None
}

pub async fn office_integration_configured(pool: &PgPool, tenant_id: i64) -> bool {
    office_provider_config(pool, tenant_id).await.is_some()
}

fn integration_docs_base_dir() -> PathBuf {
    PathBuf::from(
        std::env::var("INTEGRATION_DOCS_DIR").unwrap_or_else(|_| "data/integration-docs".into()),
    )
}

fn resolve_template_path(raw: &str) -> PathBuf {
    let p = Path::new(raw.trim());
    if p.is_absolute() {
        return p.to_path_buf();
    }
    if p.exists() {
        return p.to_path_buf();
    }
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(p)
}

fn office_merge_url(api_domain: &str) -> String {
    let host = api_domain
        .trim()
        .trim_start_matches("https://")
        .trim_start_matches("http://")
        .trim_end_matches('/');
    format!("https://{host}/writer/officeapi/v1/document/merge")
}

fn format_amount_vnd(amount: f64) -> String {
    let n = amount.round() as i64;
    let s = n.to_string();
    let mut out = String::new();
    for (i, ch) in s.chars().rev().enumerate() {
        if i > 0 && i % 3 == 0 {
            out.push('.');
        }
        out.push(ch);
    }
    out.chars().rev().collect()
}

fn merge_record_from_ctx(ctx: &DealDocumentContext) -> serde_json::Value {
    let today = chrono::Utc::now().format("%d/%m/%Y").to_string();
    serde_json::json!({
        "customer_name": ctx.customer_name,
        "opportunity_name": ctx.opportunity_name,
        "amount": format_amount_vnd(ctx.amount),
        "close_date": ctx.close_date.clone().unwrap_or_else(|| "—".into()),
        "contact_name": if ctx.contact_name.is_empty() { "—" } else { &ctx.contact_name },
        "contact_email": if ctx.contact_email.is_empty() { "—" } else { &ctx.contact_email },
        "industry": if ctx.industry.is_empty() { "—" } else { &ctx.industry },
        "product_type": if ctx.product_type.is_empty() { "—" } else { &ctx.product_type },
        "generated_date": today,
    })
}

async fn call_office_merge(
    cfg: &ZohoOfficeProviderConfig,
    template_bytes: &[u8],
    merge_record: &serde_json::Value,
) -> Result<Vec<u8>, String> {
    let Some(st) = STATE.get() else {
        return Err("state not initialized".into());
    };
    let merge_data = serde_json::json!({ "data": [merge_record] });
    let part = reqwest::multipart::Part::bytes(template_bytes.to_vec())
        .file_name("hop-dong-vip.docx")
        .mime_str("application/vnd.openxmlformats-officedocument.wordprocessingml.document")
        .map_err(|e| format!("multipart: {e}"))?;
    let form = reqwest::multipart::Form::new()
        .text("apikey", cfg.api_key.clone())
        .text("output_format", "pdf")
        .text("merge_data", merge_data.to_string())
        .part("file_content", part);
    let url = office_merge_url(&cfg.api_domain);
    let res = st
        .http
        .post(&url)
        .multipart(form)
        .send()
        .await
        .map_err(|e| format!("Office Integrator HTTP: {e}"))?;
    let status = res.status();
    let bytes = res.bytes().await.map_err(|e| format!("read body: {e}"))?;
    if !status.is_success() {
        let preview: String = String::from_utf8_lossy(&bytes).chars().take(400).collect();
        return Err(format!("Office Integrator {status}: {preview}"));
    }
    if bytes.len() < 100 {
        return Err("Office Integrator trả dữ liệu quá ngắn — kiểm tra API key và template".into());
    }
    Ok(bytes.to_vec())
}

async fn save_document_file(
    tenant_id: i64,
    sf_id: &str,
    pdf_bytes: &[u8],
) -> Result<PathBuf, String> {
    let dir = integration_docs_base_dir().join(tenant_id.to_string());
    tokio::fs::create_dir_all(&dir)
        .await
        .map_err(|e| format!("mkdir docs: {e}"))?;
    let path = dir.join(format!("{sf_id}.pdf"));
    tokio::fs::write(&path, pdf_bytes)
        .await
        .map_err(|e| format!("write pdf: {e}"))?;
    Ok(path)
}

pub async fn generate_contract_for_deal(
    pool: &PgPool,
    tenant_id: i64,
    ctx: &DealDocumentContext,
) -> Result<i64, String> {
    if let Ok(Some(existing)) =
        db::fetch_integration_document_by_sf(pool, tenant_id, "opportunity", &ctx.sf_id).await
    {
        return Ok(existing.id);
    }
    let cfg = office_provider_config(pool, tenant_id)
        .await
        .ok_or_else(|| "Zoho Office chưa cấu hình — nhập API key trên Dashboard".to_string())?;
    let template_path = resolve_template_path(&cfg.template_path);
    let template_bytes = tokio::fs::read(&template_path)
        .await
        .map_err(|e| format!("đọc template {}: {e}", template_path.display()))?;
    let merge_record = merge_record_from_ctx(ctx);
    let pdf_bytes = call_office_merge(&cfg, &template_bytes, &merge_record).await?;
    let storage_path = save_document_file(tenant_id, &ctx.sf_id, &pdf_bytes).await?;
    let filename = format!("hop-dong-{}.pdf", ctx.sf_id);
    let doc_id = db::upsert_integration_document(
        pool,
        tenant_id,
        "opportunity",
        &ctx.sf_id,
        Some(&ctx.zoho_project_id),
        &filename,
        "application/pdf",
        storage_path.to_string_lossy().as_ref(),
        pdf_bytes.len() as i64,
        ZOHO_OFFICE_PROVIDER,
    )
    .await
    .map_err(|e| format!("db document: {e}"))?;
    let _ = db::set_integration_status(pool, tenant_id, ZOHO_OFFICE_PROVIDER, "connected", None).await;
    let _ = db::touch_integration_last_sync(pool, tenant_id, ZOHO_OFFICE_PROVIDER).await;
    Ok(doc_id)
}

pub fn document_download_url(document_id: i64) -> String {
    if let Some(base) = gateway_public_base_url() {
        format!("{base}/api/integrations/documents/{document_id}/download")
    } else {
        format!("/api/integrations/documents/{document_id}/download")
    }
}

pub async fn api_office_config_get(ctx: &AdminCtx) -> Response {
    let Some(st) = STATE.get() else {
        return json_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "internal_error",
            "state not initialized",
        );
    };
    let row = db::fetch_integration_provider_config(&st.pool, ctx.tenant_id, ZOHO_OFFICE_PROVIDER)
        .await
        .ok()
        .flatten();
    if let Some(r) = row {
        if let Ok(json) = decrypt_integration_config(&r.config_encrypted) {
            if let Ok(cfg) = serde_json::from_str::<ZohoOfficeProviderConfig>(&json) {
                let masked = mask_secret_for_ui(&cfg.api_key);
                return (
                    StatusCode::OK,
                    axum::Json(ZohoOfficeConfigPublic {
                        api_domain: cfg.api_domain,
                        template_path: cfg.template_path,
                        enabled: cfg.enabled,
                        has_api_key: !cfg.api_key.trim().is_empty(),
                        api_key_masked: Some(masked),
                        updated_by: Some(r.updated_by),
                        updated_at: Some(r.updated_at),
                    }),
                )
                    .into_response();
            }
        }
    }
    (
        StatusCode::OK,
        axum::Json(ZohoOfficeConfigPublic {
            api_domain: default_office_api_domain(),
            template_path: default_template_path(),
            enabled: true,
            has_api_key: false,
            api_key_masked: None,
            updated_by: None,
            updated_at: None,
        }),
    )
        .into_response()
}

async fn existing_office_api_key(pool: &PgPool, tenant_id: i64) -> Option<String> {
    if let Ok(Some(row)) =
        db::fetch_integration_provider_config(pool, tenant_id, ZOHO_OFFICE_PROVIDER).await
    {
        if let Ok(json) = decrypt_integration_config(&row.config_encrypted) {
            if let Ok(cfg) = serde_json::from_str::<ZohoOfficeProviderConfig>(&json) {
                let s = cfg.api_key.trim().to_string();
                if !s.is_empty() {
                    return Some(s);
                }
            }
        }
    }
    None
}

pub async fn api_office_config_put(ctx: &AdminCtx, body: ZohoOfficeConfigWriteBody) -> Response {
    let Some(st) = STATE.get() else {
        return json_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "internal_error",
            "state not initialized",
        );
    };
    let mut fields = serde_json::Map::new();
    if body.api_domain.trim().is_empty() {
        fields.insert(
            "api_domain".into(),
            serde_json::Value::String("Nhập API domain (vd api.office-integrator.com)".into()),
        );
    }
    if body.template_path.trim().is_empty() {
        fields.insert(
            "template_path".into(),
            serde_json::Value::String("Nhập đường dẫn template .docx".into()),
        );
    }
    let api_key = if body.api_key.trim().is_empty() {
        match existing_office_api_key(&st.pool, ctx.tenant_id).await {
            Some(k) => k,
            None => {
                fields.insert(
                    "api_key".into(),
                    serde_json::Value::String("Nhập API key Zoho Office Integrator".into()),
                );
                String::new()
            }
        }
    } else {
        body.api_key.trim().to_string()
    };
    if !fields.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            axum::Json(serde_json::json!({
                "error": "validation_failed",
                "fields": fields,
            })),
        )
            .into_response();
    }
    let cfg = ZohoOfficeProviderConfig {
        api_key,
        api_domain: body
            .api_domain
            .trim()
            .trim_start_matches("https://")
            .trim_start_matches("http://")
            .trim_end_matches('/')
            .to_string(),
        template_path: body.template_path.trim().to_string(),
        enabled: body.enabled,
    };
    let json = match serde_json::to_string(&cfg) {
        Ok(j) => j,
        Err(e) => {
            return json_error(
                StatusCode::INTERNAL_SERVER_ERROR,
                "serialize_failed",
                &format!("{e}"),
            );
        }
    };
    let enc = match encrypt_integration_config(&json) {
        Ok(e) => e,
        Err(e) => {
            return json_error(
                StatusCode::INTERNAL_SERVER_ERROR,
                "encrypt_failed",
                &format!("{e}"),
            );
        }
    };
    if let Err(e) = db::upsert_integration_provider_config(
        &st.pool,
        ctx.tenant_id,
        ZOHO_OFFICE_PROVIDER,
        &enc,
        &ctx.username,
    )
    .await
    {
        return json_error(StatusCode::INTERNAL_SERVER_ERROR, "db_failed", &format!("{e}"));
    }
    let status = if cfg.enabled && !cfg.api_key.is_empty() {
        "connected"
    } else {
        "disconnected"
    };
    let _ = db::set_integration_status(&st.pool, ctx.tenant_id, ZOHO_OFFICE_PROVIDER, status, None)
        .await;
    let _ = db::ensure_integration_row(&st.pool, ctx.tenant_id, ZOHO_OFFICE_PROVIDER).await;
    write_audit(
        &st.pool,
        ctx,
        "integration.office.config",
        ZOHO_OFFICE_PROVIDER,
        "success",
        None,
        Some(if cfg.enabled { "enabled" } else { "disabled" }),
    )
    .await;
    let masked = mask_secret_for_ui(&cfg.api_key);
    (
        StatusCode::OK,
        axum::Json(ZohoOfficeConfigPublic {
            api_domain: cfg.api_domain,
            template_path: cfg.template_path,
            enabled: cfg.enabled,
            has_api_key: true,
            api_key_masked: Some(masked),
            updated_by: Some(ctx.username.clone()),
            updated_at: None,
        }),
    )
        .into_response()
}

pub async fn api_office_test(ctx: &AdminCtx) -> Response {
    let Some(st) = STATE.get() else {
        return json_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "internal_error",
            "state not initialized",
        );
    };
    let cfg = match office_provider_config(&st.pool, ctx.tenant_id).await {
        Some(c) => c,
        None => {
            return json_error(
                StatusCode::BAD_REQUEST,
                "not_configured",
                "Chưa cấu hình API key Zoho Office",
            );
        }
    };
    let template_path = resolve_template_path(&cfg.template_path);
    if !template_path.exists() {
        return (
            StatusCode::BAD_REQUEST,
            axum::Json(serde_json::json!({
                "error": "template_missing",
                "message": format!("Không tìm thấy template: {}", template_path.display()),
            })),
        )
            .into_response();
    }
    let sample = serde_json::json!({
        "customer_name": "Công ty TNHH Demo",
        "opportunity_name": "Dự án Demo AVASO",
        "amount": "50.000.000",
        "close_date": "01/06/2026",
        "contact_name": "Nguyễn Văn A",
        "contact_email": "demo@example.com",
        "industry": "Công nghệ",
        "product_type": "Mobile App",
        "generated_date": chrono::Utc::now().format("%d/%m/%Y").to_string(),
    });
    let template_bytes = match tokio::fs::read(&template_path).await {
        Ok(b) => b,
        Err(e) => {
            return json_error(
                StatusCode::INTERNAL_SERVER_ERROR,
                "template_read_failed",
                &format!("{e}"),
            );
        }
    };
    match call_office_merge(&cfg, &template_bytes, &sample).await {
        Ok(pdf) => (
            StatusCode::OK,
            axum::Json(serde_json::json!({
                "status": "ok",
                "provider": ZOHO_OFFICE_PROVIDER,
                "template": template_path.display().to_string(),
                "pdf_bytes": pdf.len(),
            })),
        )
            .into_response(),
        Err(e) => (
            StatusCode::BAD_GATEWAY,
            axum::Json(serde_json::json!({
                "error": "office_merge_failed",
                "message": e,
            })),
        )
            .into_response(),
    }
}

pub async fn api_list_entity_links(ctx: &AdminCtx) -> Response {
    let Some(st) = STATE.get() else {
        return json_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "internal_error",
            "state not initialized",
        );
    };
    match db::list_entity_links_public(&st.pool, ctx.tenant_id).await {
        Ok(rows) => (StatusCode::OK, axum::Json(rows)).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            axum::Json(serde_json::json!({ "error": format!("{e}") })),
        )
            .into_response(),
    }
}

pub async fn api_list_documents(ctx: &AdminCtx) -> Response {
    let Some(st) = STATE.get() else {
        return json_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "internal_error",
            "state not initialized",
        );
    };
    match db::list_integration_documents(&st.pool, ctx.tenant_id, 50).await {
        Ok(rows) => (StatusCode::OK, axum::Json(rows)).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            axum::Json(serde_json::json!({ "error": format!("{e}") })),
        )
            .into_response(),
    }
}

pub async fn api_download_document(ctx: &AdminCtx, document_id: i64) -> Response {
    let Some(st) = STATE.get() else {
        return json_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "internal_error",
            "state not initialized",
        );
    };
    let row = match db::fetch_integration_document_file(&st.pool, ctx.tenant_id, document_id).await
    {
        Ok(Some(r)) => r,
        Ok(None) => {
            return json_error(StatusCode::NOT_FOUND, "not_found", "Không tìm thấy tài liệu");
        }
        Err(e) => {
            return json_error(StatusCode::INTERNAL_SERVER_ERROR, "db_failed", &format!("{e}"));
        }
    };
    let bytes = match tokio::fs::read(&row.storage_path).await {
        Ok(b) => b,
        Err(e) => {
            return json_error(
                StatusCode::INTERNAL_SERVER_ERROR,
                "read_failed",
                &format!("{e}"),
            );
        }
    };
    let disposition = format!("inline; filename=\"{}\"", row.filename);
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, row.content_type)
        .header(header::CONTENT_DISPOSITION, disposition)
        .body(Body::from(bytes))
        .unwrap_or_else(|_| {
            json_error(
                StatusCode::INTERNAL_SERVER_ERROR,
                "response_failed",
                "build response",
            )
        })
}

pub async fn delete_tenant_documents(pool: &PgPool, tenant_id: i64) -> Result<u64, String> {
    let paths = db::delete_integration_documents(pool, tenant_id)
        .await
        .map_err(|e| format!("{e}"))?;
    let count = paths.len() as u64;
    for p in paths {
        let _ = tokio::fs::remove_file(&p).await;
    }
    Ok(count)
}
