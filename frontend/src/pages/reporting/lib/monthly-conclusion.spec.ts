import { describe, expect, it } from 'vitest'
import type {
    MonthlySeriesPoint,
    OrganizationBreakdown,
    OrganizationBreakdownRow,
} from '@shared/lib/reporting-api'
import {
    buildAchievabilityForecast,
    buildMonthlyConclusion,
    detectAnomalies,
} from './monthly-conclusion'

/**
 * `toLocaleString('ru-RU')` разделяет разряды неразрывным пробелом. В тексте это
 * ровно то, что нужно, но сравнивать с ним обычную строку нельзя — сверяем
 * по нормализованной.
 */
function plain(text: string): string {
    return text.replace(/[  ]/g, ' ')
}

function point(
    month: number,
    plan: number | null,
    fact: number | null,
): MonthlySeriesPoint {
    return {
        month,
        plan,
        fact,
        ratio: plan !== null && fact !== null
            ? Math.round((fact / plan) * 10000) / 100
            : null,
    }
}

function row(
    name: string,
    monthlyRatios: Array<number | null>,
    caseFact: number | null = 1000,
): OrganizationBreakdownRow {
    return {
        organizationOid: name,
        organizationName: name,
        monthlyRatios,
        caseFact,
        semdInSlice: 100,
        percentOfFact: 10,
    }
}

function breakdown(rows: OrganizationBreakdownRow[]): OrganizationBreakdown {
    return { fromMonth: 1, toMonth: 6, rows }
}

/**
 * Реальный ряд показателя 6.1.3.2.8 по региону на прогоне 31.08.2026: восемь
 * месяцев факта и годовой план, расписанный на все двенадцать. Именно этот
 * график Николай разбирал на созвоне и сказал по нему: «курганская поликлиника
 * номер один на план по СЭМДам в этом году уже не сможет выйти физически».
 */
const REGION_2026: MonthlySeriesPoint[] = [
    point(1, 266979, 269727),
    point(2, 266918, 231538),
    point(3, 266983, 194331),
    point(4, 266912, 195339),
    point(5, 266982, 243975),
    point(6, 266935, 127015),
    point(7, 266983, 177507),
    point(8, 266915, 168374),
    point(9, 266987, null),
    point(10, 266917, null),
    point(11, 266983, null),
    point(12, 266962, null),
]

/** Тот же ряд, но с сезонной росписью плана — чтобы правило ровного плана молчало. */
const SEASONAL_PLAN: MonthlySeriesPoint[] = REGION_2026.map(
    (p, index) => point(p.month, 200000 + index * 12000, p.fact),
)

describe('прогноз достижимости годового плана', () => {
    it('считает потолок по лучшему месяцу и признаёт план недостижимым', () => {
        const forecast = buildAchievabilityForecast(REGION_2026)!
        expect(forecast.yearPlan).toBe(3203456)
        expect(forecast.factToDate).toBe(1607806)
        expect(forecast.factShare).toBe(50.2)
        expect(forecast.bestMonth).toBe(1)
        expect(forecast.bestMonthFact).toBe(269727)
        expect(forecast.monthsLeft).toBe(4)
        // 1 607 806 + 269 727 × 4 = 2 686 714 из 3 203 456
        expect(forecast.ceiling).toBe(2686714)
        expect(forecast.ceilingShare).toBe(83.9)
        expect(forecast.achievable).toBe(false)
        expect(forecast.requiredPerMonth).toBe(398913)
    })

    it('оставшиеся месяцы считает по календарю, а не по числу выгрузок', () => {
        // Пропуск в середине года — это не будущее: наверстать его уже нельзя,
        // и добавлять пропущенный месяц в остаток значило бы завысить потолок.
        const withGap = REGION_2026.map(
            (p) => (p.month === 3 ? point(3, p.plan, null) : p),
        )
        expect(buildAchievabilityForecast(withGap)!.monthsLeft).toBe(4)
    })

    it('план в пределах лучшего месяца признаётся достижимым', () => {
        const strong = REGION_2026.map(
            (p) => (p.fact === null ? p : point(p.month, p.plan, 300000)),
        )
        expect(buildAchievabilityForecast(strong)!.achievable).toBe(true)
    })

    it('без плана прогноза нет', () => {
        // Показатель 27: знаменатель — перечень видов, а не объём терпрограммы.
        const noPlan = REGION_2026.map((p) => point(p.month, null, p.fact))
        expect(buildAchievabilityForecast(noPlan)).toBeNull()
    })

    it('без выгрузок прогноза нет', () => {
        const noFact = REGION_2026.map((p) => point(p.month, p.plan, null))
        expect(buildAchievabilityForecast(noFact)).toBeNull()
    })
})

