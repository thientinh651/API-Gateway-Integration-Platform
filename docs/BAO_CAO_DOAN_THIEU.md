# Đoạn báo cáo bổ sung — cập nhật triển khai

> Paste vào Chương 4 / thiết kế triển khai.

---

## 1. DLQ PostgreSQL persist

DLQ ghi **trực tiếp** vào `gateway_proxy_queue` khi upstream thất bại sau retry. Operator xem/replay trên dashboard; replay idempotent (`pending` → `replayed`). Giới hạn: cap `MAX_QUEUE_ITEMS` — production scale-out cần broker (Kafka/NATS).

---

## 2. RBAC hai lớp

Backend (`admin_auth.rs`) enforcement thật; frontend (`rbac.ts`) chỉ UX. Bypass UI vẫn 403 từ API.

---

## 3. Burst cap = 3

`min(per_min, 3)` — demo 429 quan sát được; production tăng theo SLA.

---

## 4. Client secret — Argon2id one-way

OAuth2 `client_secret` lưu **Argon2id** (`secret_hash`). Plaintext chỉ hiện **một lần** lúc tạo/rotate. Token endpoint verify hash — **DB leak không lộ secret**. Migration startup: AES legacy → hash → xóa `secret_encrypted`. Connector SF/Zoho vẫn AES (`config_encrypted`) vì cần gọi API bên thứ ba.

---

## 5. Authorization Code + PKCE (RFC 7636)

`code_challenge` S256 bắt buộc trên `/oauth/authorize`; `code_verifier` bắt buộc khi đổi code — align OAuth 2.1 best practice.
