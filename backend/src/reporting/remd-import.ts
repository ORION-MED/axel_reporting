import { BadRequestException } from '@nestjs/common'
import * as ExcelJS from 'exceljs'

export type RemdAggregationStrategy = 'sum' | 'max'

export interface RemdMatchedColumn {
    index: number
    header: string
    sum: number
}

export interface RemdMatchedValueColumn {
    index: number
    header: string
}

export interface RemdMatchedGroup {
    key: string
    label: string
    sum: number
    selected: boolean
    columns: RemdMatchedColumn[]
}

export interface RemdExtractedItem {
    indicatorId: string
    numerator: number
    denominator: number | null
    targetValue: number | null
    denominatorColumn: RemdMatchedColumn | null
    targetColumn: RemdMatchedValueColumn | null
    aggregation: RemdAggregationStrategy
    columns: RemdMatchedColumn[]
    groups: RemdMatchedGroup[]
    organizations: Array<{
        oid: string
        name: string
        numerator: number
        components: Record<string, number>
        denominator?: number | null
        targetValue?: number | null
    }>
}

export interface RemdExtractResult {
    organizationRows: number
    items: RemdExtractedItem[]
    warnings: string[]
}

interface RemdColumnGroup {
    key: string
    label: string
    aliases: string[]
}

interface RemdImportMapping {
    indicatorId: string
    aggregation: RemdAggregationStrategy
    columnGroups: RemdColumnGroup[]
    denominatorAliases: string[]
    targetAliases: string[]
    rules?: Array<{
        from: string
        aggregation: RemdAggregationStrategy
        groupKeys: string[]
    }>
}

interface ResolvedRemdImportMapping {
    indicatorId: string
    aggregation: RemdAggregationStrategy
    columnGroups: RemdColumnGroup[]
    denominatorAliases: string[]
    targetAliases: string[]
}

export interface RemdIndicatorCalculationRule {
    aggregation: RemdAggregationStrategy
    groupKeys: string[]
}

interface RemdHeader {
    index: number
    header: string
    normalized: string
}

interface RemdOrganizationRow {
    rowNumber: number
    name: string
    oid: string
}

