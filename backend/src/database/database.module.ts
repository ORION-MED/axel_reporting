import { Module } from '@nestjs/common'
import { EicuController } from './eicu.controller'
import { EicuService } from './eicu.service'
import { MimicController } from './mimic.controller'
import { MimicService } from './mimic.service'
import { PicdbController } from './picdb.controller'
import { PicdbService } from './picdb.service'
import { databasePoolProviders, DatabasePoolsLifecycle } from './database.providers'
import { EICU_DB_POOL, MIMIC_DB_POOL, PICDB_DB_POOL } from './database.tokens'

@Module({
    controllers: [EicuController, MimicController, PicdbController],
    providers: [
        ...databasePoolProviders,
        DatabasePoolsLifecycle,
        EicuService,
        MimicService,
        PicdbService,
    ],
    exports: [
        EICU_DB_POOL,
        MIMIC_DB_POOL,
        PICDB_DB_POOL,
        EicuService,
        MimicService,
        PicdbService,
    ],
})
// Модуль базы данных: регистрирует контроллер и сервис для доступа к eICU БД.
export class DatabaseModule { }
