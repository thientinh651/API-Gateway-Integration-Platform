# Kiểm tra nhanh — bạn đã làm gì?

Chạy từ thư mục repo: `cd /root/avaso-gateway`

---

## 1. Tổng quan (5 phút)

| Đã làm | Chưa / tuần sau |
|--------|------------------|
| Password admin Argon2id (`admin_users`) | RBAC operator/viewer (Ngày 2) |
| HMAC API key + secret AES | Users API thật, audit log (Ngày 3) |
| Replay cache, path+query, tenant 403 | Salesforce OAuth (Ngày 4) |
| Docs: `MO_HINH_BAO_MAT.md`, `HMAC_MIDDLEWARE_FLOW.md`, `TICH_HOP_VA_BAO_CAO.md` | Code SF/Zoho, `/reports` UI |

```bash
# Service + health
systemctl is-active avaso-gateway
curl -sS https://thientinh.io.vn/health

# Migration đã chạy?
python3 -c "
import sqlite3
c=sqlite3.connect('data/gateway.db')
for t in ['admin_users','tenants','gateway_client_keys','gateway_routes']:
    n=c.execute(f'SELECT COUNT(*) FROM {t}').fetchone()[0]
    print(t, n, 'rows')
c.close()
"
```

---

## 2. Ngày 1 — Password hash

```bash
# Login (đổi pass nếu bạn đã đổi trong DB / env lúc bootstrap)
curl -sS -X POST http://127.0.0.1:3000/api/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"admin"}' \
  -w '\nHTTP %{http_code}\n' -c /tmp/gw_cookies.txt

# Pass KHÔNG lưu plain — chỉ hash dài
python3 -c "
import sqlite3
c=sqlite3.connect('data/gateway.db')
r=c.execute('SELECT username, length(password_hash), substr(password_hash,1,30) FROM admin_users').fetchone()
print('admin_users:', r)
c.close()
"
```

Kỳ vọng: HTTP 200; `password_hash` dài, bắt đầu `$argon2`.

---

## 3. HMAC client key — tạo + gọi API

### 3a. Tạo key (cần admin session hoặc `X-API-Key` admin)

```bash
# Cách 1: UI https://thientinh.io.vn → Bảo mật & Auth → Tạo API Key → copy pk + sk

# Cách 2: API (thay ADMIN_KEY bằng key trong gateway_settings / env)
ADMIN_KEY="key12345"   # hoặc từ /etc/avaso-gateway/env
curl -sS -X POST http://127.0.0.1:3000/api/client-keys \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $ADMIN_KEY" \
  -d '{"name":"test-hmac"}' | python3 -m json.tool
```

Lưu `api_key` (`avaso_pk_...`) và `secret_key` (`avaso_sk_...`) — **chỉ thấy một lần**.

### 3b. Ký và gọi data-plane

```bash
cd /root/avaso-gateway
export API_KEY="avaso_pk_..."      # từ bước trên
export SECRET_KEY="avaso_sk_..."
export PATH_SIGN="/v1/api/get"     # phải có route này trên UI Quản lý Route
export METHOD="GET"
export TS=$(date +%s)
export BODY=""

python3 <<'PY'
import os, hmac, hashlib, requests
api_key = os.environ["API_KEY"]
secret = os.environ["SECRET_KEY"]
ts = os.environ["TS"]
method = os.environ["METHOD"]
path = os.environ["PATH_SIGN"]
body = os.environ["BODY"]
payload = f"{api_key}\n{ts}\n{method}\n{path}\n{body}"
sig = hmac.new(secret.encode(), payload.encode(), hashlib.sha256).hexdigest()
url = f"https://thientinh.io.vn{path}"
r = requests.get(url, headers={
    "X-API-Key": api_key,
    "X-Timestamp": ts,
    "X-Signature": sig,
}, timeout=30)
print("status", r.status_code)
print(r.text[:500])
PY
```

Kỳ vọng: **200** (nếu route trỏ httpbin/get hoặc upstream OK).

### 3c. Thiếu chữ ký → 401

```bash
curl -sS -o /dev/null -w '%{http_code}\n' \
  -H "X-API-Key: $API_KEY" \
  "https://thientinh.io.vn/v1/api/get"
# → 401
```

---

## 4. Replay attack

Gửi **đúng** request HMAC **2 lần** liên tiếp (cùng TS + Signature):

```bash
# Chạy lại đúng block python3 ở 3b hai lần (không đổi TS, SIG)
# Lần 1: 200 (hoặc 404 nếu route sai)
# Lần 2: 401 + replay_detected trong body JSON
```

Hoặc một script:

```bash
python3 scripts/test_hmac_replay.py   # nếu có — xem mục 5
```

---

## 5. Tenant + DB schema

```bash
python3 -c "
import sqlite3
c=sqlite3.connect('data/gateway.db')
print('tenants', c.execute('SELECT * FROM tenants').fetchall())
print('routes', c.execute('SELECT id, path, tenant_id FROM gateway_routes').fetchall())
print('keys', c.execute('SELECT id, name, api_key, tenant_id, length(secret_encrypted) FROM gateway_client_keys').fetchall())
c.close()
"
```

Key HMAC: `api_key` có giá trị, `secret_encrypted` > 0, `tenant_id` = 1 (default).

---

## 6. File / doc đã thêm (đối chiếu code)

```bash
ls -la docs/MO_HINH_BAO_MAT.md docs/HMAC_MIDDLEWARE_FLOW.md docs/KIEM_TRA_DA_LAM.md
ls -la migrations/202605*.sql
ls -la src/crypto.rs
git log --oneline -15 2>/dev/null || echo "(chưa commit — dùng git status)"
git status -sb 2>/dev/null
```

---

## 7. Checklist mentor (tự đánh dấu)

| Yêu cầu | Kiểm tra |
|---------|----------|
| Password hash DB | Mục 2 |
| API key HMAC, secret encrypted | Mục 3 + DB `secret_encrypted` |
| Không replay trong 5 phút | Mục 4 |
| Path ký có query | Đổi `PATH_SIGN=/v1/api/get?x=1` và ký đúng query |
| Tenant 403 | Chưa RBAC admin; data-plane có `tenant_id` — test thủ công đổi `tenant_id` key trong DB ≠ route |
| Salesforce | Chưa |

---

## 8. Lỗi thường gặp

| Triệu chứng | Xem |
|-------------|-----|
| 502 | `systemctl status avaso-gateway` — service chết |
| 401 invalid_signature | Sai path ký (thiếu `?query`), sai METHOD case, sai body |
| 401 replay | Bình thường nếu gửi lại cùng signature |
| Decrypt fail log | `CLIENT_KEY_MASTER_KEY` đổi sau khi tạo key → tạo key mới |

---

*Cập nhật khi hoàn thành thêm Ngày 2–4 trong `KE_HOACH_4_NGAY.md`.*
