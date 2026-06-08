# Docker HA demo — 2 gateway + Nginx LB

Chứng minh **chức năng lớn #15** (triển khai & HA).

## Chạy

```bash
cd /root/avaso-gateway
docker compose -f docker-compose.ha.yml up --build -d
```

## Kiến trúc

```text
Client → nginx-lb → gateway-1 | gateway-2
                      ↓           ↓
                   Redis (session chung)
                   PostgreSQL
```

## Demo HĐ

1. Login admin qua LB
2. `docker stop <gateway-1>`
3. F5 dashboard — vẫn vào được (session Redis + LB chuyển sang gateway-2)

## Dừng

```bash
docker compose -f docker-compose.ha.yml down
```

Config Nginx LB: `deploy/nginx/docker-ha.conf`
