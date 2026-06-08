# Kịch bản thử nghiệm (TC) — Chương 4 luận văn

Điền vào bảng TC_01–TC_15 trong `Tài liệu LVTN.docx`.

## Nhóm 1 — Data plane & bảo mật

| Mã | Tên | Đầu vào | Kết quả mong đợi |
|----|-----|---------|------------------|
| TC_01 | HMAC hợp lệ | Request ký đúng (Proxy Try) | 200 từ upstream |
| TC_02 | HMAC sai chữ ký | Sửa 1 ký tự signature | 401 |
| TC_03 | Timestamp hết hạn | Timestamp cũ >5 phút | 401 |
| TC_04 | Replay | Gửi lại cùng request | 401 (replay) |
| TC_05 | Rate limit | Spam > ngưỡng route/key | 429 + Retry-After |
| TC_06 | Route không tồn tại | Path chưa cấu hình | 404 |
| TC_07 | Longest prefix | 2 route chồng path | Match route dài hơn |
| TC_08 | Upstream timeout | Upstream treo | 504 |

## Nhóm 2 — Admin & RBAC

| Mã | Tên | Đầu vào | Kết quả mong đợi |
|----|-----|---------|------------------|
| TC_09 | Login admin | user/pass đúng | Cookie session, vào dashboard |
| TC_10 | Viewer POST route | Viewer gọi POST /api/routes | 403 + audit |
| TC_11 | CRUD route | Admin tạo/sửa/xóa | DB đổi, proxy ngay không restart |
| TC_12 | Tạo API key | Admin tạo key | Secret hiện 1 lần, DB encrypted |

## Nhóm 3 — Identity & tích hợp

| Mã | Tên | Đầu vào | Kết quả mong đợi |
|----|-----|---------|------------------|
| TC_13 | Quên MK | username+email khớp → OTP → pass mới | Mail OTP, login OK |
| TC_14 | Salesforce OAuth | Connect trên Integrations | Token lưu, sync snapshot |
| TC_15 | Zoho OAuth | Connect Zoho | Token lưu, sync snapshot |

## Nhóm 4 — Pipeline & log

| Mã | Tên | Đầu vào | Kết quả mong đợi |
|----|-----|---------|------------------|
| TC_16 | Retry upstream | Upstream trả 502 tạm | Client nhận 200 sau retry |
| TC_17 | DLQ | Fail + queue bật | Item trong Proxy Queue UI |
| TC_18 | Transaction log | 1 request data plane | 1 dòng trong Logs |
| TC_19 | Audit log | Admin xóa route | 1 dòng audit |

## Nhóm 5 — NFR

| Mã | Tên | Lệnh | Kết quả |
|----|-----|------|---------|
| TC_20 | Health | `curl /health` | 200 |
| TC_21 | Evidence | `./scripts/collect-thesis-evidence.sh` | artifacts trong `data/thesis-evidence/` |

## Mẫu bảng kết quả

| Mã | Mong đợi | Thực tế | Pass |
|----|----------|---------|------|
| TC_01 | 200 | 200 | ✅ |

Chạy trên https://thientinh.io.vn hoặc `localhost:3000` sau `cargo run`.