const REMD_IMPORT_MAPPINGS: RemdImportMapping[] = [
    {
        indicatorId: 'semd_outpatient_epicrisis',
        aggregation: 'sum',
        denominatorAliases: [
            'Знаменатель 6.1.3.2.8',
            'Знаменатель показателя 6.1.3.2.8',
        ],
        targetAliases: [
            'Целевое значение 6.1.3.2.8, %',
            'Цель 6.1.3.2.8, %',
        ],
        columnGroups: [
            {
                key: 'outpatient_epicrisis',
                label: 'Эпикриз по законченному случаю амбулаторный',
                aliases: [
                    'Эпикриз по законченному случаю амбулаторный',
                    'Эпикриз по законченному случаю в амбулаторных условиях',
                    'Талон амбулаторного пациента',
                ],
            },
            {
                key: 'consultation_protocol',
                label: 'Протокол консультации',
                aliases: ['Протокол консультации'],
            },
        ],
    },
    {
        indicatorId: 'semd_preventive_exam',
        aggregation: 'max',
        denominatorAliases: [
            'Знаменатель 6.1.3.2.9',
            'Знаменатель показателя 6.1.3.2.9',
        ],
        targetAliases: [
            'Целевое значение 6.1.3.2.9, %',
            'Цель 6.1.3.2.9, %',
        ],
        columnGroups: [
            {
                key: 'preventive_exam_results',
                label: 'Результаты профилактического медицинского осмотра (диспансеризации)',
                aliases: [
                    'Результаты профилактического медицинского осмотра (диспансеризации)',
                    'Результаты профилактического медицинского осмотра / диспансеризации',
                    'Результат профилактического медицинского осмотра и диспансеризации',
                    'Эпикриз по результатам диспансеризации / профилактического медицинского осмотра',
                ],
            },
            {
                key: 'preventive_exam_information',
                label: 'Сведения о результатах диспансеризации или профилактического медицинского осмотра',
                aliases: [
                    'Сведения о результатах диспансеризации или профилактического медицинского осмотра',
                    'Сведения о результатах диспансеризации / профилактического медицинского осмотра',
                ],
            },
        ],
        rules: [
            {
                from: '2027-01-01',
                aggregation: 'sum',
                groupKeys: ['preventive_exam_results'],
            },
        ],
    },
    {
        indicatorId: 'semd_inpatient_discharge',
        aggregation: 'sum',
        denominatorAliases: [
            'Знаменатель 6.1.3.2.10',
            'Знаменатель показателя 6.1.3.2.10',
        ],
        targetAliases: [
            'Целевое значение 6.1.3.2.10, %',
            'Цель 6.1.3.2.10, %',
        ],
        columnGroups: [
            {
                key: 'inpatient_discharge',
                label: 'Эпикриз в стационаре выписной',
                aliases: [
                    'Эпикриз в стационаре выписной',
                    'Выписной эпикриз из стационара',
                    'Эпикриз в стационаре выписной (онкологический)',
                ],
            },
            {
                key: 'maternity_discharge',
                label: 'Выписной эпикриз из родильного дома',
                aliases: ['Выписной эпикриз из родильного дома'],
            },
        ],
    },
    {
        indicatorId: 'semd_ambulance_call_card',
        aggregation: 'sum',
        denominatorAliases: [
            'Знаменатель 6.1.3.2.11',
            'Знаменатель показателя 6.1.3.2.11',
        ],
        targetAliases: [
            'Целевое значение 6.1.3.2.11, %',
            'Цель 6.1.3.2.11, %',
        ],
        columnGroups: [
            {
                key: 'ambulance_call_card',
                label: 'Карта вызова скорой медицинской помощи',
                aliases: [
                    'Карта вызова скорой медицинской помощи',
                    'Карта вызова СМП',
                ],
            },
        ],
    },
    {
        indicatorId: 'semd_birth_certificate',
        aggregation: 'sum',
        denominatorAliases: [
            'Знаменатель 6.1.3.2.12',
            'Знаменатель показателя 6.1.3.2.12',
        ],
        targetAliases: [
            'Целевое значение 6.1.3.2.12, %',
            'Цель 6.1.3.2.12, %',
        ],
        columnGroups: [
            {
                key: 'birth_certificate',
                label: 'Медицинское свидетельство о рождении',
                aliases: ['Медицинское свидетельство о рождении'],
            },
        ],
    },
    {
        indicatorId: 'semd_death_certificate',
        aggregation: 'sum',
        denominatorAliases: [
            'Знаменатель 6.1.3.2.13',
            'Знаменатель показателя 6.1.3.2.13',
        ],
        targetAliases: [
            'Целевое значение 6.1.3.2.13, %',
            'Цель 6.1.3.2.13, %',
        ],
        columnGroups: [
            {
                key: 'death_certificate',
                label: 'Медицинское свидетельство о смерти',
                aliases: [
                    'Медицинское свидетельство о смерти',
                    'Документ, содержащий сведения медицинского свидетельства о смерти в бумажной форме',
                    'Медицинское свидетельство о перинатальной смерти',
                    'Документ, содержащий сведения медицинского свидетельства о перинатальной смерти в бумажной форме',
                ],
            },
        ],
    },
]

