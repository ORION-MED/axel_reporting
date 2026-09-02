import type { Migration } from '../migration.types'

export const migration: Migration = {
        id: 17,
        name: 'add_user_roles',
        upSql: `
        ALTER TABLE users
        ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'user';

        UPDATE users
        SET role = 'admin'
        WHERE login = 'admin';

        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1
                FROM pg_constraint
                WHERE conname = 'users_role_chk'
            ) THEN
                ALTER TABLE users
                ADD CONSTRAINT users_role_chk CHECK (role IN ('admin', 'user'));
            END IF;
        END
        $$;

        CREATE INDEX IF NOT EXISTS users_role_idx ON users(role);
        `,
}
