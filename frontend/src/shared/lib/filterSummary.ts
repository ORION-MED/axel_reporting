export interface FilterSummaryInput {
    field: string
    operator: string
    value?: unknown
    valueFrom?: unknown
    valueTo?: unknown
}

export function formatFilterSummaryLabel(input: FilterSummaryInput): string {
    const op = input.operator

    if (op === 'isNull') return `${input.field}: Не заполнено`
    if (op === 'isNotNull') return `${input.field}: Заполнено`
    if (op === 'between') {
        return `${input.field}: ${input.valueFrom ?? '?'} - ${input.valueTo ?? '?'}`
    }
    if (op === 'ilike') return `${input.field}: содержит "${input.value ?? ''}"`
    if (op === 'categoryEquals') return `${input.field}: = '${input.value ?? ''}'`
    if (op === 'categoryNotEquals') return `${input.field}: != '${input.value ?? ''}'`

    const valuePart = input.value ?? ''
    return `${input.field}: ${op} ${valuePart}`.trim()
}