export function extractRemdNumerators(
    worksheet: ExcelJS.Worksheet,
    reportingDate?: string | null,
): RemdExtractResult {
    const headerLocation = findRemdHeader(worksheet)
    if (!headerLocation) {
        throw new BadRequestException('Не найдена строка заголовков РЭМД-отчета')
    }

    const headers: RemdHeader[] = []
    worksheet.getRow(headerLocation.rowNumber).eachCell({ includeEmpty: false }, (cell, index) => {
        const header = cellToText(cell)
        if (header) {
            headers.push({
                index,
                header,
                normalized: normalizeHeader(header),
            })
        }
    })

    const warnings: string[] = []
    const organizations = listRemdOrganizationRows(
        worksheet,
        headerLocation.rowNumber,
        headerLocation.organizationNameColumn,
        headerLocation.organizationOidColumn,
    )
    const duplicateOrganizationRows = organizations.length
        - new Set(organizations.map((organization) => organization.oid)).size
    if (duplicateOrganizationRows > 0) {
        warnings.push(
            `Найдены повторяющиеся строки МО с одинаковым OID: ${duplicateOrganizationRows}; их значения суммированы.`,
        )
    }
    const namesByOid = new Map<string, Set<string>>()
    for (const organization of organizations) {
        const names = namesByOid.get(organization.oid) ?? new Set<string>()
        names.add(organization.name)
        namesByOid.set(organization.oid, names)
    }
    const conflictingOrganizationNames = Array.from(namesByOid.entries())
        .filter(([, names]) => names.size > 1)
    if (conflictingOrganizationNames.length > 0) {
        warnings.push(
            `Для ${conflictingOrganizationNames.length} OID найдены разные названия МО; использовано название из первой строки.`,
        )
    }

    const items = REMD_IMPORT_MAPPINGS.map((mapping) => {
        const resolved = resolveMapping(mapping, reportingDate, warnings)
        const groups: Array<{
            key: string
            label: string
            columns: RemdMatchedColumn[]
            sum: number
        }> = []
        let hasMissingRequiredGroup = false

        for (const group of resolved.columnGroups) {
            const matched = findColumnsByAliases(headers, group.aliases)
            if (matched.length === 0) {
                warnings.push(
                    `Показатель ${mapping.indicatorId} не рассчитан: не найдена обязательная колонка «${group.label}».`,
                )
                hasMissingRequiredGroup = true
                continue
            }

            const columns = matched.map((header) => {
                validateNumericColumn(
                    worksheet,
                    header,
                    organizations,
                    {
                        label: `числитель «${group.label}»`,
                        min: 0,
                    },
                )
                return {
                    index: header.index,
                    header: header.header,
                    sum: sumNumericColumn(
                        worksheet,
                        header.index,
                        headerLocation.rowNumber + 1,
                        headerLocation.organizationNameColumn,
                        headerLocation.organizationOidColumn,
                    ),
                }
            })
            groups.push({
                key: group.key,
                label: group.label,
                columns,
                sum: columns.reduce((sum, column) => sum + column.sum, 0),
            })
        }

        if (hasMissingRequiredGroup || groups.length === 0) {
            return null
        }

        const selectedGroupKeys = selectGroupKeys(groups, resolved.aggregation)
        const selectedGroupKeySet = new Set(selectedGroupKeys)
        const numerator = groups
            .filter((group) => selectedGroupKeySet.has(group.key))
            .reduce((sum, group) => sum + group.sum, 0)
        const denominatorHeader = findSingleOptionalColumn(
            headers,
            resolved.denominatorAliases,
            mapping.indicatorId,
            'знаменателя',
            warnings,
        )
        const targetHeader = findSingleOptionalColumn(
            headers,
            resolved.targetAliases,
            mapping.indicatorId,
            'целевого значения',
            warnings,
        )
        const denominatorValidation = denominatorHeader
            ? validateNumericColumn(
                worksheet,
                denominatorHeader,
                organizations,
                {
                    label: `знаменатель ${mapping.indicatorId}`,
                    min: 0,
                },
            )
            : null
        if (denominatorValidation && denominatorValidation.missingCount > 0) {
            warnings.push(
                `Показатель ${mapping.indicatorId}: пустой знаменатель у ${denominatorValidation.missingCount} строк МО; региональный процент не рассчитан.`,
            )
        }
        if (denominatorValidation && denominatorValidation.zeroCount > 0) {
            warnings.push(
                `Показатель ${mapping.indicatorId}: нулевой знаменатель у ${denominatorValidation.zeroCount} строк МО; для этих МО процент не рассчитан.`,
            )
        }
        const targetValidation = targetHeader
            ? validateNumericColumn(
                worksheet,
                targetHeader,
                organizations,
                {
                    label: `целевое значение ${mapping.indicatorId}`,
                    min: 0,
                    max: 100,
                },
            )
            : null
        if (targetValidation && targetValidation.missingCount > 0) {
            warnings.push(
                `Показатель ${mapping.indicatorId}: целевое значение не заполнено у ${targetValidation.missingCount} строк МО.`,
            )
        }
        const denominatorColumn = denominatorHeader
            ? {
                index: denominatorHeader.index,
                header: denominatorHeader.header,
                sum: sumNumericColumn(
                    worksheet,
                    denominatorHeader.index,
                    headerLocation.rowNumber + 1,
                    headerLocation.organizationNameColumn,
                    headerLocation.organizationOidColumn,
                ),
            }
            : null
        const targetValues = targetHeader
            ? listNumericColumnValues(worksheet, targetHeader.index, organizations)
            : []
        const uniqueTargetValues = [...new Set(targetValues)]
        if (uniqueTargetValues.length > 1) {
            warnings.push(
                `Показатель ${mapping.indicatorId}: в колонке целевого значения найдены разные значения; использовано первое.`,
            )
        }
        const targetValue = uniqueTargetValues[0] ?? null

        return {
            indicatorId: resolved.indicatorId,
            numerator,
            denominator: denominatorColumn && denominatorValidation?.missingCount === 0
                ? denominatorColumn.sum
                : null,
            targetValue,
            denominatorColumn,
            targetColumn: targetHeader
                ? { index: targetHeader.index, header: targetHeader.header }
                : null,
            aggregation: resolved.aggregation,
            columns: groups.flatMap((group) => group.columns),
            groups: groups.map((group) => ({
                ...group,
                selected: selectedGroupKeySet.has(group.key),
            })),
            organizations: buildOrganizationValues(
                worksheet,
                organizations,
                groups,
                selectedGroupKeySet,
                denominatorHeader?.index ?? null,
                targetHeader?.index ?? null,
            ),
        } satisfies RemdExtractedItem
    }).filter((item): item is RemdExtractedItem => item !== null)

    if (items.length === 0) {
        throw new BadRequestException('В Excel-файле не найдены все обязательные колонки ни для одного MVP-показателя')
    }

    return {
        organizationRows: organizations.length,
        items,
        warnings,
    }
}

