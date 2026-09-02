import { BadRequestException } from '@nestjs/common'
import * as ExcelJS from 'exceljs'

/**
 * ТЗ 6.1.3.2.7 (agent_2026-07-15), п.1.3 — выгрузка ФРМР (`_Отчёт 19062026.xlsx`, лист
 * `frmr_depart`): записи о трудоустройстве медработников, одна строка на сотрудника, с
 * привязкой к OID организации и колонкой «Вид деятельности организации». Задача — не факты
 * о сотрудниках, а master-data «OID организации → вид деятельности», поэтому парсер сразу
 * схлопывает построчные записи до уникальных организаций. Используются текстовые значения
 * вида деятельности напрямую («Госпиталь», «Диспансер», ...) — собственная кодировка 1..9
 * из листа «Виды МО» это личная пометка Марины для себя, в реальных данных её нет.
 */
export const FRMR_PREFERRED_SHEET = 'frmr_depart'

export interface FrmrOrganizationRow {
    organizationOid: string
    organizationName: string
    activityType: string
}

/**
 * ТЗ 6.1.3.2.7 (delta 2026-07-17), п.1 — структурное подразделение из ФРМР. Собирается из
 * тех же построчных записей о сотрудниках, схлопнутых до уникальных подразделений (по
 * subdivisionOid). subdivisionType — 6 значений (Стационарный, Амбулаторный, ...),
 * subdivisionKind — ~214 значений; берутся текстом напрямую, без своей кодировки.
 */
export interface FrmrSubdivisionRow {
    organizationOid: string
    subdivisionOid: string
    subdivisionType: string
    subdivisionKind: string
    subdivisionName: string
}

export interface FrmrParseResult {
    sheetName: string
    recordCount: number
    organizations: FrmrOrganizationRow[]
    subdivisions: FrmrSubdivisionRow[]
    subdivisionTypeCount: number
    subdivisionKindCount: number
    warnings: string[]
}

export async function parseFrmrXlsx(fileBuffer: Buffer): Promise<FrmrParseResult> {
    if (!fileBuffer.length) {
        throw new BadRequestException('Файл ФРМР пуст')
    }
    const workbook = new ExcelJS.Workbook()
    try {
        await workbook.xlsx.load(fileBuffer as unknown as ExcelJS.Buffer)
    } catch {
        throw new BadRequestException('Не удалось прочитать XLSX файла ФРМР')
    }
    const sheet = workbook.getWorksheet(FRMR_PREFERRED_SHEET) ?? workbook.worksheets[0]
    if (!sheet) {
        throw new BadRequestException('В XLSX файла ФРМР не найдено ни одного листа')
    }

    const layout = findHeaderLayout(sheet)
    if (!layout) {
        throw new BadRequestException(
            `На листе «${sheet.name}» не найдены обязательные колонки «OID организации», «Вид деятельности организации»`,
        )
    }

    const organizationsByOid = new Map<string, FrmrOrganizationRow>()
    const subdivisionsByOid = new Map<string, FrmrSubdivisionRow>()
    const subdivisionTypes = new Set<string>()
    const subdivisionKinds = new Set<string>()
    const conflictingOids = new Set<string>()
    let recordCount = 0
    for (let rowNumber = layout.headerRowNumber + 1; rowNumber <= sheet.rowCount; rowNumber += 1) {
        const row = sheet.getRow(rowNumber)
        if (row.cellCount === 0) continue

        const organizationOid = cellValueToText(row.getCell(layout.organizationOidColumn).value)
        const activityType = cellValueToText(row.getCell(layout.activityTypeColumn).value)
        const organizationName = layout.organizationNameColumn
            ? cellValueToText(row.getCell(layout.organizationNameColumn).value)
            : ''
        if (!organizationOid && !activityType) continue
        if (!organizationOid || !activityType) continue

        recordCount += 1
        const existing = organizationsByOid.get(organizationOid)
        if (existing) {
            if (existing.activityType !== activityType) {
                conflictingOids.add(organizationOid)
            }
        } else {
            organizationsByOid.set(organizationOid, {
                organizationOid,
                organizationName,
                activityType,
            })
        }

        // Подразделения: та же строка сотрудника несёт привязку к подразделению.
        if (layout.subdivisionOidColumn) {
            const subdivisionOid = cellValueToText(row.getCell(layout.subdivisionOidColumn).value)
            if (subdivisionOid && !subdivisionsByOid.has(subdivisionOid)) {
                const subdivisionType = layout.subdivisionTypeColumn
                    ? cellValueToText(row.getCell(layout.subdivisionTypeColumn).value)
                    : ''
                const subdivisionKind = layout.subdivisionKindColumn
                    ? cellValueToText(row.getCell(layout.subdivisionKindColumn).value)
                    : ''
                const subdivisionName = layout.subdivisionNameColumn
                    ? cellValueToText(row.getCell(layout.subdivisionNameColumn).value)
                    : ''
                subdivisionsByOid.set(subdivisionOid, {
                    organizationOid,
                    subdivisionOid,
                    subdivisionType,
                    subdivisionKind,
                    subdivisionName,
                })
                if (subdivisionType) subdivisionTypes.add(subdivisionType)
                if (subdivisionKind) subdivisionKinds.add(subdivisionKind)
            }
        }
    }
    if (organizationsByOid.size === 0) {
        throw new BadRequestException(
            `На листе «${sheet.name}» не найдено ни одной записи с OID организации и видом деятельности`,
        )
    }

    const warnings: string[] = []
    if (conflictingOids.size > 0) {
        warnings.push(
            `Для ${conflictingOids.size} организаций в файле встречаются разные значения «Вид деятельности организации» — использовано первое встреченное значение.`,
        )
    }

    return {
        sheetName: sheet.name,
        recordCount,
        organizations: Array.from(organizationsByOid.values()),
        subdivisions: Array.from(subdivisionsByOid.values()),
        subdivisionTypeCount: subdivisionTypes.size,
        subdivisionKindCount: subdivisionKinds.size,
        warnings,
    }
}

