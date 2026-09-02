import type { ValueGroup } from './groupValues'

interface IcdRangeGroup {
    key: string
    from: number
    to: number
    label: string
}

const ICD9_RANGE_GROUPS: IcdRangeGroup[] = [
    { key: '001-139', from: 1, to: 139, label: '001–139' },
    { key: '140-239', from: 140, to: 239, label: '140–239' },
    { key: '240-279', from: 240, to: 279, label: '240–279' },
    { key: '280-289', from: 280, to: 289, label: '280–289' },
    { key: '290-319', from: 290, to: 319, label: '290–319' },
    { key: '320-389', from: 320, to: 389, label: '320–389' },
    { key: '390-459', from: 390, to: 459, label: '390–459' },
    { key: '460-519', from: 460, to: 519, label: '460–519' },
    { key: '520-579', from: 520, to: 579, label: '520–579' },
    { key: '580-629', from: 580, to: 629, label: '580–629' },
    { key: '630-679', from: 630, to: 679, label: '630–679' },
    { key: '680-709', from: 680, to: 709, label: '680–709' },
    { key: '710-739', from: 710, to: 739, label: '710–739' },
    { key: '740-759', from: 740, to: 759, label: '740–759' },
    { key: '760-779', from: 760, to: 779, label: '760–779' },
    { key: '780-799', from: 780, to: 799, label: '780–799' },
    { key: '800-999', from: 800, to: 999, label: '800–999' },
]

const EV_GROUP_LABEL = 'E/V'

function normalizeValues(values: string[]): string[] {
    return Array.from(new Set(values.map((v) => String(v).trim()).filter(Boolean))).sort((a, b) =>
        a.localeCompare(b, 'ru', { numeric: true, sensitivity: 'base' }),
    )
}

function extractIcdNumericPrefix(raw: string): number | null {
    const match = /^\D*(\d{1,3})/.exec(raw)
    if (!match?.[1]) return null
    return Number(match[1])
}

export function isIcdCategoryColumn(field?: string | null): boolean {
    if (!field) return false
    const col = field.split('.').pop()?.toLowerCase() ?? ''
    return /^icd_?(?:9)?code$/.test(col)
}

export function groupIcd9Values(values: string[]): ValueGroup[] {
    const uniqueSorted = normalizeValues(values)
    const grouped = new Map<string, ValueGroup>()

    for (const value of uniqueSorted) {
        const normalized = value.toUpperCase()
        const firstChar = normalized[0]

        if (firstChar === 'E' || firstChar === 'V') {
            const key = 'EV'
            const current = grouped.get(key)
            if (current) {
                current.values.push(value)
            } else {
                grouped.set(key, { key, label: EV_GROUP_LABEL, values: [value] })
            }
            continue
        }

        const numericPrefix = extractIcdNumericPrefix(normalized)
        const range = numericPrefix == null
            ? null
            : ICD9_RANGE_GROUPS.find((g) => numericPrefix >= g.from && numericPrefix <= g.to)

        const key = range?.key ?? 'OTHER'
        const label = range?.label ?? 'Прочие'
        const current = grouped.get(key)
        if (current) {
            current.values.push(value)
        } else {
            grouped.set(key, { key, label, values: [value] })
        }
    }

    const order = [...ICD9_RANGE_GROUPS.map((g) => g.key), 'EV', 'OTHER']
    return [...grouped.values()].sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key))
}
