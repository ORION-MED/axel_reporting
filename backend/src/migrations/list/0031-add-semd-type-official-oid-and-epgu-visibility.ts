import type { Migration } from '../migration.types'

export const migration: Migration = {
        id: 31,
        name: 'add_semd_type_official_oid_and_epgu_visibility',
        upSql: `
        ALTER TABLE reporting_semd_types
            ADD COLUMN IF NOT EXISTS official_oid TEXT,
            ADD COLUMN IF NOT EXISTS epgu_visible_registry BOOLEAN;
        `,
}
