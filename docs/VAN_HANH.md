# Vận hành thực tế — AVASO Gateway

Runbook ngắn cho admin on-prem. Production: https://thientinh.io.vn

---

## 1. Cài đặt lần đầu (on-prem)

```bash
cd /root/avaso-gateway
cargo build --release
sudo cp deploy/systemd/avaso-gateway.service /etc/systemd/system/
sudo cp deploy/systemd/env.example /etc/avaso-gateway/env
sudo nano /etc/avaso-gateway/env   # mật khẩu admin, CORS, keys

sudo ./scripts/setup-practical-onprem.sh sf-dev   # hoặc vn-prod
sudo systemctl enable --now avaso-gateway
```

**`sf-dev`** — ngưỡng deal 250k (Salesforce Developer sample USD).  
**`vn-prod`** — ngưỡng 50.000.000 VNĐ (nghiệp vụ thật).

---

## 2. Tích hợp CRM → PM

| Bước | Việc |
|------|------|
| 1 | Dashboard → Integrations → OAuth **Salesforce** |
| 2 | OAuth **Zoho Projects** (không Zoho CRM) |
| 3 | Nhập **Zoho Office** API key (PDF) |
| 4 | **Đồng bộ snapshot** SF + Zoho |
| 5 | **Sync Now** hoặc chờ worker 15 phút |

Worker nền: `INTEGRATION_SYNC_INTERVAL_MINS=15` (0 = tắt). Log:

```bash
journalctl -u avaso-gateway -f | grep -i integration
```

---

## 3. Kiểm tra hàng ngày

```bash
ADMIN_PASS='...' ./scripts/ops-daily-check.sh
```

Hoặc:

```bash
curl -sS https://thientinh.io.vn/health
./scripts/test-integrations.sh
```

---

## 4. App gọi API qua Gateway (data plane)

```bash
ADMIN_PASS='...' sudo -E ./scripts/ensure-integration-proxy-key.sh
source data/.integration-proxy-credentials
./scripts/test-integration-proxy.sh
```

App gửi Bearer JWT → `GET /v1/api/sf/services/data/v59.0/limits`  
Chi tiết: [`OAUTH2_IDENTITY.md`](OAUTH2_IDENTITY.md), [`BAN_VE_HE_THONG.md`](BAN_VE_HE_THONG.md) §6.

---

## 5. Sự cố thường gặp

### OAuth / token

| Triệu chứng | Xử lý |
|-------------|--------|
| SF/Zoho test 401 | Integrations → **Ngắt kết nối** → Connect lại |
| `demo_token_rejected` | Không dùng token giả — OAuth thật |
| `missing portal_id` | Reconnect Zoho hoặc Sync Now |

### Sync / middleware

| Triệu chứng | Xử lý |
|-------------|--------|
| Mọi deal SKIPPED | Kiểm tra Stage = Closed Won; `INTEGRATION_MIN_DEAL_AMOUNT` |
| SKIPPED “không đủ giá trị” | Hạ ngưỡng (`sf-dev`) hoặc tăng Amount trên SF |
| FAILED “chưa connected” | OAuth cả SF và Zoho |
| PDF không tạo | Office API key + template `templates/hop-dong-vip.docx` |

### Gateway

| Triệu chứng | Xử lý |
|-------------|--------|
| 502 Nginx | `systemctl status avaso-gateway`; [`XU_LY_502_BAD_GATEWAY.md`](XU_LY_502_BAD_GATEWAY.md) |
| Login fail | `COOKIE_SECURE=true` + HTTPS |
| Port 3000 busy | `pkill -9 -f avaso-gateway`; chỉ systemd |

---

## 6. Bảo mật on-prem

| Mục | Khuyến nghị |
|-----|-------------|
| Đăng ký Viewer | **Tắt** — `setup-practical-onprem.sh` xóa `ALLOW_VIEWER_REGISTRATION` |
| User mới | Admin → Users → tạo tay |
| Client keys | Một key/app; rotate khi lộ |
| Env | `chmod 600 /etc/avaso-gateway/env` |

---

## 7. Docker — dev và demo HA

Không thay production VPS. Dùng khi phát triển local hoặc demo failover:

```bash
docker compose up --build -d              # dev :3000
docker compose -f docker-compose.ha.yml up --build -d   # HA :8080
./scripts/docker-ha-demo.sh
```

Chi tiết: [`TRIEN_KHAI_DOCKER.md`](TRIEN_KHAI_DOCKER.md)

---

## 8. Cập nhật code

```bash
cd /root/avaso-gateway
git pull   # hoặc rsync
cargo build --release
cd web && npm run build
sudo systemctl restart avaso-gateway
```

---

## 9. Luồng nghiệp vụ (tóm tắt)

```
Sales đóng deal SF (Closed Won, đủ Amount)
    → Worker 15p hoặc Sync Now
    → Zoho Project [VIP] + tasks
    → PDF hợp đồng (Office)
    → Link PDF trong mô tả project
```

Không cần copy tay sang Zoho.
