import { BadRequestException } from '@nestjs/common'
import * as ExcelJS from 'exceljs'

export type RemdSheetKind = 'region' | 'institution' | 'subdivision'
export type RemdQualitySeverity = 'warning' | 'error'

export interface RemdSourceMetadata {
    periodFrom: string | null
    periodTo: string | null
    generatedAt: string | null
}

export interface RemdSemdColumn {
    columnNumber: number
    typeKey: string
    columnKey: string
    name: string
    documentFormat: string
}

export interface RemdSparseFact {
    columnKey: string
    typeKey: string
    count: number
}

export interface RemdRegionRow {
    rowNumber: number
    regionName: string
    /** Заявленное в отчёте число видов; `null` — в отчёте его нет. */
    uniqueSemdTypes: number | null
    totalDocuments: number
    facts: RemdSparseFact[]
}

export interface RemdInstitutionRow {
    rowNumber: number
    regionName: string
    institutionName: string
    institutionOid: string
    /** Заявленное в отчёте число видов; `null` — в отчёте его нет. */
    uniqueSemdTypes: number | null
    totalDocuments: number
    facts: RemdSparseFact[]
}

export interface RemdSubdivisionRow {
    rowNumber: number
    regionName: string
    institutionName: string
    institutionOid: string
    subdivisionOid: string | null
    subdivisionName: string
    isUnassigned: boolean
    buildingId: string
    buildingName: string
    buildingAddress: string
    totalDocuments: number
    facts: RemdSparseFact[]
}

export interface RemdQualityIssue {
    code: string
    severity: RemdQualitySeverity
    sheetKind: RemdSheetKind
    sheetName: string
    rowNumber: number | null
    columnNumber: number | null
    message: string
    details: Record<string, unknown>
}

export interface RemdReconciliationCheck {
    code: string
    label: string
    status: 'passed' | 'failed'
    severity: RemdQualitySeverity
    expected: number
    actual: number
}

export interface RemdParsedSheet<T> {
    kind: RemdSheetKind
    sheetName: string
    headerRowNumber: number
    declaredRecordCount: number | null
    semdColumns: RemdSemdColumn[]
    rows: T[]
}

export interface RemdWorkbookParseResult {
    metadata: RemdSourceMetadata
    region: RemdParsedSheet<RemdRegionRow>
    institutions: RemdParsedSheet<RemdInstitutionRow>
    subdivisions: RemdParsedSheet<RemdSubdivisionRow>
    semdTypes: Array<{
        typeKey: string
        name: string
        formats: string[]
    }>
    activeRegionSemdTypeCount: number
    checks: RemdReconciliationCheck[]
    issues: RemdQualityIssue[]
}

export interface RemdWorkbookPreview {
    canConfirm: boolean
    metadata: RemdSourceMetadata
    sheets: Array<{
        kind: RemdSheetKind
        sheetName: string
        declaredRecordCount: number | null
        parsedRecordCount: number
        semdColumnCount: number
    }>
    totals: {
        institutionCount: number
        subdivisionRowCount: number
        unassignedSubdivisionRowCount: number
        unassignedSubdivisionDocumentCount: number
        availableSemdTypeCount: number
        activeRegionSemdTypeCount: number
        regionDocumentCount: number
        institutionDocumentCount: number
        subdivisionDocumentCount: number
    }
    institutions: Array<{
        oid: string
        name: string
        uniqueSemdTypes: number | null
        totalDocuments: number
    }>
    checks: RemdReconciliationCheck[]
    issueSummary: Array<{
        code: string
        severity: RemdQualitySeverity
        count: number
    }>
    issues: RemdQualityIssue[]
}

interface HeaderLayout {
    headerRowNumber: number
    regionColumn: number
    institutionNameColumn?: number
    institutionOidColumn?: number
    subdivisionOidColumn?: number
    subdivisionNameColumn?: number
    buildingIdColumn?: number
    buildingNameColumn?: number
    buildingAddressColumn?: number
    uniqueTypesColumn?: number
    totalDocumentsColumn: number
    semdStartColumn: number
}

interface SheetDefinition {
    kind: RemdSheetKind
    preferredName: string
}

const SHEET_DEFINITIONS: SheetDefinition[] = [
    { kind: 'region', preferredName: 'Отчет РЭМД' },
    { kind: 'institution', preferredName: 'Отчет РЭМД по МО' },
    { kind: 'subdivision', preferredName: 'Отчет РЭМД по подразделениям' },
]

export async function loadRemdWorkbook(
    fileBuffer: Buffer,
): Promise<RemdWorkbookParseResult> {
    const workbook = new ExcelJS.Workbook()
    try {
        await workbook.xlsx.load(fileBuffer as any)
    } catch {
        throw new BadRequestException('Не удалось прочитать Excel-файл РЭМД')
    }
    return parseRemdWorkbook(workbook)
}

