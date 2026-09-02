import type { Migration } from '../migration.types'

/**
 * Перечни входимости ТВСП, присланные Минздравом (письмо № ВХ.04-08186_26
 * от 20.07.2026).
 *
 * Что это такое. По каждому виду СЭМД Минздрав называет поимённо
 * территориально-выделенные структурные подразделения, которые обязаны
 * передавать этот вид, и ставит по каждому план и факт. То есть присылает
 * готовый знаменатель показателя — тот самый, который мы почти месяц собирались
 * получать от методолога формой на 1 263 строки.
 *
 * **Это основание приоритета 1.** В матрице применимости уровень «условия
 * входимости, утверждённые МЗ РФ» стоит первым по старшинству, и до сих пор
 * он воспроизводился по слайдам методики. Здесь тот же источник, но данными.
 *
 * **Уровень строки разный у разных перечней**, и таблица это допускает:
 * у видов 6, 10, 12, 343 и 381 строка — здание, у 141 — подразделение внутри
 * здания, у 371 — медорганизация целиком без зданий. Поэтому и `building_id`,
 * и `subdivision_oid` необязательны, а уникальность строится по тому, что есть.
 *
 * **Срез, а не состояние.** Все семь файлов подписаны «по итогам июня 2026
 * года». Месяц среза хранится в `register_month`: показатель, посчитанный
 * по такому перечню, относится к июню, и подписывать его текущим месяцем
 * нельзя.
 */
export const migration: Migration = {
    id: 57,
    name: 'create_reporting_inclusion_registers',
    upSql: `
    CREATE TABLE IF NOT EXISTS reporting_inclusion_registers (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        semd_type_id UUID NOT NULL REFERENCES reporting_semd_types(id) ON DELETE CASCADE,
        subject_name TEXT NOT NULL DEFAULT '',
        organization_oid TEXT NOT NULL,
        organization_name TEXT NOT NULL DEFAULT '',
        building_id TEXT NOT NULL DEFAULT '',
        building_name TEXT NOT NULL DEFAULT '',
        building_address TEXT NOT NULL DEFAULT '',
        subdivision_oid TEXT NOT NULL DEFAULT '',
        plan_value INTEGER NOT NULL DEFAULT 0,
        fact_value INTEGER NOT NULL DEFAULT 0,
        -- Заголовок перечня целиком: он объясняет, кого Минздрав включил
        -- в знаменатель, и в интерфейсе показывается подписью под показателем.
        register_title TEXT NOT NULL DEFAULT '',
        register_month SMALLINT,
        register_year INTEGER,
        source_import_id UUID REFERENCES reporting_import_runs(id) ON DELETE SET NULL,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT reporting_inclusion_registers_month_chk
            CHECK (register_month IS NULL OR register_month BETWEEN 1 AND 12),
        CONSTRAINT reporting_inclusion_registers_values_chk
            CHECK (plan_value >= 0 AND fact_value >= 0),
        CONSTRAINT reporting_inclusion_registers_metadata_chk
            CHECK (jsonb_typeof(metadata) = 'object')
    );

    -- Строка перечня — это «вид × МО × здание × подразделение». Пустые
    -- значения участвуют в ключе наравне с заполненными, поэтому колонки
    -- объявлены NOT NULL DEFAULT '' — иначе NULL сделал бы строки
    -- неразличимыми для уникального индекса.
    CREATE UNIQUE INDEX IF NOT EXISTS reporting_inclusion_registers_uidx
        ON reporting_inclusion_registers(
            semd_type_id, organization_oid, building_id, subdivision_oid
        );

    CREATE INDEX IF NOT EXISTS reporting_inclusion_registers_type_idx
        ON reporting_inclusion_registers(semd_type_id);
    `,
}
