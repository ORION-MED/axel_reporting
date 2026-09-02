import { normalizeSemdName } from './emd-nsi-csv'
import { aggregateIntervalFacts } from './remd-interval-import.service'
import type { RemdNumeratorRow } from './remd-numerator-xlsx'

/**
 * Свод строк помесячной выгрузки РЭМД в факты «МО × вид».
 *
 * Главное, что здесь проверяется, — сложение. Широкий отчёт несёт разрез
 * по подразделениям, и один вид приходит у МО несколькими строками; «взять
 * последнюю» вместо «сложить» даёт правдоподобное, но заниженное число,
 * которое на графике выглядит как провал месяца.
 */

const PROTOCOL = 'Протокол консультации'
const EPICRISIS = 'Эпикриз в стационаре выписной'

const LOOKUP = {
    targetOrganizationOids: new Set(['1.2.3.1', '1.2.3.2']),
    activeOrganizationOids: new Set(['1.2.3.1', '1.2.3.2']),
    semdTypeIdByAlias: new Map([
        [normalizeSemdName(PROTOCOL), 'type-protocol'],
        [normalizeSemdName(EPICRISIS), 'type-epicrisis'],
    ]),
}

function row(overrides: Partial<RemdNumeratorRow> = {}): RemdNumeratorRow {
    return {
        organizationOid: '1.2.3.1',
        organizationName: 'ГБУ «МО 1»',
        subdivisionOid: '1.2.3.1.0.100',
        subdivisionName: 'Поликлиника',
        buildingId: '10',
        buildingName: 'Главный корпус',
        buildingAddress: 'г. Курган',
        documentTypeName: PROTOCOL,
        documentCount: 10,
        ...overrides,
    }
}

describe('aggregateIntervalFacts', () => {
    it('складывает строки подразделений в один факт МО', () => {
        const result = aggregateIntervalFacts(
            [
                row({ subdivisionOid: '1.2.3.1.0.100', documentCount: 10 }),
                row({ subdivisionOid: '1.2.3.1.0.200', documentCount: 7 }),
                row({ subdivisionOid: '', documentCount: 3 }),
            ],
            LOOKUP,
        )

        expect(result.facts).toEqual([
            {
                organizationOid: '1.2.3.1',
                semdTypeId: 'type-protocol',
                documentCount: 20,
            },
        ])
        expect(result.documentCount).toBe(20)
    })

    it('разные виды одной МО остаются разными фактами', () => {
        const result = aggregateIntervalFacts(
            [
                row({ documentTypeName: PROTOCOL, documentCount: 5 }),
                row({ documentTypeName: EPICRISIS, documentCount: 8 }),
            ],
            LOOKUP,
        )

        expect(result.facts).toHaveLength(2)
        expect(result.matchedTypeIds.size).toBe(2)
    })

    it('уникальные виды считаются по всем МО сразу', () => {
        // Это и есть числитель показателя 27: вид, зарегистрированный десятью МО,
        // в региональном числителе один.
        const result = aggregateIntervalFacts(
            [
                row({ organizationOid: '1.2.3.1', documentTypeName: PROTOCOL }),
                row({ organizationOid: '1.2.3.2', documentTypeName: PROTOCOL }),
            ],
            LOOKUP,
        )

        expect(result.matchedTypeIds.size).toBe(1)
        expect(result.matchedOrganizationOids.size).toBe(2)
        expect(result.facts).toHaveLength(2)
    })

    it('МО вне целевого контура пропускается молча', () => {
        // Чужой регион в выгрузке — не ошибка загрузки, показателя он не касается.
        const result = aggregateIntervalFacts(
            [row({ organizationOid: '9.9.9.9' })],
            LOOKUP,
        )

        expect(result.facts).toHaveLength(0)
        expect(result.unmatchedOrganizationOids.size).toBe(0)
    })

    it('целевая МО без записи в справочнике попадает в несопоставленные', () => {
        // Признак того, что числитель РЭМД (шаг 4) ещё не загружен: помесячные
        // выгрузки организаций не заводят.
        const result = aggregateIntervalFacts([row()], {
            ...LOOKUP,
            activeOrganizationOids: new Set(['1.2.3.2']),
        })

        expect(result.facts).toHaveLength(0)
        expect([...result.unmatchedOrganizationOids]).toEqual(['1.2.3.1'])
    })

    it('незнакомый «Вид МД» называется поимённо', () => {
        // Без имени методолог не поймёт, какой справочник обновлять.
        const result = aggregateIntervalFacts(
            [row({ documentTypeName: 'Справка неизвестного вида' })],
            LOOKUP,
        )

        expect([...result.unmatchedDocumentTypeNames])
            .toEqual(['Справка неизвестного вида'])
    })

    it('пустая выгрузка не даёт фактов', () => {
        const result = aggregateIntervalFacts([], LOOKUP)

        expect(result.facts).toHaveLength(0)
        expect(result.documentCount).toBe(0)
    })
})
