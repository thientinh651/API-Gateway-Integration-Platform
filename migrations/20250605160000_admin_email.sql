-- Tương thích DB cũ (admin_users) trước khi migration đổi tên dashboard_users
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'admin_users'
    ) THEN
        ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS email TEXT;
        CREATE UNIQUE INDEX IF NOT EXISTS admin_users_email_lower_unique
            ON admin_users (LOWER(TRIM(email)))
            WHERE email IS NOT NULL AND TRIM(email) <> '';
    END IF;
END $$;
