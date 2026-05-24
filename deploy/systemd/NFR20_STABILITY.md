# NFR-20 — Ổn định (24h tải nhẹ + systemd)

## 1. Systemd — tự khởi động lại khi crash

File: `deploy/systemd/avaso-gateway.service`

| Cấu hình | Ý nghĩa |
|----------|---------|
| `Restart=on-failure` | Process chết / exit lỗi → systemd start lại sau `RestartSec=5` |
| `StartLimitBurst=5` | Tránh restart vô hạn nếu lỗi cấu hình |
| `WantedBy=multi-user.target` | Boot máy → gateway tự chạy (sau `enable`) |

### Cài / cập nhật

```bash
cd ~/avaso-gateway
sudo cp deploy/systemd/avaso-gateway.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable avaso-gateway
sudo systemctl restart avaso-gateway
```

### Chứng minh restart sau crash

```bash
# Ghi PID trước
systemctl status avaso-gateway
PID=$(systemctl show -p MainPID --value avaso-gateway)

# Giả lập crash
sudo kill -9 "$PID"

sleep 6
systemctl status avaso-gateway   # phải active (running), PID mới
journalctl -u avaso-gateway -n 20 --no-pager
```

Chụp màn hình: `active (running)` sau kill -9.

---

## 2. Soak test 24h — tải nhẹ + theo dõi RAM

Script: `scripts/nfr20-soak-test.sh`

**Điều kiện:** gateway chạy **systemd** (không `cargo run` song song).

```bash
cd ~/avaso-gateway
chmod +x scripts/nfr20-soak-test.sh

export SOAK_URL="https://thientinh.io.vn/v1/api/get"
export SOAK_API_KEY="avaso_PLAIN_KEY_CUA_BAN"

# Thử 1 giờ trước
SOAK_HOURS=1 ./scripts/nfr20-soak-test.sh

# Đủ NFR-20
SOAK_HOURS=24 ./scripts/nfr20-soak-test.sh
```

Chạy trong `screen` / `tmux` để không mất khi SSH đứt:

```bash
screen -S soak
SOAK_HOURS=24 ./scripts/nfr20-soak-test.sh
# Ctrl+A D để detach
```

### Output

- `data/soak-nfr20/memory-*.csv` — RSS/VSZ mỗi 5 phút
- `data/soak-nfr20/requests-*.log` — mã HTTP từng request

### Đọc kết quả (memory leak)

```bash
column -t -s, data/soak-nfr20/memory-*.csv | tail -20
```

| Quan sát | Kết luận |
|----------|----------|
| RSS dao động trong biên (~vài MB), không tăng tuyến tính 24h | **Pass NFR-20** (Rust + gateway ổn) |
| RSS tăng liên tục (vd 50MB → 500MB+) | Nghi leak / session tích lũy — cần profile |

**Lưu ý:** Rust ít leak hơn GC; map session admin trong RAM có thể tăng nhẹ nếu nhiều login khác nhau trong 24h — bình thường với tải nhẹ (1 client key + GET).

### Theo dõi song song (tuỳ chọn)

```bash
watch -n 60 'systemctl status avaso-gateway; ps -o pid,rss,vsz,cmd -p $(systemctl show -p MainPID --value avaso-gateway)'
```

---

## 3. Checklist báo cáo NFR-20

| # | Việc | Pass |
|---|------|------|
| 1 | `systemctl enable avaso-gateway` | ☐ |
| 2 | Kill -9 → service lên lại &lt; 10s | ☐ |
| 3 | Soak ≥1h (hoặc 24h) không crash | ☐ |
| 4 | CSV memory: RSS không tăng vô hạn | ☐ |
| 5 | `journalctl` không lặp panic liên tục | ☐ |

---

## 4. Tải “nhẹ” là gì?

Mặc định script: **1 request / 5 giây** ≈ 17k request/24h — đủ kiểm tra ổn định, không là stress test.

Stress (không bắt buộc NFR-20): dùng `hey` / `wrk` riêng.
