//! Runtime counters for `/metrics` (JSON + Prometheus text).

use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

const LATENCY_BOUNDS_MS: &[u64] = &[5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000];

#[derive(Debug, Default)]
pub struct GatewayMetrics {
    started_at_unix: AtomicU64,
    data_plane_requests: AtomicU64,
    data_plane_success: AtomicU64,
    data_plane_denied: AtomicU64,
    data_plane_errors: AtomicU64,
    rate_limit_hits: AtomicU64,
    latency_buckets: [AtomicU64; LATENCY_BOUNDS_MS.len()],
    latency_inf: AtomicU64,
    latency_sum_ms: AtomicU64,
    latency_count: AtomicU64,
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

    pub fn record_rate_limit_hit(&self) {
        self.rate_limit_hits.fetch_add(1, Ordering::Relaxed);
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

    pub fn record_latency(&self, elapsed_ms: u128) {
        let ms = elapsed_ms.min(u64::MAX as u128) as u64;
        self.latency_count.fetch_add(1, Ordering::Relaxed);
        self.latency_sum_ms.fetch_add(ms, Ordering::Relaxed);
        for (i, bound) in LATENCY_BOUNDS_MS.iter().enumerate() {
            if ms <= *bound {
                self.latency_buckets[i].fetch_add(1, Ordering::Relaxed);
            }
        }
        self.latency_inf.fetch_add(1, Ordering::Relaxed);
    }

    pub fn snapshot(&self) -> serde_json::Value {
        let started = self.started_at_unix();
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(started);
        let mut latency_histogram = serde_json::Map::new();
        for (i, bound) in LATENCY_BOUNDS_MS.iter().enumerate() {
            latency_histogram.insert(
                format!("le_{bound}"),
                self.latency_buckets[i].load(Ordering::Relaxed).into(),
            );
        }
        latency_histogram.insert(
            "le_inf".into(),
            self.latency_count.load(Ordering::Relaxed).into(),
        );
        serde_json::json!({
            "service": "avaso-gateway",
            "format": "json",
            "uptime_secs": now.saturating_sub(started),
            "data_plane": {
                "requests_total": self.data_plane_requests.load(Ordering::Relaxed),
                "success_total": self.data_plane_success.load(Ordering::Relaxed),
                "denied_total": self.data_plane_denied.load(Ordering::Relaxed),
                "errors_total": self.data_plane_errors.load(Ordering::Relaxed),
                "rate_limit_hits_total": self.rate_limit_hits.load(Ordering::Relaxed),
            },
            "latency_ms": {
                "count": self.latency_count.load(Ordering::Relaxed),
                "sum": self.latency_sum_ms.load(Ordering::Relaxed),
                "histogram": latency_histogram,
            },
            "prometheus": "/metrics?format=prometheus",
        })
    }

    pub fn prometheus_text(&self) -> String {
        let started = self.started_at_unix();
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(started);
        let uptime = now.saturating_sub(started);
        let req = self.data_plane_requests.load(Ordering::Relaxed);
        let ok = self.data_plane_success.load(Ordering::Relaxed);
        let denied = self.data_plane_denied.load(Ordering::Relaxed);
        let err = self.data_plane_errors.load(Ordering::Relaxed);
        let rl_hits = self.rate_limit_hits.load(Ordering::Relaxed);
        let lat_count = self.latency_count.load(Ordering::Relaxed);
        let lat_sum = self.latency_sum_ms.load(Ordering::Relaxed);

        let mut out = String::new();
        out.push_str("# HELP gateway_uptime_seconds Process uptime.\n");
        out.push_str("# TYPE gateway_uptime_seconds gauge\n");
        out.push_str(&format!("gateway_uptime_seconds {uptime}\n"));
        out.push_str("# HELP gateway_data_plane_requests_total Data-plane requests.\n");
        out.push_str("# TYPE gateway_data_plane_requests_total counter\n");
        out.push_str(&format!("gateway_data_plane_requests_total {req}\n"));
        out.push_str("# HELP gateway_data_plane_success_total Successful data-plane requests.\n");
        out.push_str("# TYPE gateway_data_plane_success_total counter\n");
        out.push_str(&format!("gateway_data_plane_success_total {ok}\n"));
        out.push_str("# HELP gateway_data_plane_denied_total Denied data-plane requests.\n");
        out.push_str("# TYPE gateway_data_plane_denied_total counter\n");
        out.push_str(&format!("gateway_data_plane_denied_total {denied}\n"));
        out.push_str("# HELP gateway_data_plane_errors_total Data-plane upstream/other errors.\n");
        out.push_str("# TYPE gateway_data_plane_errors_total counter\n");
        out.push_str(&format!("gateway_data_plane_errors_total {err}\n"));
        out.push_str("# HELP gateway_rate_limit_hits_total Data-plane rate limit denials.\n");
        out.push_str("# TYPE gateway_rate_limit_hits_total counter\n");
        out.push_str(&format!("gateway_rate_limit_hits_total {rl_hits}\n"));
        out.push_str("# HELP gateway_request_duration_ms Request latency histogram (ms).\n");
        out.push_str("# TYPE gateway_request_duration_ms histogram\n");
        for (i, bound) in LATENCY_BOUNDS_MS.iter().enumerate() {
            let n = self.latency_buckets[i].load(Ordering::Relaxed);
            out.push_str(&format!(
                "gateway_request_duration_ms_bucket{{le=\"{bound}\"}} {n}\n"
            ));
        }
        out.push_str(&format!(
            "gateway_request_duration_ms_bucket{{le=\"+Inf\"}} {lat_count}\n"
        ));
        out.push_str(&format!("gateway_request_duration_ms_sum {lat_sum}\n"));
        out.push_str(&format!("gateway_request_duration_ms_count {lat_count}\n"));
        out
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

    #[test]
    fn latency_histogram_and_prometheus() {
        let m = GatewayMetrics::new();
        m.record_latency(3);
        m.record_latency(120);
        m.record_latency(9000);
        let snap = m.snapshot();
        assert_eq!(snap["latency_ms"]["count"], 3);
        let prom = m.prometheus_text();
        assert!(prom.contains("gateway_request_duration_ms_bucket"));
        assert!(prom.contains("gateway_data_plane_requests_total"));
    }
}
