# Runbook vận hành

Xem [`deploy/systemd/README.md`](../deploy/systemd/README.md) và UI **Tài liệu API** (`/api-docs`).

## Deploy nhanh

```bash
cargo build --release && cd web && npm run build
sudo systemctl restart avaso-gateway
```

## Env quan trọng

`/etc/avaso-gateway/env`, `/etc/avaso-gateway/brevo.env`

## Docs đồ án

[`docs/README.md`](README.md)
