import type { Migration } from '../migration.types'

export const migration: Migration = {
        id: 2,
        name: 'add_user_bio_column',
        upSql: `
        ALTER TABLE users
        ADD COLUMN IF NOT EXISTS bio TEXT NOT NULL DEFAULT '';
        `,
}
