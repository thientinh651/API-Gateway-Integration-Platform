# RBAC — ma trận quyền (luận văn)

## Vai trò

| Role | Mô tả |
|------|--------|
| **admin** | Toàn quyền + quản lý user |
| **operator** | Vận hành route, key, integration, logs |
| **viewer** | Chỉ đọc |

## Ma trận (tóm tắt)

| Hành động | Admin | Operator | Viewer |
|-----------|-------|----------|--------|
| Xem dashboard/logs | ✅ | ✅ | ✅ |
| CRUD route | ✅ | ✅ | ❌ |
| CRUD client key | ✅ | ✅ | ❌ |
| Integrations OAuth | ✅ | ✅ | ❌ |
| CRUD user | ✅ | ❌ | ❌ |
| Settings runtime | ✅ | ✅ | ❌ |
| Proxy Try | ✅ | ✅ | ✅ |

## Kiểm tra 2 lớp

1. **Frontend** — `web/src/lib/rbac.ts`, ẩn menu/route
2. **Backend** — `src/admin_auth.rs` `rbac_allow` → 403 + audit

## Demo HĐ

```bash
# Viewer cookie → POST /api/routes → 403
curl -sS -o /dev/null -w '%{http_code}\n' -b viewer.txt -X POST \
  https://thientinh.io.vn/api/routes -H 'Content-Type: application/json' -d '{}'
```

## Code

- `src/admin_auth.rs`
- `web/src/lib/rbac.test.ts`
