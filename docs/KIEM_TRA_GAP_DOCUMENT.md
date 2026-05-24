# Kiểm tra gap — Document.docx vs tích hợp SF / Zoho / Báo cáo

**Ngày kiểm tra:** 2026-05-21  
**File gốc:** [Document.docx](./Document.docx) (backup: `Document.docx.bak`)

---

## Kết luận nhanh

| Hạng mục | Document.docx (trước chỉnh) | Cần có |
|----------|----------------------------|--------|
| Salesforce | Chỉ **1 dòng** trong business case (§2.1) | Feature, API, OAuth, FR |
| Zoho Projects | **0** | Toàn bộ |
| Dashboard báo cáo tích hợp | Chỉ metrics gateway + “Grafana nâng cao” **ngoài phạm vi** | Trang `/integrations`, `/reports`, snapshot |
| OAuth | Ghi “**không** OAuth client” — dễ hiểu nhầm là cấm mọi OAuth | Tách: client = API key; **admin connector** = OAuth SF/Zoho |
| Feature | F‑01 … F‑12, **không** F‑13+ | F‑13, F‑14, F‑15 |
| FR | Nhóm A–H, **không** nhóm I | FR‑I1 … FR‑I10 |
| Admin API | Không có `/api/integrations`, `/api/reports` | Bổ sung danh mục |

**Đã xử lý:** script `scripts/patch_document_docx.py` chèn nội dung vào `Document.docx`. Chi tiết kỹ thuật triển khai vẫn nằm ở [TICH_HOP_VA_BAO_CAO.md](./TICH_HOP_VA_BAO_CAO.md).

---

## Chi tiết gap (theo chương)

### Chương 1 — Giới thiệu

| § | Thiếu |
|---|--------|
| 1.2 Phạm vi hệ thống | Không liệt kê: Integration connector, báo cáo snapshot CRM/PM |
| 1.3 Thuật ngữ | Thiếu: `Integration`, `Connector`, `OAuth token`, `Snapshot` |

### Chương 2 — Tổng quan

| § | Hiện trạng | Thiếu |
|---|------------|--------|
| 2.1 Business case | Có CRM/Salesforce trong danh sách hệ thống rời rạc | Không nối sang **giải pháp** (gateway làm connector) |
| 2.2 Mục tiêu | MVP = gateway + dashboard quản trị | Không có mục tiêu **tích hợp & báo cáo** |
| 2.6 KPI | Có benchmark gateway | Không KPI “≥1 CRM connected”, “báo cáo có dữ liệu thật” |

### Chương 3 — Phạm vi

| § | Mâu thuẫn / thiếu |
|---|-------------------|
| 3.3 Trong phạm vi | Admin plane không có: quản lý kết nối SF/Zoho, sync snapshot |
| 3.4 Ngoài phạm vi | “OAuth2/OIDC client” — đúng data plane nhưng **chưa nói** admin OAuth connector **trong** phạm vi mở rộng |
| 3.4 | “Dashboard phân tích Grafana” ngoài phạm vi — reader có thể hiểu **mọi** báo cáo đều ngoài phạm vi |

### Chương 4 — Features

| ID | Trạng thái |
|----|------------|
| F‑13 Connector Salesforce | **Không có** |
| F‑14 Connector Zoho Projects | **Không có** |
| F‑15 Dashboard báo cáo tích hợp | **Không có** |
| F‑08 Admin Dashboard | Có CRUD route/key — **không** menu Tích hợp / Báo cáo |

### Chương 5 — FR & API

| Hạng mục | Trạng thái |
|----------|------------|
| Nhóm I (Integration) | **Không có** |
| 5.4 Admin API | Thiếu integrations + reports |
| Quy ước FR | Chỉ A–H |

### Chương 7 — Use case

| Thiếu |
|--------|
| UC: Admin kết nối Salesforce |
| UC: Đồng bộ snapshot & xem báo cáo |

---

## Sau khi patch Document.docx

Mở Word → **cập nhật Mục lục** (References → Update Table of Contents) vì đã thêm mục 4.13–4.15, 3.3.4, 5.2.I, 5.4 Integration API.

Nếu hội đồng yêu cầu **một file Word duy nhất**: dùng `Document.docx` đã patch; không bắt buộc đính kèm `.md` (md = bản làm việc cho dev).

---

## Ma trận tham chiếu

| Nội dung Word (sau patch) | Chi tiết triển khai |
|---------------------------|---------------------|
| F‑13, FR‑I1–I5 | [TICH_HOP_SALESFORCE.md](./TICH_HOP_SALESFORCE.md) |
| F‑14, FR‑I4–I6 | [TICH_HOP_ZOHO_PROJECTS.md](./TICH_HOP_ZOHO_PROJECTS.md) |
| F‑15, FR‑I7–I8 | [TICH_HOP_VA_BAO_CAO.md](./TICH_HOP_VA_BAO_CAO.md) §6 |
| Bảo mật token | [MO_HINH_BAO_MAT.md](./MO_HINH_BAO_MAT.md) |