export function parseRemdWorkbook(
    workbook: ExcelJS.Workbook,
): RemdWorkbookParseResult {
    const issues: RemdQualityIssue[] = []
    const regionWorksheet = findWorksheet(workbook, 'region')
    const institutionWorksheet = findWorksheet(workbook, 'institution')
    const subdivisionWorksheet = findWorksheet(workbook, 'subdivision')

    const region = parseRegionSheet(regionWorksheet, issues)
    const institutions = parseInstitutionSheet(institutionWorksheet, issues)
    const subdivisions = parseSubdivisionSheet(subdivisionWorksheet, issues)
    const metadata = readSourceMetadata(regionWorksheet)

    validateDeclaredRecordCount(region, issues)
    validateDeclaredRecordCount(institutions, issues)
    validateDeclaredRecordCount(subdivisions, issues)
    validateInstitutionRows(institutions, issues)

    const semdTypes = buildSemdTypeList([
        ...region.semdColumns,
        ...institutions.semdColumns,
        ...subdivisions.semdColumns,
    ])
    const activeRegionSemdTypeCount = countActiveTypes(region.rows.flatMap((row) => row.facts))
    const checks = buildReconciliationChecks(region, institutions, subdivisions)

    for (const check of checks) {
        if (check.status === 'failed') {
            issues.push({
                code: check.code,
                severity: check.severity,
                sheetKind: 'region',
                sheetName: region.sheetName,
                rowNumber: null,
                columnNumber: null,
                message: `${check.label}: ожидалось ${check.expected}, получено ${check.actual}.`,
                details: {
                    expected: check.expected,
                    actual: check.actual,
                },
            })
        }
    }

    const declaredUniqueTypes = region.rows[0]?.uniqueSemdTypes
    if (
        typeof declaredUniqueTypes === 'number'
        && declaredUniqueTypes !== activeRegionSemdTypeCount
    ) {
        issues.push({
            code: 'region_unique_type_count_mismatch',
            severity: 'error',
            sheetKind: 'region',
            sheetName: region.sheetName,
            rowNumber: region.rows[0]?.rowNumber ?? null,
            columnNumber: null,
            message:
                `Количество фактически непустых видов СЭМД (${activeRegionSemdTypeCount}) `
                + `не совпадает со значением в отчете (${declaredUniqueTypes}).`,
            details: {
                declared: declaredUniqueTypes,
                calculated: activeRegionSemdTypeCount,
            },
        })
    }

    return {
        metadata,
        region,
        institutions,
        subdivisions,
        semdTypes,
        activeRegionSemdTypeCount,
        checks,
        issues,
    }
}

export function buildRemdWorkbookPreview(
    parsed: RemdWorkbookParseResult,
): RemdWorkbookPreview {
    const issueCounts = new Map<
        string,
        { code: string; severity: RemdQualitySeverity; count: number }
    >()
    for (const issue of parsed.issues) {
        const key = `${issue.severity}\u0000${issue.code}`
        const current = issueCounts.get(key) ?? {
            code: issue.code,
            severity: issue.severity,
            count: 0,
        }
        current.count += 1
        issueCounts.set(key, current)
    }

    return {
        canConfirm: !parsed.issues.some((issue) => issue.severity === 'error'),
        metadata: parsed.metadata,
        sheets: [
            previewSheet(parsed.region),
            previewSheet(parsed.institutions),
            previewSheet(parsed.subdivisions),
        ],
        totals: {
            institutionCount: parsed.institutions.rows.length,
            subdivisionRowCount: parsed.subdivisions.rows.length,
            unassignedSubdivisionRowCount: parsed.subdivisions.rows.filter(
                (row) => row.isUnassigned,
            ).length,
            unassignedSubdivisionDocumentCount: parsed.subdivisions.rows
                .filter((row) => row.isUnassigned)
                .reduce((sum, row) => sum + row.totalDocuments, 0),
            availableSemdTypeCount: parsed.semdTypes.length,
            activeRegionSemdTypeCount: parsed.activeRegionSemdTypeCount,
            regionDocumentCount: parsed.region.rows.reduce(
                (sum, row) => sum + row.totalDocuments,
                0,
            ),
            institutionDocumentCount: parsed.institutions.rows.reduce(
                (sum, row) => sum + row.totalDocuments,
                0,
            ),
            subdivisionDocumentCount: parsed.subdivisions.rows.reduce(
                (sum, row) => sum + row.totalDocuments,
                0,
            ),
        },
        institutions: parsed.institutions.rows.map((row) => ({
            oid: row.institutionOid,
            name: row.institutionName,
            uniqueSemdTypes: row.uniqueSemdTypes,
            totalDocuments: row.totalDocuments,
        })),
        checks: parsed.checks,
        issueSummary: Array.from(issueCounts.values()).sort((left, right) => {
            if (left.severity !== right.severity) {
                return left.severity === 'error' ? -1 : 1
            }
            return left.code.localeCompare(right.code)
        }),
        issues: parsed.issues,
    }
}

