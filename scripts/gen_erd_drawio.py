#!/usr/bin/env python3
"""Generate Chen-style ERD draw.io — 1 sheet, 18 bảng, khớp Excel."""

import html
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from generate_erd_excel import RELATIONSHIPS, TABLES  # noqa: E402

OUTPUT = Path(__file__).resolve().parents[1] / "docs" / "diagrams" / "ERD_CHEN.drawio"

ENTITY = (
    "shape=rectangle;whiteSpace=wrap;html=1;rounded=0;"
    "fillColor=#ffffff;strokeColor=#000000;fontStyle=1;fontSize=11;"
)
ATTR = "ellipse;whiteSpace=wrap;html=1;fillColor=#ffffff;strokeColor=#000000;fontSize=9;"
REL = "shape=rhombus;whiteSpace=wrap;html=1;fillColor=#ffffff;strokeColor=#000000;fontSize=9;"
E_ATTR = "endArrow=none;startArrow=none;html=1;strokeColor=#000000;"
E_ONE_FROM = "endArrow=none;startArrow=ERone;startFill=0;startSize=12;html=1;strokeColor=#000000;"
E_ONE_TO = "startArrow=none;endArrow=ERone;endFill=0;endSize=12;html=1;strokeColor=#000000;"
E_MANY_TO = "startArrow=none;endArrow=ERmany;endFill=0;endSize=14;html=1;strokeColor=#000000;"
E_MANY_FROM = "endArrow=ERmany;endFill=0;endSize=14;startArrow=none;html=1;strokeColor=#000000;"

REL_EN = {
    (1, "tenants", "dashboard_users"): "has_dashboard_users",
    (2, "tenants", "tenant_memberships"): "has_memberships",
    (3, "dashboard_users", "tenant_memberships"): "has_memberships",
    (4, "tenants", "gateway_routes"): "has_routes",
    (5, "tenants", "gateway_client_keys"): "has_clients",
    (6, "dashboard_users", "gateway_client_keys"): "owns_clients",
    (7, "gateway_client_keys", "gateway_client_key_routes"): "via_acl",
    (8, "gateway_routes", "gateway_client_key_routes"): "via_acl",
    (9, "tenants", "gateway_transaction_logs"): "has_tx_logs",
    (10, "gateway_client_keys", "gateway_transaction_logs"): "has_tx_logs",
    (11, "tenants", "audit_logs"): "has_audit_logs",
    (12, "tenants", "gateway_proxy_queue"): "has_dlq",
    (13, "gateway_routes", "gateway_proxy_queue"): "has_dlq",
    (14, "tenants", "integrations"): "has_integrations",
    (15, "tenants", "integration_provider_configs"): "has_provider_configs",
    (16, "tenants", "integration_snapshots"): "has_snapshots",
    (17, "tenants", "integration_bridge_config"): "has_bridge_config",
    (18, "tenants", "sync_logs"): "has_sync_logs",
    (19, "tenants", "integration_entity_links"): "has_entity_links",
    (20, "tenants", "integration_documents"): "has_documents",
}

# 18 bảng — layout 1 canvas lớn (2800 × 2200)
LAYOUT = {
    "gateway_settings": (40, 40),
    "tenants": (1200, 900),
    "dashboard_users": (600, 400),
    "tenant_memberships": (600, 1200),
    "gateway_routes": (1800, 400),
    "gateway_client_keys": (1800, 1200),
    "gateway_client_key_routes": (1500, 800),
    "gateway_transaction_logs": (2300, 900),
    "audit_logs": (600, 1700),
    "gateway_proxy_queue": (1500, 1700),
    "integrations": (200, 2100),
    "integration_provider_configs": (600, 2100),
    "integration_bridge_config": (1000, 2100),
    "integration_snapshots": (1400, 2100),
    "oauth_pending_states": (1800, 2100),
    "sync_logs": (400, 2500),
    "integration_entity_links": (900, 2500),
    "integration_documents": (1400, 2500),
}


def table_attrs(table_tuple):
    _, db_name, _, rows = table_tuple
    return db_name, [(name, k == "x") for name, _t, k, _u, _m, _desc in rows]


def esc(s):
    return html.escape(str(s), quote=True)