export function getRemdIndicatorCalculationRule(
    indicatorId: string,
    reportingDate?: string | null,
): RemdIndicatorCalculationRule | null {
    const mapping = REMD_IMPORT_MAPPINGS.find((candidate) => candidate.indicatorId === indicatorId)
    if (!mapping) return null
    const resolved = resolveMapping(mapping, reportingDate, [])
    return {
        aggregation: resolved.aggregation,
        groupKeys: resolved.columnGroups.map((group) => group.key),
    }
}

function resolveMapping(
    mapping: RemdImportMapping,
    reportingDate: string | null | undefined,
    warnings: string[],
): ResolvedRemdImportMapping {
    if (!mapping.rules || mapping.rules.length === 0) {
        return mapping
    }

    const normalizedDate = normalizeReportingDate(reportingDate)
    if (!normalizedDate) {
        warnings.push(
            `Для показателя ${mapping.indicatorId} не указана дата отчетного периода; применено правило методики до 01.01.2027.`,
        )
        return mapping
    }

    const applicableRule = [...mapping.rules]
        .sort((left, right) => right.from.localeCompare(left.from))
        .find((rule) => normalizedDate >= rule.from)

    if (!applicableRule) {
        return mapping
    }

    const groupKeySet = new Set(applicableRule.groupKeys)
    return {
        indicatorId: mapping.indicatorId,
        aggregation: applicableRule.aggregation,
        columnGroups: mapping.columnGroups.filter((group) => groupKeySet.has(group.key)),
        denominatorAliases: mapping.denominatorAliases,
        targetAliases: mapping.targetAliases,
    }
}

function normalizeReportingDate(value: string | null | undefined): string | null {
    if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
    return value
}

function selectGroupKeys(
    groups: Array<{ key: string; sum: number }>,
    aggregation: RemdAggregationStrategy,
): string[] {
    if (aggregation === 'sum') {
        return groups.map((group) => group.key)
    }

    let selected = groups[0]
    for (const group of groups.slice(1)) {
        if (group.sum > selected.sum) {
            selected = group
        }
    }
    return [selected.key]
}

function findRemdHeader(worksheet: ExcelJS.Worksheet): {
    rowNumber: number
    organizationNameColumn: number
    organizationOidColumn: number
} | null {
    const maxRows = Math.min(worksheet.rowCount, 10)
    for (let rowNumber = 1; rowNumber <= maxRows; rowNumber += 1) {
        const row = worksheet.getRow(rowNumber)
        let organizationNameColumn: number | null = null
        let organizationOidColumn: number | null = null

        row.eachCell({ includeEmpty: false }, (cell, columnNumber) => {
            const text = normalizeHeader(cellToText(cell))
            if (text.includes('наименование медицинской организации')) {
                organizationNameColumn = columnNumber
            }
            if (text.includes('oid медицинской организации')) {
                organizationOidColumn = columnNumber
            }
        })

        if (organizationNameColumn !== null && organizationOidColumn !== null) {
            return {
                rowNumber,
                organizationNameColumn,
                organizationOidColumn,
            }
        }
    }
    return null
}

