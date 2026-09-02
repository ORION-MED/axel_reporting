import { Inject, Injectable, Logger, OnModuleDestroy, type Provider } from '@nestjs/common'
import { Pool } from 'pg'
import { EICU_DB_POOL, MIMIC_DB_POOL, PICDB_DB_POOL } from './database.tokens'

function createPool(config: {
    host: string
    port: number
    database: string
    user: string
    password: string
    options?: string
}) {
    const pool = new Pool({
        ...config,
        max: Number(process.env.DB_POOL_MAX) || 10,
        idleTimeoutMillis: Number(process.env.DB_IDLE_TIMEOUT) || 30_000,
        connectionTimeoutMillis: Number(process.env.DB_CONNECTION_TIMEOUT) || 5_000,
    })

    pool.on('error', (err) => {
        new Logger('DatabasePool').error('Unexpected pool error', err.stack)
    })

    return pool
}

const mimicSearchPath = process.env.MIMIC_DB_SEARCH_PATH || 'mimiciv_hosp,mimiciv_icu,public'

export const databasePoolProviders: Provider[] = [
    {
        provide: EICU_DB_POOL,
        useFactory: () =>
            createPool({
                host: process.env.EICU_DB_HOST || 'localhost',
                port: Number(process.env.EICU_DB_PORT) || 5432,
                database: process.env.EICU_DB_NAME || 'postgres',
                user: process.env.EICU_DB_USER || 'postgres',
                password: process.env.EICU_DB_PASSWORD || 'postgres',
            }),
    },
    {
        provide: MIMIC_DB_POOL,
        useFactory: () =>
            createPool({
                host: process.env.MIMIC_DB_HOST || 'localhost',
                port: Number(process.env.MIMIC_DB_PORT) || 5432,
                database: process.env.MIMIC_DB_NAME || 'postgres',
                user: process.env.MIMIC_DB_USER || 'postgres',
                password: process.env.MIMIC_DB_PASSWORD || 'postgres',
                options: `-c search_path=${mimicSearchPath}`,
            }),
    },
    {
        provide: PICDB_DB_POOL,
        useFactory: () =>
            createPool({
                host: process.env.PIC_DB_HOST || 'localhost',
                port: Number(process.env.PIC_DB_PORT) || 5432,
                database: process.env.PIC_DB_NAME || 'postgres',
                user: process.env.PIC_DB_USER || 'postgres',
                password: process.env.PIC_DB_PASSWORD || 'postgres',
            }),
    },
]

@Injectable()
export class DatabasePoolsLifecycle implements OnModuleDestroy {
    constructor(
        @Inject(EICU_DB_POOL) private readonly eicuPool: Pool,
        @Inject(MIMIC_DB_POOL) private readonly mimicPool: Pool,
        @Inject(PICDB_DB_POOL) private readonly picdbPool: Pool,
    ) {}

    async onModuleDestroy() {
        await Promise.all([
            this.eicuPool.end(),
            this.mimicPool.end(),
            this.picdbPool.end(),
        ])
    }
}
