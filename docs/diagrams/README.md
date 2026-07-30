# Sơ đồ Draw.io

| File | Dùng cho |
|------|----------|
| `SO_DO_USE_CASE.drawio` | Use case tổng quat |
| `SO_DO_CHUC_NANG.drawio` | Sơ đồ chức năng |
| `Avaso Gateway.png` | Hình kiến trúc |
| `Dia/ST-01_Gateway_Request.mmd` | Sequence data plane proxy (Mermaid nguồn, khớp code) |
| `Dia/ST-01_Gateway_Request.drawio.xml` | Cùng ST-01 — mở diagrams.net, Insert Mermaid từ `.mmd` nếu cần sửa |
| `Dia/ST-01_Gateway_Request.svg` | Bản render sẵn — chèn báo cáo |
| `Dia/ST-01_Gateway_Request.png` | Bản PNG sẵn — chèn báo cáo |

## ST-01 — nội dung đúng code

Hot path: route và ACL từ AppConfig (RAM); JWT trong process; thu hồi token và rate limit qua Redis; log Postgres async (`tokio::spawn`). Không SELECT Postgres mỗi request để tra route hoặc client.

Sửa sơ đồ: chỉnh `.mmd` rồi render lại, hoặc diagrams.net → Arrange → Insert → Advanced → Mermaid.

Export PNG từ Draw.io Desktop / app.diagrams.net khi cần chèn báo cáo.
