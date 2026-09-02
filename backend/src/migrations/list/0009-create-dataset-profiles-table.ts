import type { Migration } from '../migration.types'

export const migration: Migration = {
        id: 9,
        name: 'create_dataset_profiles_table',
        upSql: `
        CREATE TABLE IF NOT EXISTS dataset_profiles (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            upload_id UUID NOT NULL REFERENCES uploads(id) ON DELETE CASCADE,
            status TEXT NOT NULL DEFAULT 'pending',
            s3_key TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
        CREATE UNIQUE INDEX IF NOT EXISTS dataset_profiles_upload_id_uidx ON dataset_profiles(upload_id);
        `,
}
