import type { Migration } from '../migration.types'

/**
 * Код условия `license_1090_5` — освидетельствование на противопоказания
 * к управлению транспортным средством.
 *
 * Лицензия 1090.5 стоит в матрице у видов 8 и 475 с самого начала, но ветки
 * разбора для неё не было: `classifyCondition` знал 1080.1, 1080.4, 1090.4
 * и 1090.6, а пятый код молча уходил в «условия нет». Оба вида получались
 * обязательными всем — 33 медорганизациям вместо 17, у которых лицензия есть.
 *
 * Проверено по самому файлу от 24.08: во всей матрице встречается ровно пять
 * кодов лицензий, и 1090.5 — единственный, который не читался.
 *
 * На региональные показатели это не влияло: виды 8 и 475 не отображаются
 * на ЕПГУ и в 35 целевых видов 6.1.3.2.7 не входят. Искажалась карточка
 * медорганизации — шестнадцать МО видели два лишних обязательных вида.
 */
export const migration: Migration = {
    id: 62,
    name: 'allow_license_1090_5_condition',
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
                'specialized_organization',
                'llo_program',
                'organization_list',
                'organization_list_except',
                'custom'
            ));
    END $$;
    `,
}
