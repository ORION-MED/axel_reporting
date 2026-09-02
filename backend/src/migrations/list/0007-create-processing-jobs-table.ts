import type { Migration } from '../migration.types'

export const migration: Migration = {
        id: 7,
        name: 'create_processing_jobs_table',
        upSql: `
        CREATE TABLE IF NOT EXISTS processing_jobs (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            upload_id UUID NOT NULL REFERENCES uploads(id) ON DELETE CASCADE,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            job_type TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'queued',
            progress_percent INTEGER NOT NULL DEFAULT 0,
            pipeline_config JSONB NOT NULL DEFAULT '{}'::jsonb,
            started_at TIMESTAMPTZ,
            finished_at TIMESTAMPTZ,
            error_message TEXT,
            worker_id TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS processing_jobs_upload_id_idx ON processing_jobs(upload_id);
        CREATE INDEX IF NOT EXISTS processing_jobs_status_idx ON processing_jobs(status);
        `,
}
