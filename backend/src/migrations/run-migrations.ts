import '../config/load-env'
import { Pool } from 'pg'
import { migrations } from './list'
import { ensureSeedAdmin } from './ensure-seed-admin'

async function main() {
    const pool = new Pool({
        host: process.env.AUTH_DB_HOST || process.env.APP_DB_HOST || process.env.EICU_DB_HOST || 'localhost',
        port: Number(process.env.AUTH_DB_PORT || process.env.APP_DB_PORT || process.env.EICU_DB_PORT || 5432),
        database: process.env.AUTH_DB_NAME || process.env.APP_DB_NAME || process.env.EICU_DB_NAME || 'postgres',
        user: process.env.AUTH_DB_USER || process.env.APP_DB_USER || process.env.EICU_DB_USER || 'postgres',
        password: process.env.AUTH_DB_PASSWORD || process.env.APP_DB_PASSWORD || process.env.EICU_DB_PASSWORD || 'postgres',
    })

    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS schema_migrations (
                id INTEGER PRIMARY KEY,
                name TEXT NOT NULL,
                applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
            );
        `)

        const existingRes = await pool.query('SELECT id FROM schema_migrations ORDER BY id')
        const appliedIds = new Set<number>(existingRes.rows.map((r: any) => Number(r.id)))

        for (const m of migrations) {
            if (appliedIds.has(m.id)) {
                // eslint-disable-next-line no-console
                console.log(`Migration #${m.id} (${m.name}) already applied`)
                continue
            }

            // eslint-disable-next-line no-console
            console.log(`Applying migration #${m.id} (${m.name})...`)
            const client = await pool.connect()
            try {
                await client.query('BEGIN')
                let shouldRecord = true
                if (m.up) {
                    const result = await m.up(client)
                    shouldRecord = result !== false
                } else if (m.upSql) {
                    await client.query(m.upSql)
                }
                if (shouldRecord) {
                    await client.query(
                        'INSERT INTO schema_migrations(id, name) VALUES ($1, $2)',
                        [m.id, m.name],
                    )
                }
                await client.query('COMMIT')
                // eslint-disable-next-line no-console
                console.log(shouldRecord ? `Migration #${m.id} applied` : `Migration #${m.id} skipped`)
            } catch (err) {
                await client.query('ROLLBACK')
                // eslint-disable-next-line no-console
                console.error(`Failed to apply migration #${m.id}:`, err)
                throw err
            } finally {
                client.release()
            }
        }

        const client = await pool.connect()
        try {
            await client.query('BEGIN')
            await ensureSeedAdmin(client)
            await client.query('COMMIT')
        } catch (err) {
            await client.query('ROLLBACK')
            // eslint-disable-next-line no-console
            console.error('Failed to synchronize seed admin:', err)
            throw err
        } finally {
            client.release()
        }
    } finally {
        await pool.end()
    }
}

main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error('Migration error:', err)
    process.exit(1)
})
