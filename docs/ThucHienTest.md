Check health

curl -sS https://thientinh.io.vn/health | python3 -m json.tool

cd web
cargo build --release
sudo systemctl restart avaso-gateway













