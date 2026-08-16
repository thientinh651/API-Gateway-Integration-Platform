# Đồng bộ hoàn thành dự án và xuất hóa đơn — Zoho → Salesforce

## Yêu cầu nghiệp vụ

Trên Zoho Projects, khi dự án xong, người dùng **chỉ đổi Trạng Thái sang «Đã hoàn tất»**.

Gateway **định kỳ** (Đồng bộ ngay / worker):

1. Đánh dấu Opportunity `Project_Completed__c = true`
2. Tạo bản ghi hóa đơn `Invoice__c` trên Salesforce (Amount lấy từ Opportunity)

Không cấu hình Webhook trên Zoho. Không thao tác tay trên Salesforce sau khi đã setup object/field một lần.

## Luồng

```
Zoho: Trạng Thái → Đã hoàn tất
        ↓
Gateway Đồng bộ ngay / worker
        ↓
Opportunity.Project_Completed__c = true
        ↓
Tạo Invoice__c (liên kết Opportunity, Account, số tiền, ngày phát hành)
```

## Điều kiện Salesforce (setup một lần)

### 1. Checkbox trên Opportunity

- Label: `Project Completed`
- API: `Project_Completed__c`

### 2. Custom Object hóa đơn `Invoice__c`

Setup → Object Manager → **Create** → Custom Object:

| Thuộc tính | Giá trị |
|------------|---------|
| Label | Invoice |
| Plural | Invoices |
| Object Name | Invoice |
| Record Name | Invoice Name (Text) |

Thêm fields:

| Field Label | Type | API Name | Ghi chú |
|-------------|------|----------|---------|
| Opportunity | Lookup → Opportunity | `Opportunity__c` | Bắt buộc cho liên kết deal |
| Account | Lookup → Account | `Account__c` | Tuỳ chọn |
| Amount | Currency | `Amount__c` | Lấy từ Opportunity.Amount |
| Status | Text (hoặc Picklist) | `Status__c` | Gateway ghi `Issued` |
| Issued Date | Date | `Issued_Date__c` | Ngày đồng bộ |
| Zoho Project Id | Text (255) | `Zoho_Project_Id__c` | Truy vết |

Cấp quyền Read/Create cho profile dùng Connected App. Thêm tab **Invoices** nếu muốn xem trên UI.

## Vận hành hàng ngày

1. OAuth Salesforce + Zoho đã connected.
2. Deal Closed Won đã sync → có Entity Link.
3. Zoho: đổi status → **Đã hoàn tất**.
4. **Đồng bộ ngay** hoặc chờ worker.
5. Kiểm tra:
   - Opportunity: **Project Completed** đã tick
   - Tab **Invoices**: bản ghi `INV-…` mới
   - Sync Log: SUCCESS hoàn thành + SUCCESS xuất hóa đơn

## Biến môi trường (tuỳ chọn)

| Biến | Mặc định | Mô tả |
|------|----------|--------|
| `INTEGRATION_SF_DELIVERY_FIELD` | `Project_Completed__c` | Checkbox hoàn thành |
| `INTEGRATION_SF_INVOICE_OBJECT` | `Invoice__c` | API name object hóa đơn |
| `INTEGRATION_SF_INVOICE_ENABLED` | bật | `0` / `false` để tắt tạo hóa đơn |
| `INTEGRATION_ZOHO_COMPLETED_STATUS` | (trống) | Thêm alias status hoàn thành |

## Lỗi thường gặp

| Triệu chứng | Nguyên nhân | Xử lý |
|-------------|-------------|--------|
| FAILED xuất hóa đơn, `INVALID_TYPE` | Chưa tạo `Invoice__c` | Tạo object + fields như bảng trên |
| `REQUIRED_FIELD_MISSING` | Thiếu field / API name sai | Đối chiếu đúng `Opportunity__c`, `Amount__c`, … |
| Project Completed tick nhưng không có Invoice | Lần sync trước FAILED | Sửa SF rồi Đồng bộ ngay lại (backfill `invoice_external_id` trống) |

## Ghi chú kỹ thuật

- `pull_zoho_completions_to_salesforce` + `create_sf_invoice_for_completed_project`
- Idempotent: `completion_synced_at`, `invoice_external_id` trên `integration_entity_links`