function findWorksheet(
    workbook: ExcelJS.Workbook,
    kind: RemdSheetKind,
): ExcelJS.Worksheet {
    const definition = SHEET_DEFINITIONS.find((candidate) => candidate.kind === kind)!
    const exact = workbook.worksheets.find(
        (worksheet) => normalizeText(worksheet.name) === normalizeText(definition.preferredName),
    )
    if (exact) return exact

    const byStructure = workbook.worksheets.find((worksheet) => {
        try {
            findHeaderLayout(worksheet, kind)
            return true
        } catch {
            return false
        }
    })
    if (byStructure) return byStructure

    const label = kind === 'region'
        ? 'регионального отчета'
        : kind === 'institution'
            ? 'отчета по МО'
            : 'отчета по подразделениям'
    throw new BadRequestException(`В Excel-файле не найден лист ${label}`)
}

function parseRegionSheet(
    worksheet: ExcelJS.Worksheet,
    issues: RemdQualityIssue[],
): RemdParsedSheet<RemdRegionRow> {
    const layout = findHeaderLayout(worksheet, 'region')
    const semdColumns = readSemdColumns(worksheet, layout, 'region', issues)
    const rows: RemdRegionRow[] = []

    forEachDataRow(worksheet, layout, (row) => {
        const regionName = cellToText(row.getCell(layout.regionColumn))
        if (!regionName) return
        rows.push({
            rowNumber: row.number,
            regionName,
            uniqueSemdTypes: readDeclaredCount(
                row.getCell(layout.uniqueTypesColumn!),
                worksheet,
                'region',
                issues,
            ),
            totalDocuments: readCount(
                row.getCell(layout.totalDocumentsColumn),
                worksheet,
                'region',
                issues,
            ),
            facts: readFacts(row, semdColumns, worksheet, 'region', issues),
        })
    })

    if (rows.length !== 1) {
        issues.push({
            code: 'unexpected_region_row_count',
            severity: 'error',
            sheetKind: 'region',
            sheetName: worksheet.name,
            rowNumber: null,
            columnNumber: null,
            message: `Ожидалась одна строка региона, найдено: ${rows.length}.`,
            details: { rowCount: rows.length },
        })
    }

    return buildParsedSheet('region', worksheet, layout, semdColumns, rows)
}

function parseInstitutionSheet(
    worksheet: ExcelJS.Worksheet,
    issues: RemdQualityIssue[],
): RemdParsedSheet<RemdInstitutionRow> {
    const layout = findHeaderLayout(worksheet, 'institution')
    const semdColumns = readSemdColumns(worksheet, layout, 'institution', issues)
    const rows: RemdInstitutionRow[] = []

    forEachDataRow(worksheet, layout, (row) => {
        const institutionName = cellToText(row.getCell(layout.institutionNameColumn!))
        const institutionOid = cellToText(row.getCell(layout.institutionOidColumn!))
        if (!institutionName && !institutionOid) return

        if (!institutionName || !institutionOid) {
            issues.push({
                code: 'institution_identity_incomplete',
                severity: 'error',
                sheetKind: 'institution',
                sheetName: worksheet.name,
                rowNumber: row.number,
                columnNumber: null,
                message: 'В строке МО не заполнено название или OID.',
                details: { institutionName, institutionOid },
            })
            return
        }

        const facts = readFacts(row, semdColumns, worksheet, 'institution', issues)
        const uniqueSemdTypes = readDeclaredCount(
            row.getCell(layout.uniqueTypesColumn!),
            worksheet,
            'institution',
            issues,
        )
        const calculatedUniqueTypes = countActiveTypes(facts)
        // Сверять нечего, когда счётчик в отчёте не заполнен.
        if (uniqueSemdTypes !== null && uniqueSemdTypes !== calculatedUniqueTypes) {
            issues.push({
                code: 'institution_unique_type_count_mismatch',
                severity: 'warning',
                sheetKind: 'institution',
                sheetName: worksheet.name,
                rowNumber: row.number,
                columnNumber: layout.uniqueTypesColumn!,
                message:
                    `Для МО «${institutionName}» количество видов СЭМД в отчете `
                    + `(${uniqueSemdTypes}) не совпадает с расчетом по колонкам (${calculatedUniqueTypes}).`,
                details: {
                    institutionOid,
                    declared: uniqueSemdTypes,
                    calculated: calculatedUniqueTypes,
                },
            })
        }

        rows.push({
            rowNumber: row.number,
            regionName: cellToText(row.getCell(layout.regionColumn)),
            institutionName,
            institutionOid,
            uniqueSemdTypes,
            totalDocuments: readCount(
                row.getCell(layout.totalDocumentsColumn),
                worksheet,
                'institution',
                issues,
            ),
            facts,
        })
    })

    return buildParsedSheet('institution', worksheet, layout, semdColumns, rows)
}

