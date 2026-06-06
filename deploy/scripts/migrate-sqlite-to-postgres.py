#!/usr/bin/env python3
"""Copy gateway data from SQLite (data/gateway.db) into PostgreSQL. Stdlib only."""
from __future__ import annotations

import os
import sqlite3
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SQLITE = ROOT / "data" / "gateway.db"
PG_URL = os.environ.get(
    "DATABASE_URL", "postgres://avaso:avaso_local_2026@127.0.0.1:5432/avaso_gateway"
)


def psql(sql: str) -> None:
    subprocess.run(
        ["psql", PG_URL, "-v", "ON_ERROR_STOP=1", "-q", "-c", sql],
        check=True,
    )


def esc(val) -> str:
    if val is None:
        return "NULL"
    if isinstance(val, (int, float)):
        return str(val)
    s = str(val).replace("'", "''")
    return f"'{s}'"


def main() -> int:
    if not SQLITE.is_file():
        print(f"Không có {SQLITE} — bỏ qua migrate dữ liệu.")
        return 0

    conn = sqlite3.connect(SQLITE)
    conn.row_factory = sqlite3.Row

    print("==> Xóa dữ liệu mặc định PG (giữ schema)")
    for table in (
        "gateway_transaction_logs",
        "integration_snapshots",
        "oauth_pending_states",
        "integration_bridge_config",
        "integration_provider_configs",
        "integrations",
        "audit_logs",
        "gateway_client_keys",
        "gateway_routes",
        "gateway_settings",
        "dashboard_users",
        "tenants",
    ):
        psql(f"TRUNCATE {table} RESTART IDENTITY CASCADE;")

    print("==> tenants")
    for row in conn.execute("SELECT id, name, created_at FROM tenants ORDER BY id"):
        psql(
            f"INSERT INTO tenants (id, name, created_at) VALUES "
            f"({row['id']}, {esc(row['name'])}, {esc(row['created_at'])}::timestamptz);"
        )
    psql("SELECT setval(pg_get_serial_sequence('tenants','id'), (SELECT COALESCE(MAX(id),1) FROM tenants));")

    print("==> gateway_routes")
    for row in conn.execute("SELECT * FROM gateway_routes ORDER BY id"):
        psql(
            "INSERT INTO gateway_routes "
            "(id, path, target, timeout_secs, rate_limit_per_min, tenant_id, "
            "transform_add_headers, transform_remove_headers, retry_max, "
            "retry_on_status, retry_on_timeout, queue_on_failure) VALUES ("
            f"{row['id']}, {esc(row['path'])}, {esc(row['target'])}, "
            f"{row['timeout_secs']}, {row['rate_limit_per_min']}, {row['tenant_id']}, "
            f"{esc(row['transform_add_headers'])}, {esc(row['transform_remove_headers'])}, "
            f"{row['retry_max']}, {esc(row['retry_on_status'])}, "
            f"{row['retry_on_timeout']}, {row['queue_on_failure']});"
        )
    psql(
        "SELECT setval(pg_get_serial_sequence('gateway_routes','id'), "
        "(SELECT COALESCE(MAX(id),1) FROM gateway_routes));"
    )

    print("==> gateway_client_keys")
    for row in conn.execute("SELECT * FROM gateway_client_keys ORDER BY id"):
        psql(
            "INSERT INTO gateway_client_keys "
            "(id, name, secret_sha256_hex, api_key, secret_encrypted, tenant_id, integration_type) "
            f"VALUES ({row['id']}, {esc(row['name'])}, {esc(row['secret_sha256_hex'])}, "
            f"{esc(row['api_key'])}, {esc(row['secret_encrypted'])}, {row['tenant_id']}, "
            f"{esc(row['integration_type'])});"
        )
    psql(
        "SELECT setval(pg_get_serial_sequence('gateway_client_keys','id'), "
        "(SELECT COALESCE(MAX(id),1) FROM gateway_client_keys));"
    )

    print("==> gateway_settings")
    for row in conn.execute("SELECT k, v FROM gateway_settings"):
        psql(f"INSERT INTO gateway_settings (k, v) VALUES ({esc(row['k'])}, {esc(row['v'])});")

    print("==> dashboard_users")
    for row in conn.execute("SELECT * FROM admin_users ORDER BY id"):
        psql(
            "INSERT INTO dashboard_users "
            "(id, username, password_hash, role, tenant_id, is_active, created_at) VALUES ("
            f"{row['id']}, {esc(row['username'])}, {esc(row['password_hash'])}, "
            f"{esc(row['role'])}, {esc(row['tenant_id'])}, {row['is_active']}, "
            f"{esc(row['created_at'])}::timestamptz);"
        )
    psql(
        "SELECT setval(pg_get_serial_sequence('dashboard_users','id'), "
        "(SELECT COALESCE(MAX(id),1) FROM dashboard_users));"
    )

    print("==> integrations")
    for row in conn.execute("SELECT * FROM integrations ORDER BY id"):
        last_sync = esc(row["last_sync_at"]) if row["last_sync_at"] else "NULL"
        if last_sync != "NULL":
            last_sync += "::timestamptz"
        psql(
            "INSERT INTO integrations "
            "(id, tenant_id, provider, status, config_encrypted, last_sync_at, last_error, updated_at) "
            f"VALUES ({row['id']}, {row['tenant_id']}, {esc(row['provider'])}, {esc(row['status'])}, "
            f"{esc(row['config_encrypted'])}, {last_sync}, {esc(row['last_error'])}, "
            f"{esc(row['updated_at'])}::timestamptz);"
        )
    psql(
        "SELECT setval(pg_get_serial_sequence('integrations','id'), "
        "(SELECT COALESCE(MAX(id),1) FROM integrations));"
    )

    if conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='integration_provider_configs'"
    ).fetchone():
        print("==> integration_provider_configs")
        for row in conn.execute("SELECT * FROM integration_provider_configs ORDER BY id"):
            psql(
                "INSERT INTO integration_provider_configs "
                "(id, tenant_id, provider, config_encrypted, updated_by, updated_at) VALUES ("
                f"{row['id']}, {row['tenant_id']}, {esc(row['provider'])}, "
                f"{esc(row['config_encrypted'])}, {esc(row['updated_by'])}, "
                f"{esc(row['updated_at'])}::timestamptz);"
            )

    conn.close()
    print("==> Migrate SQLite → PostgreSQL xong.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
