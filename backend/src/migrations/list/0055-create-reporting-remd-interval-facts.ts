import type { Migration } from '../migration.types'

/**
 * Выгрузки РЭМД за интервал: помесячные и нарастающие итогом с начала года.
 *
 * **Почему отдельная таблица, а не колонка в `reporting_remd_facts`.** Там одна
 * строка на пару «МО × вид» в периоде (`reporting_remd_facts_organization_uidx`),
 * а широкий импортёр перед записью делает `DELETE FROM reporting_remd_facts
 * WHERE period_id = $1`. Положить рядом второй набор фактов невозможно: каждая
 * следующая выгрузка затрёт предыдущую вместе с числителем всех показателей.
 * А методолог 25.08.2026 прислала тринадцать отчётов за один и тот же период —
 * семь помесячных и шесть нарастающих.
 *
 * **Почему две разновидности в одной таблице.** Границу провела сама методолог:
 * «для показателя 27 по региону и по МО количество уникальных СЭМД берём
 * из выгрузки нарастающим итогом, а динамика по кол-ву СЭМД — с каждого месяца».
 * Файлы при этом одного формата и грузятся одним импортёром — различаются только
 * тем, за что отвечают. Разводить их по двум таблицам значило бы дублировать
 * и хранение, и импорт ради одной колонки.
 *
 * `coverage` = `month`: выгрузка за один месяц, `month` — он и есть.
 * `coverage` = `cumulative`: нарастающим итогом с января, `month` — последний
 * месяц интервала (у отчёта «янв-июль» это 7).
 *
 * **Разреза по подразделениям здесь нет.** В присланных файлах он есть, но ни
 * график динамики, ни показатель 27 его не используют, а показатель 1.24 (Д-12)
 * ждёт справочник с профилем и до него не дошёл. Добавить колонку потом дешевле,
 * чем поддерживать заведомо неиспользуемую.
 *
 * **Региональных строк тоже нет.** Регион выводится из строк МО: у показателя 27
 * это уникальные виды по целевому контуру, у графика — сумма. Хранить регион
 * отдельно значило бы завести вторую версию правды, которая однажды разойдётся
 * с первой.
 */
export const migration: Migration = {
    id: 55,
    name: 'create_reporting_remd_interval_facts',
    upSql: `
    CREATE TABLE IF NOT EXISTS reporting_remd_interval_facts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        period_id UUID NOT NULL REFERENCES reporting_periods(id) ON DELETE CASCADE,
        coverage TEXT NOT NULL,
        month SMALLINT NOT NULL,
        organization_oid TEXT NOT NULL REFERENCES reporting_organizations(oid) ON DELETE CASCADE,
        semd_type_id UUID NOT NULL REFERENCES reporting_semd_types(id) ON DELETE CASCADE,
        document_count BIGINT NOT NULL DEFAULT 0,
        source_import_id UUID REFERENCES reporting_import_runs(id) ON DELETE SET NULL,
        source_name TEXT NOT NULL DEFAULT '',
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT reporting_remd_interval_facts_coverage_chk
            CHECK (coverage IN ('month', 'cumulative')),
        CONSTRAINT reporting_remd_interval_facts_month_chk
            CHECK (month BETWEEN 1 AND 12),
        CONSTRAINT reporting_remd_interval_facts_count_chk
            CHECK (document_count >= 0),
        CONSTRAINT reporting_remd_interval_facts_metadata_chk
            CHECK (jsonb_typeof(metadata) = 'object')
    );

    -- Повторная загрузка того же месяца заменяет только его: ключ включает
    -- и разновидность, и месяц, поэтому «янв-июль» не конфликтует с «июлем».
    CREATE UNIQUE INDEX IF NOT EXISTS reporting_remd_interval_facts_uidx
        ON reporting_remd_interval_facts(
            period_id, coverage, month, organization_oid, semd_type_id
        );

    -- Оба читателя ходят по периоду и разновидности: график берёт все месяцы
    -- сразу, показатель 27 — последний нарастающий.
    CREATE INDEX IF NOT EXISTS reporting_remd_interval_facts_period_idx
        ON reporting_remd_interval_facts(period_id, coverage, month);
    `,
}
