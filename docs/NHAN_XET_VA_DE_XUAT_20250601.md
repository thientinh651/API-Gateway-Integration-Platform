# Nhận xét sản phẩm & đề xuất thực hiện

**Ngày ghi nhận:** 01/06/2025  
**Nguồn:** Phản hồi khi đem sản phẩm ra trình bày / demo  
**Mục đích:** Lưu lại yêu cầu, đối chiếu hiện trạng codebase, và lộ trình triển khai.

---

## 1. Tóm tắt phản hồi

Người đánh giá kỳ vọng một **sản phẩm kết nối** (kéo mũi tên giữa hệ thống, map dữ liệu, cấu hình xong mới kết nối), không phải **công cụ cấu hình gateway** (route thủ công, cài đặt hệ thống, nhiều màn hướng dẫn). Các nhóm chính:

1. **Kiến trúc & vận hành** — session/Redis, tách concern, chịu lỗi DB/mạng  
2. **Bảo mật & đa tenant** — tài nguyên riêng từng người, RBAC rõ, API key không dùng chung  
3. **Trải nghiệm người dùng** — canvas trống, chọn Salesforce/Zoho, mũi tên + map field, gộp log, bỏ route/settings  
4. **Trải nghiệm “không cần hướng dẫn”** — ít màn, luồng tự hiểu, còn nhiều thiếu sót so với kỳ vọng

---

## 2. Chi tiết nhận xét (nguyên văn ý)

### 2.1 Kiến trúc & hạ tầng

| # | Nhận xét | Ý nghĩa |
|---|----------|---------|
| K1 | In-memory DB session — **tách ra**, không để chung backend | Session/state không nên sống trong process gateway; dễ mất khi restart, khó scale |
| K2 | **Redis** | Session, OAuth pending, replay cache, v.v. nên dùng store bền/chia sẻ |
| K3 | **Separation of concerns** | Tách control plane (admin) và data plane (proxy); trách nhiệm từng module rõ |
| K4 | **Handle khi mất DB, mạng** | Degraded mode, thông báo rõ, không sập im lặng hoặc 500 chung chung |

### 2.2 Bảo mật & phân quyền

| # | Nhận xét | Ý nghĩa |
|---|----------|---------|
| B1 | **Quản lý tài nguyên của mỗi người riêng** | Mỗi admin/tenant chỉ thấy và sửa tài nguyên của mình |
| B2 | **Role-based access control** — admin1 không được lấy của admin2 | Cách ly dữ liệu theo tenant/user, không chỉ ẩn UI |
| B3 | **Để role lại cho dễ biết** | Đặt tên/vai trò dễ hiểu; matrix quyền minh bạch |
| B4 | **Coi lại API key** — không thể để ai cũng dùng key đó | Một key admin dùng chung là rủi ro; key gắn user/tenant |
| B5 | **Lấy session của view đi tạo API bằng admin** | API admin nên gắn phiên đăng nhập, không bypass bằng key toàn cục |
| B6 | **Shadow DOM** (?) — protect password không bị lấy | Trường nhạy cảm khó bị extension/DOM đọc |
| B7 | **Xóa luôn, để người ta tự điền** | Không lưu secret/password trong hệ thống sau khi cấu hình; user tự nhập khi cần |

### 2.3 Trải nghiệm sản phẩm (UX)

| # | Nhận xét | Ý nghĩa |
|---|----------|---------|
| U1 | **Không cần quản lý route nữa, bỏ** | Bỏ màn CRUD route; route sinh từ kết nối/map |
| U2 | **Cấu hình xong mới được kết nối** — ban đầu trống, thêm dấu **+**, chọn **Salesforce** hoặc **Zoho** | Empty state; chọn provider mới hiện form |
| U3 | Chọn provider **mới lòi ra** phần cấu hình; **cấu hình xong mới hiện** trạng thái kết nối | Progressive disclosure |
| U4 | **Kéo một mũi tên**, hiện trang cấu hình cho **cả hai** hệ giao tiếp | Luồng trung tâm: nối A ↔ B, không cấu hình rời rạc |
| U5 | **Map từ từ** hai hệ qua nhau — định nghĩa sao cho make sense | Field mapping có nghĩa nghiệp vụ |
| U6 | Làm sao **cấu hình mũi tên** đó — integrate gì, cấu hình gì | UI rõ “mũi tên này làm gì” |
| U7 | Có bao nhiêu **kết nối**, trạng thái, v.v. | Tổng quan kết nối trên canvas/dashboard |
| U8 | **Không cần cài đặt hệ thống** (màn Settings) | Rate limit, metrics, admin key — chuyển deploy/env hoặc ẩn |
| U9 | **Gộp log và audit log**, dùng **bộ lọc** | Một nhật ký, phân loại bằng filter |
| U10 | **Tốt là không cần hướng dẫn** — chỉ làm được luôn | Onboarding tối thiểu; nav gọn |
| U11 | **Quá nhiều thiếu sót** so với kỳ vọng trên | Cần lộ trình ưu tiên rõ |

