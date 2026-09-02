import type { Migration } from '../migration.types'

/**
 * Здания, передавшие вид СЭМД, — отдельной таблицей.
 *
 * Зачем. Методолог определила ТВСП как здание: «всё, что находится на каждом
 * отдельном своём адресе» (ВКС 24.08.2026). Показатель 1.24 считает именно ТВСП,
 * а перечень Минздрава адресует здания поимённо — но наши факты хранились только
 * по подразделениям, и сопоставить их было не с чем. Из-за этого показатель брал
 * и числитель, и знаменатель из перечня и застывал на месяце его выпуска.
 *
 * Широкий отчёт РЭМД здания несёт — «ID здания», «Название здания», «Адрес
 * здания» на листе по подразделениям. Разбор их просто выбрасывал.
 *
 * **Почему отдельная таблица, а не колонка в `reporting_remd_interval_facts`.**
 * Там факт сведён по паре «МО × вид»: строки подразделений складываются, и это
 * ровно то, что нужно кривым динамики и показателю 27. Если у одной МО вид
 * передают два здания, в своде остаётся одна строка — здание в ней сохранить
 * нельзя, останется случайное из двух. Добавлять здание в ключ свода значило бы
 * менять зерно таблицы, от которой уже зависят проверенные суммы.
 *
 * Здесь зерно другое и вопрос другой: не «сколько документов», а «какие здания
 * передавали». Поэтому таблица-множество, и количество документов в ней —
 * справочное.
 */
export const migration: Migration = {
    id: 59,
    name: 'create_reporting_remd_building_facts',
    upSql: `
    CREATE TABLE IF NOT EXISTS reporting_remd_building_facts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        period_id UUID NOT NULL REFERENCES reporting_periods(id) ON DELETE CASCADE,
        coverage TEXT NOT NULL,
        month SMALLINT NOT NULL,
        organization_oid TEXT NOT NULL REFERENCES reporting_organizations(oid) ON DELETE CASCADE,
        building_id TEXT NOT NULL,
        building_name TEXT NOT NULL DEFAULT '',
        building_address TEXT NOT NULL DEFAULT '',
        semd_type_id UUID NOT NULL REFERENCES reporting_semd_types(id) ON DELETE CASCADE,
        document_count BIGINT NOT NULL DEFAULT 0,
        source_import_id UUID REFERENCES reporting_import_runs(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT reporting_remd_building_facts_coverage_chk
            CHECK (coverage IN ('month', 'cumulative')),
        CONSTRAINT reporting_remd_building_facts_month_chk
            CHECK (month BETWEEN 1 AND 12),
        CONSTRAINT reporting_remd_building_facts_count_chk
            CHECK (document_count >= 0),
        CONSTRAINT reporting_remd_building_facts_building_chk
            CHECK (building_id <> '')
    );

    CREATE UNIQUE INDEX IF NOT EXISTS reporting_remd_building_facts_uidx
        ON reporting_remd_building_facts(
            period_id, coverage, month, organization_oid, building_id, semd_type_id
        );

    -- Показатель 1.24 спрашивает «сколько разных зданий передали вид 343».
    CREATE INDEX IF NOT EXISTS reporting_remd_building_facts_type_idx
        ON reporting_remd_building_facts(period_id, semd_type_id, coverage, month);
    `,
}