describe('правила Д-33 — что настораживает', () => {
    it('находит всплеск и следующий за ним провал', () => {
        // Николай по этому месту: «а что за в мае за вспышка была? Что за нагоняй
        // был?» — и дальше про июнь: «прям расслабились».
        const [first] = detectAnomalies(SEASONAL_PLAN)
        expect(first.code).toBe('spike_and_drop')
        expect(plain(first.text)).toContain('Май — всплеск')
        expect(plain(first.text)).toContain('июнь — провал')
        expect(plain(first.text)).toContain('Ритм рваный')
    })

    it('последний месяц ряда провалом не объявляет', () => {
        // Выгрузку забирают среди месяца: августовская сформирована 27.08
        // и покрывает 01–26.08. Её столбик ниже июльского на 40 % просто потому,
        // что месяц не кончился, — на показателе 27 это давало ложный «провал».
        const running = [
            point(5, null, 895078),
            point(6, null, 796705),
            point(7, null, 1236272),
            point(8, null, 739952),
        ]
        expect(detectAnomalies(running).some((a) => a.code === 'spike_and_drop')).toBe(false)
    })

    it('провалом считает только соседние месяцы', () => {
        // Между июлем и сентябрём выгрузки за август нет: это дыра в данных,
        // а не падение работы.
        const gap = [
            point(7, 100000, 200000),
            point(9, 100000, 50000),
            point(10, 100000, 50000),
        ]
        expect(detectAnomalies(gap).some((a) => a.code === 'spike_and_drop')).toBe(false)
    })

    it('называет январский хвост', () => {
        const january = detectAnomalies(SEASONAL_PLAN)
            .find((item) => item.code === 'january_tail')!
        expect(plain(january.text)).toContain('Январь выбивается')
        expect(plain(january.text)).toContain('269 727')
        expect(plain(january.text)).toContain('добивают декабрь')
    })

    it('ровный январь хвостом не объявляет', () => {
        const even = SEASONAL_PLAN.map(
            (p) => (p.fact === null ? p : point(p.month, p.plan, 200000)),
        )
        expect(detectAnomalies(even).some((a) => a.code === 'january_tail')).toBe(false)
    })

    it('замечает формальную роспись плана', () => {
        // На данных региона размах 75 случаев из 266 954 — 0,03 %.
        const flat = detectAnomalies(REGION_2026).find((a) => a.code === 'flat_plan')!
        expect(plain(flat.text)).toContain('расписан ровно')
        expect(plain(flat.text)).toContain('сезонность в него не заложена')
    })

    it('сезонную роспись формальной не считает', () => {
        expect(detectAnomalies(SEASONAL_PLAN).some((a) => a.code === 'flat_plan')).toBe(false)
    })

    it('считает МО, перевалившие за 100 % плана, и называет рекордсмена', () => {
        // Николай ткнул в КОЦМП, КОСИБ и КОКД: «что это тут у них за 211 процентов?
        // Разбирайтесь».
        const rows = breakdown([
            row('КОЦМП', [2431.1, 1632, null, null, null, null]),
            row('КОСИБ', [99, 299, null, null, null, null]),
            row('МРБ5', [70, 80, null, null, null, null]),
        ])
        const found = detectAnomalies(SEASONAL_PLAN, rows)
            .find((a) => a.code === 'ratio_over_plan')!
        expect(plain(found.text)).toContain('2 МО из 3')
        expect(plain(found.text)).toContain('КОЦМП')
        expect(plain(found.text)).toContain('2 431,1 %')
        expect(plain(found.text)).toContain('январь')
    })

    it('без разреза по МО правила по МО молчат', () => {
        // При разрезе на одну организацию сравнивать её не с кем.
        const codes = detectAnomalies(SEASONAL_PLAN, null).map((a) => a.code)
        expect(codes).not.toContain('ratio_over_plan')
        expect(codes).not.toContain('missing_execution')
    })

    it('считает МО без реестров исполнения', () => {
        const rows = breakdown([
            row('МРБ1', [70], 1000),
            row('МРБ2', [70], null),
            row('МРБ3', [70], null),
        ])
        const found = detectAnomalies(SEASONAL_PLAN, rows)
            .find((a) => a.code === 'missing_execution')!
        expect(plain(found.text)).toContain('У 2 МО из 3')
        expect(plain(found.text)).toContain('это не ноль случаев')
    })

    it('ровный ряд не даёт находок', () => {
        const calm = SEASONAL_PLAN.map(
            (p) => (p.fact === null ? p : point(p.month, p.plan, 200000)),
        )
        expect(detectAnomalies(calm, breakdown([row('МРБ1', [70])]))).toEqual([])
    })
})

