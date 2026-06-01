//! Runtime counters for `/metrics` (JSON MVP — đủ chứng minh NFR đồ án).

use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Default)]
pub struct GatewayMetrics {
    started_at_unix: AtomicU64,
    data_plane_requests: AtomicU64,
    data_plane_success: AtomicU64,
    data_plane_denied: AtomicU64,
    data_plane_errors: AtomicU64,
}

impl GatewayMetrics {
    pub fn new() -> Self {
        let started = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        Self {
            started_at_unix: AtomicU64::new(started),
            ..Default::default()
        }
    }

    pub fn started_at_unix(&self) -> u64 {
        self.started_at_unix.load(Ordering::Relaxed)
    }

    pub fn record_data_plane(&self, outcome: &str) {
        self.data_plane_requests.fetch_add(1, Ordering::Relaxed);
        match outcome {
            "success" => {
                self.data_plane_success.fetch_add(1, Ordering::Relaxed);
            }
            "denied" => {
                self.data_plane_denied.fetch_add(1, Ordering::Relaxed);
            }
            _ => {
                self.data_plane_errors.fetch_add(1, Ordering::Relaxed);
            }
        }
    }

    pub fn snapshot(&self) -> serde_json::Value {
        let started = self.started_at_unix();
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(started);
        serde_json::json!({
            "service": "avaso-gateway",
            "format": "json",
            "uptime_secs": now.saturating_sub(started),
            "data_plane": {
                "requests_total": self.data_plane_requests.load(Ordering::Relaxed),
                "success_total": self.data_plane_success.load(Ordering::Relaxed),
                "denied_total": self.data_plane_denied.load(Ordering::Relaxed),
                "errors_total": self.data_plane_errors.load(Ordering::Relaxed),
            },
            "note": "Counters từ transaction log data-plane; tắt qua Settings → enable_metrics"
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn counters_increment() {
        let m = GatewayMetrics::new();
        m.record_data_plane("success");
        m.record_data_plane("denied");
        m.record_data_plane("upstream_error");
        let snap = m.snapshot();
        assert_eq!(snap["data_plane"]["requests_total"], 3);
        assert_eq!(snap["data_plane"]["success_total"], 1);
        assert_eq!(snap["data_plane"]["denied_total"], 1);
        assert_eq!(snap["data_plane"]["errors_total"], 1);
    }
}
