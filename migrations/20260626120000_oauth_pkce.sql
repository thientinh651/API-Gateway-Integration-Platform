-- PKCE for OAuth2 Authorization Code (RFC 7636)

ALTER TABLE oauth_authorization_codes
    ADD COLUMN IF NOT EXISTS code_challenge TEXT,
    ADD COLUMN IF NOT EXISTS code_challenge_method TEXT NOT NULL DEFAULT 'S256';
