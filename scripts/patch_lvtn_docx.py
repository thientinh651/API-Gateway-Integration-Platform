#!/usr/bin/env python3
"""Patch docs/Tài liệu LVTN.docx — sửa lệch code (PostgreSQL, HMAC, reload, log)."""
from __future__ import annotations

import shutil
from pathlib import Path

from docx import Document
from docx.shared import Inches
from docx.text.paragraph import Paragraph
from docx.oxml import OxmlElement


ROOT = Path(__file__).resolve().parents[1]
DOC_PATH = ROOT / "docs" / "Tài liệu LVTN.docx"
BAK_PATH = ROOT / "docs" / "Tài liệu LVTN.docx.bak"
DIAGRAMS = [
    ("Sơ đồ chức năng", ROOT / "docs" / "diagrams" / "BAO_VE_KIEN_TRUC.png", "Hình kiến trúc AVASO Gateway (khớp code)"),
    ("Hình luồng data plane", ROOT / "docs" / "diagrams" / "LUONG_DATA_PLANE.png", "Luồng xử lý data plane HMAC"),
]


def insert_after(paragraph: Paragraph, texts: list[str]) -> None:
    anchor = paragraph
    for text in texts:
        new_p = OxmlElement("w:p")
        anchor._element.addnext(new_p)
        new_para = Paragraph(new_p, anchor._parent)
        if text:
            new_para.add_run(text)
        anchor = new_para


def para_by_snippet(doc: Document, snippet: str) -> Paragraph | None:
    for p in doc.paragraphs:
        if snippet in p.text:
            return p
    return None


def replace_in_doc(doc: Document, old: str, new: str) -> int:
    n = 0
    for p in doc.paragraphs:
        if old in p.text:
            for run in p.runs:
                if old in run.text:
                    run.text = run.text.replace(old, new)
                    n += 1
            if not p.runs and old in p.text:
                p.text = p.text.replace(old, new)
                n += 1
    return n


def doc_contains(doc: Document, snippet: str) -> bool:
    return any(snippet in p.text for p in doc.paragraphs)


def insert_picture_after(anchor: Paragraph, png: Path, caption: str) -> bool:
    if not png.is_file():
        return False
    cap_p = OxmlElement("w:p")
    anchor._element.addnext(cap_p)
    cap_para = Paragraph(cap_p, anchor._parent)
    cap_para.add_run(caption).bold = True
    pic_p = OxmlElement("w:p")
    cap_para._element.addnext(pic_p)
    pic_para = Paragraph(pic_p, anchor._parent)
    run = pic_para.add_run()
    run.add_picture(str(png), width=Inches(6.2))
    return True


def main() -> None:
    if not DOC_PATH.exists():
        raise SystemExit(f"Missing {DOC_PATH}")

    if not BAK_PATH.exists():
        shutil.copy2(DOC_PATH, BAK_PATH)
        print(f"Backup: {BAK_PATH}")

    doc = Document(str(DOC_PATH))
    changes = 0

    changes += replace_in_doc(
        doc,
        "Mô hình dữ liệu mức vật lý được triển khai trên SQLite",
        "Mô hình dữ liệu mức vật lý được triển khai trên PostgreSQL (cấu hình, user, route, key, audit, integration); Redis dùng cho session admin và OTP quên mật khẩu",
    )

    changes += replace_in_doc(
        doc,
        "Cập nhật cấu hình nóng (Hot reload latency): Khi người vận hành tiến hành chỉnh sửa hoặc thay đổi file cấu hình tuyến đường (routes.yaml)",
        "Cập nhật cấu hình runtime (reload latency): Khi người vận hành chỉnh sửa route trên Dashboard, hệ thống lưu PostgreSQL và gọi reload_runtime_config() nạp lại cấu hình vào RAM",
    )

    anchor = para_by_snippet(doc, "Hoàn thành các yêu cầu chức năng ở mức bắt buộc")
    if anchor:
        insert_after(
            anchor,
            [
                "Xác thực data plane bằng HMAC-SHA256 (header X-API-Key, X-Timestamp, X-Signature), không dùng JWT.",
                "Quản lý danh tính: đăng ký Viewer, quên mật khẩu OTP qua email (Brevo API).",
                "15 phân hệ chức năng lớn — chi tiết trong docs/KIEN_TRUC_THUC_TE.md và docs/MA_TRAN_DONG_AN.md trong repository.",
            ],
        )
        changes += 1

    anchor = para_by_snippet(doc, "Kiểm tra khả năng xử lý của Gateway khi Client gửi yêu cầu HTTP đính kèm tiêu đề X-API-Key chính xác")
    if anchor:
        insert_after(
            anchor,
            [
                "Đầu vào: Request data plane có HMAC hợp lệ (Proxy Try hoặc script test_hmac_replay.py).",
                "Kết quả mong đợi: HTTP 200 từ upstream; transaction log ghi outcome success.",
            ],
        )
        changes += 1

    anchor = para_by_snippet(doc, "Về mặt chức năng:")
    if anchor and not doc_contains(doc, "triển khai production DigitalOcean và Docker HA"):
        insert_after(
            anchor,
            [
                "Đồ án hiện thực 15 phân hệ lớn: API Gateway (proxy, routing động, HMAC, rate limit, pipeline transform/retry/DLQ), transaction log và audit log tách biệt, control plane (dashboard SPA, session Redis, RBAC, quản lý user/key, quên MK OTP), tích hợp OAuth Salesforce và Zoho Projects, triển khai production DigitalOcean và Docker HA.",
            ],
        )
        changes += 1

    anchor = para_by_snippet(doc, "Sơ đồ chức năng")
    if anchor and not doc_contains(doc, "BAO_VE_KIEN_TRUC.drawio"):
        insert_after(
            anchor,
            [
                "Hình kiến trúc bảo vệ (Draw.io, khớp code): docs/diagrams/BAO_VE_KIEN_TRUC.drawio — export PNG chèn vào luận văn.",
                "Hình luồng data plane: docs/diagrams/LUONG_DATA_PLANE.drawio",
            ],
        )
        changes += 1

    anchor = para_by_snippet(doc, "Redis dùng cho session admin và OTP quên mật khẩu")
    if anchor and not doc_contains(doc, "gateway_routes"):
        insert_after(
            anchor,
            [
                "Các bảng chính: tenants, dashboard_users, gateway_routes, gateway_client_keys, gateway_transaction_logs, audit_logs, gateway_settings, integrations, integration_snapshots, oauth_pending_states.",
                "Chi tiết cột và ERD: docs/DATABASE_SCHEMA.md",
            ],
        )
        changes += 1

    for anchor_snippet, png_path, caption in DIAGRAMS:
        anchor = para_by_snippet(doc, anchor_snippet)
        if anchor and not doc_contains(doc, caption):
            if insert_picture_after(anchor, png_path, caption):
                changes += 1
                print(f"Inserted image: {png_path.name}")

    anchor = para_by_snippet(doc, "Các kịch bản thử nghiệm")
    if anchor and not doc_contains(doc, "HUONG_DAN_TEST_CHI_TIET"):
        insert_after(
            anchor,
            [
                "Danh sách TC_01–TC_21 đầy đủ: docs/HUONG_DAN_TEST_CHI_TIET.md. Chạy chứng cứ: ./scripts/collect-thesis-evidence.sh → data/thesis-evidence/",
            ],
        )
        changes += 1

    doc.save(str(DOC_PATH))
    print(f"Patched {DOC_PATH} ({changes} change groups).")
    print("Xem thêm: docs/LUAN_VAN_SUA_DOI.md")


if __name__ == "__main__":
    main()
