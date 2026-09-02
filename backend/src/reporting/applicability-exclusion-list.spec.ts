import { ApplicabilityMatrixImportService } from './applicability-matrix-import.service'
import type { TpggPlanEntry } from './tpgg-workbook-parser'

/**
 * Вердикт правила с перечнем-исключением («если МО НЕ КОПАБ, КОБСМЭ, …»).
 *
 * Форма от 18.08.2026 — ответ методолога на Н21: протоколы лабораторного и
 * цитологического исследований не должны попадать в обязательные патолого-
 * анатомическому бюро и бюро СМЭ, у которых лаборатории в составе есть,
 * а классических лабораторных исследований они не выполняют.
 *
 * Перечень записан тем же синтаксисом, что и обычный («если МО - КООД»), и отличается
 * одним словом. Поэтому вердикт проверяется тестом, а не глазами: без инверсии
 * «обязателен всем, кроме пяти» превращается в «обязателен только этим пяти»,
 * и на карте это выглядит правдоподобно.
 */

const service = new ApplicabilityMatrixImportService(
    null as never,
    null as never,
    null as never,
    null as never,
    null as never,
)

const ORGANIZATION = { oid: 'oid-kopab', officialFullName: '', officialShortName: 'ГБУ «КОПАБ»' }

const LABORATORY_SUBDIVISION = {
    organizationOid: ORGANIZATION.oid,
    subdivisionType: 'Лабораторно-диагностический',
    subdivisionKind: '',
    subdivisionName: 'Клинико-диагностическая лаборатория',
}

function evaluateRule(
    rule: Record<string, unknown>,
    subdivisions: unknown[] = [LABORATORY_SUBDIVISION],
) {
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
        subdivisions,
        new Map([[ORGANIZATION.oid, [] as TpggPlanEntry[]]]),
    )
}

/** Строка 21 формы: вид 7 «Протокол лабораторного исследования». */
function laboratoryProtocolRule(overrides: Record<string, unknown> = {}) {
    return {
        semdTypeCode: '7',
        subdivisionType: 'Лабораторно-диагностический',
        subdivisionKind: '',
        conditionCode: 'organization_list_except',
        conditionText: 'если МО НЕ КОПАБ, КОБСМЭ, КОСПК, ГСП, КОЦМП',
        conditionExcludesOrganizations: true,
        organizationNames: ['КОПАБ', 'КОБСМЭ', 'КОСПК', 'ГСП', 'КОЦМП'],
        matchedOrganizationOids: new Set<string>(['oid-kopab', 'oid-kobsme']),
        organizationOidsFromDirectory: false,
        grounds: [{ level: 1, text: 'условия входимости ТВСП МО в показатель' }],
        ...overrides,
    }
}

describe('перечень-исключение в условии правила', () => {
    it('МО из перечня обязательности не получает', () => {
        expect(evaluateRule(laboratoryProtocolRule()).verdict).toBe('not_matched')
    })

    it('МО вне перечня обязательность получает', () => {
        expect(evaluateRule(laboratoryProtocolRule({
            matchedOrganizationOids: new Set(['oid-kobsme']),
        })).verdict).toBe('matched')
    })

    it('перечень не отменяет проверку подразделения', () => {
        // Исключение сужает состав, но не расширяет его: МО без лаборатории
        // протокол лабораторного исследования не формирует в любом случае.
        expect(evaluateRule(
            laboratoryProtocolRule({ matchedOrganizationOids: new Set<string>() }),
            [{
                organizationOid: ORGANIZATION.oid,
                subdivisionType: 'Амбулаторный',
                subdivisionKind: '',
                subdivisionName: 'Поликлиника',
            }],
        ).verdict).toBe('not_matched')
    })

    it('тот же перечень без флага работает по-прежнему — как перечень адресатов', () => {
        // Страховка от инверсии: если флаг потеряется по дороге, тест поймает это
        // здесь, а не на цифрах показателя.
        expect(evaluateRule(laboratoryProtocolRule({
            conditionCode: 'attached_population',
            conditionExcludesOrganizations: false,
        })).verdict).toBe('matched')
    })
})
