#!/usr/bin/env python3
"""Generate orthogonal functional decomposition diagram for draw.io."""

import html
from pathlib import Path

OUTPUT = Path(__file__).resolve().parents[1] / "docs" / "diagrams" / "FunctionalDIA.drawio.xml"

SYSTEM = "AVASO Gateway Platform System"

MODULES = [
    (
        "Tenant & User Administration",
        [
            "Manage Tenants",
            "Manage Users",
            "Assign Workspace Members",
            "RBAC Authorization",
        ],
    ),
    (
        "System Configuration Management",
        [
            "Global System Settings",
            "Provider Catalog",
            "Integration Flow Definitions",
            "Per-Tenant Provider Configuration",
        ],
    ),
    (
        "Route & API Client Management",
        [
            "View & Search Routes",
            "Add / Edit / Delete Routes",
            "Manage API Client Keys",
            "Assign Route ACL to Clients",
            "Rotate Client Secret",
        ],
    ),
    (
        "Authentication & OAuth",
        [
            "Issue Access Tokens",
            "Revoke Tokens",
            "Authorization Code + PKCE",
            "Register Third-Party Apps",
            "Manage User Consent",
        ],
    ),
    (
        "Request Processing Gateway",
        [
            "Longest-Prefix Routing",
            "JWT & ACL Validation",
            "Rate Limiting",
            "Reverse Proxy Upstream",
            "Retry on Failure",
            "Dead Letter Queue & Replay",
        ],
    ),
    (
        "Integration & Synchronization",
        [
            "Connect Providers",
            "Synchronize Data",
            "Store Snapshots",
            "Map Source-Target Entities",
            "View Sync Logs",
        ],
    ),
    (
        "Monitoring & Logging",
        [
            "Transaction Log",
            "Admin Audit Log",
            "Metrics / Prometheus",
            "Health Check",
        ],
    ),
]

BOX = "rounded=0;whiteSpace=wrap;html=1;strokeColor=#000000;fillColor=#ffffff;fontSize=11;"
ROOT = BOX + "fontStyle=1;fontSize=13;"
MOD = BOX + "fontStyle=1;fontSize=11;"
LEAF = BOX + "fontSize=10;"
EDGE = (
    "edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;"
    "jettySize=auto;html=1;endArrow=classic;endFill=1;strokeColor=#000000;"
)

COL_W = 230
COL_GAP = 18
ROOT_W = 320
ROOT_H = 44
MOD_W = 200
MOD_H = 44
LEAF_W = 200
LEAF_H = 32
LEAF_GAP = 8
TOP_Y = 40
MOD_Y = 130
LEAF_START_Y = 220


def esc(text: str) -> str:
    return html.escape(text, quote=True)


def main() -> None:
    n = len(MODULES)
    page_w = max(1800, 60 + n * (COL_W + COL_GAP))
    center_x = page_w // 2
    max_leaves = max(len(leaves) for _, leaves in MODULES)
    page_h = LEAF_START_Y + max_leaves * (LEAF_H + LEAF_GAP) + 80

    cells: list[str] = []
    nid = 2

    def cell(cid: str, value: str, style: str, x: int, y: int, w: int, h: int) -> str:
        return (
            f'<mxCell id="{cid}" value="{esc(value)}" style="{style}" vertex="1" parent="1">'
            f'<mxGeometry x="{x}" y="{y}" width="{w}" height="{h}" as="geometry"/></mxCell>'
        )

    def edge(eid: str, src: str, tgt: str) -> str:
        return (
            f'<mxCell id="{eid}" edge="1" parent="1" source="{src}" target="{tgt}" '
            f'style="{EDGE}"><mxGeometry relative="1" as="geometry"/></mxCell>'
        )

    root_id = str(nid)
    cells.append(
        cell(
            root_id,
            SYSTEM,
            ROOT,
            center_x - ROOT_W // 2,
            TOP_Y,
            ROOT_W,
            ROOT_H,
        )
    )
    nid += 1

    col_xs: list[int] = []
    start_x = (page_w - n * COL_W - (n - 1) * COL_GAP) // 2
    for i in range(n):
        col_xs.append(start_x + i * (COL_W + COL_GAP))

    for i, (mod_name, leaves) in enumerate(MODULES):
        mod_id = str(nid)
        nid += 1
        mx = col_xs[i] + (COL_W - MOD_W) // 2
        cells.append(cell(mod_id, mod_name, MOD, mx, MOD_Y, MOD_W, MOD_H))
        cells.append(edge(f"e-root-{i}", root_id, mod_id))

        for j, leaf in enumerate(leaves):
            leaf_id = str(nid)
            nid += 1
            ly = LEAF_START_Y + j * (LEAF_H + LEAF_GAP)
            lx = col_xs[i] + (COL_W - LEAF_W) // 2
            cells.append(cell(leaf_id, leaf, LEAF, lx, ly, LEAF_W, LEAF_H))
            cells.append(edge(f"e-mod-{i}-{j}", mod_id, leaf_id))

    body = "\n".join(cells)
    xml = f"""<?xml version="1.0" encoding="UTF-8"?>
<mxfile host="app.diagrams.net" agent="avaso-gateway" version="22.1.0" type="device">
  <diagram id="functional-decomposition" name="Functional Decomposition">
    <mxGraphModel dx="2000" dy="1200" grid="1" gridSize="10" guides="1" tooltips="1"
      connect="1" arrows="1" fold="1" page="1" pageScale="1"
      pageWidth="{page_w}" pageHeight="{page_h}" math="0" shadow="0">
      <root>
        <mxCell id="0"/>
        <mxCell id="1" parent="0"/>
{body}
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>
"""
    OUTPUT.write_text(xml, encoding="utf-8")
    print(f"Wrote {OUTPUT} ({page_w}x{page_h})")


if __name__ == "__main__":
    main()
