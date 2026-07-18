//! Route matching: HTTP method filter + path params `{id}`.

use std::collections::HashMap;

use serde::de::{self, Deserializer, Error as DeError};
use serde::Deserialize;

use crate::RouteRow;

#[derive(Debug, Clone)]
pub struct MatchedRoute {
    pub route: RouteRow,
    pub params: HashMap<String, String>,
    pub suffix: String,
}

fn segments(path: &str) -> Vec<&str> {
    path.trim_end_matches('/')
        .trim_start_matches('/')
        .split('/')
        .filter(|s| !s.is_empty())
        .collect()
}

pub fn default_retry_status_codes() -> Vec<i32> {
    vec![502, 503, 504]
}

pub fn default_allowed_methods_list() -> Vec<String> {
    vec!["*".into()]
}

pub fn parse_retry_status_str(raw: &str) -> Vec<i32> {
    let mut seen = HashMap::new();
    let mut out = Vec::new();
    for part in raw.split(',') {
        let part = part.trim();
        if part.is_empty() {
            continue;
        }
        if let Ok(n) = part.parse::<i32>() {
            if (100..=599).contains(&n) && !seen.contains_key(&n) {
                seen.insert(n, ());
                out.push(n);
            }
        }
    }
    out.sort_unstable();
    out
}

pub fn parse_allowed_methods_str(raw: &str) -> Vec<String> {
    let raw = raw.trim();
    if raw.is_empty() || raw == "*" {
        return default_allowed_methods_list();
    }
    const OK: &[&str] = &[
        "GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS",
    ];
    let mut seen = HashMap::new();
    let mut out = Vec::new();
    for part in raw.split(',') {
        let m = part.trim().to_ascii_uppercase();
        if m.is_empty() || !OK.contains(&m.as_str()) {
            continue;
        }
        if !seen.contains_key(&m) {
            seen.insert(m.clone(), ());
            out.push(m);
        }
    }
    if out.is_empty() {
        default_allowed_methods_list()
    } else {
        out
    }
}

pub fn normalize_retry_status_codes(codes: Vec<i32>) -> Vec<i32> {
    let mut seen = HashMap::new();
    let mut out = Vec::new();
    for c in codes {
        if (100..=599).contains(&c) && !seen.contains_key(&c) {
            seen.insert(c, ());
            out.push(c);
        }
    }
    out.sort_unstable();
    out
}

pub fn normalize_allowed_methods_list(methods: Vec<String>) -> Vec<String> {
    if methods.is_empty() {
        return default_allowed_methods_list();
    }
    let upper: Vec<String> = methods
        .into_iter()
        .map(|m| m.trim().to_ascii_uppercase())
        .filter(|m| !m.is_empty())
        .collect();
    if upper.is_empty() || upper.iter().any(|m| m == "*") {
        return default_allowed_methods_list();
    }
    let mut seen = HashMap::new();
    let mut out = Vec::new();
    for m in upper {
        if !seen.contains_key(&m) {
            seen.insert(m.clone(), ());
            out.push(m);
        }
    }
    out
}

pub fn method_allowed(allowed: &[String], method: &str) -> bool {
    if allowed.is_empty() || allowed.iter().any(|a| a == "*") {
        return true;
    }
    let m = method.trim().to_ascii_uppercase();
    allowed.iter().any(|a| a == &m)
}

fn match_pattern(pattern: &str, path: &str) -> Option<(HashMap<String, String>, String)> {
    let pat = pattern.trim_end_matches('/');
    if !pattern.contains('{') {
        if path == pat {
            return Some((HashMap::new(), String::new()));
        }
        let prefix = format!("{pat}/");
        if path.starts_with(&prefix) {
            let suffix = path[pat.len()..].to_string();
            return Some((HashMap::new(), suffix));
        }
        return None;
    }

    let pat_segs = segments(pattern);
    let path_segs = segments(path);
    if path_segs.len() < pat_segs.len() {
        return None;
    }

    let mut params = HashMap::new();
    for (i, ps) in pat_segs.iter().enumerate() {
        let path_seg = path_segs[i];
        if ps.starts_with('{') && ps.ends_with('}') && ps.len() > 2 {
            let name = &ps[1..ps.len() - 1];
            params.insert(name.to_string(), path_seg.to_string());
        } else if *ps != path_seg {
            return None;
        }
    }

    let suffix = if path_segs.len() > pat_segs.len() {
        format!("/{}", path_segs[pat_segs.len()..].join("/"))
    } else {
        String::new()
    };
    Some((params, suffix))
}

