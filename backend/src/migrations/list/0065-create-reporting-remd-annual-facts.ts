import type { Migration } from '../migration.types'

/**
 * Итоги регистрации СЭМД за прошедший год — Д-28.
 *
 * Просьба методолога от 28.08.2026: «Надо загрузить СЭМДы 2025 года
 * (янв-декабрь). Это нам даст пул СЭМДов, которые были зарегистрированы
 * в 2025, но ещё не зарегистрированы в 2026 — и это зона ответственности МО.
 * Я предлагаю это сделать в странице детализации Видов. Добавить столбик
 * с количеством зарег. СЭМД и МО. Статус оставить тем же по итогу 2026».
 *
 * **Своя таблица, а не колонка года в фактах интервалов.** У тех зерно
 * «период × охват × месяц», и они живут внутри отчётного периода: помесячные
 * выгрузки нужны для кривой и пересчитываются вместе с ним. Прошлый год —
 * не факт периода, а справочный срез: он один на все периоды и не меняется.
 * Отсюда и ключ по году, без `period_id`, — как у терпрограммы и матрицы,
 * которые тоже применяются глобально.
 *
 * **Хранится разрез по медорганизациям, а не готовая сумма.** Методолог
 * просит показать и количество документов, и число МО; из суммы второе
 * не достать, а из разреза — оба.
 */
export const migration: Migration = {
    id: 65,
    name: 'create_reporting_remd_annual_facts',
    upSql: `
    CREATE TABLE IF NOT EXISTS reporting_remd_annual_facts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        reporting_year INTEGER NOT NULL,
        organization_oid TEXT NOT NULL,
        semd_type_id UUID NOT NULL
            REFERENCES reporting_semd_types(id) ON DELETE CASCADE,
        document_count BIGINT NOT NULL DEFAULT 0,
        source_import_id UUID REFERENCES reporting_import_runs(id) ON DELETE SET NULL,
        source_name TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE UNIQUE INDEX IF NOT EXISTS reporting_remd_annual_facts_uidx
        ON reporting_remd_annual_facts (reporting_year, organization_oid, semd_type_id);

    CREATE INDEX IF NOT EXISTS reporting_remd_annual_facts_year_idx
        ON reporting_remd_annual_facts (reporting_year, semd_type_id);
    `,
}
