import type { Migration } from '../migration.types'

export const migration: Migration = {
        id: 5,
        name: 'add_publication_visibility_flags',
        upSql: `
        ALTER TABLE publications
        ADD COLUMN IF NOT EXISTS is_public BOOLEAN NOT NULL DEFAULT FALSE;
        `,
}
