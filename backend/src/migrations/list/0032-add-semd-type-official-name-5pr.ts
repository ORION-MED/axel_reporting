import type { Migration } from '../migration.types'

export const migration: Migration = {
        id: 32,
        name: 'add_semd_type_official_name_5pr',
        upSql: `
        ALTER TABLE reporting_semd_types
            ADD COLUMN IF NOT EXISTS official_name_5pr TEXT;
        `,
}
