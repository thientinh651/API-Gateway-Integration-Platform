#!/usr/bin/env python3
"""Generate Chen ERD draw.io — 22 bảng production (LVTN.drawio.xml)."""

import html
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from erd_schema_data import RELATIONSHIPS, TABLES  # noqa: E402

OUTPUT = Path(__file__).resolve().parents[1] / "docs" / "diagrams" / "LVTN.drawio.xml"

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

REL_NAMES = {
    (1, "tenants", "dashboard_users"): "has_users",
    (2, "tenants", "tenant_memberships"): "has_memberships",
    (3, "dashboard_users", "tenant_memberships"): "member_of",
    (4, "tenants", "gateway_routes"): "has_routes",
    (5, "tenants", "gateway_client_keys"): "has_clients",
    (6, "dashboard_users", "gateway_client_keys"): "owns_clients",
    (7, "gateway_client_keys", "gateway_client_key_routes"): "via_acl",
    (8, "gateway_routes", "gateway_client_key_routes"): "via_acl",
    (9, "tenants", "gateway_transaction_logs"): "has_tx_logs",
    (10, "gateway_client_keys", "gateway_transaction_logs"): "generates_tx",
    (11, "tenants", "audit_logs"): "has_audit",
    (12, "tenants", "gateway_proxy_queue"): "has_dlq",
    (13, "gateway_routes", "gateway_proxy_queue"): "queues_failed",
    (14, "tenants", "oauth_access_tokens"): "has_tokens",
    (15, "gateway_client_keys", "oauth_access_tokens"): "issues_tokens",
    (16, "dashboard_users", "oauth_access_tokens"): "issues_tokens",
    (17, "tenants", "oauth_third_party_apps"): "has_oauth_apps",
    (18, "dashboard_users", "oauth_authorization_codes"): "authorizes",
    (19, "tenants", "oauth_authorization_codes"): "stores_codes",
    (20, "dashboard_users", "oauth_user_consents"): "consents",
    (21, "oauth_third_party_apps", "oauth_user_consents"): "for_app",
    (22, "tenants", "integrations"): "has_integrations",
    (23, "tenants", "integration_provider_configs"): "has_provider_cfg",
    (24, "tenants", "integration_snapshots"): "has_snapshots",
    (25, "tenants", "sync_logs"): "has_sync_logs",
    (26, "tenants", "integration_entity_links"): "has_entity_links",
    (27, "integration_providers", "integration_flow_types"): "defines_flow",
    (28, "integration_flow_types", "integration_providers"): "targets_provider",
    (29, "integrations", "integration_providers"): "uses_provider",
}

# 22 bảng — layout 1 canvas (3200 × 2800)
LAYOUT = {
    "gateway_settings": (40, 180),
    "oauth_pending_states": (40, 420),
    "tenants": (1400, 980),
    "dashboard_users": (700, 380),
    "tenant_memberships": (700, 1180),
    "gateway_routes": (2100, 380),
    "gateway_client_keys": (2100, 1180),
    "gateway_client_key_routes": (2100, 780),
    "gateway_transaction_logs": (2480, 880),
    "audit_logs": (700, 1580),
    "gateway_proxy_queue": (1780, 1580),
    "oauth_access_tokens": (400, 880),
    "oauth_third_party_apps": (400, 1280),
    "oauth_authorization_codes": (400, 1680),
    "oauth_user_consents": (700, 1980),
    "integration_providers": (1080, 2080),
    "integration_flow_types": (1380, 2280),
    "integrations": (980, 1680),
    "integration_provider_configs": (980, 1380),
    "integration_snapshots": (1780, 1680),
    "sync_logs": (1380, 1680),
    "integration_entity_links": (1680, 1980),
}


def table_attrs(table_tuple):
    _, db_name, _, rows = table_tuple
    return db_name, [(name, k == "x") for name, _t, k, _u, _m, _desc in rows]


def esc(s):
    return html.escape(str(s), quote=True)


class Builder:
    def __init__(self):
        self.cid = 100
        self.cells = []
        self.entities = {}
        self.layout = LAYOUT

    def add_entity(self, name, x, y, attrs):
        eid = self.cid
        self.cid += 1
        w = max(120, min(220, len(name) * 6 + 36))
        h = 36
        self.cells.append(
            f'<mxCell id="{eid}" value="{esc(name)}" style="{ENTITY}" vertex="1" parent="1">'
        )
        self.cells.append(
            f'<mxGeometry x="{x}" y="{y}" width="{w}" height="{h}" as="geometry"/></mxCell>'
        )
        n = len(attrs)
        r = 52 + min(n * 3, 50)
        for i, (aname, is_pk) in enumerate(attrs):
            aid = self.cid
            self.cid += 1
            ang = (2 * math.pi * i / max(n, 1)) - math.pi / 2
            ax = x + w / 2 + r * math.cos(ang) - 34
            ay = y + h / 2 + r * math.sin(ang) - 10
            val = f"&lt;u&gt;{esc(aname)}&lt;/u&gt;" if is_pk else esc(aname)
            aw = max(56, min(120, len(aname) * 4 + 14))
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
        rw = max(68, min(130, len(rel_name) * 4 + 18))
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
        if t1 not in b.entities or t2 not in b.entities:
            continue
        rname = REL_NAMES.get((stt, t1, t2), f"rel_{stt}")
        b.add_rel(t1, rname, t2, c1, c2)

    title = "Hình 3.1.3 — ERD mức logic (Chen): 22 bảng AVASO Gateway (PostgreSQL production)"
    note = (
        "Chen: hình chữ nhật = thực thể, ellipse = thuộc tính (gạch chân = PK), hình thoi = quan hệ. "
        "Standalone: gateway_settings, oauth_pending_states. "
        "Đã bỏ: integration_bridge_config, integration_documents."
    )
    legend = (
        "Cập nhật 2026-07-04: sync_logs (+event), entity_links (generic source→target), "
        "+integration_providers, +integration_flow_types, +4 bảng oauth lifecycle"
    )
    b.cells.insert(
        0,
        f'<mxCell id="legend" value="{esc(legend)}" '
        'style="text;html=1;strokeColor=none;fillColor=none;align=left;'
        'fontSize=10;fontColor=#333333;fontStyle=2" vertex="1" parent="1">'
        '<mxGeometry x="40" y="95" width="1600" height="24" as="geometry"/></mxCell>',
    )
    b.cells.insert(
        0,
        f'<mxCell id="note" value="{esc(note)}" '
        'style="text;html=1;strokeColor=none;fillColor=none;align=left;'
        'fontSize=10;fontColor=#666666;" vertex="1" parent="1">'
        '<mxGeometry x="40" y="55" width="1800" height="40" as="geometry"/></mxCell>',
    )
    b.cells.insert(
        0,
        f'<mxCell id="title" value="{esc(title)}" '
        'style="text;html=1;strokeColor=none;fillColor=none;align=center;'
        'fontSize=14;fontStyle=1" vertex="1" parent="1">'
        '<mxGeometry x="500" y="20" width="1400" height="30" as="geometry"/></mxCell>',
    )

    xml = f"""<?xml version="1.0" encoding="UTF-8"?>
<mxfile host="app.diagrams.net" agent="avaso-gateway" version="22.1.0" type="device">
  <diagram id="ERD-22-tables" name="ERD 22 bảng LVTN">
    <mxGraphModel dx="4200" dy="3200" grid="1" gridSize="10" guides="1"
      tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1"
      pageWidth="3200" pageHeight="2800" math="0" shadow="0">
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
