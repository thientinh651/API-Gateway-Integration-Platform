# Systemd — chạy gateway production (Ubuntu)

Tránh `cargo run` tay và lỗi **Address already in use** khi quên tắt process cũ.

## 1. Build release (một lần sau mỗi lần đổi Rust)

```bash
cd /root/avaso-gateway
cargo build --release
```

Binary: `target/release/avaso-gateway`

## 2. Cấu hình môi trường

```bash
sudo mkdir -p /etc/avaso-gateway
sudo cp deploy/systemd/env.example /etc/avaso-gateway/env
sudo nano /etc/avaso-gateway/env   # đổi ADMIN_PASSWORD, CORS, ...
```

Đảm bảo `WorkingDirectory` trong service trùng thư mục có `config.yaml` và `data/`.

## 3. Cài unit

Sửa `User`, `WorkingDirectory`, `ExecStart` trong `avaso-gateway.service` nếu repo không ở `/root/avaso-gateway`.

```bash
sudo cp deploy/systemd/avaso-gateway.service /etc/systemd/system/avaso-gateway.service
sudo systemctl daemon-reload
sudo systemctl enable avaso-gateway
sudo systemctl start avaso-gateway
sudo systemctl status avaso-gateway
```

## 4. Log realtime (FR-D1 / NFR-12)

```bash
journalctl -u avaso-gateway -f
```

Tìm dòng JSON `gateway_transaction` sau request 401/200.

Kiểm tra không lộ plain key:

```bash
journalctl -u avaso-gateway --since "5 min ago" | grep -F "avaso_" || true
# Chỉ được thấy dạng mask avaso_… trong api_key_masked, không full secret
```

## 5. Deploy UI (sau khi sửa React)

```bash
cd /root/avaso-gateway/web
npm run build
# Gateway đọc web/dist/ — không cần restart nếu chỉ đổi static
```

## 6. Brevo — OTP quên mật khẩu (free, khuyến nghị trên DigitalOcean)

DigitalOcean thường chặn SMTP 587 — dùng Brevo API (HTTPS 443).

```bash
# Brevo: Transactional → API key; Senders → verify email gửi
sudo ./scripts/setup-brevo.sh '<xkeysib-...>' 'thientinh651@gmail.com'
```

## 7. SMTP — OTP (Gmail, chỉ khi VPS mở port 587)

```bash
# Gmail: bật 2FA → App Passwords
sudo ./scripts/setup-smtp-gmail.sh '<16-char-app-password>'
```

Script ghi `/etc/avaso-gateway/smtp.env` (chmod 600), tắt `PASSWORD_RESET_DEV_LOG`, restart service, gửi mail thử.

Dev không SMTP: `PASSWORD_RESET_DEV_LOG=1` trong `/etc/avaso-gateway/env` → OTP in `journalctl -u avaso-gateway -f`.

## 8. Cập nhật sau khi sửa code Rust

```bash
cd /root/avaso-gateway
cargo build --release
sudo systemctl restart avaso-gateway
```

## 9. Dừng bản chạy tay (trước khi bật systemd)

```bash
pkill -9 -f avaso-gateway || true
ss -tlnp | grep ':3000'
```

Chỉ nên có **một** listener (systemd).

## 10. Test rate limit (429)

`config.yaml` đã có `rate_limit.enabled: true` (rps/burst). Spam request có key:

```bash
for i in $(seq 1 30); do
  curl -sS -o /dev/null -w "%{http_code} " \
    -H "x-api-key: CLIENT_KEY" \
    "https://thientinh.io.vn/v1/api/get"
done
echo
```

Kỳ vọng: một số dòng **429** + log `reason=rate_limit_exceeded`.

## 11. NFR-20 (ổn định 24h + auto-restart)

Xem chi tiết: [`NFR20_STABILITY.md`](NFR20_STABILITY.md) và script `scripts/nfr20-soak-test.sh`.

## 12. Lỗi thường gặp

| Triệu chứng | Xử lý |
|-------------|--------|
| `Address already in use` | `pkill -9 -f avaso-gateway`; chỉ dùng systemd |
| 502 từ Nginx | [`docs/XU_LY_502_BAD_GATEWAY.md`](../../docs/XU_LY_502_BAD_GATEWAY.md) — checklist; `systemctl status avaso-gateway`; cổng upstream Nginx |
| Cookie login fail | `COOKIE_SECURE=true` + HTTPS; `CORS_ALLOWED_ORIGINS` đúng domain |