function parseSubdivisionSheet(
    worksheet: ExcelJS.Worksheet,
    issues: RemdQualityIssue[],
): RemdParsedSheet<RemdSubdivisionRow> {
    const layout = findHeaderLayout(worksheet, 'subdivision')
    const semdColumns = readSemdColumns(worksheet, layout, 'subdivision', issues)
    const rows: RemdSubdivisionRow[] = []

    forEachDataRow(worksheet, layout, (row) => {
        const institutionName = cellToText(row.getCell(layout.institutionNameColumn!))
        const institutionOid = cellToText(row.getCell(layout.institutionOidColumn!))
        const subdivisionOid = cellToText(row.getCell(layout.subdivisionOidColumn!))
        const subdivisionName = cellToText(row.getCell(layout.subdivisionNameColumn!))

        if (!institutionName && !institutionOid && !subdivisionOid && !subdivisionName) return
        if (!institutionName || !institutionOid) {
            issues.push({
                code: 'subdivision_identity_incomplete',
                severity: 'error',
                sheetKind: 'subdivision',
                sheetName: worksheet.name,
                rowNumber: row.number,
                columnNumber: null,
                message: 'В строке подразделения не заполнено МО или OID МО.',
                details: {
                    institutionName,
                    institutionOid,
                    subdivisionOid,
                    subdivisionName,
                },
            })
            return
        }

        const isUnassigned = !subdivisionOid && !subdivisionName
        if (isUnassigned) {
            issues.push({
                code: 'subdivision_not_specified',
                severity: 'warning',
                sheetKind: 'subdivision',
                sheetName: worksheet.name,
                rowNumber: row.number,
                columnNumber: null,
                message: `Документы МО «${institutionName}» не привязаны к подразделению.`,
                details: {
                    institutionOid,
                    totalDocuments: readCount(
                        row.getCell(layout.totalDocumentsColumn),
                        worksheet,
                        'subdivision',
                        issues,
                    ),
                },
            })
        } else if (!subdivisionOid || !subdivisionName) {
            issues.push({
                code: 'subdivision_identity_incomplete',
                severity: 'error',
                sheetKind: 'subdivision',
                sheetName: worksheet.name,
                rowNumber: row.number,
                columnNumber: null,
                message: 'В строке подразделения заполнен только OID или только название подразделения.',
                details: {
                    institutionOid,
                    subdivisionOid,
                    subdivisionName,
                },
            })
            return
        }

        rows.push({
            rowNumber: row.number,
            regionName: cellToText(row.getCell(layout.regionColumn)),
            institutionName,
            institutionOid,
            subdivisionOid: subdivisionOid || null,
            subdivisionName: subdivisionName || 'Без привязки к подразделению',
            isUnassigned,
            buildingId: cellToText(row.getCell(layout.buildingIdColumn!)),
            buildingName: cellToText(row.getCell(layout.buildingNameColumn!)),
            buildingAddress: cellToText(row.getCell(layout.buildingAddressColumn!)),
            totalDocuments: readCount(
                row.getCell(layout.totalDocumentsColumn),
                worksheet,
                'subdivision',
                issues,
            ),
            facts: readFacts(row, semdColumns, worksheet, 'subdivision', issues),
        })
    })

    return buildParsedSheet('subdivision', worksheet, layout, semdColumns, rows)
}