function findColumnsByAliases(headers: RemdHeader[], aliases: string[]): RemdHeader[] {
    const normalizedAliases = aliases.map(normalizeHeader)
    return headers.filter((header) => {
        return normalizedAliases.some((alias) => headerMatchesAlias(header.normalized, alias))
    })
}

function findSingleOptionalColumn(
    headers: RemdHeader[],
    aliases: string[],
    indicatorId: string,
    valueLabel: string,
    warnings: string[],
): RemdHeader | null {
    const matched = findColumnsByAliases(headers, aliases)
    if (matched.length > 1) {
        warnings.push(
            `Показатель ${indicatorId}: найдено несколько колонок ${valueLabel}; использована «${matched[0].header}».`,
        )
    }
    return matched[0] ?? null
}

function headerMatchesAlias(header: string, alias: string): boolean {
    if (header === alias) return true

    if (header.startsWith(`${alias} `)) {
        const suffix = header.slice(alias.length).trim()
        return /^(?:oid|код|версия|редакция)\b/.test(suffix)
    }

    if (header.endsWith(` ${alias}`)) {
        const prefix = header.slice(0, -alias.length).trim()
        return /^(?:oid|код)\b/.test(prefix)
    }

    return false
}

function listRemdOrganizationRows(
    worksheet: ExcelJS.Worksheet,
    headerRowNumber: number,
    organizationNameColumn: number,
    organizationOidColumn: number,
): RemdOrganizationRow[] {
    const rows: RemdOrganizationRow[] = []
    for (let rowNumber = headerRowNumber + 1; rowNumber <= worksheet.rowCount; rowNumber += 1) {
        const row = worksheet.getRow(rowNumber)
        const name = cellToText(row.getCell(organizationNameColumn))
        const oid = cellToText(row.getCell(organizationOidColumn))
        if (name && oid) {
            rows.push({ rowNumber, name, oid })
        }
    }
    return rows
}

function buildOrganizationValues(
    worksheet: ExcelJS.Worksheet,
    organizations: RemdOrganizationRow[],
    groups: Array<{ key: string; columns: RemdMatchedColumn[] }>,
    selectedGroupKeys: Set<string>,
    denominatorColumnIndex: number | null,
    targetColumnIndex: number | null,
): Array<{
    oid: string
    name: string
    numerator: number
    components: Record<string, number>
    denominator?: number | null
    targetValue?: number | null
}> {
    const byOid = new Map<string, {
        oid: string
        name: string
        numerator: number
        components: Record<string, number>
        denominator?: number | null
        targetValue?: number | null
    }>()

    for (const organization of organizations) {
        const row = worksheet.getRow(organization.rowNumber)
        const components = Object.fromEntries(groups.map((group) => [
            group.key,
            group.columns.reduce((sum, column) => {
                return sum + (cellToNumber(row.getCell(column.index)) ?? 0)
            }, 0),
        ]))
        const numerator = Object.entries(components).reduce((sum, [key, value]) => {
            return selectedGroupKeys.has(key) ? sum + value : sum
        }, 0)
        const denominator = denominatorColumnIndex === null
            ? undefined
            : cellToNumber(row.getCell(denominatorColumnIndex))
        const targetValue = targetColumnIndex === null
            ? undefined
            : cellToNumber(row.getCell(targetColumnIndex))

        const existing = byOid.get(organization.oid)
        if (existing) {
            existing.numerator += numerator
            if (denominator !== null && typeof denominator !== 'undefined') {
                existing.denominator = (existing.denominator ?? 0) + denominator
            }
            if (
                targetValue !== null
                && typeof targetValue !== 'undefined'
                && (existing.targetValue === null || typeof existing.targetValue === 'undefined')
            ) {
                existing.targetValue = targetValue
            }
            for (const [key, value] of Object.entries(components)) {
                existing.components[key] = (existing.components[key] ?? 0) + value
            }
        } else {
            byOid.set(organization.oid, {
                oid: organization.oid,
                name: organization.name,
                numerator,
                components,
                ...(denominatorColumnIndex === null ? {} : { denominator: denominator ?? null }),
                ...(targetColumnIndex === null ? {} : { targetValue: targetValue ?? null }),
            })
        }
    }

    return Array.from(byOid.values())
}

