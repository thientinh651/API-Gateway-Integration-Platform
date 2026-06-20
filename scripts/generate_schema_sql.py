#!/usr/bin/env python3
"""Generate full PostgreSQL DDL from generate_erd_excel TABLES + RELATIONSHIPS."""

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from erd_schema_data import RELATIONSHIPS, TABLES  # noqa: E402

DEFAULT_OUTPUT = Path(__file__).resolve().parents[1] / "docs" / "schema_full_postgresql.sql"

# (child_table, child_col) -> (parent_table, parent_col)
FK_MAP: dict[tuple[str, str], tuple[str, str]] = {}
for stt, t1, a1, _c1, _c2, t2, a2, _desc in RELATIONSHIPS:
    if stt == 21:
        continue
    FK_MAP[(t2, a2)] = (t1, a1)

INDEXES = """
CREATE UNIQUE INDEX dashboard_users_email_lower_unique
    ON dashboard_users (LOWER(TRIM(email)))
    WHERE email IS NOT NULL AND TRIM(email) <> '';

CREATE UNIQUE INDEX idx_gateway_routes_tenant_path
    ON gateway_routes (tenant_id, path);

CREATE UNIQUE INDEX idx_gateway_client_keys_api_key
    ON gateway_client_keys (api_key) WHERE api_key IS NOT NULL;

CREATE UNIQUE INDEX idx_integrations_tenant_provider
    ON integrations (tenant_id, provider);

CREATE UNIQUE INDEX idx_integration_provider_configs_tenant_provider
    ON integration_provider_configs (tenant_id, provider);

CREATE UNIQUE INDEX idx_entity_links_tenant_sf
    ON integration_entity_links (tenant_id, sf_entity_type, sf_id);

CREATE UNIQUE INDEX idx_integration_documents_tenant_sf_provider
    ON integration_documents (tenant_id, sf_entity_type, sf_id, source_provider);

CREATE UNIQUE INDEX idx_tenant_memberships_tenant_user
    ON tenant_memberships (tenant_id, user_id);
""".strip()


def fk_ref(table: str, col: str) -> str | None:
    ref = FK_MAP.get((table, col))
    if not ref:
        return None
    pt, pc = ref
    return f"REFERENCES {pt} ({pc})"


def col_line(table: str, name: str, typ: str, k: str, u: str, m: str) -> str:
    if k == "x" and typ == "BIGSERIAL":
        return f"    {name} {typ} PRIMARY KEY"
    if k == "x" and typ == "TEXT":
        return f"    {name} {typ} PRIMARY KEY"
    if k == "x" and name == "tenant_id" and table == "integration_bridge_config":
        ref = fk_ref(table, name)
        return f"    {name} {typ} PRIMARY KEY {ref}" if ref else f"    {name} {typ} PRIMARY KEY"

    parts = [f"    {name}", typ]
    ref = fk_ref(table, name)
    if ref:
        parts.append(ref)
    if u == "x" and k != "x":
        parts.append("UNIQUE")
    if m == "x":
        parts.append("NOT NULL")
    return " ".join(parts)


def table_sql(db_name: str, rows: list, *, style: str) -> str:
    if style == "verbose":
        lines = [
            "-- -----------------------------------------------------------------------------",
            f"-- {db_name}",
            "-- -----------------------------------------------------------------------------",
            f"CREATE TABLE {db_name} (",
        ]
    else:
        lines = [f"CREATE TABLE {db_name} ("]

    body = []
    for name, typ, k, u, m, _desc in rows:
        if db_name == "gateway_client_key_routes" and k == "x":
            ref = fk_ref(db_name, name)
            line = f"    {name} {typ} NOT NULL"
            if ref:
                line += f" {ref}"
            body.append(line)
        elif db_name == "integration_bridge_config" and name == "tenant_id":
            body.append(col_line(db_name, name, typ, k, u, m))
        else:
            body.append(col_line(db_name, name, typ, k, u, m))

    if db_name == "gateway_client_key_routes":
        body.append("    PRIMARY KEY (client_key_id, route_id)")

    lines.append(",\n".join(body))
    lines.append(");")
    return "\n".join(lines)


def render(style: str) -> str:
    n = len(TABLES)
    if style == "verbose":
        header = f"""-- =============================================================================
-- AVASO Gateway — Full PostgreSQL Schema ({n} bảng)
-- Auto-generated from scripts/generate_erd_excel.py (khớp Excel dictionary)
-- Paste vào DBeaver / pgModeler để vẽ ERD
-- =============================================================================

"""
        index_header = """-- =============================================================================
-- Indexes bổ sung (migrations)
-- =============================================================================

"""
        index_sql = index_header + INDEXES.replace(
            "CREATE UNIQUE INDEX ",
            "CREATE UNIQUE INDEX IF NOT EXISTS ",
        )
        footer = "\n\n-- Seed\nINSERT INTO tenants (name) VALUES ('default') ON CONFLICT (name) DO NOTHING;\n"
    else:
        header = f"-- AVASO Gateway — PostgreSQL Schema ({n} bảng, khớp Excel dictionary)\n\n"
        index_sql = "\n\n" + INDEXES
        footer = "\n"

    parts = [header]
    tables = [
        table_sql(table[1], table[3], style=style)
        for table in TABLES
    ]
    parts.append("\n\n".join(tables))
    parts.append(index_sql)
    parts.append(footer)
    return "\n".join(parts)


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate PostgreSQL DDL from ERD dictionary")
    parser.add_argument(
        "--out",
        type=Path,
        default=DEFAULT_OUTPUT,
        help=f"Output path (default: {DEFAULT_OUTPUT})",
    )
    parser.add_argument(
        "--style",
        choices=("clean", "verbose"),
        default="clean",
        help="clean = nộp giảng viên; verbose = docs/DBeaver",
    )
    args = parser.parse_args()
    style = args.style
    sql = render(style)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(sql, encoding="utf-8")
    print(args.out)


if __name__ == "__main__":
    main()
