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

Sửa upstream trong file vừa copy (đoạn `proxy_pass http://127.0.0.1:8080;`) cho đúng port app.

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
```