function findHeaderLayout(
    worksheet: ExcelJS.Worksheet,
    kind: RemdSheetKind,
): HeaderLayout {
    const maxRow = Math.min(worksheet.rowCount, 15)
    for (let rowNumber = 1; rowNumber <= maxRow; rowNumber += 1) {
        const row = worksheet.getRow(rowNumber)
        const headers = new Map<number, string>()
        row.eachCell({ includeEmpty: false }, (cell, columnNumber) => {
            headers.set(columnNumber, normalizeText(cellToText(cell)))
        })

        const regionColumn = findHeaderColumn(headers, 'наименование субъекта российской федерации')
        if (!regionColumn) continue

        if (kind === 'region') {
            const uniqueTypesColumn = findHeaderColumn(headers, 'количество уникальных видов сэмд')
            const totalDocumentsColumn = findHeaderColumn(headers, 'количество сэмд')
            if (uniqueTypesColumn && totalDocumentsColumn) {
                return {
                    headerRowNumber: rowNumber,
                    regionColumn,
                    uniqueTypesColumn,
                    totalDocumentsColumn,
                    semdStartColumn: totalDocumentsColumn + 1,
                }
            }
        }

        if (kind === 'institution') {
            const institutionNameColumn = findHeaderColumn(headers, 'наименование медицинской организации')
            const institutionOidColumn = findHeaderColumn(headers, 'oid медицинской организации')
            const uniqueTypesColumn = findHeaderColumn(headers, 'количество уникальных видов сэмд')
            const totalDocumentsColumn = findHeaderColumn(headers, 'количество всего')
            if (
                institutionNameColumn
                && institutionOidColumn
                && uniqueTypesColumn
                && totalDocumentsColumn
            ) {
                return {
                    headerRowNumber: rowNumber,
                    regionColumn,
                    institutionNameColumn,
                    institutionOidColumn,
                    uniqueTypesColumn,
                    totalDocumentsColumn,
                    semdStartColumn: totalDocumentsColumn + 1,
                }
            }
        }

        if (kind === 'subdivision') {
            const institutionNameColumn = findHeaderColumn(headers, 'наименование медицинской организации')
            const institutionOidColumn = findHeaderColumn(headers, 'oid медицинской организации')
            const subdivisionOidColumn = findHeaderColumn(headers, 'oid сп мо')
            const subdivisionNameColumn = findHeaderColumn(headers, 'название сп мо')
            const buildingIdColumn = findHeaderColumn(headers, 'id здания')
            const buildingNameColumn = findHeaderColumn(headers, 'название здания')
            const buildingAddressColumn = findHeaderColumn(headers, 'адрес здания')
            const totalDocumentsColumn = findHeaderColumn(headers, 'количество всего')
            if (
                institutionNameColumn
                && institutionOidColumn
                && subdivisionOidColumn
                && subdivisionNameColumn
                && buildingIdColumn
                && buildingNameColumn
                && buildingAddressColumn
                && totalDocumentsColumn
            ) {
                return {
                    headerRowNumber: rowNumber,
                    regionColumn,
                    institutionNameColumn,
                    institutionOidColumn,
                    subdivisionOidColumn,
                    subdivisionNameColumn,
                    buildingIdColumn,
                    buildingNameColumn,
                    buildingAddressColumn,
                    totalDocumentsColumn,
                    semdStartColumn: totalDocumentsColumn + 1,
                }
            }
        }
    }

    throw new BadRequestException(
        `На листе «${worksheet.name}» не найдена ожидаемая структура заголовков РЭМД`,
    )
}

function readSemdColumns(
    worksheet: ExcelJS.Worksheet,
    layout: HeaderLayout,
    kind: RemdSheetKind,
    issues: RemdQualityIssue[],
): RemdSemdColumn[] {
    const headerRow = worksheet.getRow(layout.headerRowNumber)
    const formatRow = worksheet.getRow(layout.headerRowNumber + 1)
    const columns: RemdSemdColumn[] = []
    let currentName = ''
    const columnKeyOccurrences = new Map<string, number>()
    const maxColumn = Math.max(
        worksheet.columnCount,
        headerRow.cellCount,
        formatRow.cellCount,
    )

    for (
        let columnNumber = layout.semdStartColumn;
        columnNumber <= maxColumn;
        columnNumber += 1
    ) {
        const headerCell = headerRow.getCell(columnNumber)
        const formatCell = formatRow.getCell(columnNumber)
        if (isMergedSlave(headerCell) && isMergedSlave(formatCell)) {
            continue
        }

        const headerName = cellToText(headerCell)
        if (headerName) currentName = headerName
        const documentFormat = cellToText(formatCell)

        if (!currentName && !documentFormat) continue
        if (!currentName) {
            issues.push({
                code: 'semd_header_name_missing',
                severity: 'error',
                sheetKind: kind,
                sheetName: worksheet.name,
                rowNumber: layout.headerRowNumber,
                columnNumber,
                message: 'Не удалось определить наименование вида СЭМД для колонки.',
                details: { documentFormat },
            })
            continue
        }
        if (!documentFormat) {
            issues.push({
                code: 'semd_header_format_missing',
                severity: 'warning',
                sheetKind: kind,
                sheetName: worksheet.name,
                rowNumber: layout.headerRowNumber + 1,
                columnNumber,
                message: `Для вида СЭМД «${currentName}» не указан формат документа.`,
                details: { semdName: currentName },
            })
        }

        const typeKey = normalizeKey(currentName)
        const formatKey = normalizeKey(documentFormat || 'не указан')
        const baseColumnKey = `${typeKey}|${formatKey}`
        const occurrence = (columnKeyOccurrences.get(baseColumnKey) ?? 0) + 1
        columnKeyOccurrences.set(baseColumnKey, occurrence)
        const columnKey = occurrence === 1
            ? baseColumnKey
            : `${baseColumnKey}#${occurrence}`
        columns.push({
            columnNumber,
            typeKey,
            columnKey,
            name: currentName,
            documentFormat,
        })
        if (occurrence > 1) {
            issues.push({
                code: 'duplicate_semd_column',
                severity: 'warning',
                sheetKind: kind,
                sheetName: worksheet.name,
                rowNumber: layout.headerRowNumber,
                columnNumber,
                message: `Повторяется колонка вида СЭМД «${currentName}» в формате «${documentFormat || 'не указан'}».`,
                details: {
                    baseColumnKey,
                    occurrence,
                },
            })
        }
    }

    if (columns.length === 0) {
        throw new BadRequestException(
            `На листе «${worksheet.name}» не найдены колонки видов СЭМД`,
        )
    }

    return columns
}

