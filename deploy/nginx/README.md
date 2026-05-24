# Nginx + SSL (thientinh.io.vn)

## Mục tiêu

- HTTP (port 80) -> HTTPS (301)
- `www.thientinh.io.vn` -> `thientinh.io.vn` (301)

## Cài gói

```bash
sudo apt update
sudo apt install -y nginx certbot python3-certbot-nginx
```

## Bật vhost

```bash
sudo cp deploy/nginx/thientinh.io.vn.conf /etc/nginx/sites-available/thientinh.io.vn.conf
sudo ln -sf /etc/nginx/sites-available/thientinh.io.vn.conf /etc/nginx/sites-enabled/thientinh.io.vn.conf
```

### Chỉ cần chèn `/api/` (site đã có `try_files` SPA)

Copy snippet và include trong `server { }` **HTTPS** (trước `location /`):

```bash
sudo mkdir -p /etc/nginx/snippets
sudo cp deploy/nginx/snippets/api-proxy.conf /etc/nginx/snippets/avaso-gateway-api.conf
# Sửa cổng trong file nếu gateway không chạy 3000
```

Trong file vhost site (vd `sites-enabled/thientinh.io.vn`):

```nginx
    include /etc/nginx/snippets/avaso-gateway-api.conf;
```

Sau đó `curl -sS https://thientinh.io.vn/api/ping` phải trả JSON (`"service":"avaso-gateway"`). Nếu vẫn 404 rỗng: kiểm tra `include` nằm đúng `server { }` HTTPS, gateway đang listen đúng cổng trong `upstream`, rồi `sudo nginx -t && sudo systemctl reload nginx`.

HTTPS + cookie: trên gateway bật `COOKIE_SECURE=true` và `CORS_ALLOWED_ORIGINS` (origin UI). Xem `.env.example` ở root repo.

## Lấy SSL (Let's Encrypt)

```bash
sudo nginx -t
sudo systemctl reload nginx

sudo certbot --nginx -d thientinh.io.vn -d www.thientinh.io.vn
sudo nginx -t && sudo systemctl reload nginx
```

## Test nhanh

```bash
curl -I http://thientinh.io.vn
curl -I https://thientinh.io.vn
curl -I https://www.thientinh.io.vn

# Phải 200 + JSON (xác nhận Nginx → đúng avaso-gateway mới, có /api/*):
curl -sS https://thientinh.io.vn/api/ping
```

