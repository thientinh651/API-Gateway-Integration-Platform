# Docker HA — demo bảo vệ (Active-Active)

**Mục tiêu:** Nginx LB + 2 container gateway — kịch bản `docker stop middleware-instance-1` vẫn phản hồi.

Không thay Kubernetes trên VPS 2GB; **đủ chứng minh HA** cho đồ án.

---

## Kiến trúc

```
Client → Nginx (:8080 host)
           ├─ round-robin → middleware-instance-1 :3000
           └─ round-robin → middleware-instance-2 :3000
                    └─ volume chung gateway-data (SQLite routes/keys/integrations)
```

| Thành phần | File |
|------------|------|
| Image Rust (Alpine multi-stage) | `Dockerfile` |
| 2 instance + LB | `docker-compose.ha.yml` |
| Nginx config | `deploy/nginx/docker-ha.conf` |
| Script demo | `scripts/docker-ha-demo.sh` |

**Header demo:** `X-Gateway-Instance: middleware-instance-1|2`  
**Health JSON:** field `"instance"`.

---

## Chạy trước buổi bảo vệ

```bash
cd /root/avaso-gateway
cp .env.example .env   # chỉnh secret
# Tắt systemd nếu chiếm :3000 (tuỳ chọn — HA dùng :8080)
docker compose -f docker-compose.ha.yml up --build -d
docker compose -f docker-compose.ha.yml ps
curl -sS http://127.0.0.1:8080/health | python3 -m json.tool
./scripts/docker-ha-demo.sh
```

Load test (tuỳ chọn):

```bash
hey -n 500 -c 20 http://127.0.0.1:8080/health
```

---

## Kịch bản trình bày (2 phút)

1. Mở `docker compose -f docker-compose.ha.yml ps` — 3 container healthy.  
2. `curl -i http://127.0.0.1:8080/health` vài lần — header instance đổi 1/2.  
3. `docker stop middleware-instance-1`  
4. Gửi request Postman / `wrk` — vẫn 200, header chỉ `middleware-instance-2`.  
5. `docker start middleware-instance-1` — cả hai lại nhận traffic.

---

## Giải trình Hội đồng

### Tại sao không Kubernetes?

> Ứng dụng đã **đóng gói Docker Image** độc lập. Em cấu hình **HA Active-Active**: nhiều container sau **Nginx Load Balancer**. Trên **single-node 2GB RAM**, Kubernetes chiếm phần lớn tài nguyên cho control plane; **Docker Compose** đủ dự phòng cho đồ án và giữ throughput data-plane cao. Rust stateless ở tầng xử lý request; cấu hình route/key/integration **tập trung SQLite volume chung**. Lên EKS sau này chủ yếu đổi manifest hạ tầng.

### "1 server sập thì sao?"

> Trong phạm vi 1 VPS: **một container sập** ≠ cả hệ thống sập — Nginx health/failover sang instance còn lại (demo script). **Cả VPS sập** cần máy thứ hai + DB replicated — hướng phát triển sau đồ án.

### Hạn chế thật (nói thẳng = điểm tín)

| Thành phần | HA demo |
|------------|---------|
| Route, key, integration token | Volume SQLite chung — OK demo |
| Admin session, replay cache, DLQ | **In-memory từng instance** — `/api` dùng **ip_hash** sticky; data-plane round-robin OK |
| Ghi SQLite đồng thời 2 instance | Chỉ phù hợp tải demo; production nên Postgres |

---

## Transform + Retry + SF/Zoho (demo F-12)

1. Bật **Transform / Retry** trong Settings.  
2. Route `/v1/api/sf/...` hoặc proxy httpbin + header transform.  
3. `docker compose -f docker-compose.ha.yml logs -f middleware-instance-1` — log transaction khi gọi qua LB.

---

## Lệnh thường dùng

```bash
docker compose -f docker-compose.ha.yml logs -f nginx-lb
docker compose -f docker-compose.ha.yml down
docker compose -f docker-compose.ha.yml up --build -d
```

Compose đơn instance (dev): `docker compose up` — file `docker-compose.yml`.
