import type { Migration } from '../migration.types'

export const migration: Migration = {
        id: 12,
        name: 'add_uploads_checksum_unique_index',
        upSql: `
        CREATE UNIQUE INDEX IF NOT EXISTS uploads_checksum_user_uidx
        ON uploads(checksum, user_id)
        WHERE checksum IS NOT NULL;
        `,
}
