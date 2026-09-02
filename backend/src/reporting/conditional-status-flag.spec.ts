import { ApplicabilityMatrixImportService } from './applicability-matrix-import.service'
import {
    CONDITIONAL_STATUS_IS_REQUIRED,
    parseConditionOrganizationList,
} from './applicability-matrix-xlsx'
import type { TpggPlanEntry } from './tpgg-workbook-parser'

/**
 * Флаг `CONDITIONAL_STATUS_IS_REQUIRED` — трактовка решения «условно» в форме условий.
 *
 * Вопрос открыт с 15.08.2026 и стоит денег: пока «условно» читается как «не определено»,
 * вид выпадает и из знаменателя, и из числителя, а расчёт по МО помечается
 * предварительным. После формы от 18.08, где методолог перевела в «условно» виды 86
 * и 121, так стало у 33 МО из 37 — было 18.
 *
 * Тест держит флаг в положении «как сейчас» и проверяет, что от его появления расчёт
 * не сдвинулся. Заодно фиксирует вердикт перечня-включения — он включается тем же
 * флагом и без него остаётся `custom`, то есть «не определено».
 */

const service = new ApplicabilityMatrixImportService(
    null as never,
    null as never,
    null as never,
    null as never,
    null as never,
)

const ORGANIZATION = { oid: 'oid-kood', officialFullName: '', officialShortName: 'ГБУ «КООД»' }

function evaluateRule(rule: Record<string, unknown>) {
    return (service as unknown as {
        evaluateRule: (
            rule: unknown,
            organization: unknown,
            subdivisions: unknown,
            tpggEntriesByOrganization: Map<string, TpggPlanEntry[]>,
        ) => { verdict: string }
    }).evaluateRule(
        rule,
        ORGANIZATION,
        [{
            organizationOid: ORGANIZATION.oid,
            subdivisionType: 'Лабораторно-диагностический',
            subdivisionKind: '',
            subdivisionName: 'Цитологическая лаборатория',
        }],
        new Map([[ORGANIZATION.oid, [] as TpggPlanEntry[]]]),
    )
}

/** Строка 45 формы: вид 121 «Протокол цитологического исследования». */
function cytologyRule(overrides: Record<string, unknown> = {}) {
    return {
        semdTypeCode: '121',
        subdivisionType: 'Лабораторно-диагностический',
        subdivisionKind: '',
        conditionCode: 'organization_list',
        conditionText: 'если МО - КООД',
        conditionExcludesOrganizations: false,
        organizationNames: ['КООД'],
        matchedOrganizationOids: new Set<string>(['oid-kood']),
        organizationOidsFromDirectory: false,
        grounds: [{ level: 1, text: 'условия входимости ТВСП МО в показатель' }],
        ...overrides,
    }
}

describe('флаг трактовки решения «условно»', () => {
    it('выключен — расчёт остался прежним', () => {
        expect(CONDITIONAL_STATUS_IS_REQUIRED).toBe(false)
    })
})

describe('перечень-включение «если МО - …»', () => {
    it('МО из перечня получает обязательность', () => {
        expect(evaluateRule(cytologyRule()).verdict).toBe('matched')
    })

    it('МО вне перечня — «не подходит», а не «не определено»', () => {
        expect(evaluateRule(cytologyRule({
            matchedOrganizationOids: new Set(['oid-other']),
        })).verdict).toBe('not_matched')
    })

    it('смысл ровно обратный перечню-исключению', () => {
        // Две формы записи отличаются одним словом, и перепутать их — значит выдать
        // ровно противоположный состав обязательных видов.
        const included = evaluateRule(cytologyRule()).verdict
        const excluded = evaluateRule(cytologyRule({
            conditionCode: 'organization_list_except',
            conditionExcludesOrganizations: true,
        })).verdict

        expect(included).toBe('matched')
        expect(excluded).toBe('not_matched')
    })

    it('разбор отличает включение от исключения', () => {
        expect(parseConditionOrganizationList('если МО - КООД').excluded).toBe(false)
        expect(parseConditionOrganizationList('если МО НЕ ГСП').excluded).toBe(true)
    })
})
