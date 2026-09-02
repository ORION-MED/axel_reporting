import type { Migration } from '../migration.types'

export const migration: Migration = {
        id: 11,
        name: 'add_users_token_version',
        upSql: `
        ALTER TABLE users
        ADD COLUMN IF NOT EXISTS token_version INT NOT NULL DEFAULT 0;
        `,
}
