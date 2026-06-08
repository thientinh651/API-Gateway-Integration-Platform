# Luận văn — danh sách sửa (khớp code thật)

Tài liệu này liệt kê **chỗ sai / thiếu** trong `Tài liệu LVTN.docx` so với codebase `avaso-gateway`, và **câu thay thế** khi bảo vệ.

Nguồn sự thật: code Rust (`src/`), React (`web/`), deploy (`deploy/`).

---

## 1. Sửa ngay trong Word (bắt buộc)

| # | Đang viết (sai / thiếu) | Sửa thành (đúng code) |
|---|-------------------------|------------------------|
| 1 | Mức vật lý: **SQLite** | **PostgreSQL** (route, user, key, audit, integration) + **Redis** (session admin, OTP quên MK) |
| 2 | Data plane: **JWT Token** | **HMAC-SHA256**: `X-API-Key`, `X-Timestamp`, `X-Signature` |
| 3 | Route đọc **file YAML** mỗi request | Route lưu **PostgreSQL**; `config.yaml` chỉ **seed lần đầu**; runtime đọc **RAM** (`reload_runtime_config`) |
| 4 | Hot reload: **SIGHUP + routes.yaml** | Sau CRUD route trên Dashboard → API lưu DB → `reload_runtime_config()` — **không restart**, **không SIGHUP** |
| 5 | Dashboard → Gateway: **Redis Pub/Sub** | **Không có Pub/Sub** — reload config in-memory sau API admin |
| 6 | Transaction log: **Redis buffer → bulk Postgres** | **`tokio::spawn`** → INSERT async trực tiếp `gateway_transaction_logs` — không chặn response; Redis buffer = **hướng mở rộng** |
| 7 | Chương 3 bảng CSDL: placeholder “chi tiêu” | Thay bằng bảng thật: `dashboard_users`, `routes`, `client_api_keys`, `gateway_transaction_logs`, `audit_logs`, `integrations`, … — xem [`DATABASE_SCHEMA.md`](DATABASE_SCHEMA.md) |
| 8 | TC_02–TC_12 trống | Điền từ [`HUONG_DAN_TEST_CHI_TIET.md`](HUONG_DAN_TEST_CHI_TIET.md) |
| 9 | Chương 5 kết luận cắt cụt | Hoàn thiện theo mục 4 bên dưới |
| 10 | Thiếu quên MK / Brevo / đăng ký Viewer | Bổ sung vào Identity + Chương 4 |

---

## 2. Không nói khi HĐ (chưa implement)

- Prometheus `/metrics` chuẩn (hiện JSON counters)
- Hot reload file YAML bằng SIGHUP
- Redis Pub/Sub đồng bộ route
- Transaction log qua Redis List + worker batch
- Path params `{id}` trên route (hiện prefix match)
- HTTP/2 native trên Axum (TLS do Nginx)

---

## 3. Nói được — có file chứng minh

| Nội dung | File / lệnh |
|----------|-------------|
| Longest prefix match | `src/main.rs` ~4329–4334 |
| HMAC + replay | `src/main.rs` `verify_client_auth`, `scripts/test_hmac_replay.py` |
| Rate limit token bucket | `src/main.rs` `TokenBucket` |
| Transform / retry / DLQ | `src/proxy_ext.rs`, UI `ProxyQueue.tsx` |
| Session Redis | `src/session.rs` |
| RBAC 2 lớp | `src/admin_auth.rs`, `web/src/lib/rbac.ts` |
| OAuth SF/Zoho | `src/integrations.rs` |
| Quên MK 3 bước + Brevo | `src/password_reset.rs`, `ForgotPassword.tsx` |
| Docker HA | `docker-compose.ha.yml`, `docs/DOCKER_HA_DEMO.md` |
| Benchmark / evidence | `scripts/benchmark-gateway.sh`, `data/thesis-evidence/` |

---

## 4. Đoạn kết luận mẫu (Chương 5)

**Chức năng:** Đồ án hiện thực 15 phân hệ lớn (xem [`KIEN_TRUC_THUC_TE.md`](KIEN_TRUC_THUC_TE.md)): API Gateway data plane (proxy, routing động, HMAC, rate limit, pipeline), observability (transaction + audit log), control plane (dashboard, session, RBAC, identity, client key), tích hợp Salesforce/Zoho OAuth, triển khai production DigitalOcean + Docker HA.

**Kỹ thuật:** Rust/Tokio/Axum, PostgreSQL, Redis, React SPA; phân tách data plane / admin plane; mã nguồn mở, chỉnh sửa và mở rộng được.

**Hạn chế:** Queue/DLQ in-memory; metrics chưa Prometheus; transaction log ghi thẳng Postgres (async spawn); chưa hot-reload file YAML; benchmark cần bổ sung wrk/oha trên VPS.

**Hướng phát triển:** Redis buffer log, Prometheus exporter, persistent DLQ, path params route, OIDC client (ngoài phạm vi hiện tại).

---

## 5. Sơ đồ Draw.io (bảo vệ)

| File | Cách dùng |
|------|-----------|
| `docs/diagrams/BAO_VE_KIEN_TRUC.drawio` | Mở draw.io → Export PNG → chèn Word Chương 2/3 |
| `docs/diagrams/LUONG_DATA_PLANE.drawio` | Sequence HMAC |

Xem [`diagrams/README.md`](diagrams/README.md).

---

## 6. Tài liệu repo (đã tạo / cập nhật)

| File | Mục đích |
|------|----------|
| [`KIEN_TRUC_THUC_TE.md`](KIEN_TRUC_THUC_TE.md) | Giải thích 15 chức năng lớn — bảo vệ |
| [`MA_TRAN_DONG_AN.md`](MA_TRAN_DONG_AN.md) | Ma trận FR ↔ code |
| [`HMAC_MIDDLEWARE_FLOW.md`](HMAC_MIDDLEWARE_FLOW.md) | Luồng HMAC |
| [`HUONG_DAN_TEST_CHI_TIET.md`](HUONG_DAN_TEST_CHI_TIET.md) | TC_01–TC_15 |
| [`BENCHMARK.md`](BENCHMARK.md) | NFR + cách đo |
| [`DEMO_BAO_VE.md`](DEMO_BAO_VE.md) | Kịch bản demo HĐ |
| [`DATABASE_SCHEMA.md`](DATABASE_SCHEMA.md) | Bảng PostgreSQL |

Chạy patch Word:

```bash
python3 scripts/patch_lvtn_docx.py
```
