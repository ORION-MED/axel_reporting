export interface ValueGroup {
    key: string
    label: string
    values: string[]
}

function getGroupKey(raw: string): string {
    const s = raw.trim()
    if (!s) return '#'
    const ch = s[0]

    if (/\d/.test(ch)) return ch
    if (/[a-zа-яё]/i.test(ch)) return ch.toUpperCase()
    return '#'
}

function groupOrderKey(key: string): [number, string] {
    if (/^\d$/.test(key)) return [0, key]
    if (key === '#') return [2, key]
    return [1, key]
}

export function groupValuesByPrefix(values: string[]): ValueGroup[] {
    const uniqueSorted = Array.from(new Set(values.map((v) => String(v).trim()).filter(Boolean))).sort((a, b) =>
        a.localeCompare(b, 'ru', { numeric: true, sensitivity: 'base' }),
    )

    const map = new Map<string, string[]>()
    for (const value of uniqueSorted) {
        const key = getGroupKey(value)
        const arr = map.get(key)
        if (arr) {
            arr.push(value)
        } else {
            map.set(key, [value])
        }
    }

    return Array.from(map.entries())
        .sort((a, b) => {
            const [aOrder, aKey] = groupOrderKey(a[0])
            const [bOrder, bKey] = groupOrderKey(b[0])
            if (aOrder !== bOrder) return aOrder - bOrder
            return aKey.localeCompare(bKey, 'ru', { numeric: true, sensitivity: 'base' })
        })
        .map(([key, groupedValues]) => ({ key, label: key, values: groupedValues }))
}
