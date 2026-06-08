//! Route matching: HTTP method filter + path params `{id}`.

use std::collections::HashMap;

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

pub fn method_allowed(allowed: &str, method: &str) -> bool {
    let m = method.trim().to_ascii_uppercase();
    let raw = allowed.trim();
    if raw.is_empty() || raw == "*" {
        return true;
    }
    raw.split(',')
        .map(|s| s.trim().to_ascii_uppercase())
        .any(|a| a == m)
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

pub fn validate_allowed_methods(raw: &str) -> bool {
    let raw = raw.trim();
    if raw.is_empty() || raw == "*" {
        return true;
    }
    const OK: &[&str] = &[
        "GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS",
    ];
    raw.split(',').all(|part| {
        let m = part.trim().to_ascii_uppercase();
        !m.is_empty() && OK.contains(&m.as_str())
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::RouteRow;

    fn row(path: &str, target: &str, methods: &str) -> RouteRow {
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
            retry_on_status: "502,503,504".into(),
            retry_on_timeout: 1,
            queue_on_failure: 0,
            allowed_methods: methods.into(),
        }
    }

    #[test]
    fn prefix_route_backward_compat() {
        let routes = vec![row("/v1/api/orders", "http://up/orders", "*")];
        let m = find_route(&routes, "GET", "/v1/api/orders/42").unwrap();
        assert_eq!(m.suffix, "/42");
        assert_eq!(
            build_upstream_url(&m.route.target, &m.params, &m.suffix),
            "http://up/orders/42"
        );
    }

    #[test]
    fn param_route_substitutes_target() {
        let routes = vec![row(
            "/v1/api/users/{id}",
            "https://api.example/users/{id}",
            "GET",
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
        let routes = vec![row("/v1/api/foo", "http://up", "GET")];
        assert!(find_route(&routes, "POST", "/v1/api/foo").is_none());
        assert!(find_route(&routes, "GET", "/v1/api/foo").is_some());
    }

    #[test]
    fn longest_prefix_wins() {
        let routes = vec![
            row("/v1/api", "http://a", "*"),
            row("/v1/api/special", "http://b", "*"),
        ];
        let m = find_route(&routes, "GET", "/v1/api/special/x").unwrap();
        assert_eq!(m.route.target, "http://b");
    }
}
