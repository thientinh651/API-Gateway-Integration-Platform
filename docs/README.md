# Tài liệu AVASO Gateway

Production: https://thientinh.io.vn

---

## Viết báo cáo luận văn

| File | Vai trò |
|------|---------|
| **[`BAO_CAO.md`](BAO_CAO.md)** | **Bắt đầu ở đây** — outline 5 chương khớp mục lục Word |
| [`BAN_VE_HE_THONG.md`](BAN_VE_HE_THONG.md) | Bản vẽ kỹ thuật đầy đủ (SSOT implementation) |
| [`DEMO_BAO_VE.md`](DEMO_BAO_VE.md) | Kịch bản demo 15 phút |
| [`MA_TRAN_DONG_AN.md`](MA_TRAN_DONG_AN.md) | Ma trận FR ↔ code |

---

## Triển khai & vận hành

| File | Nội dung |
|------|----------|
| [`TRIEN_KHAI.md`](TRIEN_KHAI.md) | VPS, systemd, Nginx |
| [`TRIEN_KHAI_DOCKER.md`](TRIEN_KHAI_DOCKER.md) | Docker Compose Deployment |
| [`VAN_HANH.md`](VAN_HANH.md) | Runbook production |
| [`XU_LY_502_BAD_GATEWAY.md`](XU_LY_502_BAD_GATEWAY.md) | Xử lý 502 |

---

## Tích hợp (cấu hình OAuth)

| File | Nội dung |
|------|----------|
| [`TICH_HOP_SALESFORCE.md`](TICH_HOP_SALESFORCE.md) | OAuth Salesforce |
| [`TICH_HOP_ZOHO_PROJECTS.md`](TICH_HOP_ZOHO_PROJECTS.md) | OAuth Zoho Projects |
| [`TICH_HOP_ZOHO_OFFICE.md`](TICH_HOP_ZOHO_OFFICE.md) | PDF hợp đồng (phụ) |

---

## Kỹ thuật tham chiếu

| File | Nội dung |
|------|----------|
| [`DATABASE_SCHEMA.md`](DATABASE_SCHEMA.md) | Bảng PostgreSQL |
| [`HMAC_MIDDLEWARE_FLOW.md`](HMAC_MIDDLEWARE_FLOW.md) | Luồng HMAC |
| [`MO_HINH_BAO_MAT.md`](MO_HINH_BAO_MAT.md) | Bảo mật |
| [`RBAC_LVTN.md`](RBAC_LVTN.md) | Phân quyền |
| [`HUONG_DAN_TEST_CHI_TIET.md`](HUONG_DAN_TEST_CHI_TIET.md) | Test case |
| [`BENCHMARK.md`](BENCHMARK.md) | Benchmark NFR |
| [`TEAM_RUNBOOK.md`](TEAM_RUNBOOK.md) | Runbook team |

---

## Sơ đồ

| File | Mục đích |
|------|----------|
| [`diagrams/BAO_VE_KIEN_TRUC.drawio`](diagrams/BAO_VE_KIEN_TRUC.drawio) | Kiến trúc Word/slide |
| [`diagrams/LUONG_DATA_PLANE.drawio`](diagrams/LUONG_DATA_PLANE.drawio) | Sequence HMAC |
| [`diagrams/README.md`](diagrams/README.md) | Export PNG |

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
