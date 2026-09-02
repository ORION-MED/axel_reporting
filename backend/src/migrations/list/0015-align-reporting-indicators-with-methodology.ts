import type { Migration } from '../migration.types'

export const migration: Migration = {
        id: 15,
        name: 'align_reporting_indicators_with_methodology',
        upSql: `
        UPDATE reporting_indicators
        SET title = 'Доля СЭМД «Эпикриз по законченному случаю амбулаторный» и (или) «Протокол консультации», зарегистрированных в РЭМД ЕГИСЗ, относительно количества случаев оказания ПМСП',
            formula_text = 'Дамб = (Кэпикриз + Кпротокол) / Кслучпмсп × 100',
            numerator_label = 'Все успешно зарегистрированные СЭМД «Эпикриз по законченному случаю амбулаторный» и «Протокол консультации»',
            denominator_label = 'Случаи оказания ПМСП в рамках ОМС по данным ФОМС',
            metadata = '{
                "contextSource": "Методики расчёта показателей по цифровизации здравоохранения.pdf",
                "methodologyPage": 31,
                "numeratorAggregation": "sum",
                "numeratorGroups": [
                    "Эпикриз по законченному случаю амбулаторный",
                    "Протокол консультации"
                ],
                "denominatorSource": "ФОМС",
                "denominatorLagMonths": 1,
                "periodicity": "monthly_cumulative",
                "annualBasis": "second_half"
            }'::jsonb,
            updated_at = now()
        WHERE id = 'semd_outpatient_epicrisis';

        UPDATE reporting_indicators
        SET title = 'Доля СЭМД «Результаты профилактического медицинского осмотра (диспансеризации)», зарегистрированных в РЭМД ЕГИСЗ, относительно количества обращений с профилактической целью',
            formula_text = 'До 01.01.2027: Ддисп = MAX(Крезультаты, Ксведения) / Кслучдисп × 100; с 01.01.2027: Ддисп = Крезультаты / Кслучдисп × 100',
            numerator_label = 'До 01.01.2027 — большее из количеств двух видов СЭМД; с 01.01.2027 — только СЭМД «Результаты профилактического медицинского осмотра (диспансеризации)»',
            denominator_label = 'Обращения с профилактической целью в рамках ОМС по данным ФОМС',
            metadata = '{
                "contextSource": "Методики расчёта показателей по цифровизации здравоохранения.pdf",
                "methodologyPage": 32,
                "numeratorAggregation": "max",
                "numeratorGroups": [
                    "Результаты профилактического медицинского осмотра (диспансеризации)",
                    "Сведения о результатах диспансеризации или профилактического медицинского осмотра"
                ],
                "rules": [
                    {
                        "from": "2027-01-01",
                        "numeratorAggregation": "single",
                        "numeratorGroup": "Результаты профилактического медицинского осмотра (диспансеризации)"
                    }
                ],
                "denominatorSource": "ФОМС",
                "denominatorLagMonths": 1,
                "periodicity": "monthly_cumulative",
                "annualBasis": "second_half"
            }'::jsonb,
            updated_at = now()
        WHERE id = 'semd_preventive_exam';

        UPDATE reporting_indicators
        SET title = 'Доля СЭМД «Эпикриз в стационаре выписной» и (или) «Выписной эпикриз из родильного дома», зарегистрированных в РЭМД ЕГИСЗ, относительно количества случаев стационарной помощи',
            formula_text = 'Дстац = (Кэпикризстац + Кэпикризроддом) / Кслучстац × 100',
            numerator_label = 'Все успешно зарегистрированные СЭМД «Эпикриз в стационаре выписной» и «Выписной эпикриз из родильного дома»',
            denominator_label = 'Случаи медицинской помощи в условиях стационаров в рамках ОМС по данным ФОМС',
            metadata = '{
                "contextSource": "Методики расчёта показателей по цифровизации здравоохранения.pdf",
                "methodologyPage": 33,
                "numeratorAggregation": "sum",
                "numeratorGroups": [
                    "Эпикриз в стационаре выписной",
                    "Выписной эпикриз из родильного дома"
                ],
                "denominatorSource": "ФОМС",
                "denominatorLagMonths": 1,
                "periodicity": "monthly_cumulative",
                "annualBasis": "second_half"
            }'::jsonb,
            updated_at = now()
        WHERE id = 'semd_inpatient_discharge';

        UPDATE reporting_indicators
        SET title = 'Доля СЭМД «Карта вызова скорой медицинской помощи», зарегистрированных в РЭМД ЕГИСЗ, относительно количества случаев оказания скорой медицинской помощи',
            formula_text = 'Дсмп = Ксэмдсмп / Кслучсмп × 100',
            numerator_label = 'Все успешно зарегистрированные СЭМД «Карта вызова скорой медицинской помощи»',
            denominator_label = 'Случаи оказания скорой медицинской помощи в рамках ОМС по данным ФОМС',
            metadata = '{
                "contextSource": "Методики расчёта показателей по цифровизации здравоохранения.pdf",
                "methodologyPage": 34,
                "numeratorAggregation": "sum",
                "numeratorGroups": [
                    "Карта вызова скорой медицинской помощи"
                ],
                "denominatorSource": "ФОМС",
                "denominatorLagMonths": 1,
                "periodicity": "monthly_cumulative",
                "annualBasis": "second_half"
            }'::jsonb,
            updated_at = now()
        WHERE id = 'semd_ambulance_call_card';

        UPDATE reporting_indicators
        SET title = 'Доля медицинских свидетельств о рождении, сформированных в форме ЭМД и зарегистрированных в РЭМД ЕГИСЗ',
            formula_text = 'Дмсррэмд = Кфмсррэмд / Кпмсрагс × 100',
            numerator_label = 'СЭМД «Медицинское свидетельство о рождении», зарегистрированные в РЭМД ЕГИСЗ',
            denominator_label = 'Акты гражданского состояния о рождении по данным ЕГР ЗАГС с применением критериев методики',
            metadata = '{
                "contextSource": "Методики расчёта показателей по цифровизации здравоохранения.pdf",
                "methodologyPage": 50,
                "numeratorAggregation": "sum",
                "numeratorGroups": [
                    "Медицинское свидетельство о рождении"
                ],
                "denominatorSource": "ЕГР ЗАГС",
                "denominatorFiltersRequired": [
                    "уникальный человек",
                    "дата рождения в отчетном периоде",
                    "исключить мертворожденных",
                    "исключить иностранцев",
                    "МО относится к ОУЗ"
                ],
                "periodicity": "monthly_cumulative",
                "annualBasis": "second_half"
            }'::jsonb,
            updated_at = now()
        WHERE id = 'semd_birth_certificate';
        `,
}
