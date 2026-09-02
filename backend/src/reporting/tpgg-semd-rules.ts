import type { TpggPlanEntry } from './tpgg-workbook-parser'

export type TpggRequirementStatus =
    | 'required'
    | 'not_required'
    | 'unknown'

export interface TpggSemdRule {
    nsiTypeCode: string
    title: string
    sectionCodes: string[]
    zeroMeansNotRequired: boolean
}

export interface TpggRuleEvaluation {
    requirementStatus: TpggRequirementStatus
    reason: string
    rule: TpggSemdRule | null
    evidence: TpggPlanEntry[]
}

const PREVENTIVE_EXAM_SECTIONS = [
    '3.2',
    '3.3',
    '3.4',
    '3.5',
    '3.6',
    '3.7',
    '3.8',
    '3.9',
]

const INSTRUMENTAL_DIAGNOSTIC_SECTIONS = [
    '2.3',
    '2.4',
    '2.5',
    '2.6',
    '2.9',
    '2.16',
    '2.17',
    '2.18',
    '2.19',
    '2.26',
    '2.27',
    '2.30',
]

const LABORATORY_DIAGNOSTIC_SECTIONS = [
    '2.10',
    '2.13',
    '2.14',
    '2.25',
    '2.28',
    '2.29',
]

const OUTPATIENT_SECTIONS = ['2', '3', '4']

export const TPGG_SEMD_RULES: readonly TpggSemdRule[] = [
    {
        nsiTypeCode: '74',
        title: 'Карта вызова скорой медицинской помощи',
        sectionCodes: ['1'],
        zeroMeansNotRequired: true,
    },
    {
        nsiTypeCode: '85',
        title: 'Протокол консультации в рамках диспансерного наблюдения',
        sectionCodes: ['2.2'],
        zeroMeansNotRequired: true,
    },
    {
        nsiTypeCode: '12',
        title: 'Протокол прижизненного патолого-анатомического исследования',
        sectionCodes: ['2.7'],
        zeroMeansNotRequired: true,
    },
    {
        // Р10 (рекомендации 27.07, п.9.5): цитологические исследования идут по разделу
        // 2.7 ПАИ. В ТПГГ Курганской области на 2026 год положительный объём есть только
        // у ГБУ «КООД» и ГБУ «ШГБ» — остальным МО вид не обязателен.
        nsiTypeCode: '121',
        title: 'Протокол цитологического исследования',
        sectionCodes: ['2.7'],
        zeroMeansNotRequired: true,
    },
    {
        nsiTypeCode: '1',
        title: 'Выписной эпикриз стационара',
        sectionCodes: ['5'],
        zeroMeansNotRequired: true,
    },
    {
        nsiTypeCode: '381',
        title: 'Первичный осмотр врачом приемного отделения',
        sectionCodes: ['5'],
        zeroMeansNotRequired: true,
    },
    {
        nsiTypeCode: '350',
        title: 'Выписка из истории болезни',
        sectionCodes: ['5'],
        zeroMeansNotRequired: true,
    },
    {
        nsiTypeCode: '69',
        title: 'Медицинская группа для занятий физической культурой',
        sectionCodes: ['3.9'],
        zeroMeansNotRequired: true,
    },
    {
        nsiTypeCode: '141',
        title: 'Результаты диспансеризации или профилактического осмотра',
        sectionCodes: PREVENTIVE_EXAM_SECTIONS,
        zeroMeansNotRequired: true,
    },
    {
        nsiTypeCode: '340',
        title: 'Результаты профилактического медицинского осмотра',
        sectionCodes: PREVENTIVE_EXAM_SECTIONS,
        zeroMeansNotRequired: true,
    },
    {
        nsiTypeCode: '6',
        title: 'Протокол инструментального исследования',
        sectionCodes: INSTRUMENTAL_DIAGNOSTIC_SECTIONS,
        zeroMeansNotRequired: false,
    },
    {
        nsiTypeCode: '7',
        title: 'Протокол лабораторного исследования',
        sectionCodes: LABORATORY_DIAGNOSTIC_SECTIONS,
        zeroMeansNotRequired: false,
    },
    {
        nsiTypeCode: '107',
        title: 'Направление на лабораторное исследование',
        sectionCodes: LABORATORY_DIAGNOSTIC_SECTIONS,
        zeroMeansNotRequired: false,
    },
    {
        nsiTypeCode: '2',
        title: 'Эпикриз по законченному амбулаторному случаю',
        sectionCodes: OUTPATIENT_SECTIONS,
        zeroMeansNotRequired: false,
    },
    {
        nsiTypeCode: '5',
        title: 'Протокол консультации',
        sectionCodes: OUTPATIENT_SECTIONS,
        zeroMeansNotRequired: false,
    },
] as const

const RULE_BY_TYPE_CODE = new Map(
    TPGG_SEMD_RULES.map((rule) => [rule.nsiTypeCode, rule]),
)

export function evaluateTpggSemdRule(
    nsiTypeCode: string,
    organizationEntries: TpggPlanEntry[],
): TpggRuleEvaluation {
    const rule = RULE_BY_TYPE_CODE.get(String(nsiTypeCode ?? '').trim())
    if (!rule) {
        return {
            requirementStatus: 'unknown',
            reason:
                'В ТПГГ нет однозначного правила для этого вида СЭМД; требуется отдельная таблица применимости.',
            rule: null,
            evidence: [],
        }
    }

    const relevantEntries = organizationEntries.filter(
        (entry) => rule.sectionCodes.includes(entry.sheetCode),
    )
    const positiveEntries = relevantEntries.filter(
        (entry) => entry.annualValue > 0,
    )
    if (positiveEntries.length > 0) {
        return {
            requirementStatus: 'required',
            reason:
                `ТПГГ предусматривает положительный годовой объем по разделу: `
                + positiveEntries.map(
                    (entry) => `${entry.sheetName} (${entry.annualValue})`,
                ).join('; '),
            rule,
            evidence: relevantEntries,
        }
    }
    if (relevantEntries.length === 0) {
        return {
            requirementStatus: 'unknown',
            reason:
                'МО не найдена в однозначно связанных разделах ТПГГ.',
            rule,
            evidence: [],
        }
    }
    if (rule.zeroMeansNotRequired) {
        return {
            requirementStatus: 'not_required',
            reason:
                'Во всех однозначно связанных разделах ТПГГ годовой объем равен нулю.',
            rule,
            evidence: relevantEntries,
        }
    }
    return {
        requirementStatus: 'unknown',
        reason:
            'Положительный объем в связанных разделах ТПГГ не найден, но нулевой объем недостаточен для вывода «не требуется».',
        rule,
        evidence: relevantEntries,
    }
}
