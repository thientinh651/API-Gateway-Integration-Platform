-- Chuẩn hóa: admin_users → dashboard_users (mọi role console: admin/operator/viewer)
-- Không tách bảng theo role — RBAC qua cột role + middleware.

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'admin_users'
    ) AND NOT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'dashboard_users'
    ) THEN
        ALTER TABLE admin_users RENAME TO dashboard_users;
    END IF;
END $$;

ALTER TABLE dashboard_users ADD COLUMN IF NOT EXISTS email TEXT;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relkind = 'i' AND c.relname = 'admin_users_email_lower_unique'
    ) THEN
        ALTER INDEX admin_users_email_lower_unique RENAME TO dashboard_users_email_lower_unique;
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS dashboard_users_email_lower_unique
    ON dashboard_users (LOWER(TRIM(email)))
    WHERE email IS NOT NULL AND TRIM(email) <> '';

UPDATE dashboard_users SET tenant_id = 1 WHERE tenant_id IS NULL;

UPDATE dashboard_users SET role = LOWER(TRIM(role)) WHERE role IS NOT NULL;

UPDATE gateway_client_keys k
SET owner_user_id = NULL
WHERE owner_user_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM dashboard_users u WHERE u.id = k.owner_user_id);

ALTER TABLE dashboard_users ALTER COLUMN tenant_id SET DEFAULT 1;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'dashboard_users'
          AND column_name = 'tenant_id' AND is_nullable = 'YES'
    ) THEN
        ALTER TABLE dashboard_users ALTER COLUMN tenant_id SET NOT NULL;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'dashboard_users_tenant_id_fkey'
    ) THEN
        ALTER TABLE dashboard_users
            ADD CONSTRAINT dashboard_users_tenant_id_fkey
            FOREIGN KEY (tenant_id) REFERENCES tenants(id);
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'dashboard_users_role_check'
    ) THEN
        ALTER TABLE dashboard_users
            ADD CONSTRAINT dashboard_users_role_check
            CHECK (role IN ('admin', 'operator', 'viewer'));
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'dashboard_users_is_active_check'
    ) THEN
        ALTER TABLE dashboard_users
            ADD CONSTRAINT dashboard_users_is_active_check
            CHECK (is_active IN (0, 1));
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_dashboard_users_tenant_role
    ON dashboard_users (tenant_id, role);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'gateway_client_keys_owner_user_id_fkey'
    ) THEN
        ALTER TABLE gateway_client_keys
            ADD CONSTRAINT gateway_client_keys_owner_user_id_fkey
            FOREIGN KEY (owner_user_id) REFERENCES dashboard_users(id) ON DELETE SET NULL;
    END IF;
END $$;
