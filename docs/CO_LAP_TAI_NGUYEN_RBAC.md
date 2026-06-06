# Cô lập tài nguyên & RBAC (personal gateway)

**Cập nhật:** 2026-06 · chi tiết LVTN: [`RBAC_LVTN.md`](RBAC_LVTN.md)

## Mô hình

| Khái niệm | Ý nghĩa |
|-----------|---------|
| **Tenant / workspace** | Không gian riêng — routes, keys, integrations, logs |
| **Quản trị viên (`admin`)** | Tài khoản chủ workspace; tạo user; user mới role **admin** → **tenant mới** |
| **NV vận hành / NV giám sát** | Thành viên **cùng tenant** do Quản trị viên tạo |
| **Hồ sơ cá nhân** | Mọi role tự đổi username/mật khẩu qua `PUT /api/me` (không đổi role) |
| **owner_user_id** | Client API key gắn người tạo — operator không thấy key của admin |

## Ma trận quyền

| Tài nguyên | Admin | Operator | Viewer |
|------------|-------|----------|--------|
| Routes | CRUD | RU (không tạo/xóa) | R |
| Client API keys | Tất cả trong tenant | Chỉ key mình tạo | **Không** |
| Integrations OAuth | Full | **Không** | **Không** |
| Users | CRUD (trong tenant) | Không | Không |
| Settings | Sửa | Không | Không |
| Transaction / Audit logs | Xem | Xem | **Không** |
| Proxy queue / Thử proxy | Full | Có | **Không** |

## Cô lập admin1 ≠ admin2

- Mỗi user role **admin** (trừ admin đầu legacy) có tenant `personal:{username}`.
- Mọi query admin API lọc `ctx.tenant_id` từ session.
- Data plane: client key + route phải cùng `tenant_id`.

## API key toàn cục

- `ALLOW_ADMIN_API_KEY=false` (mặc định) — UI/curl session cookie.
- Bật `=1` chỉ cho automation dev (tenant 1).

## Migration

`20250601120000_personal_tenant_isolation.sql`:

- `owner_user_id` trên `gateway_client_keys`
- Admin thứ 2+ trên tenant 1 → tenant riêng (dữ liệu tenant 1 giữ admin đầu)
