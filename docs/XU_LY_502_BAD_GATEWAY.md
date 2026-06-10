# Xử lý 502 Bad Gateway

**Nhanh (tự chẩn đoán + sửa):**

```bash
sudo bash deploy/fix-502.sh
```

Script: start gateway, rebuild nếu `VersionMissing`, kiểm tra postgres/redis/nginx.

---

**Thủ công:**

1. `systemctl status avaso-gateway` — active?
2. `curl -sS http://127.0.0.1:3000/health` — gateway sống?
3. Nginx upstream trỏ `127.0.0.1:3000` — xem `deploy/nginx/thientinh.io.vn.conf`
4. `journalctl -u avaso-gateway -n 50`
5. `sudo tail -20 /var/log/nginx/error.log`

Sau sửa: `sudo nginx -t && sudo systemctl reload nginx`
