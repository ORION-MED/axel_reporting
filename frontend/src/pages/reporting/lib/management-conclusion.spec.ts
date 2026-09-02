import { describe, expect, it } from 'vitest'
import type { AchievabilityForecast, Anomaly } from './monthly-conclusion'
import { buildManagementVerdict } from './management-conclusion'

function forecast(
    overrides: Partial<AchievabilityForecast> = {},
): AchievabilityForecast {
    return {
        yearPlan: 3203456,
        factToDate: 1607806,
        factShare: 50.2,
        monthsWithFact: 8,
        monthsLeft: 4,
        bestMonth: 1,
        bestMonthFact: 269727,
        requiredPerMonth: 398913,
        ceiling: 2686714,
        ceilingShare: 83.9,
        achievable: false,
        ...overrides,
    }
}

const RHYTHM: Anomaly = { code: 'spike_and_drop', text: 'Ритм рваный.' }
const NO_DATA: Anomaly = { code: 'missing_execution', text: 'Реестров нет.' }

describe('управленческий вывод', () => {
    it('невыполнимый год перекрывает всё остальное', () => {
        // Обсуждать ритм работы, когда ёмкость года потеряна, поздно.
        const verdict = buildManagementVerdict(forecast(), [RHYTHM, NO_DATA])!
        expect(verdict.situation).toBe('unreachable')
        expect(verdict.text).toContain('возврат средств')
    })

    it('рваный ритм при достижимом плане ведёт к контролю', () => {
        const verdict = buildManagementVerdict(
            forecast({ achievable: true, requiredPerMonth: 100000 }),
            [RHYTHM],
        )!
        expect(verdict.situation).toBe('uneven')
    })

    it('достижимо, но темпом выше среднего — это «без запаса»', () => {
        // Средний месяц 200 976, требуется 250 000.
        const verdict = buildManagementVerdict(
            forecast({ achievable: true, requiredPerMonth: 250000 }),
            [],
        )!
        expect(verdict.situation).toBe('tight')
    })

    it('темп в пределах среднего отдельных мер не требует', () => {
        const verdict = buildManagementVerdict(
            forecast({ achievable: true, requiredPerMonth: 150000 }),
            [],
        )!
        expect(verdict.situation).toBe('on_track')
    })

    it('без прогноза и находок вывод не выдумывается', () => {
        expect(buildManagementVerdict(null, [])).toBeNull()
    })

    it('нехватка реестров вылезает, когда с планом всё в порядке', () => {
        const verdict = buildManagementVerdict(
            forecast({ achievable: true, requiredPerMonth: 150000 }),
            [NO_DATA],
        )!
        expect(verdict.situation).toBe('no_execution_data')
    })

    it('ни одна формулировка пока не подтверждена методологом', () => {
        // Николай: «управленческий вывод пока можно просто двоеточие поставить,
        // поработаем с экспертизой». Пока это так — в интерфейсе идёт пометка.
        const situations = [
            buildManagementVerdict(forecast(), []),
            buildManagementVerdict(forecast({ achievable: true, requiredPerMonth: 250000 }), []),
            buildManagementVerdict(forecast({ achievable: true, requiredPerMonth: 150000 }), []),
        ]
        expect(situations.every((verdict) => verdict?.draft)).toBe(true)
    })
})
