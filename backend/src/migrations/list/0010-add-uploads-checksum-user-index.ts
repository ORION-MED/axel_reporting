import type { Migration } from '../migration.types'

export const migration: Migration = {
        id: 10,
        name: 'add_uploads_checksum_user_index',
        upSql: `
        CREATE INDEX IF NOT EXISTS uploads_checksum_user_idx ON uploads(checksum, user_id);
        `,
}
