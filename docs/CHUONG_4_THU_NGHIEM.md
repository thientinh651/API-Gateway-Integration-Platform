# CHƯƠNG 4. THỬ NGHIỆM

Quá trình thử nghiệm nhằm xác minh nền tảng Gateway đa tích hợp (Rust) đáp ứng các yêu cầu chức năng đã nêu ở Chương 3, tập trung vào mặt phẳng dữ liệu (OAuth2 JWT, định tuyến, điều tiết), mặt phẳng điều khiển (session, RBAC) và phần mở rộng tích hợp Salesforce/Zoho. Môi trường: PostgreSQL, gateway chạy cổng 3000; công cụ: `curl`, `scripts/test_jwt_auth.py`, `scripts/smoke-test.sh`, k6/wrk, giao diện dashboard và kiểm thử thủ công.

---

## 4.1 CÁC KỊCH BẢN THỬ NGHIỆM

Để đảm bảo hệ thống hoạt động đúng theo các yêu cầu chức năng đã đề ra, quá trình thử nghiệm được chia thành các nhóm chức năng chính:

### 4.1.1 Nhóm xác thực an ninh và điều tiết giao dịch

Nhóm này kiểm tra cơ chế xác thực OAuth2 Client Credentials + JWT Bearer, giới hạn tần suất (rate limit) và kiểm soát truy cập theo tuyến (ACL).

| Mã kịch bản | Tên kịch bản | Mô tả | Đầu vào | Kết quả mong đợi |
|-------------|--------------|-------|---------|------------------|
| TC_01 | Xác thực JWT hợp lệ | Kiểm tra Gateway chấp nhận data plane khi client có Bearer JWT hợp lệ (sau `POST /api/oauth/token`) | Client active; `client_id` + `client_secret` → token; `GET /v1/api/{route}` + `Authorization: Bearer` | HTTP 200/404 từ upstream (tùy target); không trả 401; ghi log giao dịch `outcome=success` hoặc upstream tương ứng |
| TC_02 | Từ chối thiếu hoặc sai token | Kiểm tra Gateway từ chối yêu cầu không Bearer, token sai, hết hạn hoặc client disabled | (a) Không header `Authorization`; (b) Token sai/hết hạn; (c) Client disabled | HTTP 401; body JSON (`missing_token`, `invalid_token`, `token_expired`, …); không chuyển tiếp upstream |
| TC_03 | Token endpoint — client_id/secret | Kiểm tra đổi credential tại `/api/oauth/token` (secret không dùng trên data plane) | (a) Sai `client_secret` → 401; (b) Đúng credential → `access_token`; (c) Data plane chỉ gửi Bearer | Token endpoint từ chối secret sai; data plane không yêu cầu secret |
| TC_04 | Rate limit vượt ngưỡng | Kiểm tra điều tiết khi vượt giới hạn req/phút (client hoặc route) | Client `clientRateLimit=10`/phút; gửi >10 request/phút tới route hợp lệ | HTTP 429; header `Retry-After`; không proxy quá ngưỡng; metric/data plane ghi nhận bị chặn |
| TC_05 | ACL tuyến theo client | Kiểm tra client chỉ gọi được tuyến được gán trong `gateway_client_key_routes` | Client A chỉ ACL route `/v1/api/a`; gửi JWT tới `/v1/api/b` | HTTP 403; không forward upstream; log ghi lý do từ chối ACL |

### 4.1.2 Nhóm định tuyến, proxy và pipeline xử lý yêu cầu

Nhóm này kiểm tra khả năng định tuyến động, lọc phương thức HTTP, chuyển tiếch upstream, retry/DLQ và ghi nhật ký giao dịch.

| Mã kịch bản | Tên kịch bản | Mô tả | Đầu vào | Kết quả mong đợi |
|-------------|--------------|-------|---------|------------------|
| TC_06 | Proxy định tuyến thành công | Kiểm tra match route theo path và chuyển tiếp upstream | Route `path=/v1/api/demo`, `target=https://httpbin.org/get`; Bearer JWT hợp lệ; `GET /v1/api/demo` | HTTP 200; phản hồi từ upstream; header transform (nếu cấu hình) được áp dụng |
| TC_07 | Lọc phương thức HTTP theo tuyến | Kiểm tra `allowedMethods` trên route | Route chỉ cho phép `GET`; gửi `POST` cùng path | HTTP 405 hoặc 403 (method not allowed); không gọi upstream |
| TC_08 | Retry và đưa vào DLQ khi upstream lỗi | Kiểm tra pipeline retry và hàng đợi lỗi khi upstream trả 502/503 hoặc timeout | Route bật `queueOnFailure=1`, `retryMax>0`; upstream cố ý lỗi | Sau retry thất bại: bản ghi xuất hiện trong `gateway_proxy_queue`; operator xem/replay trên dashboard |
| TC_09 | Ghi nhật ký giao dịch (transaction log) | Kiểm tra mỗi yêu cầu data plane được ghi log bất đồng bộ | Bất kỳ request Bearer JWT hợp lệ (thành công hoặc thất bại) | Bản ghi mới trong `gateway_transaction_logs` gồm `requestId`, `method`, `path`, `status`, `durationMs`, `clientKeyId` |

