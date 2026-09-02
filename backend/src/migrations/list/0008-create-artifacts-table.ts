import type { Migration } from '../migration.types'

export const migration: Migration = {
        id: 8,
        name: 'create_artifacts_table',
        upSql: `
        CREATE TABLE IF NOT EXISTS artifacts (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            job_id UUID NOT NULL REFERENCES processing_jobs(id) ON DELETE CASCADE,
            artifact_type TEXT NOT NULL,
            format TEXT NOT NULL,
            s3_key TEXT NOT NULL,
            size_bytes BIGINT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS artifacts_job_id_idx ON artifacts(job_id);
        `,
}
