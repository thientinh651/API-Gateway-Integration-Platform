# Đoạn báo cáo bổ sung — Ngày 2

> Paste vào đúng mục Chương 4 / thiết kế triển khai. Không cần thêm code.

---

## 1. DLQ in-memory — trade-off

Hàng đợi lỗi (DLQ) được triển khai theo mô hình buffer in-memory tại runtime, định kỳ flush sang PostgreSQL (`gateway_proxy_queue`). Cách này giảm độ phức tạp triển khai và phù hợp phạm vi đồ án: operator vẫn xem, replay và audit trên dashboard sau khi persist. Trade-off chấp nhận được là cửa sổ mất dữ liệu ngắn (vài giây) nếu process gateway crash trước lần flush kế tiếp; replay được thiết kế idempotent để tránh gửi trùng side-effect. Trong môi trường production, hướng phát triển là ghi append-only (WAL/Kafka) hoặc enqueue trực tiếp vào broker để loại bỏ cửa sổ mất message.

---

## 2. RBAC hai lớp

Phân quyền được thực thi ở hai lớp: backend (`admin_auth.rs`) là ranh giới bảo mật thật — mọi API quản trị kiểm tra session và role trước khi xử lý; frontend (`rbac.ts`) chỉ ẩn menu và nút thao tác để cải thiện UX. Kiểm thử bypass (gọi API trực tiếp bằng curl/Postman với cookie viewer) xác nhận backend vẫn trả 403 dù UI không hiển thị chức năng — frontend không thay thế enforcement.

---

## 3. Burst cap = 3 — lý do (một câu)

Hệ số burst được giới hạn `min(per_min, 3)` để demo rate limit quan sát được (2–3 request liên tiếp rồi 429) và tránh trường hợp burst bằng toàn bộ hạn mức phút che khuất hành vi Token Bucket refill; production có thể tăng burst theo SLA từng client.

---

## 4. Client secret AES reversible

Client secret được mã hóa AES-256-GCM trước khi lưu PostgreSQL (`secret_encrypted`), khóa master nằm ngoài DB (`CLIENT_KEY_MASTER_KEY` trên server). Lý do chọn mã hóa reversible thay vì hash one-way: dashboard cần hiển thị/xác minh secret khi tạo client, và luồng `client_credentials` phải so sánh plaintext với giá trị đăng ký; hash one-way buộc luồng “chỉ hiện một lần” khó vận hành trong scope đồ án. Điều kiện an toàn: key master không commit, rotate định kỳ, giới hạn quyền đọc env trên VPS. Hướng phát triển: hash + pepper cho client mới, hoặc vault/KMS thay env key.
