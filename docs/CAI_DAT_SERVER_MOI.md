# Cài AVASO Gateway trên VPS mới

Cài **từ GitHub**, DB **trống** (migration tự chạy lúc start). Không copy database / env / Redis từ máy cũ.

Máy cũ (`thientinh.io.vn`) giữ WordPress → DNS A của domain đó **không** trỏ sang VPS này. Gateway cần **domain mới**.

Production mẫu: systemd + Nginx TLS + Postgres + Redis. Không dùng `docker compose` trên VPS này.

Thay mọi chỗ `gateway.example.com` bằng domain thật.

---

## 0. Trước khi SSH

1. Domain mới → DNS A → IP VPS mới (TTL thấp nếu vừa mua).
2. Repo GitHub clone được (public hoặc deploy key).
3. VPS Ubuntu 22.04/24.04, ≥2GB RAM (cargo release nặng — thiếu RAM thì thêm swap, mục 1b).

---

## 1. Gói hệ thống

```bash
sudo apt update
sudo apt install -y build-essential pkg-config libssl-dev git curl \
  postgresql postgresql-contrib redis-server nginx certbot python3-certbot-nginx
```

**Rust** (apt quá cũ — `Cargo.toml` dùng edition 2024, cần rustc stable mới):

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
source "$HOME/.cargo/env"
rustc --version   # kỳ vọng 1.85+
```

**Node 20** (SPA):

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node -v && npm -v
```

Firewall (nếu UFW bật):

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
```

### 1b. Swap (VPS 2GB — tránh OOM khi `cargo build --release`)

```bash
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

---

## 2. Clone + build

```bash
cd /root
git clone https://github.com/<OWNER>/avaso-gateway.git
cd /root/avaso-gateway

cargo build --release
cd web && npm ci && npm run build && cd ..

test -x target/release/avaso-gateway && test -f web/dist/index.html
```

Sửa URL clone cho đúng repo. Path `/root/avaso-gateway` khớp `deploy/systemd/avaso-gateway.service` — nếu đặt chỗ khác phải sửa `WorkingDirectory` và `ExecStart`.

`web/dist` và `target/release` **không** có trên GitHub — bắt buộc build.

---

## 3. PostgreSQL + Redis

```bash
sudo systemctl enable --now postgresql redis-server
```

Tạo user/DB trống (đổi mật khẩu):

```bash
sudo -u postgres psql <<'SQL'
CREATE USER avaso WITH PASSWORD 'doi-mat-khau-postgres';
CREATE DATABASE avaso_gateway OWNER avaso;
SQL
```

Schema **không** chạy tay. Gateway áp `migrations/` khi start.

```bash
redis-cli ping    # PONG
```

---

## 4. Env production

```bash
sudo mkdir -p /etc/avaso-gateway
sudo cp /root/avaso-gateway/deploy/systemd/env.example /etc/avaso-gateway/env
sudo nano /etc/avaso-gateway/env
```

Sửa tối thiểu:

| Biến | Giá trị |
|------|---------|
| `DATABASE_URL` | `postgres://avaso:doi-mat-khau-postgres@127.0.0.1:5432/avaso_gateway` |
| `REDIS_URL` | `redis://127.0.0.1:6379` |
| `PORT` | `3000` |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | login dashboard (mới) |
| `JWT_SECRET` | chuỗi ngẫu nhiên ≥32 ký tự |
| `CLIENT_KEY_MASTER_KEY` | chuỗi ngẫu nhiên ≥32 |
| `INTEGRATION_MASTER_KEY` | chuỗi **khác** `CLIENT_KEY_MASTER_KEY` |
| `COOKIE_SECURE` | `true` |
| `CORS_ALLOWED_ORIGINS` | `https://gateway.example.com` (thêm `https://www....` nếu dùng www) |

Thêm 2 dòng (không có trong `env.example`):

```bash
GATEWAY_PUBLIC_URL=https://gateway.example.com
# OTP in journal nếu chưa gắn Brevo:
PASSWORD_RESET_DEV_LOG=1
```

```bash
sudo chmod 600 /etc/avaso-gateway/env
cd /root/avaso-gateway
sudo ./scripts/setup-practical-onprem.sh sf-dev
```

`sf-dev` = ngưỡng deal 250k (SF Developer). `vn-prod` = 50.000.000 VNĐ.

**Không** copy `/etc/avaso-gateway/env` từ máy cũ (DB mới + key mới).