function forEachDataRow(
    worksheet: ExcelJS.Worksheet,
    layout: HeaderLayout,
    callback: (row: ExcelJS.Row) => void,
): void {
    const firstDataRow = layout.headerRowNumber + 2
    for (let rowNumber = firstDataRow; rowNumber <= worksheet.rowCount; rowNumber += 1) {
        const row = worksheet.getRow(rowNumber)
        const regionCell = normalizeText(cellToText(row.getCell(layout.regionColumn)))
        if (!regionCell || regionCell === 'итого') continue
        callback(row)
    }
}

function readFacts(
    row: ExcelJS.Row,
    semdColumns: RemdSemdColumn[],
    worksheet: ExcelJS.Worksheet,
    kind: RemdSheetKind,
    issues: RemdQualityIssue[],
): RemdSparseFact[] {
    const facts: RemdSparseFact[] = []
    for (const column of semdColumns) {
        const count = readCount(
            row.getCell(column.columnNumber),
            worksheet,
            kind,
            issues,
        )
        if (count > 0) {
            facts.push({
                columnKey: column.columnKey,
                typeKey: column.typeKey,
                count,
            })
        }
    }
    return facts
}

/**
 * Формула, сохранённая без вычисленного значения.
 *
 * ExcelJS отдаёт такую ячейку объектом `{ formula, result: undefined }`, и выражение
 * `cell.result ?? cell.value` подставляет вместо числа сам объект. Дальше он приводится
 * к строке «[object Object]», и ячейка объявляется некорректной — при том что значения
 * в ней просто нет.
 *
 * Так пришёл сводный отчёт РЭМД от 15.08.2026: в колонке «количество уникальных видов»
 * стоит `COUNTIF(...)` без кэша, 38 ячеек, и файл не проходил подтверждение целиком,
 * хотя все семь сверок итогов сходились.
 */
function isUnevaluatedFormula(value: unknown): boolean {
    return (
        typeof value === 'object'
        && value !== null
        && ('formula' in value || 'sharedFormula' in value)
        && typeof (value as { result?: unknown }).result === 'undefined'
    )
}

/**
 * Заявленное значение счётчика: `null` — в ячейке ничего нет.
 *
 * Отличается от `readCount` тем, что не приравнивает пустоту к нулю. Для количества
 * документов ноль и пусто — одно и то же, а для заявленного числа видов нет: «заявлено 0»
 * расходится с расчётом и обязано ругаться, «не заявлено» — сверять не с чем.
 */
function readDeclaredCount(
    cell: ExcelJS.Cell,
    worksheet: ExcelJS.Worksheet,
    kind: RemdSheetKind,
    issues: RemdQualityIssue[],
): number | null {
    const raw = cell.result ?? cell.value
    if (
        raw === null
        || typeof raw === 'undefined'
        || raw === ''
        || isUnevaluatedFormula(raw)
    ) {
        return null
    }
    return readCount(cell, worksheet, kind, issues)
}

function readCount(
    cell: ExcelJS.Cell,
    worksheet: ExcelJS.Worksheet,
    kind: RemdSheetKind,
    issues: RemdQualityIssue[],
): number {
    const raw = cell.result ?? cell.value
    if (raw === null || typeof raw === 'undefined' || raw === '') return 0
    // Формула без кэша — это отсутствие значения, а не ошибка в нём.
    if (isUnevaluatedFormula(raw)) return 0

    const normalized = typeof raw === 'number'
        ? raw
        : Number(String(raw).replace(/\s|\u00a0/g, '').replace(',', '.'))
    if (!Number.isFinite(normalized) || normalized < 0 || !Number.isInteger(normalized)) {
        issues.push({
            code: 'invalid_document_count',
            severity: 'error',
            sheetKind: kind,
            sheetName: worksheet.name,
            rowNumber: Number(cell.row),
            columnNumber: Number(cell.col),
            message: `Некорректное количество документов в ячейке ${cell.address}.`,
            details: { value: cellToText(cell) },
        })
        return 0
    }
    return normalized
}

