import type { Migration } from '../migration.types'

export const migration: Migration = {
        id: 1,
        name: 'create_users_table',
        upSql: `
        CREATE TABLE IF NOT EXISTS users (
            id SERIAL PRIMARY KEY,
            login VARCHAR(64) NOT NULL UNIQUE,
            email VARCHAR(256) NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            bio TEXT NOT NULL DEFAULT ''
        );
        `,
}