### 4.1.3 Nhóm quản trị control plane và tích hợp mở rộng

Nhóm này kiểm tra đăng nhập dashboard, phân quyền RBAC tĩnh, quản trị route/client và pipeline đồng bộ Salesforce → Zoho.

| Mã kịch bản | Tên kịch bản | Mô tả | Đầu vào | Kết quả mong đợi |
|-------------|--------------|-------|---------|------------------|
| TC_10 | Đăng nhập session và kiểm tra sức khỏe hệ thống | Kiểm tra luồng admin: login cookie session, `/health`, `/metrics` | `POST /api/login` user/pass hợp lệ; `GET /health`; `GET /metrics` | Login HTTP 200 + cookie; `/health` JSON `status` OK; `/metrics` có metric data plane; `smoke-test.sh` pass |
| TC_11 | RBAC vai trò Viewer / Operator | Kiểm tra phân quyền tĩnh trên API quản trị | User role `viewer`: `GET /api/routes`; `POST /api/routes`. User `operator`: `PUT /api/routes/{id}`; `POST /api/routes` | Viewer: GET được dashboard giám sát, POST route → 403. Operator: PUT route được, POST/DELETE route → 403; không truy cập integrations |
| TC_12 | Pipeline đồng bộ tích hợp SF → Zoho | Kiểm tra kết nối OAuth và chạy sync batch (Closed Won → Project) | Admin đã OAuth SF + Zoho; bật bridge; gọi sync hoặc chờ worker ~15 phút | `sync_logs` ghi trạng thái; `integration_entity_links` có mapping SF↔Zoho; không trùng bản ghi khi chạy lại |

---

## 4.2 KẾT QUẢ THỬ NGHIỆM CÁC KỊCH BẢN

Môi trường thử nghiệm: Ubuntu VPS / Docker Compose; PostgreSQL 16; Gateway Rust (Axum) bản triển khai đồ án; thời gian thực hiện theo đợt kiểm thử trước bảo vệ.

| Mã kịch bản | Kết quả mong đợi | Kết quả thực tế | Trạng thái |
|-------------|-------------------|-----------------|------------|
| TC_01 | HTTP 200/404; không 401; có log giao dịch | Request Bearer JWT hợp lệ nhận phản hồi upstream; `gateway_transaction_logs` có bản ghi tương ứng | **Đạt** |
| TC_02 | HTTP 401; không forward upstream | Thiếu/sai/hết hạn token đều trả 401 JSON đúng mã lỗi | **Đạt** |
| TC_03 | Token endpoint từ chối secret sai | `test_jwt_auth.py`: sai secret → 401; đúng → `access_token`; data plane chỉ Bearer | **Đạt** |
| TC_04 | HTTP 429 khi vượt ngưỡng | Burst vượt limit trả 429 kèm `Retry-After` | **Đạt** |
| TC_05 | HTTP 403 khi gọi route ngoài ACL | Client không trong ACL bị chặn trước upstream | **Đạt** |
| TC_06 | Proxy thành công theo route | Path match đúng, upstream phản hồi 200 | **Đạt** |
| TC_07 | Method không hợp lệ bị từ chối | POST vào route chỉ GET bị chặn | **Đạt** |
| TC_08 | Bản ghi DLQ sau lỗi upstream | Hàng đợi `gateway_proxy_queue` có item; replay thủ công thành công trên UI | **Đạt** |
| TC_09 | Log giao dịch đầy đủ trường | Mọi request data plane đều có log async | **Đạt** |
| TC_10 | Login + health + metrics OK | `smoke-test.sh` pass toàn bộ bước | **Đạt** |
| TC_11 | RBAC đúng ma trận role | Khớp unit test `rbac.test.ts` và kiểm thử API thực tế | **Đạt** |
| TC_12 | Sync pipeline + entity link | OAuth connected; sync ghi log; entity link idempotent khi chạy lại | **Đạt** |

**Kết luận 4.2:** 12/12 kịch bản **Đạt**. Các yêu cầu cốt lõi Gateway (~70%) và phần mở rộng tích hợp (~30%) được xác minh trên môi trường triển khai thực tế.

---

## 4.3 XỬ LÝ CÁC TRƯỜNG HỢP NGOẠI LỆ

Trong quá trình thử nghiệm, các trường hợp ngoại lệ (edge cases) được kiểm tra nhằm đảm bảo ứng dụng xử lý lỗi một cách hợp lý, không bị crash và đưa ra thông báo phù hợp cho người dùng.

### 4.3.1 Xác thực dữ liệu đầu vào

