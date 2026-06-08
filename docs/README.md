# Tài liệu đồ án AVASO Gateway

## Bảo vệ luận văn (đọc theo thứ tự)

1. [`LUAN_VAN_SUA_DOI.md`](LUAN_VAN_SUA_DOI.md) — **Sửa gì trong Word**, câu trả lời HĐ
2. [`KIEN_TRUC_THUC_TE.md`](KIEN_TRUC_THUC_TE.md) — 15 chức năng lớn, khớp code
3. [`MA_TRAN_DONG_AN.md`](MA_TRAN_DONG_AN.md) — Ma trận FR ↔ code
4. [`DEMO_BAO_VE.md`](DEMO_BAO_VE.md) — Kịch bản demo 15 phút
5. [`HUONG_DAN_TEST_CHI_TIET.md`](HUONG_DAN_TEST_CHI_TIET.md) — TC Chương 4

## Sơ đồ Draw.io (slide / Word)

| File | Mục đích |
|------|----------|
| [`TICH_HOP_SALESFORCE.md`](TICH_HOP_SALESFORCE.md) | Salesforce Connected App + `setup-salesforce.sh` |
| [`diagrams/BAO_VE_KIEN_TRUC.drawio`](diagrams/BAO_VE_KIEN_TRUC.drawio) | **Kiến trúc bảo vệ** — import draw.io |
| [`diagrams/LUONG_DATA_PLANE.drawio`](diagrams/LUONG_DATA_PLANE.drawio) | Sequence data plane |
| [`diagrams/README.md`](diagrams/README.md) | Cách mở + export PNG |

## Kỹ thuật

| File | Nội dung |
|------|----------|
| [`HMAC_MIDDLEWARE_FLOW.md`](HMAC_MIDDLEWARE_FLOW.md) | Luồng HMAC data plane |
| [`MO_HINH_BAO_MAT.md`](MO_HINH_BAO_MAT.md) | Mô hình bảo mật |
| [`RBAC_LVTN.md`](RBAC_LVTN.md) | Ma trận RBAC |
| [`DATABASE_SCHEMA.md`](DATABASE_SCHEMA.md) | Bảng PostgreSQL (Chương 3) |
| [`BENCHMARK.md`](BENCHMARK.md) | NFR + benchmark |
| [`DOCKER_HA_DEMO.md`](DOCKER_HA_DEMO.md) | HA demo |

## Word

```bash
python3 scripts/patch_lvtn_docx.py   # sửa Tài liệu LVTN.docx
```

File gốc: `Tài liệu LVTN.docx`, bản đầy đủ tham khảo: `Document.docx`
