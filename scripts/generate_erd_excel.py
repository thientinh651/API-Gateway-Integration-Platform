#!/usr/bin/env python3
"""Excel bảng + thuộc tính — layout 2 cột như mẫu luận văn."""

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter

from erd_schema_data import HEADERS, RELATIONSHIPS, TABLES

OUTPUT = "/root/avaso-gateway/docs/Bảng và thuộc tính, quan hệ.xlsx"

THIN = Side(style="thin", color="000000")
BORDER = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)
HDR_FILL = PatternFill("solid", fgColor="D9D9D9")
HDR_FONT = Font(bold=True, size=11)
TITLE_FONT = Font(bold=True, size=12)
WRAP = Alignment(vertical="center", wrap_text=True)
CENTER = Alignment(horizontal="center", vertical="center", wrap_text=True)

# Left block A-F, gap G, right block H-M
LEFT_COL = 1   # A
RIGHT_COL = 8  # H
NCOLS = 6


def col_widths(ws) -> None:
    for c, w in [(1, 22), (2, 14), (3, 4), (4, 4), (5, 4), (6, 44),
                 (7, 2), (8, 22), (9, 14), (10, 4), (11, 4), (12, 4), (13, 44)]:
        ws.column_dimensions[get_column_letter(c)].width = w


def paint(ws, r: int, c: int, value, *, header=False, center=False) -> None:
    cell = ws.cell(row=r, column=c, value=value if value else None)
    cell.border = BORDER
    cell.alignment = CENTER if center else WRAP
    if header:
        cell.fill = HDR_FILL
        cell.font = HDR_FONT


def table_height(table) -> int:
    _, _, _, rows = table
    return 2 + 1 + len(rows) + 1  # title + header + data + gap


def draw_table(ws, start_row: int, start_col: int, table) -> int:
    display, db_name, desc, rows = table
    r = start_row

    # Tên bảng
    title_cell = ws.cell(row=r, column=start_col, value=display)
    title_cell.font = TITLE_FONT
    ws.merge_cells(
        start_row=r, start_column=start_col,
        end_row=r, end_column=start_col + NCOLS - 1,
    )
    r += 1

    # Header
    for i, h in enumerate(HEADERS):
        paint(ws, r, start_col + i, h, header=True, center=(i >= 2))
    r += 1

    # Data
    for row in rows:
        for i, val in enumerate(row):
            paint(ws, r, start_col + i, val, center=(i >= 2))
        r += 1

    return r + 1  # gap row


def build_tables_sheet(ws) -> None:
    col_widths(ws)
    row_left = 1
    row_right = 1
    i = 0
    while i < len(TABLES):
        left = TABLES[i]
        end_left = draw_table(ws, row_left, LEFT_COL, left)
        row_left = end_left

        if i + 1 < len(TABLES):
            right = TABLES[i + 1]
            end_right = draw_table(ws, row_right, RIGHT_COL, right)
            row_right = end_right
            row_left = max(row_left, row_right)
            row_right = row_left
            i += 2
        else:
            i += 1


def build_relations_sheet(ws) -> None:
    headers = ["STT", "Bảng 1", "Thuộc tính 1", "Bảng 1 (SL)", "Bảng 2 (SL)", "Bảng 2", "Thuộc tính 2", "Diễn giải"]
    ws.column_dimensions["A"].width = 6
    for c, w in zip("BCDEFGH", [26, 14, 10, 10, 26, 14, 46]):
        ws.column_dimensions[c].width = w

    r = 1
    ws.cell(row=r, column=1, value="Quan hệ giữa các bảng").font = Font(bold=True, size=14)
    r = 3
    for i, h in enumerate(headers, 1):
        paint(ws, r, i, h, header=True, center=(i == 1 or i in (4, 5)))
    r += 1
    for rel in RELATIONSHIPS:
        for i, val in enumerate(rel, 1):
            paint(ws, r, i, val, center=(i == 1 or i in (4, 5)))
        r += 1


def main() -> None:
    wb = Workbook()
    ws = wb.active
    ws.title = "Bảng và thuộc tính"
    build_tables_sheet(ws)

    ws2 = wb.create_sheet("Quan hệ")
    build_relations_sheet(ws2)

    wb.save(OUTPUT)
    print(OUTPUT)


if __name__ == "__main__":
    main()
