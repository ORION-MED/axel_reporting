import {
    buildSemdMonthlySeries,
    type MonthlySeriesFact,
    type MonthlySeriesPlan,
} from './semd-monthly-series'
import { toPercent, type SemdVolumeRatioConfig } from './semd-volume-ratio.calculator'

/**
 * Разрез по медорганизациям для двух дополнительных диаграмм дашборда (Д-25).
 *
 * ТЗ от 24.08.2026 просит «дополнительные диаграммы для визуализации связей /
 * корреляции данных», не называя их. Постановка уточнена с Ильёй 26.08:
 *
 * - **точечная диаграмма** «случаи против СЭМД», точка — медорганизация,
 *   с диагональю «на каждый случай оформлен документ»: отвечает на «кто отстаёт»;
 * - **тепловая карта** «медорганизация × месяц»: отвечает на «когда».
 *
 * **Почему связь ищется между медорганизациями, а не между месяцами.**
 * Помесячная роспись терпрограммы почти постоянна: за 2026 год размах между
 * минимальным и максимальным месяцем — 0,028 % (266 912 против 266 987).
 * Корреляция с практически константой вырождается: облако точек «месяц против
 * месяца» встало бы вертикальной полосой. Между медорганизациями разброс
 * настоящий — от 51 % до 225 %.
 *
 * **Кривая каждой МО считается тем же `buildSemdMonthlySeries`, что и общая.**
 * Своя реализация здесь однажды разошлась бы с диаграммой незаметно: у 6.1.3.2.9
 * числитель берёт максимум внутри МО, и повторить это правило второй раз —
 * значит завести второе место, где его можно забыть.
 */

export interface OrganizationBreakdownRow {
    organizationOid: string
    organizationName: string
    /** Доля СЭМД от плана по месяцам, индекс 0 — январь. `null` — данных нет. */
    monthlyRatios: Array<number | null>
    /**
     * Случаи, поданные на оплату в ТФОМС за срез исполнения.
     * `null` — реестров по этой МО фонд не прислал; это не ноль,
     * и на точечной диаграмме такой МО быть не должно вовсе.
     */
    caseFact: number | null
    /** СЭМД за те же месяцы среза. */
    semdInSlice: number | null
    /** Доля СЭМД от факта — вертикальное расстояние до диагонали. */
    percentOfFact: number | null
}

export interface OrganizationBreakdown {
    /** Границы среза исполнения; `null` — точечную диаграмму строить не из чего. */
    fromMonth: number | null
    toMonth: number | null
    rows: OrganizationBreakdownRow[]
}

export interface OrganizationBreakdownInput {
    config: SemdVolumeRatioConfig
    organizations: ReadonlyArray<{ oid: string; name: string }>
    facts: readonly MonthlySeriesFact[]
    plans: readonly MonthlySeriesPlan[]
    loadedMonths: readonly number[]
    /** Факт по реестрам ОМС: OID медорганизации → случаи за срез. */
    executionByOrganization: ReadonlyMap<string, number>
    fromMonth: number | null
    toMonth: number | null
}

export function buildOrganizationBreakdown(
    input: OrganizationBreakdownInput,
): OrganizationBreakdown {
    const hasSlice = input.fromMonth !== null && input.toMonth !== null
        && input.fromMonth <= input.toMonth

    const rows = input.organizations.map((organization) => {
        const points = buildSemdMonthlySeries({
            config: input.config,
            organizationOids: [organization.oid],
            facts: input.facts,
            plans: input.plans,
            loadedMonths: input.loadedMonths,
        })

        const caseFact = input.executionByOrganization.get(organization.oid) ?? null
        const semdInSlice = hasSlice
            ? points
                .filter((point) => point.month >= input.fromMonth!
                    && point.month <= input.toMonth!)
                .reduce((sum, point) => sum + (point.fact ?? 0), 0)
            : null

        return {
            organizationOid: organization.oid,
            organizationName: organization.name,
            monthlyRatios: points.map((point) => point.ratio),
            caseFact,
            semdInSlice,
            percentOfFact: caseFact !== null && caseFact > 0 && semdInSlice !== null
                ? toPercent(semdInSlice, caseFact)
                : null,
        }
    })

    return {
        fromMonth: hasSlice ? input.fromMonth : null,
        toMonth: hasSlice ? input.toMonth : null,
        rows,
    }
}
