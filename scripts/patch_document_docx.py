#!/usr/bin/env python3
"""Patch docs/Document.docx — bổ sung tích hợp SF, Zoho, báo cáo."""
from __future__ import annotations

import shutil
from pathlib import Path

from docx import Document
from docx.text.paragraph import Paragraph
from docx.oxml import OxmlElement


ROOT = Path(__file__).resolve().parents[1]
DOC_PATH = ROOT / "docs" / "Document.docx"
BAK_PATH = ROOT / "docs" / "Document.docx.bak"


def insert_after(paragraph: Paragraph, texts: list[str]) -> None:
    """Insert paragraphs in order immediately after `paragraph`."""
    anchor = paragraph
    for text in texts:
        new_p = OxmlElement("w:p")
        anchor._element.addnext(new_p)
        new_para = Paragraph(new_p, anchor._parent)
        if text:
            new_para.add_run(text)
        anchor = new_para


def para_by_snippet(doc: Document, snippet: str) -> Paragraph:
    for p in doc.paragraphs:
        if snippet in p.text:
            return p
    raise RuntimeError(f"Anchor not found: {snippet!r}")


def replace_para_text(p: Paragraph, new: str) -> None:
    if not p.runs:
        p.add_run(new)
        return
    p.runs[0].text = new
    for r in p.runs[1:]:
        r.text = ""


