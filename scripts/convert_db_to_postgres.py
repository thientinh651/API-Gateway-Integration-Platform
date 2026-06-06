#!/usr/bin/env python3
"""Convert src/db.rs SQLite SQL strings to PostgreSQL ($1 placeholders)."""
from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DB_RS = ROOT / "src" / "db.rs"

SQL_REPLACEMENTS = [
    ("datetime('now', '+' || ? || ' seconds')", "NOW() + ($7::bigint * INTERVAL '1 second')"),
    ("datetime('now', '-1 day')", "NOW() - INTERVAL '1 day'"),
    ("datetime('now')", "NOW()"),
    ("strftime('%H:00', created_at)", "to_char(created_at AT TIME ZONE 'UTC', 'HH24:00')"),
    ("INSERT OR IGNORE INTO", "INSERT INTO"),
    ("AVG(CAST(duration_ms AS REAL))", "AVG(duration_ms::double precision)"),
    ("/// Kiểm tra SQLite còn phản hồi", "/// Kiểm tra PostgreSQL còn phản hồi"),
    ("//! SQLite persistence", "//! PostgreSQL persistence"),
]


def convert_qmarks(sql: str) -> str:
    n = 0
    out = []
    for c in sql:
        if c == "?":
            n += 1
            out.append(f"${n}")
        else:
            out.append(c)
    return "".join(out)


def is_sql_string(s: str) -> bool:
    upper = s.upper()
    return "?" in s and any(
        k in upper
        for k in (
            "SELECT ",
            "INSERT ",
            "UPDATE ",
            "DELETE ",
            " FROM ",
            " INTO ",
            " WHERE ",
            " ON CONFLICT",
            "VALUES (",
        )
    )


def process_strings(content: str) -> str:
    out: list[str] = []
    i = 0
    while i < len(content):
        if content[i] != '"':
            out.append(content[i])
            i += 1
            continue
        j = i + 1
        parts: list[str] = []
        while j < len(content):
            if content[j] == "\\":
                parts.append(content[j : j + 2])
                j += 2
                continue
            if content[j] == '"':
                break
            parts.append(content[j])
            j += 1
        raw = "".join(parts)
        if is_sql_string(raw):
            for old, new in SQL_REPLACEMENTS:
                raw = raw.replace(old, new)
            raw = convert_qmarks(raw)
        out.append('"')
        out.append(raw)
        out.append('"')
        i = j + 1
    return "".join(out)


def patch_connect(content: str) -> str:
    pattern = re.compile(
        r"pub async fn connect\(database_url: &str\) -> Result<SqlitePool, sqlx::Error> \{.*?\n\}",
        re.DOTALL,
    )
    new_connect = """pub async fn connect(database_url: &str) -> Result<PgPool, sqlx::Error> {
    let url = database_url.trim();
    if !url.starts_with("postgres://") && !url.starts_with("postgresql://") {
        return Err(sqlx::Error::Configuration(
            "DATABASE_URL must be postgres:// or postgresql://".into(),
        ));
    }
    PgPoolOptions::new()
        .max_connections(10)
        .connect(url)
        .await
}"""
    return pattern.sub(new_connect, content, count=1)


def main() -> None:
    text = DB_RS.read_text(encoding="utf-8")
    text = text.replace(
        "use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};\nuse sqlx::SqlitePool;\nuse std::path::PathBuf;\n\n",
        "use sqlx::postgres::PgPoolOptions;\nuse sqlx::PgPool;\n\n",
    )
    text = text.replace("SqlitePool", "PgPool")
    text = patch_connect(text)
    text = process_strings(text)

    # ON CONFLICT helpers (after ? conversion)
    text = text.replace(
        'INSERT INTO tenants (name) VALUES (\'default\')',
        "INSERT INTO tenants (name) VALUES ('default') ON CONFLICT (name) DO NOTHING",
    )
    text = text.replace(
        "\"INSERT INTO gateway_client_keys (name, secret_sha256_hex) VALUES ($1, $2)\"",
        "\"INSERT INTO gateway_client_keys (name, secret_sha256_hex) VALUES ('imported', $1) ON CONFLICT (secret_sha256_hex) DO NOTHING\"",
    )

    DB_RS.write_text(text, encoding="utf-8")
    print(f"Patched {DB_RS}")


if __name__ == "__main__":
    main()
