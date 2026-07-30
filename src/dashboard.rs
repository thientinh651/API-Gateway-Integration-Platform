//! Dashboard aggregation: integrations, snapshots, audit.

use axum::{
    Json,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;

use crate::admin_auth::AdminCtx;
use crate::db;
use crate::integrations;
use crate::{STATE, json_error};

#[derive(Debug, Deserialize)]
pub struct DashboardStatsQuery {
    /// Window length: 1 | 24 | 72 | 168 (default 24).
    pub hours: Option<i32>,
}

pub fn normalize_dashboard_hours(raw: Option<i32>) -> i32 {
    raw.unwrap_or(24).clamp(1, 8760)
}

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
pub struct AuditWindow {
    pub total: i64,
    pub success: i64,
    pub failure: i64,
}

#[derive(Debug, Serialize)]
pub struct TrafficWindow {
    pub total: i64,
    pub success: i64,
    pub denied: i64,
    pub upstream_error: i64,
    pub queued: i64,
    pub avg_duration_ms: f64,
}

#[derive(Debug, Serialize)]
pub struct ClientRegistryStats {
    pub total: i64,
    pub active: i64,
    pub disabled: i64,
}

#[derive(Debug, Serialize)]
pub struct ClientTrafficTopPublic {
    pub client_key_id: i64,
    pub name: String,
    pub total: i64,
}

#[derive(Debug, Serialize)]
pub struct DashboardStats {
    /// Selected window in hours (1 / 24 / 72 / 168 / 744).
    pub window_hours: i32,
    pub routes_count: i64,
    pub client_keys_count: i64,
    pub client_registry: ClientRegistryStats,
    /// Kept as `traffic_24h` for API compatibility — counts match `window_hours`.
    pub traffic_24h: TrafficWindow,
    pub traffic_status_buckets: Vec<LabelCount>,
    pub traffic_hourly: Vec<LabelCount>,
    pub traffic_top_paths: Vec<LabelCount>,
    pub traffic_methods: Vec<LabelCount>,
    pub traffic_denial_reasons: Vec<LabelCount>,
    pub client_traffic_top: Vec<ClientTrafficTopPublic>,
    pub audit_24h: AuditWindow,
    pub audit_top_actions: Vec<LabelCount>,
    pub audit_hourly: Vec<LabelCount>,
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
        let k = if key.is_empty() {
            "(trống)".into()
        } else {
            key
        };
        *map.entry(k).or_insert(0) += 1;
    }
    map.into_iter()
        .map(|(label, count)| LabelCount { label, count })
        .collect()
}

fn parse_snapshot_array(payload: &str) -> Vec<serde_json::Value> {
    serde_json::from_str::<Vec<serde_json::Value>>(payload).unwrap_or_default()
}

