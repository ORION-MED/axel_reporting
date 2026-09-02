export function pickJoinKey(
    leftColumns: Iterable<string>,
    rightColumns: Iterable<string>,
    preferredKeys: string[],
): string | null {
    const left = new Set(leftColumns)
    const right = new Set(rightColumns)

    for (const key of preferredKeys) {
        if (left.has(key) && right.has(key)) {
            return key
        }
    }

    return null
}

export function assertSupportedJoinKey(
    leftTable: string,
    rightTable: string,
    leftColumns: Iterable<string>,
    rightColumns: Iterable<string>,
    preferredKeys: string[],
): string {
    const key = pickJoinKey(leftColumns, rightColumns, preferredKeys)
    if (key) return key

    throw new Error(
        `Unsupported join between "${leftTable}" and "${rightTable}": no common keys among [${preferredKeys.join(', ')}]`,
    )
}
