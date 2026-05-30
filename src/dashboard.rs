//! Dashboard aggregation: integrations, snapshots, audit.

use axum::{http::StatusCode, response::{IntoResponse, Response}, Json};
use serde::Serialize;
use sqlx::SqlitePool;

use crate::admin_auth::AdminCtx;
use crate::db;
use crate::integrations;
use crate::{json_error, STATE};

#[derive(Debug, Serialize)]
pub struct LabelCount {
    pub label: String,
    pub count: i64,
}

#[derive(Debug, Serialize)]
pub struct SnapshotEntityStat {
    pub provider: String,
    pub entity_type: String,
    pub label: String,
    pub record_count: i64,
    pub fetched_at: String,
}

#[derive(Debug, Serialize)]
pub struct SnapshotTimelinePoint {
    pub fetched_at: String,
    pub provider: String,
    pub entity_type: String,
    pub record_count: i64,
}

#[derive(Debug, Serialize)]
pub struct Audit24h {
    pub total: i64,
    pub success: i64,
    pub failure: i64,
}

#[derive(Debug, Serialize)]
pub struct DashboardStats {
    pub routes_count: i64,
    pub client_keys_count: i64,
    pub audit_24h: Audit24h,
    pub integrations: Vec<db::IntegrationPublic>,
    pub snapshot_entities: Vec<SnapshotEntityStat>,
    pub snapshot_timeline: Vec<SnapshotTimelinePoint>,
    pub salesforce_stages: Vec<LabelCount>,
    pub zoho_project_status: Vec<LabelCount>,
    pub total_snapshot_records: i64,
}

fn entity_label(provider: &str, entity_type: &str) -> String {
    match (provider, entity_type) {
        ("salesforce", "opportunity") => "Salesforce Opportunities".into(),
        ("salesforce", "account") => "Salesforce Accounts".into(),
        ("zoho_projects", "project") => "Zoho Projects".into(),
        ("zoho_projects", "task") => "Zoho Tasks".into(),
        (p, e) => format!("{p} / {e}"),
    }
}

fn count_by_field(rows: &[serde_json::Value], field: &str) -> Vec<LabelCount> {
    let mut map: std::collections::BTreeMap<String, i64> = std::collections::BTreeMap::new();
    for r in rows {
        let key = r
            .get(field)
            .and_then(|v| v.as_str())
            .unwrap_or("(trống)")
            .trim()
            .to_string();
        let k = if key.is_empty() { "(trống)".into() } else { key };
        *map.entry(k).or_insert(0) += 1;
    }
    map.into_iter()
        .map(|(label, count)| LabelCount { label, count })
        .collect()
}

fn parse_snapshot_array(payload: &str) -> Vec<serde_json::Value> {
    serde_json::from_str::<Vec<serde_json::Value>>(payload).unwrap_or_default()
}

pub async fn build_dashboard_stats(pool: &SqlitePool, tenant_id: i64) -> Result<DashboardStats, sqlx::Error> {
    let routes = db::list_routes_for_tenant(pool, tenant_id).await?;
    let client_keys_count = db::count_client_keys_for_tenant(pool, tenant_id).await?;
    let audit_24h = db::audit_counts_24h(pool, tenant_id).await?;
    let integration_rows = db::list_integrations(pool, tenant_id).await?;
    let mut integrations = integrations::list_with_stubs(integration_rows);
    let zoho_cfg = db::fetch_integration_provider_config(pool, tenant_id, "zoho_projects")
        .await
        .ok()
        .flatten()
        .is_some();
    let sf_cfg = db::fetch_integration_provider_config(pool, tenant_id, "salesforce")
        .await
        .ok()
        .flatten()
        .is_some();
    for r in &mut integrations {
        if r.provider == "zoho_projects" {
            r.available = r.available || zoho_cfg;
        } else if r.provider == "salesforce" {
            r.available = r.available || sf_cfg;
        }
    }

    let summaries = db::list_integration_snapshot_summaries(pool, tenant_id, None).await?;
    let snapshot_entities: Vec<SnapshotEntityStat> = summaries
        .iter()
        .map(|s| SnapshotEntityStat {
            provider: s.provider.clone(),
            entity_type: s.entity_type.clone(),
            label: entity_label(&s.provider, &s.entity_type),
            record_count: s.record_count,
            fetched_at: s.fetched_at.clone(),
        })
        .collect();

    let recent = db::list_integration_snapshots_recent(pool, tenant_id, 40).await?;
    let snapshot_timeline: Vec<SnapshotTimelinePoint> = recent
        .iter()
        .rev()
        .map(|r| SnapshotTimelinePoint {
            fetched_at: r.fetched_at.clone(),
            provider: r.provider.clone(),
            entity_type: r.entity_type.clone(),
            record_count: r.record_count,
        })
        .collect();

    let mut salesforce_stages = Vec::new();
    let mut zoho_project_status = Vec::new();
    if let Ok(Some(opp)) =
        db::fetch_latest_integration_snapshot(pool, tenant_id, "salesforce", "opportunity").await
    {
        salesforce_stages = count_by_field(&parse_snapshot_array(&opp.payload_json), "stage");
    }
    if let Ok(Some(proj)) =
        db::fetch_latest_integration_snapshot(pool, tenant_id, "zoho_projects", "project").await
    {
        zoho_project_status = count_by_field(&parse_snapshot_array(&proj.payload_json), "status");
    }

    let total_snapshot_records: i64 = snapshot_entities.iter().map(|e| e.record_count).sum();

    Ok(DashboardStats {
        routes_count: routes.len() as i64,
        client_keys_count,
        audit_24h: Audit24h {
            total: audit_24h.0,
            success: audit_24h.1,
            failure: audit_24h.2,
        },
        integrations,
        snapshot_entities,
        snapshot_timeline,
        salesforce_stages,
        zoho_project_status,
        total_snapshot_records,
    })
}

pub async fn api_dashboard_stats(ctx: &AdminCtx) -> Response {
    let Some(st) = STATE.get() else {
        return json_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "internal_error",
            "state not initialized",
        );
    };
    match build_dashboard_stats(&st.pool, ctx.tenant_id).await {
        Ok(stats) => (StatusCode::OK, Json(stats)).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": format!("{e}") })),
        )
            .into_response(),
    }
}
