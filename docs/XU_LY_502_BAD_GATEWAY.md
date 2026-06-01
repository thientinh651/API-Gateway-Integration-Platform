# 502 / web không vào — xử lý nhanh

Gateway: `avaso-gateway` · cổng **3000** · Nginx proxy ra ngoài.

---

## Chọn tình huống

| Tình huống | Nguyên nhân thường gặp |
|------------|------------------------|
| Cả site 502 (trang Nginx) | Gateway tắt; hoặc Nginx `/` trỏ **8080** mà không có app |
| Web OK, login/API lỗi | Gateway crash; Nginx `/api/` sai cổng; cookie HTTPS |
| Chỉ `/v1/api/...` 502 | Upstream route sai/chết — **web không sập** |

---

## 1. Cả site 502

**Kiểm tra**

```bash
systemctl status avaso-gateway --no-pager
curl -sS http://127.0.0.1:3000/health
ss -tlnp | grep -E ':3000|:8080'
curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/
curl -sS -o /dev/null -w '%{http_code}\n' https://thientinh.io.vn/health
```

| Kết quả | Nguyên nhân | Xử lý |
|---------|-------------|--------|
| health refused / service dead | Process không chạy | **Khôi phục** (mục 4) |
| health OK, public 502, có 3000 không 8080 | Nginx `location /` → 8080 trống | Sửa Nginx: `/` → `3000` (file `deploy/nginx/thientinh.io.vn.conf`) |
| hai process :3000 | `cargo run` + systemd trùng cổng | `pkill -9 -f avaso-gateway` → **Khôi phục** |

---

## 2. Web OK, API / login lỗi

```bash
curl -sS http://127.0.0.1:3000/health
curl -sS -o /dev/null -w '%{http_code}\n' https://thientinh.io.vn/api/me
```

| Kết quả | Nguyên nhân | Xử lý |
|---------|-------------|--------|
| local OK, public fail | Nginx `/api/` không trỏ 3000 | Sửa Nginx `^~ /api/` → `127.0.0.1:3000` |
| cả hai fail | Gateway down | **Khôi phục** |
| API 401, web load | Session/cookie | `COOKIE_SECURE=true` + HTTPS; login lại |

---

## 3. Chỉ data-plane 502 (`/v1/api/...`)

**Nguyên nhân:** route sai path; upstream URL chết; timeout.

**Xử lý:** UI **Quản lý Route** + **Thử Proxy** — không restart web.

```bash
journalctl -u avaso-gateway --since "5 min ago" | grep gateway_transaction
```

---

## 4. Khôi phục (chạy đúng thứ tự)

```bash
cd /root/avaso-gateway
test -f web/dist/index.html || (cd web && npm run build)
pkill -9 -f avaso-gateway 2>/dev/null || true
sudo systemctl restart avaso-gateway
sleep 2
curl -sS http://127.0.0.1:3000/health
systemctl is-active avaso-gateway
```

Sau sửa Rust: `cargo build --release` rồi restart.  
Sau sửa Nginx: `sudo nginx -t && sudo systemctl reload nginx`.

**Xong khi:** health `200`, `active`, mở `/login` được.

---

## 5. Log (vẫn lỗi)

```bash
journalctl -u avaso-gateway -n 50 --no-pager
sudo tail -20 /var/log/nginx/error.log
```

| Log | Nguyên nhân |
|-----|-------------|
| `Address already in use` | Trùng cổng 3000 |
| `database` / `sqlite` | DB/quyền `data/` |
| `connect() failed (111)` | Upstream Nginx trỏ sai cổng / app tắt |

---

## 6. Sau deploy (tránh tái phát)

```bash
cd /root/avaso-gateway/web && npm run build    # đổi UI
cd /root/avaso-gateway && cargo build --release && sudo systemctl restart avaso-gateway   # đổi Rust
./scripts/smoke-test.sh
```

- Production chỉ dùng **systemd**, không `cargo run` song song.
- Nginx: `/api/`, `/v1/`, `/` cùng **3000** nếu gateway serve `web/dist`.

---

## Cổng (nhớ)

```
/api/  /v1/  → 3000 (gateway)
/           → phải 3000 (không để 8080 trống)
```

Xem thêm: `deploy/systemd/README.md`, `scripts/smoke-test.sh`
