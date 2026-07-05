# Thiết kế CSDL tích hợp — mở rộng đa provider

Tài liệu trả lời hội đồng: *"Tại sao schema không cứng Salesforce/Zoho? Làm sao thêm HubSpot/SAP sau này?"*

---

## 1. Nguyên tắc thiết kế

| Nguyên tắc | Ý nghĩa |
|------------|---------|
| **Provider-agnostic** | Cột `provider` thay vì bảng `sf_*` / `zoho_*` riêng |
| **Flow abstraction** | Pipeline SF→Zoho là **một flow type** (`sales_to_delivery`), không phải toàn bộ hệ thống |
| **Event typing** | Mỗi bước pipeline ghi `event_type` + `correlation_id` — truy vết end-to-end |
| **Entity mapping generic** | Link nguồn↔đích dùng `(source_provider, source_id) → (target_provider, target_id)` |
| **Catalog tables** | `integration_providers` + `integration_flow_types` — khai báo connector/flow mới không đổi core |

---

## 2. Sơ đồ quan hệ (phần tích hợp)

```text
integration_providers          integration_flow_types
  salesforce                     sales_to_delivery
  zoho_projects                  (sf → zoho, POC hiện tại)
        │                                │
        └──────────┬─────────────────────┘
                   ▼
            integrations (tenant × provider, OAuth token)
                   │
     ┌─────────────┼─────────────┐
     ▼             ▼             ▼
integration_   integration_   sync_logs (events)
snapshots      entity_links
(provider,     (flow_type,
 entity_type)   source → target)
```

---

## 3. Bảng chi tiết

### 3.1 `integration_providers` (catalog)

| Cột | Mô tả |
|-----|-------|
| `id` | `salesforce`, `zoho_projects`, tương lai: `hubspot`, `sap` |
| `display_name` | Tên hiển thị UI |
| `auth_type` | `oauth2` |
| `capabilities_json` | `["crm","snapshot"]` — mô tả khả năng connector |

**Trả lời HĐ:** Thêm provider mới = INSERT 1 dòng catalog + implement connector Rust, **không migration schema**.

### 3.2 `integration_flow_types` (catalog pipeline)

| Cột | Mô tả |
|-----|-------|
| `id` | `sales_to_delivery` (POC), tương lai: `lead_to_crm`, `invoice_to_erp` |
| `source_provider` / `target_provider` | FK → `integration_providers` |
| `enabled` | Bật/tắt flow theo tenant hoặc global |

**POC hiện tại:** `sales_to_delivery` = Closed Won Opportunity (SF) → Zoho Project + tasks.

### 3.3 `integrations` (đã generic từ trước)

```sql
(tenant_id, provider) UNIQUE
status, config_encrypted  -- OAuth tokens AES-256-GCM
```

Provider values: `salesforce`, `zoho_projects`.

### 3.4 `integration_snapshots` (đã generic)

```sql
(tenant_id, provider, entity_type, payload_json, fetched_at)
```

Ví dụ: `salesforce/opportunity`, `salesforce/account`.

### 3.5 `sync_logs` → integration events

**Migration 20260704120000** bổ sung:

| Cột mới | Mô tả |
|---------|-------|
| `event_type` | `pipeline_started`, `deal_filtered`, `entity_pushed`, … |
| `flow_type` | `sales_to_delivery` |
| `source_provider` / `target_provider` | Ngữ cảnh event |
| `correlation_id` | UUID — gom toàn bộ log 1 lần Sync Now |
| `metadata_json` | `{ "source_id", "target_id", "amount" }` |

Giữ `status`, `message` — tương thích UI cũ.

### 3.6 `integration_entity_links` (đã refactor generic)

**Trước (cứng SF/Zoho):**
```sql
sf_entity_type, sf_id, zoho_entity_type, zoho_id, zoho_name
```

**Sau (mở rộng):**
```sql
flow_type           -- sales_to_delivery
source_provider     -- salesforce
source_entity_type  -- opportunity
source_id
target_provider     -- zoho_projects
target_entity_type  -- project
target_id
target_name
UNIQUE (tenant_id, flow_type, source_provider, source_entity_type, source_id)
```

**Trả lời HĐ:** Flow SF→HubSpot chỉ cần flow_type mới + mapping mới, **cùng một bảng**.

---

## 4. Event types (Rust enum)

```rust
enum IntegrationEventType {
    PipelineStarted,
    PipelineCompleted,
    SnapshotSynced,
    DealFiltered,
    EntitySkipped,
    EntityPushed,
    EntityPushFailed,
    EntityLinkStale,
    UpstreamRetry,
}
```

Mỗi lần **Sync Now** sinh `correlation_id` — filter log theo trace trong dashboard.

---

## 5. Mở rộng tương lai — checklist

### Thêm provider mới (ví dụ HubSpot)

1. `INSERT INTO integration_providers ('hubspot', ...)`
2. Implement OAuth + proxy path `/v1/api/hubspot/*` trong Rust
3. `INSERT INTO integrations (tenant_id, 'hubspot', ...)`

**Không đổi:** `integrations`, `integration_snapshots`, `sync_logs` schema.

### Thêm flow mới (ví dụ SF → HubSpot Deal)

1. `INSERT INTO integration_flow_types ('sf_to_hubspot', ...)`
2. Implement worker/pipeline cho flow đó
3. Entity links dùng `flow_type = 'sf_to_hubspot'`

### Thêm connector trong code (hướng dài hạn)

```rust
trait IntegrationProvider {
    fn id(&self) -> &str;
    async fn refresh_token(&self, ...) -> Result<()>;
    async fn proxy_request(&self, ...) -> Result<Response>;
}
```

POC chưa implement trait — **documented as future work**; DB đã sẵn sàng.

---

## 6. Câu hỏi hội đồng — gợi ý trả lời

**Q: Tại sao không tách bảng `sf_sync_logs` và `zoho_sync_logs`?**  
A: Một bảng event + cột `provider`/`flow_type` — query thống nhất, thêm provider không migration.

**Q: Làm sao truy vết 1 deal qua nhiều bước?**  
A: `correlation_id` gom log pipeline; `integration_entity_links` lưu mapping idempotent.

**Q: Thêm SAP thì sao?**  
A: Catalog provider + flow mới; snapshots/links/events tái sử dụng cùng schema.

**Q: Code vẫn hardcode SF/Zoho?**  
A: Đúng ở tầng connector (POC). Schema và event model đã tách abstraction — bước tiếp theo là `IntegrationProvider` trait.

---

## 7. API quản trị

| Endpoint | Mô tả |
|----------|-------|
| `GET /api/integrations/catalog` | Danh sách providers + flow types đã đăng ký |
| `GET /api/integrations/sync-logs` | Events có `event_type`, `correlation_id` |
| `GET /api/integrations/entity-links` | Mapping generic source→target |

---

## 8. Migration

File: `migrations/20260704120000_integration_extensible_schema.sql`

- Tạo catalog tables + seed SF/Zoho
- ALTER `sync_logs`, migrate `integration_entity_links`
- Data cũ được backfill tự động