pub async fn build_dashboard_stats(
    pool: &PgPool,
    tenant_id: i64,
    include_integrations: bool,
    hours: i32,
) -> Result<DashboardStats, sqlx::Error> {
    let hours = normalize_dashboard_hours(Some(hours));
    let routes = db::list_routes_for_tenant(pool, tenant_id).await?;
    let client_keys_count = db::count_client_keys_for_tenant(pool, tenant_id).await?;
    let (client_active, client_disabled) = db::count_client_keys_by_status(pool, tenant_id).await?;
    let denial_rows = db::traffic_denial_reasons(pool, tenant_id, hours, 8).await?;
    let traffic_denial_reasons: Vec<LabelCount> = denial_rows
        .into_iter()
        .map(|(label, count)| LabelCount { label, count })
        .collect();
    let client_traffic_top: Vec<ClientTrafficTopPublic> =
        db::client_traffic_top(pool, tenant_id, hours, 8)
            .await?
            .into_iter()
            .map(|r| ClientTrafficTopPublic {
                client_key_id: r.client_key_id,
                name: r.name,
                total: r.total,
            })
            .collect();
    let audit_counts = db::audit_counts(pool, tenant_id, hours).await?;
    let traffic_counts = db::traffic_outcome_counts(pool, tenant_id, hours).await?;
    let traffic_status_rows = db::traffic_status_buckets(pool, tenant_id, hours).await?;
    let traffic_status_buckets: Vec<LabelCount> = traffic_status_rows
        .into_iter()
        .map(|(label, count)| LabelCount { label, count })
        .collect();
    let traffic_hourly_rows = db::traffic_series(pool, tenant_id, hours).await?;
    let traffic_hourly: Vec<LabelCount> = traffic_hourly_rows
        .into_iter()
        .map(|(label, count)| LabelCount { label, count })
        .collect();
    let traffic_path_rows = db::traffic_top_paths(pool, tenant_id, hours, 8).await?;
    let traffic_top_paths: Vec<LabelCount> = traffic_path_rows
        .into_iter()
        .map(|(label, count)| LabelCount { label, count })
        .collect();
    let traffic_method_rows = db::traffic_method_counts(pool, tenant_id, hours).await?;
    let traffic_methods: Vec<LabelCount> = traffic_method_rows
        .into_iter()
        .map(|(label, count)| LabelCount { label, count })
        .collect();
    let audit_action_rows = db::audit_top_actions(pool, tenant_id, hours, 8).await?;
    let audit_top_actions: Vec<LabelCount> = audit_action_rows
        .into_iter()
        .map(|(label, count)| LabelCount { label, count })
        .collect();
    let audit_hourly_rows = db::audit_series(pool, tenant_id, hours).await?;
    let audit_hourly: Vec<LabelCount> = audit_hourly_rows
        .into_iter()
        .map(|(label, count)| LabelCount { label, count })
        .collect();
    let (
        integrations,
        snapshot_entities,
        snapshot_timeline,
        salesforce_stages,
        zoho_project_status,
        total_snapshot_records,
    ) = if include_integrations {
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
            db::fetch_latest_integration_snapshot(pool, tenant_id, "salesforce", "opportunity")
                .await
        {
            salesforce_stages = count_by_field(&parse_snapshot_array(&opp.payload_json), "stage");
        }
        if let Ok(Some(proj)) =
            db::fetch_latest_integration_snapshot(pool, tenant_id, "zoho_projects", "project").await
        {
            zoho_project_status =
                count_by_field(&parse_snapshot_array(&proj.payload_json), "status");
        }

        let total_snapshot_records: i64 = snapshot_entities.iter().map(|e| e.record_count).sum();
        (
            integrations,
            snapshot_entities,
            snapshot_timeline,
            salesforce_stages,
            zoho_project_status,
            total_snapshot_records,
        )
    } else {
        (
            Vec::new(),
            Vec::new(),
            Vec::new(),
            Vec::new(),
            Vec::new(),
            0,
        )
    };

    Ok(DashboardStats {
        window_hours: hours,
        routes_count: routes.len() as i64,
        client_keys_count,
        client_registry: ClientRegistryStats {
            total: client_keys_count,
            active: client_active,
            disabled: client_disabled,
        },
        traffic_24h: TrafficWindow {
            total: traffic_counts.0,
            success: traffic_counts.1,
            denied: traffic_counts.2,
            upstream_error: traffic_counts.3,
            queued: traffic_counts.4,
            avg_duration_ms: (traffic_counts.5 * 10.0).round() / 10.0,
        },
        traffic_status_buckets,
        traffic_hourly,
        traffic_top_paths,
        traffic_methods,
        traffic_denial_reasons,
        client_traffic_top,
        audit_24h: AuditWindow {
            total: audit_counts.0,
            success: audit_counts.1,
            failure: audit_counts.2,
        },
        audit_top_actions,
        audit_hourly,
        integrations,
        snapshot_entities,
        snapshot_timeline,
        salesforce_stages,
        zoho_project_status,
        total_snapshot_records,
    })
}

pub async fn api_dashboard_stats(ctx: &AdminCtx, hours: Option<i32>) -> Response {
    let Some(st) = STATE.get() else {
        return json_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "internal_error",
            "state not initialized",
        );
    };
    let hours = normalize_dashboard_hours(hours);
    match build_dashboard_stats(&st.pool, ctx.tenant_id, ctx.is_admin(), hours).await {
        Ok(stats) => (StatusCode::OK, Json(stats)).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": format!("{e}") })),
        )
            .into_response(),
    }
}