fn specificity(pattern: &str) -> usize {
    segments(pattern)
        .iter()
        .map(|s| {
            if s.starts_with('{') && s.ends_with('}') {
                50
            } else {
                100 + s.len()
            }
        })
        .sum()
}

pub fn find_route(routes: &[RouteRow], method: &str, path: &str) -> Option<MatchedRoute> {
    routes
        .iter()
        .filter(|r| method_allowed(&r.allowed_methods, method))
        .filter_map(|r| {
            match_pattern(&r.path, path).map(|(params, suffix)| MatchedRoute {
                route: r.clone(),
                params,
                suffix,
            })
        })
        .max_by_key(|m| specificity(&m.route.path))
}

/// Ghép query client vào upstream URL (dùng `&` nếu target đã có `?`).
pub fn append_query_to_upstream_url(base: &str, query: &str) -> String {
    let q = query.trim();
    if q.is_empty() {
        return base.to_string();
    }
    if base.contains('?') {
        let sep = if base.ends_with('?') || base.ends_with('&') {
            ""
        } else {
            "&"
        };
        format!("{base}{sep}{q}")
    } else {
        format!("{base}?{q}")
    }
}

pub fn build_upstream_url(
    target: &str,
    params: &HashMap<String, String>,
    suffix: &str,
) -> String {
    let mut url = target.to_string();
    for (k, v) in params {
        url = url.replace(&format!("{{{k}}}"), v);
    }
    let base = url.trim_end_matches('/');
    if suffix.is_empty() {
        base.to_string()
    } else if suffix.starts_with('/') {
        format!("{base}{suffix}")
    } else {
        format!("{base}/{suffix}")
    }
}

pub fn validate_allowed_methods_list(methods: &[String]) -> bool {
    if methods.is_empty() || methods.iter().any(|a| a == "*") {
        return true;
    }
    const OK: &[&str] = &[
        "GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS",
    ];
    methods.iter().all(|m| OK.contains(&m.as_str()))
}

pub fn validate_retry_status_codes(codes: &[i32]) -> bool {
    codes.iter().all(|&c| (100..=599).contains(&c))
}

/// Accept JSON string (`"502,503"`) or array (`[502,503]`) for backward-compatible API input.
pub fn deserialize_retry_status<'de, D>(deserializer: D) -> Result<Vec<i32>, D::Error>
where
    D: Deserializer<'de>,
{
    let value = serde_json::Value::deserialize(deserializer)?;
    match value {
        serde_json::Value::String(s) => Ok(parse_retry_status_str(&s)),
        serde_json::Value::Array(items) => {
            let mut out = Vec::with_capacity(items.len());
            for item in items {
                let n = match item {
                    serde_json::Value::Number(num) => num
                        .as_i64()
                        .ok_or_else(|| DeError::custom("retry_on_status phải là số nguyên"))?
                        as i32,
                    serde_json::Value::String(s) => s
                        .parse::<i32>()
                        .map_err(|_| DeError::custom("retry_on_status phải là số nguyên"))?,
                    _ => return Err(DeError::custom("retry_on_status phải là string hoặc mảng số")),
                };
                out.push(n);
            }
            Ok(normalize_retry_status_codes(out))
        }
        _ => Err(DeError::custom("retry_on_status phải là string hoặc mảng số")),
    }
}

