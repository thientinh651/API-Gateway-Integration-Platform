# Mô hình dữ liệu — AVASO Gateway

**Cập nhật:** 2026-06 · bảng console: `dashboard_users` (trước: `admin_users`)

## Hai lớp “user” — không gộp một bảng

| Khái niệm | Bảng | Xác thực | Ai dùng |
|-----------|------|----------|---------|
| **Người dùng console** | `dashboard_users` | Session cookie + RBAC | Admin, Operator, Viewer |
| **Client API (data-plane)** | `gateway_client_keys` | HMAC / API key | Ứng dụng gọi `/v1/api/*` |

Đây là hai actor khác nhau. **Không** tách `dashboard_users` thành 3 bảng theo role — cùng schema (username, pass, email, tenant), khác quyền qua `role` + `rbac_middleware`.

## `dashboard_users` (console RBAC)

```sql
dashboard_users (
  id, username UNIQUE, password_hash,
  role CHECK (admin|operator|viewer),
  tenant_id NOT NULL → tenants(id),
  is_active CHECK (0|1),
  email UNIQUE (lower, nullable),
  created_at
)
```

| Role | Tạo bằng |
|------|----------|
| `admin` | Bootstrap env / Admin tạo user |
| `operator` | Chỉ Admin (`POST /api/users`) |
| `viewer` | Admin tạo **hoặc** đăng ký công khai (`POST /api/register`) |

**Tenant:** Admin mới → `personal:{username}`. Operator/Viewer do Admin tạo → tenant workspace Admin. Viewer tự đăng ký → tenant riêng.

## `tenants`

Workspace cô lập: routes, keys, integrations, logs theo `tenant_id`.

## Ràng buộc đã siết (migration `20260606120000`)

- `tenant_id` NOT NULL + FK → `tenants`
- `role` CHECK — DB từ chối role lạ
- `gateway_client_keys.owner_user_id` FK → `dashboard_users` ON DELETE SET NULL
- Index `(tenant_id, role)` cho list user theo workspace

## Bảng khác (tóm tắt)

| Bảng | Ghi chú |
|------|---------|
| `gateway_routes` | `tenant_id` FK, path unique global |
| `gateway_client_keys` | Secret HMAC; `owner_user_id` = Operator tạo key |
| `audit_logs` | `actor` text (denormalized), `tenant_id` |
| `integrations` | Per-tenant OAuth CRM |
| `gateway_transaction_logs` | Traffic data-plane |

## Không cần làm

- ❌ Bảng `operators`, `viewers` riêng — trùng cột, khó đổi role
- ❌ Gộp `gateway_client_keys` vào `dashboard_users` — khác lifecycle & auth
- ❌ Bảng `roles` + `user_roles` — 3 role cố định LVTN, overkill

## Migrate DB cũ

```bash
sqlx migrate run
# hoặc restart gateway (auto-migrate)
```

Đổi tên: `admin_users` → `dashboard_users` (idempotent). Code Rust đã trỏ `dashboard_users`.
