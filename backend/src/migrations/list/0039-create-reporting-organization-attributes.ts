import type { Migration } from '../migration.types'

/**
 * Справочник признаков МО региона (ВКС 31.07: «справочник по списку медорганизаций
 * прикреплённого населения — вот его нужно сделать отдельно»). Файл получен от методолога
 * 04.08.2026 и закрывает сразу два признака: прикреплённое население (приоритет
 * обязательности 4) и лицензии на отдельные виды медпомощи (приоритет 3).
 *
 * До него оба перечня вытаскивались разбором текста из колонки «Комментарий методолога»
 * матрицы применимости. Разбор остаётся в коде — он источник первичного заполнения и
 * страховка, — но при наличии строки в этой таблице главнее справочник.
 *
 * Лицензии лежат в JSONB, а не колонками: перечень открытый, методолог прямо предложила
 * его дополнять («при отсутствии в перечне укажите виды лицензий, влияющие на показатели»),
 * и новая лицензия не должна требовать миграции. Ключ — код вида работ как в файле: «1090.4».
 *
 * Пустая таблица эквивалентна прежнему поведению: перечни берутся из комментариев матрицы.
 */
export const migration: Migration = {
    id: 39,
    name: 'create_reporting_organization_attributes',
    upSql: `
    CREATE TABLE IF NOT EXISTS reporting_organization_attributes (
        organization_oid TEXT PRIMARY KEY
            REFERENCES reporting_organizations(oid) ON DELETE CASCADE,
        display_short_name TEXT NOT NULL DEFAULT '',
        attached_population BOOLEAN NOT NULL DEFAULT FALSE,
        attached_child_population BOOLEAN NOT NULL DEFAULT FALSE,
        licenses JSONB NOT NULL DEFAULT '{}'::jsonb,
        note TEXT NOT NULL DEFAULT '',
        source_name TEXT NOT NULL DEFAULT '',
        source_import_id UUID REFERENCES reporting_import_runs(id) ON DELETE SET NULL,
        source_row_number INTEGER,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT reporting_organization_attributes_licenses_chk
            CHECK (jsonb_typeof(licenses) = 'object')
    );
    `,
}