/// Accept JSON string (`"GET,POST"` / `"*"`) or array (`["GET","POST"]`) for API input.
pub fn deserialize_allowed_methods<'de, D>(deserializer: D) -> Result<Vec<String>, D::Error>
where
    D: Deserializer<'de>,
{
    let value = serde_json::Value::deserialize(deserializer)?;
    match value {
        serde_json::Value::String(s) => Ok(parse_allowed_methods_str(&s)),
        serde_json::Value::Array(items) => {
            let mut out = Vec::with_capacity(items.len());
            for item in items {
                let s = match item {
                    serde_json::Value::String(s) => s,
                    _ => return Err(DeError::custom("allowed_methods phải là string hoặc mảng chuỗi")),
                };
                out.push(s);
            }
            Ok(normalize_allowed_methods_list(out))
        }
        _ => Err(DeError::custom("allowed_methods phải là string hoặc mảng chuỗi")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::RouteRow;

    fn row(path: &str, target: &str, methods: Vec<String>) -> RouteRow {
        RouteRow {
            id: 1,
            path: path.into(),
            target: target.into(),
            timeout_secs: 30,
            rate_limit_per_min: 0,
            tenant_id: 1,
            transform_add_headers: "{}".into(),
            transform_remove_headers: "[]".into(),
            retry_max: 0,
            retry_on_status: default_retry_status_codes(),
            retry_on_timeout: 1,
            queue_on_failure: 0,
            allowed_methods: methods,
        }
    }

    #[test]
    fn prefix_route_backward_compat() {
        let routes = vec![row("/v1/api/orders", "http://up/orders", default_allowed_methods_list())];
        let m = find_route(&routes, "GET", "/v1/api/orders/42").unwrap();
        assert_eq!(m.suffix, "/42");
        assert_eq!(
            build_upstream_url(&m.route.target, &m.params, &m.suffix),
            "http://up/orders/42"
        );
    }

    #[test]
    fn append_query_plain_target() {
        assert_eq!(
            append_query_to_upstream_url(
                "https://api.openweathermap.org/data/2.5/weather",
                "q=Hanoi&appid=KEY"
            ),
            "https://api.openweathermap.org/data/2.5/weather?q=Hanoi&appid=KEY"
        );
    }

    #[test]
    fn append_query_target_already_has_params() {
        assert_eq!(
            append_query_to_upstream_url(
                "https://api.example/weather?appid=KEY",
                "q=Hanoi&units=metric"
            ),
            "https://api.example/weather?appid=KEY&q=Hanoi&units=metric"
        );
    }

    #[test]
    fn param_route_substitutes_target() {
        let routes = vec![row(
            "/v1/api/users/{id}",
            "https://api.example/users/{id}",
            vec!["GET".into()],
        )];
        let m = find_route(&routes, "GET", "/v1/api/users/99").unwrap();
        assert_eq!(m.params.get("id").map(String::as_str), Some("99"));
        assert_eq!(
            build_upstream_url(&m.route.target, &m.params, &m.suffix),
            "https://api.example/users/99"
        );
    }

    #[test]
    fn method_filter_blocks_post() {
        let routes = vec![row("/v1/api/foo", "http://up", vec!["GET".into()])];
        assert!(find_route(&routes, "POST", "/v1/api/foo").is_none());
        assert!(find_route(&routes, "GET", "/v1/api/foo").is_some());
    }

    #[test]
    fn longest_prefix_wins() {
        let routes = vec![
            row("/v1/api", "http://a", default_allowed_methods_list()),
            row("/v1/api/special", "http://b", default_allowed_methods_list()),
        ];
        let m = find_route(&routes, "GET", "/v1/api/special/x").unwrap();
        assert_eq!(m.route.target, "http://b");
    }

    #[test]
    fn method_allowed_star_and_list() {
        assert!(method_allowed(&["*".into()], "POST"));
        assert!(method_allowed(&[], "POST"));
        assert!(method_allowed(&["GET".into(), "POST".into()], "POST"));
        assert!(!method_allowed(&["GET".into()], "POST"));
    }

    #[test]
    fn parse_csv_to_arrays() {
        assert_eq!(parse_retry_status_str("502,503,504"), vec![502, 503, 504]);
        assert_eq!(parse_allowed_methods_str("*"), vec!["*"]);
        assert_eq!(parse_allowed_methods_str("GET,POST"), vec!["GET", "POST"]);
    }
}