def main() -> None:
    if not BAK_PATH.exists():
        shutil.copy2(DOC_PATH, BAK_PATH)

    doc = Document(str(DOC_PATH))

    # --- Chương 1: phạm vi + thuật ngữ ---
    insert_after(
        para_by_snippet(doc, "RBAC: phân quyền theo vai trò Admin / Operator / Viewer và ghi audit"),
        [
            "Tích hợp hệ thống ngoài (Integration): kết nối OAuth tới Salesforce và Zoho Projects; lưu token mã hóa; đồng bộ dữ liệu đọc (snapshot) phục vụ báo cáo.",
            "Báo cáo tích hợp (Integration reporting): Dashboard hiển thị trạng thái kết nối, KPI và bảng/biểu đồ từ snapshot — không thay thế Grafana/Prometheus cho metrics gateway.",
        ],
    )

    insert_after(
        para_by_snippet(doc, "Audit log: nhật ký ghi lại hành động quản trị"),
        [
            "Integration / Connector: thành phần gateway quản lý OAuth và gọi API Salesforce hoặc Zoho Projects theo tenant.",
            "Snapshot: bản chụp dữ liệu (JSON) lấy từ hệ thống ngoài tại một thời điểm, lưu SQLite để dashboard báo cáo.",
            "OAuth token (admin): access_token và refresh_token do admin authorize; mã hóa at rest — khác API key của client data plane.",
        ],
    )

    insert_after(
        para_by_snippet(doc, "Không triển khai OAuth2/OIDC cho client trong phạm vi đồ án"),
        [
            "Lưu ý: OAuth2/OIDC áp dụng cho client data plane là ngoài phạm vi; OAuth2 phía admin (connector Salesforce/Zoho) thuộc phạm vi mở rộng đồ án (xem §3.3.4, F‑13, F‑14).",
        ],
    )

    # --- Chương 2: mục tiêu & KPI ---
    replace_para_text(
        para_by_snippet(doc, "Trong phạm vi đồ án, hệ thống tập trung hiện thực lát cắt cốt lõi"),
        "Trong phạm vi đồ án, hệ thống hiện thực lát cắt middleware platform: API Gateway + Admin Dashboard + RBAC + audit log; giai đoạn mở rộng bổ sung connector Salesforce, Zoho Projects và dashboard báo cáo tích hợp (§3.3.4).",
    )

    insert_after(
        para_by_snippet(doc, "Mục tiêu mở rộng:"),
        [
            "Integration plane: OAuth Salesforce (Must), Zoho Projects (Should); sync snapshot read-only.",
            "Dashboard báo cáo: trang Tích hợp (/integrations) và Báo cáo (/reports) — KPI, biểu đồ, bảng Opportunities/Projects/Tasks.",
        ],
    )

    insert_after(
        para_by_snippet(doc, "Độ ổn định: hệ thống chạy liên tục 24h"),
        [
            "Tích hợp: tối thiểu một connector (Salesforce sandbox) ở trạng thái connected; test API thành công.",
            "Báo cáo: sau sync, dashboard hiển thị số liệu thật (không mock) trên /reports.",
        ],
    )

    # --- Chương 3: trong / ngoài phạm vi ---
    insert_after(
        para_by_snippet(doc, "Audit log ghi nhận các hành động quản trị (login, CRUD route/key/user, reload"),
        [
            "3.3.4 Integration plane (phạm vi mở rộng)",
            "Kết nối OAuth: Salesforce Connected App; Zoho Projects (Server-based Application).",
            "Lưu token mã hóa (AES-GCM) trong SQLite; bảng integrations, integration_snapshots.",
            "Admin API: list/connect/disconnect/sync/test theo provider; audit connect/disconnect/sync.",
            "Dashboard: quản lý kết nối; báo cáo KPI và snapshot (Viewer đọc-only).",
        ],
    )

    insert_after(
        para_by_snippet(doc, "Các nội dung sau không thuộc phạm vi bắt buộc của đồ án"),
        [
            "Phân biệt: OAuth2/OIDC cho client data plane — ngoài phạm vi (client dùng API key). OAuth2 admin connector (Salesforce/Zoho) — trong phạm vi mở rộng.",
            "Báo cáo tích hợp cơ bản (snapshot + chart trên dashboard) — trong phạm vi mở rộng; không bao gồm BI warehouse hay Grafana phân tán đầy đủ.",
        ],
    )

    # --- Mục lục (TOC) ---
    insert_after(
        para_by_snippet(doc, "4.12 Feature F‑12: Optional extensions"),
        [
            "4.13 Feature F‑13: Connector Salesforce\t25",
            "4.14 Feature F‑14: Connector Zoho Projects\t26",
            "4.15 Feature F‑15: Dashboard báo cáo tích hợp\t27",
        ],
    )

    insert_after(
        para_by_snippet(doc, "3.3.3 Runtime"),
        ["3.3.4 Integration plane\t8"],
    )

    # --- Chương 4: F-13, F-14, F-15 ---
    f12_block = """Queue không được lưu vào đĩa (in‑memory) → mất dữ liệu khi gateway restart. Đây là giới hạn chấp nhận được trong MVP."""

    insert_after(
        para_by_snippet(doc, f12_block),
        [
            "Feature F‑13: Connector Salesforce",
            "Mục tiêu: Cho phép admin kết nối org Salesforce (sandbox/production) qua OAuth 2.0; lưu token an toàn; gọi REST API và đồng bộ snapshot phục vụ báo cáo.",
            "Tác nhân: Administrator (connect/disconnect/sync); Operator/Viewer (xem trạng thái).",
            "Luồng chính: Admin bấm Connect → redirect Salesforce → callback gateway đổi code lấy token → mã hóa lưu SQLite → trạng thái connected. Sync: SOQL Opportunities/Accounts → integration_snapshots.",
            "Luồng thay thế: OAuth từ chối hoặc state sai → lỗi, audit failure. Token hết hạn → refresh_token trước khi gọi API.",
            "API admin: GET /api/integrations/salesforce/connect, callback, POST disconnect, POST sync, GET test.",
            "Feature F‑14: Connector Zoho Projects",
            "Mục tiêu: Kết nối Zoho Projects qua OAuth; đọc portals, projects, tasks; snapshot cho báo cáo.",
            "Tác nhân: Giống F‑13.",
            "Luồng chính: OAuth Zoho (scope Projects READ) → lưu api_domain, portal_id → sync projects/tasks vào snapshot.",
            "Ghi chú: Data center Zoho (.com / .eu) phải khớp cấu hình accounts URL.",
            "Feature F‑15: Dashboard báo cáo tích hợp",
            "Mục tiêu: Giao diện báo cáo dựa trên dữ liệu đã tích hợp (snapshot), không chỉ metrics gateway.",
            "Tác nhân: Administrator, Operator, Viewer (read-only báo cáo).",
            "Trang /integrations: card Salesforce và Zoho — trạng thái, last_sync, nút Connect/Sync/Test (admin).",
            "Trang /reports: KPI (số connector connected, bản ghi 24h); biểu đồ (snapshot theo ngày, phân bổ provider, stage Opportunity, status Task); bảng chi tiết theo tab.",
            "API: GET /api/reports/summary, /api/reports/snapshots, /api/reports/charts/* — filter theo tenant_id session.",
            "Cập nhật F‑08: menu sidebar thêm Tích hợp và Báo cáo; trang Tổng quan hiển thị trạng thái connector thay số mock.",
        ],
    )

    # --- Chương 5: FR nhóm I ---
    replace_para_text(
        para_by_snippet(doc, "Quy ước mã số: FR‑A*, FR‑B*, …, FR‑H*"),
        "Quy ước mã số: FR‑A*, FR‑B*, …, FR‑H*, FR‑I* theo nhóm chức năng A–I.",
    )

    insert_after(
        para_by_snippet(doc, "H. Reliability Extensions"),
        [
            "I. Integration & Reporting",
            "FR-I1: Salesforce OAuth connect — Must — Admin hoàn tất OAuth; integrations.status=connected.",
            "FR-I2: Token encrypted at rest — Must — Không lưu plain token trong DB/log.",
            "FR-I3: Salesforce token refresh — Should — Sync thành công khi access_token hết hạn.",
            "FR-I4: Zoho Projects OAuth — Should — Connected + portal_id hợp lệ.",
            "FR-I5: Sync Salesforce snapshot — Must — ≥1 snapshot opportunity với record_count>0.",
            "FR-I6: Sync Zoho snapshot — Should — snapshot project/task sau connect.",
            "FR-I7: UI trang Tích hợp — Must — Khớp GET /api/integrations.",
            "FR-I8: UI trang Báo cáo — Must — KPI/charts từ /api/reports/*.",
            "FR-I9: RBAC integration — Must — Viewer không connect; POST connect → 403.",
            "FR-I10: Audit integration actions — Must — connect/disconnect/sync trong audit_logs.",
        ],
    )

    insert_after(
        para_by_snippet(doc, "GET /admin/metrics (Viewer/Operator/Admin)"),
        [
            "Integration API (admin session, prefix /api/integrations)",
            "GET /api/integrations — list provider, status, last_sync_at.",
            "GET /api/integrations/salesforce/connect — redirect OAuth (Admin).",
            "GET /api/integrations/salesforce/callback — OAuth callback.",
            "POST /api/integrations/salesforce/disconnect | sync | — Admin.",
            "GET /api/integrations/salesforce/test — kiểm tra API limits.",
            "Tương tự /api/integrations/zoho/* cho Zoho Projects.",
            "Reporting API",
            "GET /api/reports/summary — KPI tổng hợp.",
            "GET /api/reports/snapshots — danh sách/metadata snapshot.",
            "GET /api/reports/charts/daily | by-provider — dữ liệu biểu đồ.",
        ],
    )

    doc.save(str(DOC_PATH))
    print(f"Patched: {DOC_PATH}")
    print(f"Backup: {BAK_PATH}")
    print("→ Mở Word, Update Table of Contents (F9).")


if __name__ == "__main__":
    main()
