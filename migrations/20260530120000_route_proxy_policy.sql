ALTER TABLE gateway_routes ADD COLUMN transform_add_headers TEXT NOT NULL DEFAULT '{}';
ALTER TABLE gateway_routes ADD COLUMN transform_remove_headers TEXT NOT NULL DEFAULT '[]';
ALTER TABLE gateway_routes ADD COLUMN retry_max INTEGER NOT NULL DEFAULT 0;
ALTER TABLE gateway_routes ADD COLUMN retry_on_status TEXT NOT NULL DEFAULT '502,503,504';
ALTER TABLE gateway_routes ADD COLUMN retry_on_timeout INTEGER NOT NULL DEFAULT 1;
ALTER TABLE gateway_routes ADD COLUMN queue_on_failure INTEGER NOT NULL DEFAULT 0;