interface HeaderLayout {
    headerRowNumber: number
    organizationOidColumn: number
    organizationNameColumn: number | null
    activityTypeColumn: number
    subdivisionOidColumn: number | null
    subdivisionTypeColumn: number | null
    subdivisionKindColumn: number | null
    subdivisionNameColumn: number | null
}

function findHeaderLayout(sheet: ExcelJS.Worksheet): HeaderLayout | null {
    for (let rowNumber = 1; rowNumber <= Math.min(sheet.rowCount, 20); rowNumber += 1) {
        const row = sheet.getRow(rowNumber)
        const headers = new Map<string, number>()
        row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
            headers.set(normalizeHeader(cellValueToText(cell.value)), colNumber)
        })
        const organizationOidColumn = headers.get('oidорганизации')
        const activityTypeColumn = headers.get('виддеятельностиорганизации')
        if (organizationOidColumn && activityTypeColumn) {
            return {
                headerRowNumber: rowNumber,
                organizationOidColumn,
                organizationNameColumn: headers.get('краткоенаименованиеорганизации') ?? null,
                activityTypeColumn,
                subdivisionOidColumn: headers.get('oidструктурногоподразделения') ?? null,
                subdivisionTypeColumn: headers.get('типструктурногоподразделения') ?? null,
                subdivisionKindColumn: headers.get('видструктурногоподразделения') ?? null,
                subdivisionNameColumn: headers.get('наименованиеструктурногоподразделения') ?? null,
            }
        }
    }
    return null
}

function normalizeHeader(value: string): string {
    return value.replace(/\s+/g, '').toLowerCase()
}

function cellValueToText(value: ExcelJS.CellValue): string {
    if (value === null || typeof value === 'undefined') return ''
    if (typeof value === 'object' && 'text' in value) {
        return String((value as { text: unknown }).text ?? '').trim()
    }
    if (typeof value === 'object' && 'result' in value) {
        return String((value as { result: unknown }).result ?? '').trim()
    }
    return String(value).trim()
}
