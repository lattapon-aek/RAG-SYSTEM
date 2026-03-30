ALTER TABLE admin_users
ADD COLUMN IF NOT EXISTS role VARCHAR(32) NOT NULL DEFAULT 'admin';

UPDATE admin_users
SET role = 'admin'
WHERE role IS NULL OR role = '';

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'admin_users_role_check'
    ) THEN
        ALTER TABLE admin_users
        ADD CONSTRAINT admin_users_role_check
        CHECK (role IN ('viewer', 'operator', 'admin'));
    END IF;
END $$;
