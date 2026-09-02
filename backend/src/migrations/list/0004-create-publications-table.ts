import type { Migration } from '../migration.types'

export const migration: Migration = {
        id: 4,
        name: 'create_publications_table',
        upSql: `
        CREATE TABLE IF NOT EXISTS publications (
            id SERIAL PRIMARY KEY,
            owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            title VARCHAR(256) NOT NULL,
            description TEXT NOT NULL DEFAULT '',
            tags TEXT[] NOT NULL DEFAULT '{}',
            workspace_state JSONB NOT NULL DEFAULT '{}'::jsonb,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
        `,
}
