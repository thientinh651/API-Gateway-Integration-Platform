# Hướng dẫn test end-to-end (một luồng duy nhất)

Luồng này: **bật gateway → bật web → test gần hết trên website**; chỉ dùng **một lệnh `curl` cuối** để xác nhận proxy + client key (vì trang Vite `localhost:5173` gọi thẳng `127.0.0.1:3000` bị chặn CORS nếu không cấu hình thêm).

Chuẩn bị hai terminal + trình duyệt.

---

## Bước 0 — Chốt admin key cho cả bài test (quan trọng)

Bạn chọn **một** chuỗi làm admin, ví dụ: `HocSinhTest2026`

- Nó phải **trùng** ở: `ADMIN_X_API_KEY` (lúc chạy gateway **lần đầu** tạo DB) **và** `VITE_ADMIN_X_API_KEY` trong web `.env`.

**Nếu đã có file `data/gateway.db` từ trước** với key khác:

- Hoặc dùng đúng key cũ (không đổi được bằng env nữa),  
- Hoặc **xóa DB để làm lại từ đầu** (mất hết route/key trong DB):

```bash
cd ~/avaso-gateway
rm -f data/gateway.db
mkdir -p data
```

---

## Bước 1 — Terminal 1: chạy gateway

```bash
cd ~/avaso-gateway   # bắt buộc: cwd = thư mục có Cargo.toml (đường dẫn sqlite tương đối gắn cwd)
mkdir -p data         # tuỳ chọn; code cũng tự tạo thư mục cha + file DB nếu thiếu
export ADMIN_X_API_KEY='HocSinhTest2026'
export DATABASE_URL='sqlite:data/gateway.db'
# Nếu cổng 3000 bận: PORT=3001 cargo run  (và ở Bước 4 đổi VITE_GATEWAY_ORIGIN cho khớp)
cargo run
```

**Nếu chỉ thấy** `❌ Cổng 3000 đang bị chiếm` **(như log của bạn)** — SQLite đã ổn; gateway chưa chạy vì port bận. Chọn **một** cách:

```bash
# Cách A (gọn nhất) — tắt mọi process tên avaso-gateway
pkill -9 -f avaso-gateway
cargo run
```

Hoặc xem **đúng PID** (số sau `pid=` trong `users:((...`, **không** dùng số `128` ở cột `Recv-Q` — đó là hàng đợi socket, không phải PID):

```bash
ss -tlnp | grep ':3000'
kill -9 546560    # ví dụ: thay bằng số pid=... trên dòng vừa in
cargo run
```

Sau khi kill, nếu vẫn báo cổng bận: chạy lại `ss -tlnp | grep ':3000'` — có thể có **PID mới** (terminal khác, Cursor, hoặc service tự chạy lại).

Hoặc (Linux, có thể cần `sudo`):

```bash
fuser -k 3000/tcp
cargo run
```

```bash
# Cách B — giữ process cũ, chạy gateway cổng khác
PORT=3001 cargo run
```

Rồi ở **Bước 4** đặt `VITE_GATEWAY_ORIGIN=http://127.0.0.1:3001` trong `web/.env`.

**Kỳ vọng:** sau vài giây thấy dòng kiểu `Gateway đang lắng nghe: http://127.0.0.1:3000/` và **không** thoát process. Để terminal này **mở**.

Nếu lỗi **trước** dòng “đang lắng nghe”:

- `unable to open database file`: thường do **không** `cd` vào đúng repo, hoặc ổ không ghi được — thử lại từ `~/avaso-gateway`.
- `Address already in use`: cổng bận — dùng `PORT=3001` hoặc kill process cũ (xem message gateway).

---

## Bước 2 — Terminal 2: web

```bash
cd ~/avaso-gateway/web
cp -n .env.example .env   # Linux: bỏ qua nếu .env đã có; hoặc tạo tay .env
```

Mở file **`web/.env`** và sửa / thêm đúng hai dòng (trùng admin ở Bước 0):

```env
VITE_GATEWAY_ORIGIN=http://127.0.0.1:3000
VITE_ADMIN_X_API_KEY=HocSinhTest2026
```

(Nếu gateway dùng `PORT=3001` thì đổi origin thành `http://127.0.0.1:3001`.)

Chạy dev server:

```bash
npm install
npm run dev
```

**Kỳ vọng:** Vite in ra URL, thường `http://localhost:5173`. Mở URL đó trên trình duyệt.

---

## Bước 3 — Website: Tổng quan (Overview)

1. Vào trang chủ app (route `/` sau khi đăng nhập layout — thường là **Tổng quan / Overview**).
2. Đợi vài giây — bảng **danh sách route** load từ gateway (`GET /api/routes` qua proxy `/api`).

**Pass:** có bảng path/target (có thể rỗng hoặc có sẵn từ `config.yaml` bootstrap).  
**Fail:** toast lỗi / dòng vàng — thường do sai `VITE_ADMIN_X_API_KEY`, gateway tắt, hoặc `VITE_GATEWAY_ORIGIN` sai cổng.

**Cách nhìn “thật” hơn (tuỳ chọn):** F12 → tab **Network** → lọc `routes` → request `GET .../api/routes` → Status **200** và response là JSON mảng.

---

## Bước 4 — Website: Quản lý Route

1. Sidebar → **Quản lý Route** (`/routes`).
2. **Thêm route:** nút thêm / dialog → điền:
   - **Path:** `/thu-nghiem` (bắt đầu bằng `/`).
   - **Upstream URL:** `https://httpbin.org`  
   - Lưu / Tạo.

**Pass:** dòng mới xuất hiện trong bảng; lỗi 409 nếu path trùng.

