# Triển khai hệ thống — AVASO Gateway

Tài liệu tổng quan các **mô hình triển khai** đã hiện thực trong đồ án.

---

## 1. Ba mô hình triển khai

| Mô hình | Công cụ | Khi nào dùng |
|---------|---------|--------------|
| **Production VPS** | systemd + Nginx TLS | Chạy thật tại https://thientinh.io.vn |
| **Docker Compose Deployment** | `docker-compose.yml` | Phát triển local, container hóa |
| **Compose 2 instance** *(thử nghiệm)* | `docker-compose.ha.yml` | Thử LB — **không** gọi HA trong báo cáo |

---

## 2. Production — VPS + systemd

### Kiến trúc

```text
Internet
    │
    ▼
Nginx :443 TLS
    │
    ▼
avaso-gateway :3000  (127.0.0.1, systemd)
    │
    ├── PostgreSQL :5432
    └── Redis :6379
```

### Các bước chính

```bash
cd /root/avaso-gateway
cargo build --release
cd web && npm run build

sudo mkdir -p /etc/avaso-gateway
sudo cp deploy/systemd/env.example /etc/avaso-gateway/env
sudo nano /etc/avaso-gateway/env

sudo cp deploy/systemd/avaso-gateway.service /etc/systemd/system/
sudo systemctl enable --now avaso-gateway
```

Cấu hình Nginx: `deploy/nginx/thientinh.io.vn.conf`

Runbook đầy đủ: [`VAN_HANH.md`](VAN_HANH.md)  
Chi tiết systemd: [`deploy/systemd/README.md`](../deploy/systemd/README.md)

### Đặc điểm

- Binary Rust release chạy trực tiếp trên host — hiệu năng tốt trên VPS 2GB
- SPA build trong `web/dist/` — gateway phục vụ static
- Biến môi trường trong `/etc/avaso-gateway/env`, chmod 600
- `COOKIE_SECURE=true`, `CORS_ALLOWED_ORIGINS` khớp domain HTTPS
- OAuth callback: `https://thientinh.io.vn/api/integrations/.../callback`

---

## 3. Docker — container hóa

Toàn bộ chi tiết: **[`TRIEN_KHAI_DOCKER.md`](TRIEN_KHAI_DOCKER.md)**

### Dev local một lệnh

```bash
docker compose up --build -d
curl http://127.0.0.1:3000/health
```

Stack: PostgreSQL + Redis + gateway trong image Alpine.

### Compose thử nghiệm 2 instance

```bash
docker compose -f docker-compose.ha.yml up --build -d
./scripts/docker-ha-demo.sh
```

Hai gateway + Nginx LB — **chỉ thử nghiệm triển khai**, không chứng minh HA production.

---

## 4. Mô hình tổ chức

| Chế độ | Env | Mô tả |
|--------|-----|-------|
| **On-prem** | mặc định | Một công ty, một gateway — phù hợp luận văn |
| **SaaS** | `DEPLOYMENT_MODE=saas` | Multi-tenant — hướng mở rộng |

Chi tiết on-prem / SaaS: [`BAN_VE_HE_THONG.md`](BAN_VE_HE_THONG.md) §8.

Script cấu hình on-prem thực tế:

```bash
sudo ./scripts/setup-practical-onprem.sh sf-dev
```

---

## 5. Thành phần hạ tầng

| Thành phần | Vai trò | Bắt buộc |
|------------|---------|----------|
| **PostgreSQL** | Route, user, key, log, integration, queue | Có |
| **Redis** | Session admin, OTP quên mật khẩu | Có |
| **Nginx** | TLS, reverse proxy production | Production |
| **Brevo / SMTP** | Gửi OTP email | Tuỳ chọn |

Gateway **không** chạy độc lập không có PostgreSQL và Redis.

---

## 6. Cập nhật phiên bản

### systemd production

```bash
cd /root/avaso-gateway
git pull
cargo build --release
cd web && npm run build
sudo systemctl restart avaso-gateway
```

### Docker

```bash
docker compose up --build -d
# hoặc
docker compose -f docker-compose.ha.yml up --build -d
```

Migration SQL tự áp dụng khi gateway khởi động.

---

## 7. Chứng minh triển khai trong luận văn

| Yêu cầu | Chứng minh |
|---------|------------|
| Binary release | `cargo build --release`, Dockerfile multi-stage |
| Docker Compose Deployment | `docker compose up`, ảnh `docker ps` |
| Compose 2 instance *(thử)* | `docker-ha-demo.sh` — không gọi HA trong Word |
| Production HTTPS | Screenshot `thientinh.io.vn`, Nginx config |
| Health check | `curl /health` — DB + Redis up |

---

## 8. Mục lục tài liệu triển khai

| File | Nội dung |
|------|----------|
| [`CAI_DAT_SERVER_MOI.md`](CAI_DAT_SERVER_MOI.md) | Cài VPS mới — clone GitHub, DB trống |
| [`TRIEN_KHAI_DOCKER.md`](TRIEN_KHAI_DOCKER.md) | Docker Compose Deployment |
| [`VAN_HANH.md`](VAN_HANH.md) | Runbook vận hành production |
| [`deploy/nginx/README.md`](../deploy/nginx/README.md) | Cấu hình Nginx host |