| STT | Trường hợp ngoại lệ | Hành vi xử lý | Kết quả |
|-----|---------------------|---------------|---------|
| 1 | Đăng nhập dashboard sai mật khẩu | Từ chối, không tạo session | HTTP 401; thông báo credentials invalid; không ghi cookie |
| 2 | Tạo route với `path` rỗng hoặc không bắt đầu `/` | Validate trước khi ghi DB | HTTP 400; JSON mô tả trường lỗi; không insert |
| 3 | Tạo route `target` không phải URL http/https | Validate schema URL | HTTP 400; không lưu cấu hình sai |
| 4 | `timeoutSecs` hoặc `routeRateLimit` âm | Validate biên số | HTTP 400; thông báo out of range |
| 5 | JWT hết hạn hoặc sai issuer | Verify JWT trước proxy | HTTP 401 `token_expired` / `invalid_token` |
| 6 | Request body JSON admin API sai định dạng | Axum deserialize lỗi | HTTP 400/422; không thay đổi DB |
| 7 | Tạo client key thiếu tên hoặc rate limit ngoài [0, 1_000_000] | Validate form/API | HTTP 400; field error rõ ràng trên UI |
| 8 | Gọi API admin không cookie và không `X-API-Key` | Middleware auth | HTTP 401 unauthorized |

### 4.3.2 Xử lý trùng lặp dữ liệu

| STT | Trường hợp ngoại lệ | Hành vi xử lý | Kết quả |
|-----|---------------------|---------------|---------|
| 1 | Trùng `(tenantId, path)` khi tạo route | UNIQUE index `idx_gateway_routes_tenant_path` | HTTP 409 hoặc 400; không ghi đè route cũ |
| 2 | Trùng `username` khi tạo dashboard user | UNIQUE constraint | HTTP 409; thông báo username đã tồn tại |
| 3 | Trùng `(tenantId, provider)` trên integrations | UNIQUE constraint | Upsert/connect cập nhật bản ghi cũ, không duplicate |
| 4 | Trùng cặp ACL `(clientKeyId, routeId)` | PRIMARY KEY composite | INSERT bị bỏ qua hoặc conflict; ACL không nhân đôi |
| 5 | Sync lại cùng `(tenantId, sfEntityType, sfId)` | UNIQUE trên `integration_entity_links` | Không tạo link trùng; cập nhật `lastSyncedAt` |
| 6 | Trùng tài liệu `(tenantId, sfEntityType, sfId, sourceProvider)` | UNIQUE constraint | Giữ một metadata; không duplicate file record |

### 4.3.3 Xử lý quyền hệ thống

| STT | Trường hợp ngoại lệ | Hành vi xử lý | Kết quả |
|-----|---------------------|---------------|---------|
| 1 | Viewer truy cập `POST /api/routes` | `rbac_allow()` từ chối | HTTP 403; ghi audit failure (nếu có thao tác) |
| 2 | Operator truy cập `GET /api/users` hoặc `PUT /api/settings` | RBAC chặn quản trị user/settings | HTTP 403 |
| 3 | Operator/Viewer truy cập `/api/integrations/*` | Chỉ admin được tích hợp | HTTP 403 |
| 4 | Client disabled gọi data plane | Kiểm tra `status=disabled` trước verify JWT | HTTP 401/403; key disabled |

### 4.3.4 Xử lý các trường hợp biên

| STT | Trường hợp ngoại lệ | Hành vi xử lý | Kết quả |
|-----|---------------------|---------------|---------|
| 1 | Upstream timeout vượt `timeoutSecs` | Hủy request, trả lỗi gateway | HTTP 504 Gateway Timeout; log ghi `reason=timeout` |
| 2 | Upstream trả 502/503 trong danh sách retry | Retry theo `retryMax`; nếu vẫn lỗi → DLQ | Client nhận lỗi hoặc 502; DLQ có bản ghi nếu bật queue |
| 3 | Route không tồn tại (path không match) | Không proxy | HTTP 404; log outcome failure |
| 4 | `clientRateLimit=0` và `routeRateLimit=0` | Kế thừa rate limit global từ `gateway_settings` | Áp dụng RPS global hoặc không limit nếu tắt |
| 5 | Session admin hết hạn | `resolve_session_ctx` trả None | HTTP 401; redirect login trên SPA |
| 6 | OAuth `state` hết hạn hoặc không khớp | Từ chối callback | Redirect lỗi; không lưu token; bản ghi pending bị xóa/purge |
| 7 | PostgreSQL tạm không phản hồi | `/health` phản ánh trạng thái DB | `/health` không OK; gateway báo unhealthy |
| 8 | Request body data plane rất lớn | Proxy stream; timeout áp dụng | Không crash process; timeout hoặc upstream từ chối có kiểm soát |

---

*Tài liệu tham chiếu kiểm thử: `scripts/smoke-test.sh`, `scripts/test_jwt_auth.py`, `scripts/test-integrations.sh`, `web/src/lib/rbac.test.ts`, dashboard Proxy Try / Routes / Client Registry.*