function buildParsedSheet<T>(
    kind: RemdSheetKind,
    worksheet: ExcelJS.Worksheet,
    layout: HeaderLayout,
    semdColumns: RemdSemdColumn[],
    rows: T[],
): RemdParsedSheet<T> {
    return {
        kind,
        sheetName: worksheet.name,
        headerRowNumber: layout.headerRowNumber,
        declaredRecordCount: readDeclaredRecordCount(worksheet),
        semdColumns,
        rows,
    }
}

function previewSheet<T>(
    sheet: RemdParsedSheet<T>,
): RemdWorkbookPreview['sheets'][number] {
    return {
        kind: sheet.kind,
        sheetName: sheet.sheetName,
        declaredRecordCount: sheet.declaredRecordCount,
        parsedRecordCount: sheet.rows.length,
        semdColumnCount: sheet.semdColumns.length,
    }
}

function readSourceMetadata(worksheet: ExcelJS.Worksheet): RemdSourceMetadata {
    let periodFrom: string | null = null
    let periodTo: string | null = null
    let generatedAt: string | null = null

    for (let rowNumber = 1; rowNumber <= Math.min(worksheet.rowCount, 6); rowNumber += 1) {
        const text = cellToText(worksheet.getRow(rowNumber).getCell(1))
        const periodMatch = text.match(
            /за период\s+(\d{2}\.\d{2}\.\d{4})\s*-\s*(\d{2}\.\d{2}\.\d{4})/i,
        )
        if (periodMatch) {
            periodFrom = russianDateToIso(periodMatch[1])
            periodTo = russianDateToIso(periodMatch[2])
        }
        const generatedMatch = text.match(
            /дата формирования:\s*(\d{2}\.\d{2}\.\d{4})\s+(\d{2}):(\d{2})/i,
        )
        if (generatedMatch) {
            generatedAt = `${russianDateToIso(generatedMatch[1])}T${generatedMatch[2]}:${generatedMatch[3]}:00`
        }
    }

    return { periodFrom, periodTo, generatedAt }
}

function readDeclaredRecordCount(worksheet: ExcelJS.Worksheet): number | null {
    for (let rowNumber = 1; rowNumber <= Math.min(worksheet.rowCount, 6); rowNumber += 1) {
        const text = cellToText(worksheet.getRow(rowNumber).getCell(1))
        const match = text.match(/общее количество записей:\s*(\d+)/i)
        if (match) return Number(match[1])
    }
    return null
}

function validateDeclaredRecordCount<T>(
    sheet: RemdParsedSheet<T>,
    issues: RemdQualityIssue[],
): void {
    if (
        sheet.declaredRecordCount !== null
        && sheet.declaredRecordCount !== sheet.rows.length
    ) {
        issues.push({
            code: 'declared_record_count_mismatch',
            severity: 'error',
            sheetKind: sheet.kind,
            sheetName: sheet.sheetName,
            rowNumber: null,
            columnNumber: null,
            message:
                `На листе «${sheet.sheetName}» заявлено ${sheet.declaredRecordCount} записей, `
                + `прочитано ${sheet.rows.length}.`,
            details: {
                declared: sheet.declaredRecordCount,
                parsed: sheet.rows.length,
            },
        })
    }
}

function validateInstitutionRows(
    sheet: RemdParsedSheet<RemdInstitutionRow>,
    issues: RemdQualityIssue[],
): void {
    const rowsByOid = new Map<string, RemdInstitutionRow[]>()
    for (const row of sheet.rows) {
        const rows = rowsByOid.get(row.institutionOid) ?? []
        rows.push(row)
        rowsByOid.set(row.institutionOid, rows)
    }

    for (const [oid, rows] of rowsByOid) {
        if (rows.length > 1) {
            issues.push({
                code: 'duplicate_institution_oid',
                severity: 'error',
                sheetKind: 'institution',
                sheetName: sheet.sheetName,
                rowNumber: rows[0].rowNumber,
                columnNumber: null,
                message: `OID МО ${oid} встречается в отчете несколько раз.`,
                details: {
                    oid,
                    rowNumbers: rows.map((row) => row.rowNumber),
                    names: [...new Set(rows.map((row) => row.institutionName))],
                },
            })
        }
    }
}

function buildSemdTypeList(
    columns: RemdSemdColumn[],
): RemdWorkbookParseResult['semdTypes'] {
    const types = new Map<string, { typeKey: string; name: string; formats: Set<string> }>()
    for (const column of columns) {
        const existing = types.get(column.typeKey) ?? {
            typeKey: column.typeKey,
            name: column.name,
            formats: new Set<string>(),
        }
        if (column.documentFormat) existing.formats.add(column.documentFormat)
        types.set(column.typeKey, existing)
    }
    return Array.from(types.values())
        .map((type) => ({
            typeKey: type.typeKey,
            name: type.name,
            formats: Array.from(type.formats).sort((left, right) => left.localeCompare(right, 'ru')),
        }))
        .sort((left, right) => left.name.localeCompare(right.name, 'ru'))
}