Mail OTP thật (tuỳ): `sudo ./scripts/setup-brevo.sh '<xkeysib-...>' 'email-gui@domain'`. Có Brevo thì bỏ `PASSWORD_RESET_DEV_LOG`.

---

## 5. systemd

```bash
sudo cp /root/avaso-gateway/deploy/systemd/avaso-gateway.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now avaso-gateway
sudo systemctl status avaso-gateway --no-pager
curl -sS http://127.0.0.1:3000/health
curl -sS http://127.0.0.1:3000/api/ping
```

Health phải JSON OK. Fail: `journalctl -u avaso-gateway -n 80 --no-pager` (sai `DATABASE_URL` / Redis / chưa `web/dist`).

---

## 6. Nginx + HTTPS

Tắt site mặc định. Vhost HTTP trước (certbot cần :80):

```bash
sudo rm -f /etc/nginx/sites-enabled/default
sudo nano /etc/nginx/sites-available/avaso-gateway.conf
```

Dán (đổi domain):

```nginx
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}

server {
    listen 80;
    listen [::]:80;
    server_name gateway.example.com;

    client_max_body_size 20m;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_read_timeout 60s;
        proxy_send_timeout 60s;
    }
}
```

Mẫu đầy đủ (www + TLS hardening) sau khi có cert: `deploy/nginx/thientinh.io.vn.conf` — `sed` đổi `thientinh.io.vn` → domain mới.

```bash
sudo ln -sf /etc/nginx/sites-available/avaso-gateway.conf /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

sudo certbot --nginx -d gateway.example.com
sudo nginx -t && sudo systemctl reload nginx
```

Certbot thường thêm `listen 443 ssl` và redirect HTTP→HTTPS. Kiểm tra `X-Forwarded-Proto` vẫn tới gateway (cookie `COOKIE_SECURE`).

---

## 7. Kiểm tra

```bash
curl -sS https://gateway.example.com/health
curl -sS https://gateway.example.com/api/ping
```

Mở `https://gateway.example.com` → login `ADMIN_USERNAME` / `ADMIN_PASSWORD`.

---

## 8. Tích hợp (DB trống)

Dashboard → **Integrations**:

1. OAuth Salesforce — Connected App callback:  
   `https://gateway.example.com/api/integrations/salesforce/callback`
2. OAuth Zoho Projects (không Zoho CRM) — callback:  
   `https://gateway.example.com/api/integrations/zoho/callback`
3. Zoho Office API key (PDF)
4. Đồng bộ snapshot → **Đồng bộ ngay**

App Connected App **cũ** còn URL `thientinh.io.vn` → sửa sang domain mới, không chỉ đổi DNS.

---

## 9. Máy cũ — nhường WordPress

Trên VPS `thientinh.io.vn`:

```bash
sudo systemctl disable --now avaso-gateway
```

Gỡ/disable vhost Nginx gateway. Cài WordPress (Nginx + PHP-FPM + MySQL/MariaDB). DNS A `thientinh.io.vn` **giữ IP cũ**.

Postgres/Redis gateway trên máy cũ không cần cho WP — gỡ được.

---

## 10. Cập nhật code sau này

```bash
cd /root/avaso-gateway
git pull
./scripts/deploy-production.sh
```

Hoặc: `cargo build --release` → `cd web && npm ci && npm run build` → `sudo systemctl restart avaso-gateway`.

---

## Sự cố thường gặp

| Triệu chứng | Xử lý |
|-------------|--------|
| `cargo` OOM / killed | Swap 2G (mục 1b) |
| Login cookie fail | `COOKIE_SECURE=true` + CORS đúng `https://...` + Nginx `X-Forwarded-Proto` |
| OAuth redirect lỗi | Connected App + `GATEWAY_PUBLIC_URL` domain mới |
| 502 Nginx | `systemctl status avaso-gateway`; `curl 127.0.0.1:3000/health`; [`XU_LY_502_BAD_GATEWAY.md`](XU_LY_502_BAD_GATEWAY.md) |
| Port 3000 busy | `sudo systemctl stop avaso-gateway`; `pkill -x avaso-gateway`; chỉ một process |
| `Address already in use` | Giống trên — không `cargo run` song song systemd |
| `/api/ping` 404 HTML | Nginx chưa proxy `/api/` → 3000 |

Runbook vận hành: [`VAN_HANH.md`](VAN_HANH.md). Tổng quan mô hình: [`TRIEN_KHAI.md`](TRIEN_KHAI.md).
