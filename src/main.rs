use axum::{routing::get, Router, extract::State};
use serde::Deserialize;
use std::fs;
use std::sync::Arc;

// 1. Định nghĩa cấu trúc file cấu hình
#[derive(Debug, Deserialize, Clone)]
struct RouteConfig {
    path: String,
    target: String,
}

#[derive(Debug, Deserialize, Clone)]
struct AppConfig {
    routes: Vec<RouteConfig>,
}

#[tokio::main]
async fn main() {
    // 2. Đọc file config.yaml
    let config_str = fs::read_to_string("config.yaml")
        .expect("Không tìm thấy file config.yaml");
    let config: AppConfig = serde_yaml::from_str(&config_str)
        .expect("Lỗi định dạng file YAML");
    
    // Chia sẻ config cho toàn bộ server (Arc là con trỏ dùng chung)
    let shared_config = Arc::new(config);

    // 3. Xây dựng App
    let mut app = Router::new().route("/", get(|| async { "Avaso Gateway is running with Dynamic Config!" }));

    // In ra danh sách các route đã load để kiểm tra
    for r in &shared_config.routes {
        println!("📡 Loaded Route: {} -> {}", r.path, r.target);
        // Ở bước này, ta chỉ mới load config. 
        // Logic xử lý chuyển tiếp (Proxy) thực sự sẽ nằm ở bước tiếp theo.
    }

    let listener = tokio::net::TcpListener::bind("0.0.0.0:3000").await.unwrap();
    println!("🚀 Gateway Ready tại port 3000");
    axum::serve(listener, app).await.unwrap();
}
