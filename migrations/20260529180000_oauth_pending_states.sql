-- OAuth CSRF state + PKCE verifier (survives gateway restart)

CREATE TABLE IF NOT EXISTS oauth_pending_states (
    state TEXT PRIMARY KEY,
    tenant_id INTEGER NOT NULL,
    provider TEXT NOT NULL,
    actor TEXT NOT NULL DEFAULT '',
    role TEXT NOT NULL DEFAULT 'admin',
    pkce_verifier TEXT,
    expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_oauth_pending_expires ON oauth_pending_states (expires_at);
