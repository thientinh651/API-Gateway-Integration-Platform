# Mô hình dữ liệu vật lý — PostgreSQL

**Không dùng SQLite** cho production. Redis dùng session admin + OTP quên MK.

## Bảng chính (Chương 3 luận văn)

| Bảng | Mô tả | Chức năng lớn |
|------|--------|---------------|
| `tenants` | Đơn vị tenant (multi-tenant) | RBAC / isolation |
| `dashboard_users` | User console (admin/operator/viewer), email, password_hash | Identity, RBAC |
| `gateway_routes` | Path, method, upstream, timeout, rate_limit, transform, retry | Routing động |
| `gateway_client_keys` | API key public + secret encrypted | HMAC auth |
| `gateway_transaction_logs` | Log mỗi request data plane | Transaction log |
| `audit_logs` | Hành động admin | Audit log |
| `gateway_settings` | Toggle runtime (retry, queue, transform…) | Settings |
| `integrations` | Trạng thái OAuth SF/Zoho per tenant | Integration |
| `integration_provider_configs` | Client id/secret provider | Integration |
| `integration_snapshots` | JSON snapshot sync | Integration |
| `oauth_pending_states` | State OAuth tạm | OAuth flow |
| `integration_bridge_config` | Cấu hình bridge | Integration |

## Redis (không phải bảng SQL)

| Key pattern | Mục đích |
|-------------|----------|
| `gw:session:{id}` | Session admin (24h) |
| `gw:pwdreset:*` | OTP + reset ticket quên MK |

## ERD đơn giản (mô tả Word)

```text
tenants 1───* dashboard_users
tenants 1───* gateway_routes
tenants 1───* gateway_client_keys
tenants 1───* integrations
gateway_routes ── log ── gateway_transaction_logs
dashboard_users ── audit ── audit_logs
```

Migration: `migrations/*.sql`

## Ghi chú bảo vệ

- Secret client key: **AES-256-GCM** at rest, không plain text
- OAuth token: mã hóa tương tự
- `dashboard_users` (không còn tên `admin_users` trên DB mới)