---

## 3. Đối chiếu hiện trạng (01/06/2025)

Tham chiếu codebase `avaso-gateway` tại thời điểm ghi nhận.

### 3.1 Kiến trúc

| Hạng mục | Hiện trạng | File / ghi chú |
|----------|------------|----------------|
| Admin session | In-memory `DashMap`, mất khi restart | `src/main.rs` |
| Redis | Không có | — |
| OAuth pending / HMAC replay | In-memory | `src/main.rs`, `src/integrations.rs` |
| Monolith | Một binary: proxy + admin API + static UI | `src/`, `web/` |
| Lỗi DB | Thường `500` + message; startup fail nếu DB không mở được | `src/db.rs`, handlers trong `main.rs` |
| Lỗi upstream | Transaction log, retry/DLQ | `src/proxy_ext.rs`, `gateway_transaction_logs` |

### 3.2 Bảo mật

| Hạng mục | Hiện trạng | Ghi chú |
|----------|------------|---------|
| Tenant scope | `tenant_id` trên routes, keys, audit | `src/db.rs` |
| RBAC | `admin` / `operator` / `viewer` | `src/admin_auth.rs`, `web/src/lib/rbac.ts` |
| Admin API key | **Một key dùng chung** toàn gateway; bypass → user ảo tenant 1, role admin | `gateway_settings`, `AdminCtx::from_admin_api_key()` |
| Secret OAuth | Lưu DB (masked); form có nhập client_secret | `Integrations.tsx`, `integration_provider_configs` |
| Password UI | `PasswordManagerTrap`, autocomplete — **không** Shadow DOM | `web/src/app/components/forms/PasswordManagerTrap.tsx` |

### 3.3 UX

| Hạng mục | Hiện trạng | Ghi chú |
|----------|------------|---------|
| Quản lý Route | Có nav + CRUD đầy đủ | `web/.../Routes.tsx`, `navConfig.ts` |
| Tích hợp | Một trang: SF + Zoho cùng lúc, dialog OAuth | `web/.../Integrations.tsx` |
| Logs | Hai trang: `/logs` (traffic) và `/audit` (admin) | `Logs.tsx`, `AuditLogs.tsx` |
| Cài đặt hệ thống | `/settings` — rate limit, metrics, admin API key | `Settings.tsx` |
| Nav | Nhiều mục: Route, Proxy Try, Queue, API docs, Settings, … | `navConfig.ts` |

---

## 4. Đề xuất thực hiện

### 4.1 Nguyên tắc sản phẩm

1. **Đơn vị là “kết nối”** (Salesforce ↔ Zoho), không phải “route”.  
2. **Empty → chọn hệ → cấu hình → kéo mũi tên → map → kết nối**.  
3. **Bảo mật theo tenant/user** trước khi làm UI đẹp.  
4. **Một nhật ký, nhiều filter** thay vì hai màn log.  
5. **Cấu hình vận hành** (rate limit, metrics, key toàn cục) ra khỏi UI người dùng cuối.

### 4.2 Luồng UX mục tiêu (mô tả)

```
[Màn trống]
    │
    ▼ [+] Chọn Salesforce | Zoho
    │
    ▼ Form OAuth / app credentials (chỉ provider đã chọn)
    │
    ▼ Connect → node “sẵn sàng”
    │
    ▼ Kéo mũi tên giữa hai node
    │
    ▼ Panel: hai hệ giao tiếp thế nào + map field
    │
    ▼ Lưu → backend tạo integration + route ẩn (user không thấy CRUD route)
```

### 4.3 Lộ trình ưu tiên

#### P0 — Demo / bảo vệ / niềm tin bảo mật cơ bản