describe('текст под диаграммой', () => {
    it('четыре строки, последняя — черновик управленческого вывода', () => {
        const { lines } = buildMonthlyConclusion(REGION_2026)
        expect(lines.map((line) => line.label)).toEqual([
            'Что на графике',
            'Что настораживает',
            'Прогноз',
            'Управленческий вывод',
        ])
        // Текст берётся из справочника, но помечен как неподтверждённый:
        // формулировку даёт методолог.
        expect(lines[3].draft).toBe(true)
        expect(plain(lines[3].text)).toContain('возврат средств')
    })

    it('первая строка называет период, объём и долю годового плана', () => {
        const [first] = buildMonthlyConclusion(REGION_2026).lines
        expect(plain(first.text)).toContain('январь–август')
        expect(plain(first.text)).toContain('1 607 806')
        expect(plain(first.text)).toContain('50,2 %')
    })

    it('находки собираются в одну строку, но не больше трёх', () => {
        const rows = breakdown([
            row('КОЦМП', [2431.1, 1632, null, null, null, null], null),
            row('МРБ5', [70, 80, null, null, null, null], null),
        ])
        const line = buildMonthlyConclusion(REGION_2026, rows).lines[1]
        // Сработали все пять правил; в строку попадают три первых по цене.
        expect(detectAnomalies(REGION_2026, rows)).toHaveLength(5)
        expect(plain(line.text)).toContain('Ритм рваный')
        expect(plain(line.text)).toContain('Январь выбивается')
        expect(plain(line.text)).toContain('КОЦМП')
        expect(plain(line.text)).not.toContain('сезонность в него не заложена')
        expect(line.alarming).toBe(true)
    })

    it('без находок строка говорит о ровной работе', () => {
        const calm = SEASONAL_PLAN.map(
            (p) => (p.fact === null ? p : point(p.month, p.plan, 200000)),
        )
        const line = buildMonthlyConclusion(calm).lines[1]
        expect(line.label).toBe('Что настораживает')
        expect(plain(line.text)).toContain('Работа ровная')
        expect(line.alarming).toBe(false)
    })

    it('прогноз говорит «недостижим» и показывает обе цифры', () => {
        const line = buildMonthlyConclusion(REGION_2026).lines[2]
        expect(plain(line.text)).toContain('398 913')
        expect(plain(line.text)).toContain('269 727')
        expect(plain(line.text)).toContain('83,9 %')
        expect(plain(line.text)).toContain('недостижим')
        expect(line.alarming).toBe(true)
    })

    it('без плана строки прогноза нет, а факт всё равно назван', () => {
        const noPlan = REGION_2026.map((p) => point(p.month, null, p.fact))
        const { lines, forecast } = buildMonthlyConclusion(noPlan)
        expect(forecast).toBeNull()
        expect(lines.map((line) => line.label)).toEqual([
            'Что на графике',
            'Что настораживает',
            'Управленческий вывод',
        ])
        expect(plain(lines[0].text)).toContain('1 607 806')
    })

    it('без единой выгрузки текст не выдумывается', () => {
        const empty = REGION_2026.map((p) => point(p.month, p.plan, null))
        const { lines } = buildMonthlyConclusion(empty)
        expect(lines).toHaveLength(1)
        expect(plain(lines[0].text)).toContain('считать нечего')
    })
})
