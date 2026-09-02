import { ApplicabilityMatrixImportService } from './applicability-matrix-import.service'
import type { TpggPlanEntry } from './tpgg-workbook-parser'

/**
 * Вопросы 8.1 и 8.2 — две развилки в трактовке слов методолога, обе под флагами
 * со значением «как сейчас».
 *
 * 8.1: приоритеты обязательности работают «в режиме ИЛИ» — достаточно одного основания.
 *      Сейчас отсутствие объёма в ТПГГ снимает обязательность даже при выполненном
 *      основании уровня 1.
 * 8.2: «есть ФРМО, нет ФРМО — нас уже не интересует» — при буквальном прочтении
 *      для оснований уровня 1 проверку подразделения надо отключить.
 *
 * Тест держит оба флага выключенными и проверяет, что расчёт от их появления
 * не сдвинулся: правило проекта — расчёт не должен меняться молча.
 */

const service = new ApplicabilityMatrixImportService(
    null as never,
    null as never,
    null as never,
    null as never,
    null as never,
)

const ORGANIZATION = { oid: 'oid-1', officialFullName: '', officialShortName: 'ГБУ «Тест»' }

function evaluateRule(
    rule: Record<string, unknown>,
    subdivisions: Array<Record<string, unknown>>,
    tpggEntries: TpggPlanEntry[] = [],
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
        new Map([[ORGANIZATION.oid, tpggEntries]]),
    )
}

/** Правило с основанием уровня 1 и ограничением по типу подразделения. */
function entryGroundRule(overrides: Record<string, unknown> = {}) {
    return {
        semdTypeCode: '1',
        subdivisionType: 'Стационарный',
        subdivisionKind: '',
        conditionCode: 'none',
        organizationNames: [],
        matchedOrganizationOids: new Set<string>(),
        grounds: [{ level: 1, text: 'условия входимости ТВСП МО в показатель' }],
        ...overrides,
    }
}

const STATIONARY = [{
    organizationOid: ORGANIZATION.oid,
    subdivisionType: 'Стационарный',
    subdivisionKind: 'Терапевтические',
    subdivisionName: 'Терапия',
}]

describe('вопрос 8.2 — проверка подразделения в ФРМО при основании уровня 1', () => {
    it('подразделение есть — вид обязателен', () => {
        expect(evaluateRule(entryGroundRule(), STATIONARY).verdict).toBe('matched')
    })

    it('подразделения нет — вид не обязателен (текущее поведение, флаг выключен)', () => {
        // При включённом LEVEL_1_GROUND_SKIPS_FRMR_CHECK здесь стало бы matched:
        // это и есть цена вопроса 8.2, ради которой считается прогон.
        expect(evaluateRule(entryGroundRule(), []).verdict).toBe('not_matched')
    })

    it('правило без ограничения по подразделению проверку ФРМО не проходит вовсе', () => {
        const rule = entryGroundRule({ subdivisionType: '', subdivisionKind: '' })
        expect(evaluateRule(rule, []).verdict).toBe('matched')
    })
})

describe('вопрос 8.1 — ТПГГ против основания уровня 1', () => {
    /** У правила два основания: входимость по ФРМО (1) и объём по госзаданию (2). */
    function twoGroundRule() {
        return entryGroundRule({
            // Код 121 — цитология, контрольный кейс методолога: для неё нулевой объём
            // методически означает «не требуется».
            semdTypeCode: '121',
            grounds: [
                { level: 1, text: 'условия входимости ТВСП МО в показатель' },
                { level: 2, text: 'объём, утверждённый госзаданием' },
            ],
        })
    }

    it('подразделение есть, но объёма в ТПГГ нет — вид НЕ обязателен (текущее поведение)', () => {
        // Ровно это даёт контрольный результат по цитологии: обязательна только
        // у ГБУ «КООД» и ГБУ «ШГБ». При строгом ИЛИ здесь было бы matched
        // и цитология стала бы обязательной у 31 МО.
        expect(evaluateRule(twoGroundRule(), STATIONARY, []).verdict).toBe('not_matched')
    })

    it('правило без основания уровня 2 отсутствием ТПГГ не затрагивается', () => {
        expect(evaluateRule(entryGroundRule(), STATIONARY, []).verdict).toBe('matched')
    })
})
