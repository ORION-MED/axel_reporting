import * as ExcelJS from 'exceljs'
import {
    BASELINE_COLUMN,
    CODE_COLUMN,
    ITEM_NUMBER_COLUMN,
    MONTH_COLUMNS,
    NAME_COLUMN,
    NOTES_COLUMN,
    UNIT_COLUMN,
    YEAR_END_COLUMN,
} from './target-plan-parser'

/**
 * Экспорт рассчитанных показателей в структуре шаблона «Приложение 2»
 * (см. target-plan-parser.ts, который читает этот же шаблон в обратную сторону).
 * Отдельный новый файл, оригинальный план не перезаписывается.
 *
 * С 15.08.2026 выгружается не один 6.1.3.2.7, а все показатели MVP — просьба
 * методолога: «чтобы получилась выгрузка по типу приложения 2, но уже
 * с рассчитанными показателями».
 *
 * **Колонки подписаны иначе, чем в оригинале.** В шаблоне в месячных колонках
 * стоит план, а здесь — факт, и в «конце года» — целевое. Оставить исходные
 * подписи значило бы отдать методологу файл, где факт выглядит планом.
 */

const MONTH_NAMES: Record<number, string> = {
    6: 'июнь',
    7: 'июль',
    8: 'авг.',
    9: 'сент.',
    10: 'окт.',
    11: 'нояб.',
}

const COLUMN_COUNT = Math.max(
    ITEM_NUMBER_COLUMN,
    NAME_COLUMN,
    CODE_COLUMN,
    UNIT_COLUMN,
    BASELINE_COLUMN,
    YEAR_END_COLUMN,
    NOTES_COLUMN,
    ...MONTH_COLUMNS.map(({ column }) => column),
)

export interface TargetPlanFactRow {
    itemNumber: string
    name: string
    indicatorCode: string
    unit: string
    baseline2025: number | null
    /** Calendar month (6-11) the fact value belongs to, or null if unknown/out of range. */
    factMonth: number | null
    factValue: number | null
    yearEndValue: number | null
    notes: string
}

export async function buildTargetPlanFactWorkbook(
    sheetName: string,
    rows: TargetPlanFactRow[],
): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook()
    const worksheet = workbook.addWorksheet(sheetName)

    const header = new Array<string>(COLUMN_COUNT).fill('')
    header[ITEM_NUMBER_COLUMN - 1] = '№ п/п'
    header[NAME_COLUMN - 1] = 'Наименование показателя'
    header[CODE_COLUMN - 1] = 'Номер показателя в соответствии с Соглашением о предоставлении МБТ в 2026 году'
    header[UNIT_COLUMN - 1] = 'Единица измерения (по ОКЕИ)'
    header[BASELINE_COLUMN - 1] = 'Базовое значение по итогам 2025 года'
    for (const { month, column } of MONTH_COLUMNS) {
        header[column - 1] = `${MONTH_NAMES[month]} (факт)`
    }
    header[YEAR_END_COLUMN - 1] = 'Целевое на конец 2026 года'
    header[NOTES_COLUMN - 1] = 'особенности'
    const headerRow = worksheet.addRow(header)
    headerRow.font = { bold: true }
    headerRow.alignment = { wrapText: true, vertical: 'top' }

    for (const row of rows) {
        const values = new Array<string | number | null>(COLUMN_COUNT).fill(null)
        values[ITEM_NUMBER_COLUMN - 1] = row.itemNumber
        values[NAME_COLUMN - 1] = row.name
        values[CODE_COLUMN - 1] = row.indicatorCode
        values[UNIT_COLUMN - 1] = row.unit
        values[BASELINE_COLUMN - 1] = row.baseline2025
        for (const { month, column } of MONTH_COLUMNS) {
            values[column - 1] = row.factMonth === month ? row.factValue : null
        }
        values[YEAR_END_COLUMN - 1] = row.yearEndValue
        values[NOTES_COLUMN - 1] = row.notes
        worksheet.addRow(values)
    }

    worksheet.getColumn(NAME_COLUMN).width = 60
    worksheet.getColumn(CODE_COLUMN).width = 42
    worksheet.getColumn(NOTES_COLUMN).width = 40
    for (const { column } of MONTH_COLUMNS) {
        worksheet.getColumn(column).width = 12
    }

    const buffer = await workbook.xlsx.writeBuffer()
    return Buffer.from(buffer)
}
