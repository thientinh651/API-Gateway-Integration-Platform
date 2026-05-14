-- Persistent gateway configuration (SQLite)

CREATE TABLE IF NOT EXISTS gateway_routes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    path TEXT NOT NULL UNIQUE,
    target TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS gateway_client_keys (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL DEFAULT '',
    secret_sha256_hex TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS gateway_settings (
    k TEXT PRIMARY KEY,
    v TEXT NOT NULL
);
