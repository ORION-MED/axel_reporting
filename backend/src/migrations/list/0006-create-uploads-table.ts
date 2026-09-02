import type { Migration } from '../migration.types'

export const migration: Migration = {
        id: 6,
        name: 'create_uploads_table',
        upSql: `
        CREATE TABLE IF NOT EXISTS uploads (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            original_filename TEXT NOT NULL,
            mime_type TEXT NOT NULL,
            size_bytes BIGINT NOT NULL,
            s3_raw_key TEXT NOT NULL,
            checksum TEXT,
            status TEXT NOT NULL DEFAULT 'uploaded',
            uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS uploads_user_id_idx ON uploads(user_id);
        `,
}
