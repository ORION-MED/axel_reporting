import type { Migration } from '../migration.types'

/**
 * Исполнение терпрограммы по реестрам ОМС — третья колонка карточки МО (Д-10).
 *
 * **Почему рядом с планом, а не в нём.** `reporting_tpgg_plan_values` хранит
 * утверждённые объёмы: одна строка на лист терпрограммы и медорганизацию,
 * с помесячной росписью. Исполнение приходит другой выгрузкой, другим файлом
 * и другим срезом (январь-июнь против года), и дописывать его колонкой в план
 * значило бы, что переимпорт терпрограммы стирает исполнение — они грузятся
 * порознь.
 *
 * **Помесячной разбивки здесь нет и не будет в ближайшее время.** Все шестнадцать
 * файлов фонда — один срез за 01.01–30.06.2026, проверено поиском названий
 * месяцев по всем листам. Поэтому вместо месяца хранится интервал: он и стоит
 * подписью в карточке («Факт ТПГГ (случаев), январь-июнь»). Если фонд начнёт
 * присылать помесячно, интервал станет месяцем без изменения таблицы.
 *
 * **Год, а не период.** Так же читается и план: терпрограмма годовая и может быть
 * загружена в другом периоде того же года. Правило одно на обе таблицы —
 * последняя загрузка года вытесняет предыдущие.
 */
export const migration: Migration = {
    id: 56,
    name: 'create_reporting_tpgg_execution_values',
    upSql: `
    CREATE TABLE IF NOT EXISTS reporting_tpgg_execution_values (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        period_id UUID NOT NULL REFERENCES reporting_periods(id) ON DELETE CASCADE,
        reporting_year INTEGER NOT NULL,
        organization_oid TEXT REFERENCES reporting_organizations(oid) ON DELETE SET NULL,
        organization_name TEXT NOT NULL,
        normalized_organization_name TEXT NOT NULL,
        sheet_code TEXT NOT NULL,
        plan_value NUMERIC NOT NULL DEFAULT 0,
        fact_value NUMERIC NOT NULL DEFAULT 0,
        -- Границы среза исполнения; месяцами, а не датами: подпись в карточке
        -- называет месяцы, а день фонд и так ставит первым и последним.
        from_month SMALLINT,
        to_month SMALLINT,
        source_import_id UUID NOT NULL
            REFERENCES reporting_import_runs(id) ON DELETE CASCADE,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT reporting_tpgg_execution_values_year_chk
            CHECK (reporting_year BETWEEN 2000 AND 2100),
        CONSTRAINT reporting_tpgg_execution_values_month_chk
            CHECK (
                (from_month IS NULL OR from_month BETWEEN 1 AND 12)
                AND (to_month IS NULL OR to_month BETWEEN 1 AND 12)
            ),
        CONSTRAINT reporting_tpgg_execution_values_metadata_chk
            CHECK (jsonb_typeof(metadata) = 'object')
    );

    -- Повторная загрузка того же файла заменяет свои строки, а не удваивает их.
    -- Ключ без импорта: смысл строки — «исполнение листа X у МО Y в году Z».
    CREATE UNIQUE INDEX IF NOT EXISTS reporting_tpgg_execution_values_uidx
        ON reporting_tpgg_execution_values(
            reporting_year, sheet_code, normalized_organization_name
        );

    CREATE INDEX IF NOT EXISTS reporting_tpgg_execution_values_org_idx
        ON reporting_tpgg_execution_values(reporting_year, organization_oid);
    `,
}
