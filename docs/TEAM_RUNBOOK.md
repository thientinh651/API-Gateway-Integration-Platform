# Bước 0 — Nền chạy & luồng gateway (team)

**Test từng bước (website + SRS FR/NFR):** xem [`HUONG_DAN_TEST_CHI_TIET.md`](HUONG_DAN_TEST_CHI_TIET.md).

**Chạy production (systemd):** xem [`deploy/systemd/README.md`](../deploy/systemd/README.md).

`temp/Document.docx` không có trong repo; nội dung dưới bám SRS bạn mô tả + code hiện tại.

## Chạy gateway (Rust)

```bash
cd /root/avaso-gateway
export DATABASE_URL="sqlite:data/gateway.db"   # mặc định nếu không set
export ADMIN_X_API_KEY="key12345"            # chỉ dùng lần đầu khi chưa có hash admin trong DB
# export PORT=3001                            # tuỳ chọn nếu 3000 bị chiếm
cargo run
```

- **Port**: mặc định `3000`; đổi bằng `PORT=3001 cargo run`. Nếu cổng bận, process thoát với hướng dẫn (không còn in “đang chạy” trước khi bind).
- **`config.yaml`** (thư mục gốc khi `cargo run`):
  - `rate_limit` → đọc runtime (không nằm trong SQLite)
  - `routes` + `api_keys` → **bootstrap một lần** nếu bảng SQLite đang rỗng (seed), sau đó nguồn sự thật là DB
- **Admin API key**: hash SHA-256 lưu trong `gateway_settings.k = admin_x_api_key_sha256`. Lần đầu tạo từ `ADMIN_X_API_KEY` hoặc default dev `key12345`. Đổi key: cập nhật DB + restart hoặc sau này endpoint đổi admin (chưa có).

## Test UI

**Cách A — web (dev, proxy Vite)**

```bash
cd web
cp .env.example .env   # chỉnh VITE_ADMIN_X_API_KEY trùng secret admin đang dùng
npm install
npm run dev
```

Vite proxy `/api`, `/health`, `/metrics` → `VITE_GATEWAY_ORIGIN` (mặc định `http://127.0.0.1:3000`). Header admin từ `VITE_ADMIN_X_API_KEY`.

**Cách B — Static qua gateway**

```bash
cd web && npm run build   # → web/dist/
```

Mở `http://127.0.0.1:3000/` — gateway phục vụ `web/dist/` + SPA fallback.

## Luồng runtime (tóm tắt)

1. **Route upstream** đọc từ SQLite `gateway_routes` (longest-prefix match theo `path`).
2. **Data plane prefix** (mặc định `/v1/api`, env `DATA_PLANE_PREFIX`): mọi request dưới prefix này **bắt buộc** `X-API-Key` client hợp lệ (khi DB đã có client keys); không có route → **404 JSON**, không trả SPA. Ngoài prefix, proxy route legacy: nếu DB có client keys thì vẫn bắt buộc key như cũ.
3. **`/health`**, **`/metrics`**: JSON, **không** yêu cầu API key (SRS).
4. **Rate limit**: theo `config.yaml` → áp sau khi auth key (nếu bật).
5. **Reload cấu hình từ DB** (routes + hash client keys + hash admin): `POST /api/reload-config` với header admin `x-api-key`. Các endpoint admin mutating (CRUD route / key) sau khi ghi DB cũng gọi reload nội bộ.

## Admin API (Bước 1 — tối thiểu)

Tất cả dưới prefix `/api/…`, header **`x-api-key`** = plaintext admin (so với hash trong DB).

| Method | Path | Mô tả |
|--------|------|--------|
| GET | `/api/routes` | Danh sách route `{ id, path, target }` |
| POST | `/api/routes` | JSON `{ "path", "target" }` → 201 + row |
| PUT | `/api/routes/:id` | JSON `{ "path", "target" }` |
| DELETE | `/api/routes/:id` | 204 |
| GET | `/api/client-keys` | `{ id, name }[]` (không có secret) |
| POST | `/api/client-keys` | JSON `{ "name" }` → 201 + `{ id, name, api_key }` (**plaintext chỉ lần này**) |
| DELETE | `/api/client-keys/:id` | 204 |
| POST | `/api/reload-config` | Reload cache từ DB → JSON `{ "status", "message" }` |
| GET | `/api/proxy` | Demo upstream → JSON |

**Public (không API key):** `GET /health` → `{ "status": "ok" }`; `GET /metrics` → JSON stub (MVP).
