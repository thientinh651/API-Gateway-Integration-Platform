# Sơ đồ Draw.io — bảo vệ đồ án

## Mở file

1. [draw.io](https://app.diagrams.net) hoặc VS Code extension Draw.io
2. **File → Open** → chọn file `.drawio` trong thư mục này

**Export PNG tự động (VPS):**

```bash
./scripts/export-drawio-png.sh
# hoặc: npx draw.io-export@0.3.0 BAO_VE_KIEN_TRUC.drawio -o BAO_VE_KIEN_TRUC.png -F png
```

PNG đã có sẵn cùng thư mục — `patch_lvtn_docx.py` chèn vào Word.
3. Export PNG/SVG cho slide Word: **File → Export as → PNG**

## File

| File | Nội dung |
|------|----------|
| [`BAO_VE_KIEN_TRUC.drawio`](BAO_VE_KIEN_TRUC.drawio) | **Chính** — toàn cảnh 15 chức năng, khớp code |
| [`LUONG_DATA_PLANE.drawio`](LUONG_DATA_PLANE.drawio) | Sequence 1 request HMAC |

## Chèn vào Word

Export `BAO_VE_KIEN_TRUC.png` → Chương 2 hoặc 3 — “Sơ đồ kiến trúc hệ thống”.

## Khớp code

- `reload_runtime_config()` — không Pub/Sub, không SIGHUP
- HMAC — không JWT
- PostgreSQL + Redis — không SQLite
- Tx log: `tokio::spawn` → PG

Chi tiết: [`../KIEN_TRUC_THUC_TE.md`](../KIEN_TRUC_THUC_TE.md)
