import { BadRequestException } from '@nestjs/common'
import * as ExcelJS from 'exceljs'

/**
 * Parses "Помесячный план достижения показателей" — the official monthly target-value
 * plan for indicators under the federal transfer agreement (Прил. 2). One row per
 * indicator, plus section-header rows (item number blank) that are skipped.
 */

export interface TargetPlanRow {
    itemNumber: string
    name: string
    /** Extracted from the "Номер показателя" text, e.g. "6.1.3.2.7" or "1.7". Null if no pattern matched. */
    indicatorCode: string | null
    unit: string
    baseline2025: number | null
    /** Planned value per calendar month (6 = June .. 11 = November), 2026. */
    monthlyValues: Record<number, number | null>
    yearEndValue: number | null
    notes: string
}

export interface TargetPlanParseResult {
    sheetName: string
    rows: TargetPlanRow[]
}

const HEADER_MARKER = '№ п/п'

export const ITEM_NUMBER_COLUMN = 1 // A
export const NAME_COLUMN = 2 // B
export const CODE_COLUMN = 3 // C
export const UNIT_COLUMN = 4 // D
export const BASELINE_COLUMN = 5 // E
export const YEAR_END_COLUMN = 12 // L
export const NOTES_COLUMN = 14 // N

export const MONTH_COLUMNS: Array<{ month: number; column: number }> = [
    { month: 6, column: 6 }, // F: июнь
    { month: 7, column: 7 }, // G: июль
    { month: 8, column: 8 }, // H: авг.
    { month: 9, column: 9 }, // I: сент.
    { month: 10, column: 10 }, // J: окт.
    { month: 11, column: 11 }, // K: нояб.
]

function cellText(cell: ExcelJS.Cell | undefined): string {
    if (!cell) return ''
    const value = cell.value
    if (value === null || typeof value === 'undefined') return ''
    if (typeof value === 'object' && value !== null && 'richText' in (value as unknown as Record<string, unknown>)) {
        const richText = (value as { richText: Array<{ text: string }> }).richText
        return richText.map((part) => part.text).join('').trim()
    }
    return String(value).trim()
}

function toNullableNumber(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) return value
    if (typeof value === 'string') {
        const normalized = value.replace(',', '.').trim()
        if (!normalized) return null
        const parsed = Number(normalized)
        return Number.isFinite(parsed) ? parsed : null
    }
    return null
}

function extractIndicatorCode(rawCode: string): string | null {
    const longMatch = rawCode.match(/(\d+\.\d+\.\d+\.\d+\.\d+)/)
    if (longMatch) return longMatch[1]
    const mainMatch = rawCode.match(/(\d+\.\d+\.\d+\.\d+)/)
    if (mainMatch) return mainMatch[1]
    const additionalMatch = rawCode.match(/п\.\s*(\d+\.\d+)/)
    return additionalMatch ? additionalMatch[1] : null
}

export async function loadTargetPlanWorkbook(fileBuffer: Buffer): Promise<TargetPlanParseResult> {
    const workbook = new ExcelJS.Workbook()
    try {
        await workbook.xlsx.load(fileBuffer as any)
    } catch {
        throw new BadRequestException('Не удалось прочитать Excel-файл плана показателей')
    }
    const worksheet = workbook.worksheets[0]
    if (!worksheet) {
        throw new BadRequestException('В файле плана показателей не найден лист с данными')
    }

    let headerRowNumber: number | null = null
    worksheet.eachRow((row, rowNumber) => {
        if (headerRowNumber !== null) return
        if (cellText(row.getCell(ITEM_NUMBER_COLUMN)) === HEADER_MARKER) {
            headerRowNumber = rowNumber
        }
    })
    if (headerRowNumber === null) {
        throw new BadRequestException('Не найдена строка заголовков плана показателей')
    }

    const rows: TargetPlanRow[] = []
    worksheet.eachRow((row, rowNumber) => {
        if (rowNumber <= (headerRowNumber as number) + 1) return
        const itemNumber = cellText(row.getCell(ITEM_NUMBER_COLUMN))
        const codeRaw = cellText(row.getCell(CODE_COLUMN))
        if (!itemNumber || !codeRaw) return

        const monthlyValues: Record<number, number | null> = {}
        for (const { month, column } of MONTH_COLUMNS) {
            monthlyValues[month] = toNullableNumber(row.getCell(column).value)
        }

        rows.push({
            itemNumber,
            name: cellText(row.getCell(NAME_COLUMN)),
            indicatorCode: extractIndicatorCode(codeRaw),
            unit: cellText(row.getCell(UNIT_COLUMN)),
            baseline2025: toNullableNumber(row.getCell(BASELINE_COLUMN).value),
            monthlyValues,
            yearEndValue: toNullableNumber(row.getCell(YEAR_END_COLUMN).value),
            notes: cellText(row.getCell(NOTES_COLUMN)),
        })
    })

    if (rows.length === 0) {
        throw new BadRequestException('В файле плана показателей не найдено ни одной строки с данными')
    }

    return { sheetName: worksheet.name, rows }
}
