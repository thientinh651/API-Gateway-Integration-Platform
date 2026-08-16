# Thiết kế CSDL tích hợp — mở rộng đa provider

Tài liệu trả lời hội đồng: *"Tại sao schema không cứng Salesforce/Zoho? Làm sao thêm HubSpot/SAP sau này?"*

---

## 1. Nguyên tắc thiết kế

| Nguyên tắc | Ý nghĩa |
|------------|---------|
| **Provider-agnostic** | Cột `provider` thay vì bảng `sf_*` / `zoho_*` riêng |
| **Flow abstraction** | Mỗi pipeline là một `flow_type` (`sales_to_delivery`, `delivery_to_sales`, …) |
| **Event typing** | Mỗi bước pipeline ghi `event_type` + `correlation_id` — truy vết end-to-end |
| **Entity mapping generic** | Link nguồn↔đích dùng `(source_provider, source_id) → (target_provider, target_id)` |
| **Catalog tables** | `integration_providers` + `integration_flow_types` — khai báo connector/flow mới không đổi core |

---

## 2. Sơ đồ quan hệ (phần tích hợp)

```text
integration_providers          integration_flow_types
  salesforce                     sales_to_delivery
  zoho_projects                  delivery_to_sales
        │                                │
        └──────────┬─────────────────────┘
                   ▼
     integration_connections   (tenant × provider, OAuth token runtime)
     integration_provider_configs (tenant × provider, admin settings)
                   │
     ┌─────────────┼─────────────┐
     ▼             ▼             ▼
integration_   integration_   integration_events
snapshots      entity_links   (pipeline events)
(provider,     (flow_type,
 entity_type)   source → target
                + workflow state POC)
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

### 3.2 `integration_flow_types` (catalog pipeline)

| Cột | Mô tả |
|-----|-------|
| `id` | `sales_to_delivery`, `delivery_to_sales`, … |
| `source_provider` / `target_provider` | FK → `integration_providers` |
| `enabled` | Bật/tắt flow |

**POC hiện tại:**

| Flow | Ý nghĩa |
|------|---------|
| `sales_to_delivery` | Closed Won Opportunity (SF) → Zoho Project + tasks |
| `delivery_to_sales` | Zoho «Đã hoàn tất» → SF `Project_Completed__c` + tạo `Invoice__c` |

### 3.3 `integration_connections` (trạng thái kết nối)

```sql
(tenant_id, provider) UNIQUE
status, token_payload_encrypted  -- OAuth tokens AES-256-GCM
last_sync_at, last_error
```

Không nhầm với catalog `integration_providers`.

### 3.4 `integration_provider_configs` (cấu hình admin)

```sql
(tenant_id, provider) UNIQUE
settings_encrypted  -- client_id, secret, redirect_uri, scopes
```

### 3.5 `integration_snapshots`

```sql
(tenant_id, provider, entity_type, payload_json, fetched_at)
```

### 3.6 `integration_events` (pipeline events)

| Cột | Mô tả |
|-----|-------|
| `event_type` | `pipeline_started`, `deal_filtered`, `entity_pushed`, … |
| `flow_type` | `sales_to_delivery` / `delivery_to_sales` |
| `source_provider` / `target_provider` | Ngữ cảnh event |
| `correlation_id` | UUID — gom log 1 lần Đồng bộ ngay |
| `metadata_json` | `{ "source_id", "target_id", "amount" }` |

API dashboard vẫn expose `/api/integrations/sync-logs` (product path).

### 3.7 `integration_entity_links`

```sql
flow_type
source_provider / source_entity_type / source_id
target_provider / target_entity_type / target_id
target_display_name
last_synced_at
-- Workflow state POC (mapping + trạng thái nghiệp vụ cùng bảng):
completion_synced_at   -- đã báo hoàn thành về SF
invoice_external_id    -- id hóa đơn phía hệ thống đích (SF)
invoice_created_at
UNIQUE (tenant_id, flow_type, source_provider, source_entity_type, source_id)
```

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

---

## 5. Mở rộng tương lai

### Thêm provider mới
1. `INSERT INTO integration_providers`
2. Implement OAuth + proxy trong Rust
3. Row trong `integration_connections` / `integration_provider_configs`

### Thêm flow mới
1. `INSERT INTO integration_flow_types`
2. Implement worker/pipeline
3. Entity links dùng `flow_type` mới

---

## 6. Câu hỏi hội đồng — gợi ý

**Q: Tại sao không tách `sf_sync_logs` / `zoho_sync_logs`?**  
A: Một bảng `integration_events` + `flow_type` / provider — query thống nhất.

**Q: Truy vết 1 deal?**  
A: `correlation_id` + `integration_entity_links`.

**Q: Thêm SAP?**  
A: Catalog provider + flow mới; tái sử dụng schema.

**Q: Code còn hardcode SF/Zoho?**  
A: Đúng ở tầng connector (POC). Schema đã tách abstraction.

---

## 7. API quản trị

| Endpoint | Mô tả |
|----------|-------|
| `GET /api/integrations/catalog` | Providers + flow types |
| `GET /api/integrations/sync-logs` | Events (`integration_events`) |
| `GET /api/integrations/entity-links` | Mapping source→target |

---

## 8. Migration rename (20260804120000)

- `integrations` → `integration_connections` (`token_payload_encrypted`)
- `integration_provider_configs.config_encrypted` → `settings_encrypted`
- `sync_logs` → `integration_events`
- Entity links: `target_display_name`, `completion_synced_at`, `invoice_external_id`
