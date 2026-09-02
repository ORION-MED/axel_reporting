import type { Migration } from '../migration.types'

/**
 * Код условия `inpatient_or_day_hospital` — «оказание стационарной МП
 * или в условиях дневного стационара».
 *
 * До 28.08.2026 такая формулировка уходила в `day_hospital_group`, и проверка
 * искала только дневной стационар. Половина условия — про круглосуточный —
 * терялась молча: у вида 341 «Осмотр лечащим врачом» медорганизации
 * со стационарными отделениями, но без дневного стационара, оставались
 * необязанными.
 *
 * Нашла методолог 28.08.2026, пометив в матрице: «ГКУ "ШОПТД", Далматовская
 * ЦРБ — СЭМД отнесён во Внимание, но должен быть в Обязательных. В МО есть
 * стационарные отделения — это условие обязательности». Проверено по ФРМР:
 * стационарные подразделения у обеих есть — 48 и 74 строки.
 *
 * Формулировка встречается в матрице от 24.08 только у вида 341, в двух строках.
 * Остальные два правила с дневным стационаром — виды 1 и 389 — говорят именно
 * про дневные стационары, и для них прежний код верен.
 */
export const migration: Migration = {
    id: 64,
    name: 'allow_inpatient_or_day_hospital_condition',
    upSql: `
    DO $$
    BEGIN
        ALTER TABLE reporting_semd_applicability_rules
            DROP CONSTRAINT IF EXISTS reporting_semd_applicability_rules_condition_chk;
        ALTER TABLE reporting_semd_applicability_rules
            ADD CONSTRAINT reporting_semd_applicability_rules_condition_chk
            CHECK (condition_code IN (
                'none',
                'attached_population',
                'attached_child_population',
                'license_1080_1',
                'license_1080_4',
                'license_1090_4',
                'license_1090_5',
                'license_1090_6',
                'day_hospital_group',
                'inpatient_or_day_hospital',
                'specialized_organization',
                'llo_program',
                'organization_list',
                'organization_list_except',
                'custom'
            ));
    END $$;
    `,
}