class Builder:
    def __init__(self):
        self.cid = 2
        self.cells = []
        self.entities = {}
        self.layout = LAYOUT

    def add_entity(self, name, x, y, attrs):
        eid = self.cid
        self.cid += 1
        w = max(120, len(name) * 6 + 30)
        h = 36
        self.cells.append(
            f'<mxCell id="{eid}" value="{esc(name)}" style="{ENTITY}" vertex="1" parent="1">'
        )
        self.cells.append(
            f'<mxGeometry x="{x}" y="{y}" width="{w}" height="{h}" as="geometry"/></mxCell>'
        )
        n = len(attrs)
        r = 55 + min(n * 4, 45)
        for i, (aname, is_pk) in enumerate(attrs):
            aid = self.cid
            self.cid += 1
            ang = (2 * math.pi * i / max(n, 1)) - math.pi / 2
            ax = x + w / 2 + r * math.cos(ang) - 34
            ay = y + h / 2 + r * math.sin(ang) - 10
            val = f"&lt;u&gt;{esc(aname)}&lt;/u&gt;" if is_pk else esc(aname)
            aw = max(56, len(aname) * 4 + 14)
            self.cells.append(
                f'<mxCell id="{aid}" value="{val}" style="{ATTR}" vertex="1" parent="1">'
            )
            self.cells.append(
                f'<mxGeometry x="{ax:.0f}" y="{ay:.0f}" width="{aw}" '
                f'height="20" as="geometry"/></mxCell>'
            )
            e2 = self.cid
            self.cid += 1
            self.cells.append(
                f'<mxCell id="{e2}" edge="1" parent="1" source="{eid}" '
                f'target="{aid}" style="{E_ATTR}">'
            )
            self.cells.append('<mxGeometry relative="1" as="geometry"/></mxCell>')
        self.entities[name] = eid

    def add_rel(self, from_e, rel_name, to_e, card_from, card_to):
        fx, fy = self.layout[from_e]
        tx, ty = self.layout[to_e]
        mx, my = (fx + tx) / 2, (fy + ty) / 2
        rid = self.cid
        self.cid += 1
        rw = max(68, len(rel_name) * 4 + 18)
        self.cells.append(
            f'<mxCell id="{rid}" value="{esc(rel_name)}" style="{REL}" vertex="1" parent="1">'
        )
        self.cells.append(
            f'<mxGeometry x="{mx:.0f}" y="{my:.0f}" width="{rw}" '
            f'height="40" as="geometry"/></mxCell>'
        )
        style_from = E_ONE_FROM if card_from == "1" else E_MANY_FROM
        style_to = E_ONE_TO if card_to == "1" else E_MANY_TO
        e1 = self.cid
        self.cid += 1
        self.cells.append(
            f'<mxCell id="{e1}" edge="1" parent="1" '
            f'source="{self.entities[from_e]}" target="{rid}" style="{style_from}">'
        )
        self.cells.append('<mxGeometry relative="1" as="geometry"/></mxCell>')
        e2 = self.cid
        self.cid += 1
        self.cells.append(
            f'<mxCell id="{e2}" edge="1" parent="1" '
            f'source="{rid}" target="{self.entities[to_e]}" style="{style_to}">'
        )
        self.cells.append('<mxGeometry relative="1" as="geometry"/></mxCell>')


def main():
    b = Builder()
    schema = {table_attrs(t)[0]: table_attrs(t)[1] for t in TABLES}

    for t in TABLES:
        name = t[1]
        if name in LAYOUT:
            x, y = LAYOUT[name]
            b.add_entity(name, x, y, schema[name])

    for rel in RELATIONSHIPS:
        stt, t1, _a1, c1, c2, t2, _a2, _desc = rel
        if stt == 21:
            continue
        if t1 not in b.entities or t2 not in b.entities:
            continue
        rname = REL_EN.get((stt, t1, t2), f"rel_{stt}")
        b.add_rel(t1, rname, t2, c1, c2)

    title = "Hình 3.1.2 — ERD mức logic (Chen): 18 bảng AVASO Gateway"
    note = (
        "Chen: hình chữ nhật = thực thể, ellipse = thuộc tính (gạch chân = PK), "
        "hình thoi = quan hệ. Standalone: gateway_settings, oauth_pending_states."
    )
    b.cells.insert(
        0,
        f'<mxCell id="note" value="{esc(note)}" '
        'style="text;html=1;strokeColor=none;fillColor=none;align=left;'
        'fontSize=10;fontColor=#666666;" vertex="1" parent="1">'
        '<mxGeometry x="40" y="55" width="1200" height="30" as="geometry"/></mxCell>',
    )
    b.cells.insert(
        0,
        f'<mxCell id="title" value="{esc(title)}" '
        'style="text;html=1;strokeColor=none;fillColor=none;align=center;'
        'fontSize=14;fontStyle=1" vertex="1" parent="1">'
        '<mxGeometry x="600" y="20" width="900" height="30" as="geometry"/></mxCell>',
    )

    xml = f"""<?xml version="1.0" encoding="UTF-8"?>
<mxfile host="app.diagrams.net" agent="avaso-gateway" version="22.1.0" type="device">
  <diagram id="ERD-Full-18" name="ERD 18 bảng">
    <mxGraphModel dx="3200" dy="2800" grid="1" gridSize="10" guides="1"
      tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1"
      pageWidth="2800" pageHeight="2800" math="0" shadow="0">
      <root>
        <mxCell id="0"/>
        <mxCell id="1" parent="0"/>
{chr(10).join(b.cells)}
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>
"""
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(xml, encoding="utf-8")
    print(OUTPUT, "entities:", len(b.entities), "cells:", len(b.cells))


if __name__ == "__main__":
    main()