| ID | Hạng mục | Việc làm |
|----|----------|----------|
| P0-1 | Tenant isolation | Kiểm tra + test: admin tenant A không đọc/sửa tài nguyên tenant B; sửa bypass API key nếu có |
| P0-2 | API key | Bỏ hoặc hạn chế key admin dùng chung; ưu tiên session cookie / token per user |
| P0-3 | UX canvas | Màn trống + (+) chọn SF/Zoho; ẩn form đến khi chọn; connect sau khi config hợp lệ |
| P0-4 | Bỏ Route (UI) | Gỡ nav và route công khai; route sinh ngầm từ kết nối (có thể giữ API tạm cho backend) |
| P0-5 | Gộp log | Một trang Nhật ký; filter: traffic \| quản trị \| thời gian \| user |
| P0-6 | Secret | Không giữ client_secret lâu dài; user tự điền khi cần; chỉ token OAuth sau connect |
| P0-7 | Ẩn Settings | Gỡ “Cài đặt hệ thống” khỏi nav user; chuyển sang env/deploy doc |

#### P1 — Production

| ID | Hạng mục | Việc làm |
|----|----------|----------|
| P1-1 | Redis | Session admin, OAuth state, HMAC replay |
| P1-2 | Session service | Tách hoặc module riêng; gateway chỉ validate session id |
| P1-3 | RBAC | Đổi tên role + trang matrix; tenant-admin vs super-admin (nếu cần) |
| P1-4 | Resilience | Health degraded khi DB down; UI banner; proxy hành vi an toàn |
| P1-5 | Mũi tên + map | UI map field SF ↔ Zoho; lưu schema mapping trong DB |

#### P2 — Scale & hardening

| ID | Hạng mục | Việc làm |
|----|----------|----------|
| P2-1 | Tách control / data plane | Deploy hoặc crate riêng nếu scale |
| P2-2 | Shadow DOM / iframe credential | Field password/secret hardened (đánh giá cost/benefit) |
| P2-3 | HA session | Sticky session hoặc shared Redis cluster |

### 4.4 Thay đổi navigation đề xuất

**Giữ (user thường):** Tổng quan, Kết nối (canvas), Nhật ký (gộp), Bảo mật & keys (nếu cần).  
**Chỉ admin:** Quản lý Users.  
**Bỏ / ẩn khỏi UI chính:** Quản lý Route, Cài đặt hệ thống, Proxy Try, Proxy Queue (hoặc dev-only), tách Logs/Audit.

### 4.5 Thay đổi API / dữ liệu (định hướng)

- `GET/POST /api/connections` — thay vai trò route+integration cho UI.  
- `POST /api/connections/:id/mapping` — field map giữa hai provider.  
- `GET /api/events` — gộp transaction log + audit với query `type=traffic|admin`.  
- Session: header/cookie only; deprecate shared `X-API-Key` cho UI (giữ cho automation có scope hạn).

---

## 5. Mapping file tham khảo (khi triển khai)

| Mục tiêu | File chính |
|----------|------------|
| Session in-memory | `src/main.rs` |
| RBAC / admin context | `src/admin_auth.rs` |
| Tenant queries | `src/db.rs` |
| OAuth SF/Zoho | `src/integrations.rs` |
| RBAC UI | `web/src/lib/rbac.ts` |
| Nav | `web/src/app/components/layout/navConfig.ts` |
| Routes UI | `web/src/app/pages/Routes.tsx` |
| Integrations UI | `web/src/app/pages/Integrations.tsx` |
| Logs / Audit | `web/src/app/pages/Logs.tsx`, `AuditLogs.tsx` |
| Settings | `web/src/app/pages/Settings.tsx` |
| Admin API key UI | `web/src/app/pages/Settings.tsx`, `web/src/lib/api.ts` |

---

## 6. Tiêu chí “xong” (acceptance gợi ý)

- [ ] Hai admin khác tenant không đọc được route/key/log của nhau (test tự động).  
- [ ] UI không có màn “Quản lý Route” và “Cài đặt hệ thống” cho user demo.  
- [ ] Màn kết nối: trống → + → SF hoặc Zoho → config → connect.  
- [ ] Có luồng kéo/nối hai node và màn map (ít nhất MVP).  
- [ ] Một trang nhật ký với filter loại traffic/admin.  
- [ ] Không còn hướng dẫn bắt buộc để hoàn thành luồng kết nối cơ bản.  
- [ ] (P1) Restart process không đăng xuất hàng loạt nếu dùng Redis session.

---

## 7. Ghi chú

- Tài liệu này **không** thay thế `README.md` hay runbook kỹ thuật hiện có; là backlog sản phẩm từ buổi nhận xét.  
- Khi bắt đầu task, tạo issue/PR link tới ID P0-x / P1-x trong mục 4.3.  
- Cập nhật mục 3 khi codebase thay đổi đáng kể.

---

*Cập nhật lần đầu: 01/06/2025*
