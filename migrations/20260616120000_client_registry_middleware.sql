-- Client Registry: status, per-client rate limit, route ACL (Middleware Integration Platform)

ALTER TABLE gateway_client_keys
    ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';

ALTER TABLE gateway_client_keys
    ADD COLUMN IF NOT EXISTS rate_limit_per_min INTEGER NOT NULL DEFAULT 0;

ALTER TABLE gateway_client_keys
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE TABLE IF NOT EXISTS gateway_client_key_routes (
    client_key_id BIGINT NOT NULL REFERENCES gateway_client_keys(id) ON DELETE CASCADE,
    route_id BIGINT NOT NULL REFERENCES gateway_routes(id) ON DELETE CASCADE,
    PRIMARY KEY (client_key_id, route_id)
);

CREATE INDEX IF NOT EXISTS idx_client_key_routes_route
    ON gateway_client_key_routes(route_id);