function buildReconciliationChecks(
    region: RemdParsedSheet<RemdRegionRow>,
    institutions: RemdParsedSheet<RemdInstitutionRow>,
    subdivisions: RemdParsedSheet<RemdSubdivisionRow>,
): RemdReconciliationCheck[] {
    const regionTotal = region.rows.reduce((sum, row) => sum + row.totalDocuments, 0)
    const institutionTotal = institutions.rows.reduce(
        (sum, row) => sum + row.totalDocuments,
        0,
    )
    const subdivisionTotal = subdivisions.rows.reduce(
        (sum, row) => sum + row.totalDocuments,
        0,
    )
    const regionColumnTotal = sumFacts(region.rows.flatMap((row) => row.facts))
    const institutionColumnTotal = sumFacts(
        institutions.rows.flatMap((row) => row.facts),
    )
    const subdivisionColumnTotal = sumFacts(
        subdivisions.rows.flatMap((row) => row.facts),
    )

    return [
        makeCheck(
            'region_total_vs_columns',
            'Итог региона и сумма колонок СЭМД',
            regionTotal,
            regionColumnTotal,
            'warning',
        ),
        makeCheck(
            'region_vs_institutions',
            'Итог региона и сумма по МО',
            regionTotal,
            institutionTotal,
            'error',
        ),
        makeCheck(
            'region_vs_subdivisions',
            'Итог региона и сумма по подразделениям',
            regionTotal,
            subdivisionTotal,
            'error',
        ),
        makeCheck(
            'institution_totals_vs_columns',
            'Сумма итогов МО и колонок СЭМД по МО',
            institutionTotal,
            institutionColumnTotal,
            'warning',
        ),
        makeCheck(
            'subdivision_totals_vs_columns',
            'Сумма итогов подразделений и колонок СЭМД по подразделениям',
            subdivisionTotal,
            subdivisionColumnTotal,
            'warning',
        ),
        makeCheck(
            'region_columns_vs_institution_columns',
            'Колонки СЭМД региона и МО',
            regionColumnTotal,
            institutionColumnTotal,
            'warning',
        ),
        makeCheck(
            'region_columns_vs_subdivision_columns',
            'Колонки СЭМД региона и подразделений',
            regionColumnTotal,
            subdivisionColumnTotal,
            'warning',
        ),
    ]
}

function makeCheck(
    code: string,
    label: string,
    expected: number,
    actual: number,
    severity: RemdQualitySeverity,
): RemdReconciliationCheck {
    return {
        code,
        label,
        status: expected === actual ? 'passed' : 'failed',
        severity,
        expected,
        actual,
    }
}

function countActiveTypes(facts: RemdSparseFact[]): number {
    return new Set(
        facts.filter((fact) => fact.count > 0).map((fact) => fact.typeKey),
    ).size
}

function sumFacts(facts: RemdSparseFact[]): number {
    return facts.reduce((sum, fact) => sum + fact.count, 0)
}

function findHeaderColumn(
    headers: Map<number, string>,
    expectedStart: string,
): number | null {
    for (const [columnNumber, header] of headers) {
        if (header.startsWith(expectedStart)) return columnNumber
    }
    return null
}

function cellToText(cell: ExcelJS.Cell): string {
    const value = cell.result ?? cell.value
    if (value === null || typeof value === 'undefined') return ''
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        return String(value).trim()
    }
    if (value instanceof Date) return value.toISOString()
    if (typeof value === 'object') {
        if ('richText' in value && Array.isArray((value as any).richText)) {
            return (value as any).richText
                .map((part: any) => String(part?.text ?? ''))
                .join('')
                .trim()
        }
        if ('text' in value) return String((value as any).text ?? '').trim()
        if ('result' in value) return String((value as any).result ?? '').trim()
    }
    return String(value).trim()
}

function isMergedSlave(cell: ExcelJS.Cell): boolean {
    return cell.isMerged && cell.master.address !== cell.address
}

function normalizeText(value: string): string {
    return String(value || '')
        .replace(/ё/g, 'е')
        .replace(/\s+/g, ' ')
        .trim()
        .toLocaleLowerCase('ru-RU')
}

function normalizeKey(value: string): string {
    return normalizeText(value)
        .replace(/[^a-zа-я0-9]+/giu, ' ')
        .trim()
        .replace(/\s+/g, '_')
}

function russianDateToIso(value: string): string {
    const [day, month, year] = value.split('.')
    return `${year}-${month}-${day}`
}
