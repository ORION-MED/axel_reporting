import type { Migration } from '../migration.types'

export const migration: Migration = {
        id: 33,
        name: 'add_organization_activity_type',
        upSql: `
        ALTER TABLE reporting_organizations
            ADD COLUMN IF NOT EXISTS activity_type TEXT;
        `,
}
