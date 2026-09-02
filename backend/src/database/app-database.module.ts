import { Global, Inject, Injectable, Module, OnModuleDestroy } from '@nestjs/common'
import { Pool } from 'pg'
import { APP_DB_POOL } from './database.tokens'

@Injectable()
class AppPoolLifecycle implements OnModuleDestroy {
    constructor(@Inject(APP_DB_POOL) private readonly pool: Pool) {}
    async onModuleDestroy() {
        await this.pool.end()
    }
}

@Global()
@Module({
    providers: [
        {
            provide: APP_DB_POOL,
            useFactory: () =>
                new Pool({
                    host: process.env.AUTH_DB_HOST || process.env.APP_DB_HOST || 'localhost',
                    port: Number(process.env.AUTH_DB_PORT || process.env.APP_DB_PORT) || 5432,
                    database: process.env.AUTH_DB_NAME || process.env.APP_DB_NAME || 'postgres',
                    user: process.env.AUTH_DB_USER || process.env.APP_DB_USER || 'postgres',
                    password: process.env.AUTH_DB_PASSWORD || process.env.APP_DB_PASSWORD || 'postgres',
                    max: Number(process.env.DB_POOL_MAX) || 10,
                    idleTimeoutMillis: Number(process.env.DB_IDLE_TIMEOUT) || 30_000,
                    connectionTimeoutMillis: Number(process.env.DB_CONNECTION_TIMEOUT) || 5_000,
                }),
        },
        AppPoolLifecycle,
    ],
    exports: [APP_DB_POOL],
})
export class AppDatabaseModule {}
