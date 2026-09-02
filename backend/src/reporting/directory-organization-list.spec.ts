import { ApplicabilityMatrixImportService } from './applicability-matrix-import.service'
import type { TpggPlanEntry } from './tpgg-workbook-parser'

/**
 * Откуда берётся перечень МО для условия правила («прикреплённое население»,
 * «при наличии лицензии…»).
 *
 * Источников два: разбор наименований из колонки «Комментарий методолога» и справочник
 * признаков МО. Проверка «нет наименований в комментарии → условие не определено»
 * была написана, когда источник был один, и на виде 68 («Заключение о результатах
 * медицинского освидетельствования лиц, желающих усыновить…») дала осечку: методолог
 * написала в комментарии «Перечень МО определяется по справочнику признаков МО»,
 * наименований не оставила — и вид ушёл в `unknown` у всех 37 МО, из-за чего расчёт
 * по каждой МО стал предварительным.
 */

const service = new ApplicabilityMatrixImportService(
    null as never,
    null as never,
    null as never,
    null as never,
    null as never,
)

const ORGANIZATION = { oid: 'oid-1', officialFullName: '', officialShortName: 'ГБУ «Тест»' }

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
        [{ organizationOid: 'oid-1', subdivisionType: 'Амбулаторный', subdivisionKind: '', subdivisionName: '' }],
        new Map([[ORGANIZATION.oid, [] as TpggPlanEntry[]]]),
    )
}

/** Правило вида 68: без ограничения по подразделению, условие — прикреплённое население. */
function attachedPopulationRule(overrides: Record<string, unknown> = {}) {
    return {
        semdTypeCode: '68',
        subdivisionType: '',
        subdivisionKind: '',
        conditionCode: 'attached_population',
        conditionText: 'Обязателен для МО с прикрепленным населением',
        organizationNames: [],
        matchedOrganizationOids: new Set<string>(),
        organizationOidsFromDirectory: false,
        grounds: [{ level: 4, text: 'наличие прикрепленного взрослого населения' }],
        ...overrides,
    }
}

describe('перечень МО для условия правила', () => {
    it('справочник закрывает условие, даже если в комментарии нет наименований', () => {
        expect(evaluateRule(attachedPopulationRule({
            organizationOidsFromDirectory: true,
            matchedOrganizationOids: new Set(['oid-1', 'oid-2']),
        })).verdict).toBe('matched')
    })

    it('МО вне перечня справочника — «не подходит», а не «не определено»', () => {
        expect(evaluateRule(attachedPopulationRule({
            organizationOidsFromDirectory: true,
            matchedOrganizationOids: new Set(['oid-2']),
        })).verdict).toBe('not_matched')
    })

    it('без справочника и без наименований условие по-прежнему не определено', () => {
        // Прежнее поведение: перечень взять неоткуда, и молча решать за методолога нельзя.
        expect(evaluateRule(attachedPopulationRule()).verdict).toBe('unknown')
    })

    it('перечень из комментария работает, когда справочник не загружен', () => {
        expect(evaluateRule(attachedPopulationRule({
            organizationNames: ['ГБУ «Тест»'],
            matchedOrganizationOids: new Set(['oid-1']),
        })).verdict).toBe('matched')
    })

    it('пустой перечень из справочника снимает условие, а не подвешивает его', () => {
        // Справочник загружен и условие покрывает, но ни одна МО ему не удовлетворяет.
        // Это ответ «ни у кого», а не «неизвестно»: иначе расчёт остался бы предварительным.
        expect(evaluateRule(attachedPopulationRule({
            organizationOidsFromDirectory: true,
            matchedOrganizationOids: new Set<string>(),
        })).verdict).toBe('not_matched')
    })

    /**
     * Обратный случай: перечень задан наименованиями, и ни одно не сопоставилось —
     * «Санаторий», которого среди 37 медорганизаций нет.
     *
     * До 25.08.2026 это давало «не подходит» у всех, то есть вид молча становился
     * необязательным всем: у ГКУ «КОБСМЭ» из шести правил «если МО - Бюро СМЭ»
     * выходило ноль обязательных видов, и по цифрам это неотличимо от честного нуля.
     * От такого исхода спасала блокировка импорта; теперь он невозможен сам по себе,
     * а блокировка понижена до предупреждения.
     */
    it('нераспознанный перечень по наименованиям подвешивает вид, а не снимает', () => {
        expect(evaluateRule(attachedPopulationRule({
            organizationNames: ['Санаторий'],
            organizationOidsFromDirectory: false,
            matchedOrganizationOids: new Set<string>(),
        })).verdict).toBe('unknown')
    })

    it('перечень-исключение без совпадений оставлен блокировке, а не подвешивается', () => {
        // «Исключать некого» означает, что правило действует на всех. Тихо ошибиться
        // здесь нельзя по другой причине: несопоставленное имя в исключении
        // блокирует импорт.
        expect(evaluateRule(attachedPopulationRule({
            organizationNames: ['Санаторий'],
            organizationOidsFromDirectory: false,
            conditionExcludesOrganizations: true,
            matchedOrganizationOids: new Set<string>(),
        })).verdict).toBe('matched')
    })
})
