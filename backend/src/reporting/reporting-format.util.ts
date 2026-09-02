import type { LocationPrecision } from './organization-geo'

export type ReportingBusinessStatus =
    | 'not_assessed'
    | 'target_met'
    | 'below_target'
    | 'critical'

export type ReportingImportMode = 'merge' | 'replace'

export function toNullableNumber(value: unknown): number | null {
    if (value === null || typeof value === 'undefined') return null
    const numberValue = Number(value)
    return Number.isFinite(numberValue) ? numberValue : null
}

/**
 * Календарная дата колонки `DATE` в виде «ГГГГ-ММ-ДД».
 *
 * Драйвер `pg` разбирает `DATE` в **локальную** полночь: '2026-08-31' становится
 * `new Date(2026, 7, 31)`. Прежняя реализация брала `toISOString()`, то есть
 * переводила этот момент в UTC, и восточнее Гринвича дата уезжала на день назад:
 * в Кургане (UTC+5) отчётная дата периода 2026-08-31 читалась как 2026-08-30.
 *
 * На стенде это не проявлялось — контейнер живёт в UTC, — а цена ошибки высокая:
 * от отчётной даты зависят выбор действующей редакции справочника видов СЭМД
 * и месяц накопительного плана ТПГГ. Обходили на местах потребления (разбирали
 * месяц из строки в `target-plan-fact-rows.ts` и
 * `semd-volume-ratio-calculation.service.ts`), а корень оставался.
 *
 * Поэтому берутся локальные компоненты: они возвращают ровно ту календарную дату,
 * которую драйвер прочитал из базы. Для `timestamptz` такая трактовка была бы
 * спорной, но сюда приходят только колонки `DATE` периода — время у них
 * отсутствует как факт.
 */
export function toDateString(value: unknown): string | null {
    if (!value) return null
    if (value instanceof Date) {
        const year = String(value.getFullYear()).padStart(4, '0')
        const month = String(value.getMonth() + 1).padStart(2, '0')
        const day = String(value.getDate()).padStart(2, '0')
        return `${year}-${month}-${day}`
    }
    return String(value).slice(0, 10)
}

export function toIsoString(value: unknown): string {
    if (value instanceof Date) return value.toISOString()
    return String(value)
}

export function toBusinessStatus(value: unknown): ReportingBusinessStatus {
    if (
        value === 'target_met'
        || value === 'below_target'
        || value === 'critical'
        || value === 'not_assessed'
    ) {
        return value
    }
    return 'not_assessed'
}

export function toLocationPrecision(value: unknown): LocationPrecision {
    if (
        value === 'exact'
        || value === 'street'
        || value === 'locality'
        || value === 'approximate'
        || value === 'unknown'
    ) {
        return value
    }
    return 'unknown'
}

export function cleanText(value: unknown, maxLength: number): string {
    if (typeof value !== 'string') return ''
    return value.trim().slice(0, maxLength)
}

export function mapCalculationDetails(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {}
}
