use axum::{
    Json, Router,
    extract::Query,
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::get,
};
use serde::Deserialize;
use serde_json::json;
use tokio::time::{Duration, sleep};

pub fn router() -> Router {
    Router::new()
        .route("/mock/report/success", get(report_success))
        .route("/mock/report/empty", get(report_empty))
        .route("/mock/report/invalid", get(report_invalid))
        .route("/mock/report/unauthorized", get(report_unauthorized))
        .route("/mock/report/not-found", get(report_not_found))
        .route("/mock/report/server-error", get(report_server_error))
        .route("/mock/report/delay", get(report_delay))
        .route("/testAPI/get", get(report_success))
        .route("/testAPI/empty", get(report_empty))
        .route("/testAPI/invalid", get(report_invalid))
        .route("/testAPI/unauthorized", get(report_unauthorized))
        .route("/testAPI/not-found", get(report_not_found))
        .route("/testAPI/server-error", get(report_server_error))
        .route("/testAPI/delay", get(report_delay))
}

async fn report_success() -> Response {
    (
        StatusCode::OK,
        Json(json!({
            "status": "success",
            "message": "Mock report data ready",
            "result": [
                {
                    "id": 1,
                    "report_code": "RPT-001",
                    "customer": "Avaso Demo",
                    "total": 1250000,
                    "currency": "VND",
                    "created_at": "2026-07-30T16:30:00Z"
                },
                {
                    "id": 2,
                    "report_code": "RPT-002",
                    "customer": "Thien Tinh Demo",
                    "total": 980000,
                    "currency": "VND",
                    "created_at": "2026-07-30T16:35:00Z"
                }
            ],
            "meta": {
                "source": "mock-api",
                "count": 2
            }
        })),
    )
        .into_response()
}

async fn report_empty() -> Response {
    (
        StatusCode::OK,
        Json(json!({
            "status": "success",
            "message": "No report data",
            "result": [],
            "meta": {
                "source": "mock-api",
                "count": 0
            }
        })),
    )
        .into_response()
}

async fn report_invalid() -> Response {
    (
        StatusCode::OK,
        Json(json!({
            "status": "success",
            "message": "Invalid mock shape for parser test",
            "result": {
                "unexpected": true,
                "reason": "result should be an array in normal success case"
            },
            "meta": "invalid-meta-type"
        })),
    )
        .into_response()
}

async fn report_unauthorized() -> Response {
    (
        StatusCode::UNAUTHORIZED,
        Json(json!({
            "error": "unauthorized",
            "message": "Mock unauthorized response"
        })),
    )
        .into_response()
}

async fn report_not_found() -> Response {
    (
        StatusCode::NOT_FOUND,
        Json(json!({
            "error": "not_found",
            "message": "Mock report resource not found"
        })),
    )
        .into_response()
}

async fn report_server_error() -> Response {
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(json!({
            "error": "server_error",
            "message": "Mock internal server error"
        })),
    )
        .into_response()
}

#[derive(Debug, Deserialize)]
struct DelayQuery {
    ms: Option<u64>,
    code: Option<u16>,
}

async fn report_delay(Query(query): Query<DelayQuery>) -> Response {
    let delay_ms = query.ms.unwrap_or(3_000).min(30_000);
    sleep(Duration::from_millis(delay_ms)).await;

    let status = query
        .code
        .and_then(|code| StatusCode::from_u16(code).ok())
        .unwrap_or(StatusCode::OK);

    (
        status,
        Json(json!({
            "status": if status.is_success() { "success" } else { "error" },
            "message": "Mock delayed response",
            "delay_ms": delay_ms,
            "result": [
                {
                    "id": 99,
                    "report_code": "RPT-DELAY",
                    "customer": "Timeout Demo"
                }
            ]
        })),
    )
        .into_response()
}