3. **Sửa:** bấm sửa trên dòng vừa tạo → đổi ví dụ upstream thành `https://httpbin.org` (hoặc giữ) → Cập nhật.

**Pass:** bảng cập nhật, không toast lỗi.

4. **Xóa:** xóa route test (nếu UI có nút xóa).

**Pass:** dòng biến mất.

Toàn bộ bước này đang gọi **POST/PUT/DELETE** admin API + gateway reload cache trong code — không còn “chỉ sửa local UI”.

---

## Bước 5 — Website: API Keys (Auth)

1. Sidebar → mục kiểu **Bảo mật / Auth** (`/auth`).
2. **Tạo API key:** nút tạo → nhập tên ví dụ `web-test` → tạo trên gateway.

**Pass:** dialog hiện **một chuỗi key dạng `avaso_...`** — **copy ngay** vào Notepad (sau đó không xem lại được từ UI/DB).

3. Bảng dưới liệt kê **id + name** (không có full secret) — đúng thiết kế hash-only trong SQLite.

4. **Xóa key** (nếu cần dọn): nút xóa trên dòng → list cập nhật.

---

## Bước 6 — Xác nhận proxy + client key (một lệnh terminal)

Trước hết cần **ít nhất một route** trỏ tới httpbin và **client key** còn hiệu lực (plaintext bạn đã copy ở Bước 5). Nếu vừa xóa hết key, tạo lại một key và copy.

Trong **Terminal 3** (hoặc dùng lại Terminal 2 tạm thời, miễn không kill dev server — có thể mở tab terminal mới):

```bash
# Thay CLIENT_KEY bằng chuỗi avaso_... vừa copy
curl -sS -o /tmp/proxy_body.txt -w "HTTP %{http_code}\n" \
  -H "x-api-key: CLIENT_KEY" \
  "http://127.0.0.1:3000/thu-nghiem/get"
head -c 400 /tmp/proxy_body.txt
echo
```

**Lưu ý:** path URL phải khớp route bạn tạo (ví dụ `/thu-nghiem/...`). Nếu ở Bước 4 bạn đã xóa route `/thu-nghiem`, tạo lại route đó rồi chạy `curl` lại.

**Pass:** dòng đầu `HTTP 200` (hoặc mã upstream), body là JSON/HTML từ httpbin.  
**401:** sai/thiếu client key trong khi DB vẫn còn key.  
**404:** không match route (sai path).

Đây là bước **chứng minh data-plane**: gateway đọc route từ SQLite, proxy ra upstream, kiểm tra `x-api-key` client.

---

## Bước 7 — Tổng kết “đã hiểu được gì”

| Bước | Bạn vừa chứng minh |
|------|---------------------|
| 3 | Admin UI đọc route từ DB qua `/api/routes` |
| 4 | CRUD route ghi SQLite + reload runtime |
| 5 | Client key chỉ plaintext lúc tạo; list không lộ secret |
| 6 | Proxy dùng route + hash client key |

---

## Bước 8 — SRS: Auth + Happy path trên web (không bắt buộc curl)

Trang **Thử gọi Proxy** (`/proxy-try`) trên production hoặc `npm run dev`:

1. Path: `/v1/api/get` (cần route `/v1/api` → `https://httpbin.org` trên Quản lý Route).
2. Dán client key `avaso_...` (tạo ở Bảo mật & Auth).
3. **Gửi không API Key** → **401** + JSON + toast “đúng kỳ vọng”.
4. **Gửi có API Key** → **200** + body httpbin.

| FR | Chứng minh |
|----|------------|
| FR-F1, FR-F3 | Bước 3 — 401 thiếu key |
| FR-F2 | Bước 4 — 200 forward upstream |
| JSON 5.5 | Response tab hiển thị JSON lỗi/thành công |

**Không** lấy plain client key từ SQLite (chỉ hash). Login admin: `https://thientinh.io.vn/login` (không có `/admin`).

---

## Bước 9 — SRS: Observability (FR-D1, NFR-12)

Xem log gateway khi chạy Bước 8:

```bash
journalctl -u avaso-gateway -f
# hoặc terminal cargo run
```

**FR-D1 — 401:** dòng JSON có `"event":"gateway_transaction"`, `"outcome":"denied"`, `"status":401`, `"reason":"missing_or_invalid_api_key"`.

**FR-D1 — 200:** `"outcome":"success"`, `"reason":"forwarded"`.

**NFR-12:** field `api_key_masked` là `(none)` hoặc `avaso_…` — **không** có full plaintext key trong log.

Cần **restart gateway** sau khi cập nhật Rust có log transaction.

---

## Bước 10 — Production: systemd (khuyên dùng)

Chi tiết: [`deploy/systemd/README.md`](../deploy/systemd/README.md)

```bash
cd ~/avaso-gateway
cargo build --release
sudo mkdir -p /etc/avaso-gateway
sudo cp deploy/systemd/env.example /etc/avaso-gateway/env
# chỉnh /etc/avaso-gateway/env
sudo cp deploy/systemd/avaso-gateway.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now avaso-gateway
journalctl -u avaso-gateway -f
```

Trước đó: `pkill -9 -f avaso-gateway` để giải phóng cổng 3000.

---

## Ghi chú nhanh

- **Một process** trên cổng 3000 — ưu tiên **systemd**, tránh vừa `cargo run` vừa service.
- **Sửa UI** → `npm run build`; **sửa Rust** → `cargo build --release` + `systemctl restart avaso-gateway`.
- Login admin: cookie session tại `/login`; client key chỉ plaintext lúc POST tạo key.
