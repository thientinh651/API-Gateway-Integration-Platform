# Tài liệu AVASO Gateway

Production: https://thientinh.io.vn

---

## Ôn bảo vệ / sổ tay sản phẩm

| File | Vai trò |
|------|---------|
| [`TaiLieuBaoCao/README.md`](TaiLieuBaoCao/README.md) | Sổ tay: kiến trúc, DB, quy trình, jump code, Q&A |

---

## Kỹ thuật cốt lõi

| File | Vai trò |
|------|---------|
| [`ROUTING_JWT_CORE.md`](ROUTING_JWT_CORE.md) | Routing + JWT + Benchmark |
| [`OAUTH2_IDENTITY.md`](OAUTH2_IDENTITY.md) | Token endpoint, Bearer flow |
| [`BENCHMARK.md`](BENCHMARK.md) | Benchmark NFR |

---

## Triển khai & vận hành

| File | Nội dung |
|------|----------|
| [`TRIEN_KHAI.md`](TRIEN_KHAI.md) | VPS, systemd, Nginx |
| [`TRIEN_KHAI_DOCKER.md`](TRIEN_KHAI_DOCKER.md) | Docker Compose |
| [`VAN_HANH.md`](VAN_HANH.md) | Runbook production |
| [`XU_LY_502_BAD_GATEWAY.md`](XU_LY_502_BAD_GATEWAY.md) | Xử lý 502 |

---

## Tích hợp & CSDL

| File | Nội dung |
|------|----------|
| [`TICH_HOP_SALESFORCE.md`](TICH_HOP_SALESFORCE.md) | OAuth Salesforce |
| [`TICH_HOP_ZOHO_DELIVERY.md`](TICH_HOP_ZOHO_DELIVERY.md) | Zoho hoàn thành → SF (đồng bộ định kỳ) |
| [`INTEGRATION_DB_DESIGN.md`](INTEGRATION_DB_DESIGN.md) | Schema tích hợp đa provider |
| [`schema_full_postgresql.sql`](schema_full_postgresql.sql) | Schema PostgreSQL (tham chiếu) |

Runtime áp schema qua `migrations/` (sqlx), không chạy `schema_full_*.sql` trực tiếp.

---

## Sơ đồ

| File | Mục đích |
|------|----------|
| [`diagrams/README.md`](diagrams/README.md) | Sơ đồ drawio / PNG |

---

## Script nhanh

```bash
./scripts/smoke-test.sh
./scripts/test-integrations.sh
docker compose up --build -d
```
