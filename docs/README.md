# Tài liệu AVASO Gateway

Production: https://thientinh.io.vn

Báo cáo Word/PDF (SSOT): [`../Báo cáo/Báo cáo LVTN.docx`](../Báo%20cáo/Báo%20cáo%20LVTN.docx)

---

## Báo cáo & ma trận đồ án

| File | Vai trò |
|------|---------|
| [`THESIS_CONTEXT.md`](THESIS_CONTEXT.md) | Ngữ cảnh bảo vệ / stack / trade-off |
| [`MA_TRAN_DO_AN.md`](MA_TRAN_DO_AN.md) | Ma trận FR ↔ code |
| [`TONG_QUAN_DO_AN_VA_DANH_GIA.md`](TONG_QUAN_DO_AN_VA_DANH_GIA.md) | Tổng quan + đánh giá |
| [`ROUTING_JWT_CORE.md`](ROUTING_JWT_CORE.md) | Trọng tâm bảo vệ — Routing + JWT + Benchmark |
| [`OAUTH2_IDENTITY.md`](OAUTH2_IDENTITY.md) | Token endpoint, Bearer flow |
| [`CHUONG_4_THU_NGHIEM.md`](CHUONG_4_THU_NGHIEM.md) | Chương thử nghiệm |
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

## Tích hợp

| File | Nội dung |
|------|----------|
| [`TICH_HOP_SALESFORCE.md`](TICH_HOP_SALESFORCE.md) | OAuth Salesforce |
| [`INTEGRATION_DB_DESIGN.md`](INTEGRATION_DB_DESIGN.md) | Schema tích hợp đa provider |
| [`RBAC_LVTN.md`](RBAC_LVTN.md) | Phân quyền |

---

## CSDL & ERD

| File | Nội dung |
|------|----------|
| [`schema_full_postgresql.sql`](schema_full_postgresql.sql) | Schema PostgreSQL (trạng thái cuối) |
| [`Nhap.txt`](Nhap.txt) | ERD PlantUML |

Runtime áp schema qua `migrations/` (sqlx), không chạy `schema_full_*.sql` trực tiếp.

---

## Sơ đồ

| File | Mục đích |
|------|----------|
| [`diagrams/README.md`](diagrams/README.md) | Hướng dẫn export (nếu có cây diagrams local) |

```bash
./scripts/export-drawio-png.sh
```

---

## Script nhanh

```bash
./scripts/smoke-test.sh
./scripts/test-integrations.sh
docker compose up --build -d
./scripts/collect-thesis-evidence.sh
```
