-- Admin console users (password = Argon2id hash at rest)

CREATE TABLE IF NOT EXISTS admin_users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'admin',
    tenant_id INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
