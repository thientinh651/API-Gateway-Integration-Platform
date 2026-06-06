# RBAC — căn cứ Tài liệu LVTN (mục 2.3.1)

**Cập nhật:** 2026-06 · đồng bộ code `admin_auth.rs`, `web/src/lib/rbac.ts` · DB: `dashboard_users` (xem `DATABASE_SCHEMA.md`)

## Thuật ngữ (Word ↔ code)

| LVTN (tiếng Việt) | Code / UI | Mô tả |
|-------------------|-----------|--------|
| Quản trị viên | `admin` | Chủ workspace; tạo user; toàn quyền cấu hình |
| Nhân viên vận hành | `operator` | Vận hành route/key/log; không quản trị hệ thống |
| Nhân viên giám sát | `viewer` | Chỉ xem route & overview; không key/log/queue/tích hợp |

## Kiểm soát hai lớp (LVTN § quy trình quản lý người dùng)

1. **Lớp giao diện:** `NavAccessGuard` + `canAccessNavPath` — chặn URL trực tiếp, redirect `/`.
2. **Lớp API:** `rbac_middleware` — mọi `/api/*` (trừ login/logout/me public) đối chiếu role; `403` + audit `rbac_denied`.

## Ma trận quyền tài nguyên

| Tài nguyên | Quản trị viên | NV vận hành | NV giám sát |
|------------|---------------|-------------|-------------|
| Đăng nhập / đăng xuất | ✓ | ✓ | ✓ |
| **Hồ sơ cá nhân** (`PUT /api/me`) | ✓ | ✓ | ✓ |
| Quản lý user khác | CRUD | ✗ | ✗ |
| Routes | CRUD | RU | R |
| Client API keys | Tất cả tenant | Key mình tạo | ✗ |
| Integrations OAuth | Full | ✗ | ✗ |
| Settings + reload-config | ✓ | ✗ | ✗ |
| Transaction / Audit logs | ✓ | ✓ | ✗ |
| Proxy queue / Thử proxy | ✓ | ✓ | ✗ |
| Dashboard KPI tích hợp | ✓ | ✗ | ✗ |

## Tạo tài khoản (LVTN)

| Cách | Ai | Vai trò | API |
|------|-----|---------|-----|
| Bootstrap | Hệ thống (DB trống) | `admin` | `ADMIN_USERNAME` / `ADMIN_PASSWORD` / `ADMIN_EMAIL` |
| Quản trị viên tạo | Admin | `admin`, `operator`, `viewer` | `POST /api/users` (session Admin) |
| Đăng ký cá nhân | Công khai (bật env) | **`viewer` cố định** | `POST /api/register` |

- `ALLOW_VIEWER_REGISTRATION=1` — bật đăng ký Viewer; mặc định **tắt**.
- Đăng ký: username + email (bắt buộc) + mật khẩu → workspace tenant riêng, role viewer, auto đăng nhập.
- Admin/Operator **không** tự đăng ký — Admin tạo trong **Quản lý Users**.
- Google OAuth: hướng mở rộng (Chương 5.2).

## Quên mật khẩu (OTP email)

1. User cấu hình **email** tại **Tài khoản của tôi** (`/profile`).
2. `POST /api/forgot-password` — gửi OTP 6 số (Redis TTL 10 phút).
3. `POST /api/reset-password` — `{ username, otp, password }`.
4. Dev: `PASSWORD_RESET_DEV_LOG=1` → OTP in `journalctl`. Production: `SMTP_*`.

## Hồ sơ cá nhân (bổ sung F-19)

- Mọi role: đổi `username`, đổi mật khẩu (cần mật khẩu hiện tại).
- Không đổi `role` qua `/api/me`.
- Đổi mật khẩu → thu hồi mọi session Redis → đăng nhập lại.
- Audit: `profile_update`, `profile_password_change`.

## Minh chứng demo

```bash
# Operator không vào integrations
curl -sS -o /dev/null -w '%{http_code}\n' -b cookie.txt https://thientinh.io.vn/api/integrations

# Mọi role đổi pass
curl -X PUT https://thientinh.io.vn/api/me -b cookie.txt \
  -H 'Content-Type: application/json' \
  -d '{"password":"newpass","current_password":"old"}'
```