function listNumericColumnValues(
    worksheet: ExcelJS.Worksheet,
    columnIndex: number,
    organizations: RemdOrganizationRow[],
): number[] {
    const values: number[] = []
    for (const organization of organizations) {
        const value = cellToNumber(worksheet.getRow(organization.rowNumber).getCell(columnIndex))
        if (value !== null) values.push(value)
    }
    return values
}

function validateNumericColumn(
    worksheet: ExcelJS.Worksheet,
    header: RemdHeader,
    organizations: RemdOrganizationRow[],
    options: {
        label: string
        min: number
        max?: number
    },
): { missingCount: number; zeroCount: number } {
    let missingCount = 0
    let zeroCount = 0

    for (const organization of organizations) {
        const cell = worksheet.getRow(organization.rowNumber).getCell(header.index)
        const rawText = cellToText(cell)
        const value = cellToNumber(cell)
        if (value === null) {
            if (rawText) {
                throw new BadRequestException(
                    `Строка ${organization.rowNumber}, колонка «${header.header}»: ${options.label} должно быть числом.`,
                )
            }
            missingCount += 1
            continue
        }
        if (value < options.min) {
            throw new BadRequestException(
                `Строка ${organization.rowNumber}, колонка «${header.header}»: ${options.label} не может быть меньше ${options.min}.`,
            )
        }
        if (typeof options.max === 'number' && value > options.max) {
            throw new BadRequestException(
                `Строка ${organization.rowNumber}, колонка «${header.header}»: ${options.label} не может быть больше ${options.max}.`,
            )
        }
        if (value === 0) {
            zeroCount += 1
        }
    }

    return { missingCount, zeroCount }
}

function sumNumericColumn(
    worksheet: ExcelJS.Worksheet,
    columnIndex: number,
    startRow: number,
    organizationNameColumn: number,
    organizationOidColumn: number,
): number {
    let sum = 0
    for (let rowNumber = startRow; rowNumber <= worksheet.rowCount; rowNumber += 1) {
        const row = worksheet.getRow(rowNumber)
        const organizationName = cellToText(row.getCell(organizationNameColumn))
        const organizationOid = cellToText(row.getCell(organizationOidColumn))
        if (!organizationName || !organizationOid) continue
        const value = cellToNumber(row.getCell(columnIndex))
        if (value !== null) sum += value
    }
    return sum
}

function cellToText(cell: ExcelJS.Cell): string {
    const value = cell.value
    if (value === null || typeof value === 'undefined') return ''
    if (typeof value === 'object') {
        if ('richText' in value && Array.isArray((value as any).richText)) {
            return (value as any).richText.map((item: any) => item.text).join('').trim()
        }
        if ('text' in value) return String((value as any).text ?? '').trim()
        if ('result' in value) return String((value as any).result ?? '').trim()
    }
    return String(value).trim()
}

function cellToNumber(cell: ExcelJS.Cell): number | null {
    const value = cell.value
    if (value === null || typeof value === 'undefined' || value === '') return null
    if (typeof value === 'number') return Number.isFinite(value) ? value : null
    if (typeof value === 'object' && 'result' in value) {
        const resultValue = Number((value as any).result)
        return Number.isFinite(resultValue) ? resultValue : null
    }
    const normalized = String(value).replace(/\s+/g, '').replace(',', '.')
    const numberValue = Number(normalized)
    return Number.isFinite(numberValue) ? numberValue : null
}

function normalizeHeader(value: string): string {
    return value
        .toLowerCase()
        .replace(/ё/g, 'е')
        .replace(/[№"«»„“”]/g, '')
        .replace(/[()[\]]/g, ' ')
        .replace(/\s*[/\\]\s*/g, ' / ')
        .replace(/[.,;:]+$/g, '')
        .replace(/\s+/g, ' ')
        .trim()
}
