/** The bar series occupies the lower part of the shared chart area. */
export const BAR_BAND = 0.55
export const LINE_BAND_BOTTOM = 0.66
export const LINE_BAND_TOP = 0.94

export function barDomain(values: readonly (number | null)[]): [number, number] {
    const max = Math.max(0, ...values.filter((value): value is number => value !== null))
    return [0, max > 0 ? max / BAR_BAND : 1]
}

export function lineDomain(values: readonly (number | null)[]): [number, number] {
    const numbers = values.filter((value): value is number => value !== null)
    if (numbers.length === 0) return [0, 1]
    const min = Math.min(...numbers)
    const max = Math.max(...numbers)
    const spread = max - min || Math.max(Math.abs(max) * 0.1, 1)
    const range = spread / (LINE_BAND_TOP - LINE_BAND_BOTTOM)
    const bottom = min - LINE_BAND_BOTTOM * range
    return [bottom, bottom + range]
}

export const DYNAMICS_COLORS = {
    semd: '#9DC3E6',
    plan: '#A9D18E',
    execution: '#2F5597',
    ratio: '#7030A0',
    typeCount: '#16a34a',
} as const
