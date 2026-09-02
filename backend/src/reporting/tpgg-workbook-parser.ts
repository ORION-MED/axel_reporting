import { BadRequestException } from '@nestjs/common'
import * as ExcelJS from 'exceljs'

export type TpggSheetStatus = 'parsed' | 'skipped'

/**
 * Помесячная роспись объёма: номер месяца (1–12) → значение.
 *
 * Нужна знаменателю долей 6.1.3.2.8–6.1.3.2.11: с 15.08.2026 он считается
 * не от годового плана, а нарастающим итогом по месяц отчётной даты — иначе
 * семь месяцев факта делятся на двенадцать месяцев плана и все четыре
 * показателя оказываются в «критическом отклонении» на ровном месте.
 *
 * Месяцы 1–11 расписаны ровно, в декабрь падает остаток, поэтому накопительный
 * план **нельзя** получить как `годовой / 12 × N` — только суммой месяцев.
 */
export type TpggMonthlyValues = Record<number, number>

export interface TpggPlanEntry {
    sheetName: string
    sheetCode: string
    rowNumber: number
    organizationName: string
    normalizedOrganizationName: string
    annualValue: number
    /** Пустой объект, если у листа нет помесячной росписи. */
    monthlyValues: TpggMonthlyValues
}

export interface TpggSheetSummary {
    sheetName: string
    sheetCode: string
    status: TpggSheetStatus
    headerRowNumber: number | null
    organizationColumnNumber: number | null
    annualValueColumnNumber: number | null
    /** Строка с названиями месяцев; null, если помесячной росписи на листе нет. */
    monthHeaderRowNumber: number | null
    /** Сколько месяцев из двенадцати нашлось. Меньше двенадцати — повод для находки. */
    monthColumnCount: number
    parsedRowCount: number
    positiveRowCount: number
    annualValueTotal: number
    warning: string
}

export interface TpggWorkbookParseResult {
    reportingYear: number | null
    sheets: TpggSheetSummary[]
    entries: TpggPlanEntry[]
    warnings: string[]
}

interface TpggHeaderLayout {
    headerRowNumber: number
    organizationColumnNumber: number
    annualValueColumnNumber: number
}

interface TpggMonthLayout {
    monthHeaderRowNumber: number
    /** Номер месяца (1–12) → номер колонки. */
    columnsByMonth: Map<number, number>
}

const HEADER_SCAN_ROWS = 12

/**
 * Порядок важен: индекс + 1 даёт номер месяца. В шапках встречаются и полные
 * названия («сентябрь» на листах ТПГГ), и сокращения с точкой («авг.», «сент.»
 * в «Приложении 2»), поэтому ячейка сверяется с полным именем как его начало.
 */
const MONTH_NAMES: readonly string[] = [
    'январь', 'февраль', 'март', 'апрель', 'май', 'июнь',
    'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь',
]

/**
 * Ниже трёх букв сокращения неоднозначны: «ма» — это и март, и май,
 * «ию» — и июнь, и июль.
 */
const MIN_MONTH_ABBREVIATION = 3

/**
 * Меньше этого числа месяцев в строке — совпадение случайное, а не шапка росписи.
 * Порог невысокий: важнее не принять за шапку строку, где слово «май» попало
 * в название услуги, чем разобрать лист с неполной росписью.
 */
const MIN_MONTHS_FOR_HEADER = 6

export async function loadTpggWorkbook(
    fileBuffer: Buffer,
): Promise<TpggWorkbookParseResult> {
    const workbook = new ExcelJS.Workbook()
    try {
        await workbook.xlsx.load(fileBuffer as any)
    } catch {
        throw new BadRequestException(
            'Не удалось прочитать Excel-файл ТПГГ',
        )
    }
    return parseTpggWorkbook(workbook)
}

export function parseTpggWorkbook(
    workbook: ExcelJS.Workbook,
): TpggWorkbookParseResult {
    const sheets: TpggSheetSummary[] = []
    const entries: TpggPlanEntry[] = []
    const warnings: string[] = []

    for (const worksheet of workbook.worksheets) {
        const sheetCode = extractTpggSheetCode(worksheet.name)
        const header = findHeaderLayout(worksheet)
        if (!header) {
            const isContents = normalizeText(worksheet.name).includes('оглавлен')
            const warning = isContents
                ? ''
                : `Лист «${worksheet.name}» пропущен: не найдены колонки медицинской организации и годового итога.`
            sheets.push({
                sheetName: worksheet.name,
                sheetCode,
                status: 'skipped',
                headerRowNumber: null,
                organizationColumnNumber: null,
                annualValueColumnNumber: null,
                monthHeaderRowNumber: null,
                monthColumnCount: 0,
                parsedRowCount: 0,
                positiveRowCount: 0,
                annualValueTotal: 0,
                warning,
            })
            if (warning) warnings.push(warning)
            continue
        }

        const months = findMonthLayout(worksheet)
        const sheetEntries = parsePlanEntries(
            worksheet,
            sheetCode,
            header,
            months,
        )
        // Знаменатель долей считается нарастающим итогом по месяцам, поэтому лист
        // без росписи — не мелочь: по нему придётся откатываться на годовой план
        // и помечать расчёт предварительным. Молча пропустить это нельзя.
        if (!months) {
            const warning = `Лист «${worksheet.name}»: помесячная роспись не найдена, `
                + 'накопительный план по нему посчитать нельзя.'
            warnings.push(warning)
        } else if (months.columnsByMonth.size < 12) {
            warnings.push(
                `Лист «${worksheet.name}»: в помесячной росписи найдено `
                + `${months.columnsByMonth.size} месяцев из 12.`,
            )
        }
        entries.push(...sheetEntries)
        sheets.push({
            sheetName: worksheet.name,
            sheetCode,
            status: 'parsed',
            headerRowNumber: header.headerRowNumber,
            organizationColumnNumber: header.organizationColumnNumber,
            annualValueColumnNumber: header.annualValueColumnNumber,
            monthHeaderRowNumber: months?.monthHeaderRowNumber ?? null,
            monthColumnCount: months?.columnsByMonth.size ?? 0,
            parsedRowCount: sheetEntries.length,
            positiveRowCount: sheetEntries.filter(
                (entry) => entry.annualValue > 0,
            ).length,
            annualValueTotal: roundNumber(
                sheetEntries.reduce(
                    (sum, entry) => sum + entry.annualValue,
                    0,
                ),
            ),
            warning: '',
        })
    }

    if (entries.length === 0) {
        throw new BadRequestException(
            'В файле ТПГГ не найдены строки медицинских организаций с годовыми объемами',
        )
    }

    return {
        reportingYear: detectReportingYear(workbook),
        sheets,
        entries,
        warnings,
    }
}

export function normalizeTpggOrganizationName(value: string): string {
    return String(value ?? '')
        .replace(/№/g, ' ')
        .normalize('NFKC')
        .toLocaleLowerCase('ru-RU')
        .replace(/ё/g, 'е')
        .replace(/\bno(?=\s|\d|$)/g, ' ')
        .replace(/[«»„“”"']/g, ' ')
        .replace(/[^a-zа-я0-9]+/giu, ' ')
        .replace(/\s+/g, ' ')
        .trim()
}

export function extractTpggSheetCode(sheetName: string): string {
    const match = String(sheetName ?? '').match(/^\s*(\d+(?:\.\d+)*)/)
    return match?.[1] ?? ''
}

function findHeaderLayout(
    worksheet: ExcelJS.Worksheet,
): TpggHeaderLayout | null {
    const maxRow = Math.min(HEADER_SCAN_ROWS, worksheet.rowCount)
    for (let rowNumber = 1; rowNumber <= maxRow; rowNumber += 1) {
        let organizationColumnNumber: number | null = null
        let annualValueColumnNumber: number | null = null
        const maxColumn = Math.max(worksheet.columnCount, 1)
        for (
            let columnNumber = 1;
            columnNumber <= maxColumn;
            columnNumber += 1
        ) {
            const text = normalizeText(
                getCellText(
                    worksheet.getCell(rowNumber, columnNumber),
                ),
            )
            if (
                !organizationColumnNumber
                && text.includes('медицинская организация')
            ) {
                organizationColumnNumber = columnNumber
            }
            if (
                !annualValueColumnNumber
                && (
                    text === 'всего'
                    || text.startsWith('всего ')
                    || text.startsWith('всего,')
                    || text.includes('объемы всего')
                    || text.startsWith(
                        'объемы высокотехнологичной медицинской помощи',
                    )
                )
            ) {
                annualValueColumnNumber = columnNumber
            }
        }
        if (organizationColumnNumber && annualValueColumnNumber) {
            return {
                headerRowNumber: rowNumber,
                organizationColumnNumber,
                annualValueColumnNumber,
            }
        }
    }
    return null
}

/**
 * Ищет строку с названиями месяцев отдельно от основной шапки: в файле ТПГГ
 * она лежит на две строки ниже («Медицинская организация» и «Всего» стоят
 * в объединённых ячейках, под ними — кварталы, под ними — месяцы).
 *
 * Номера колонок по листам разные — 10–21 на «1.Скорая помощь», 9–20 на листах
 * 2.x, 8–19 на «5. Круглосуточный ст.», 5–16 на «3.10 Центры здоровья».
 * Поэтому ищем по тексту заголовка, а не по позиции: привязка к номеру колонки
 * развалилась бы на первом же листе с другой разметкой, причём молча.
 */
function findMonthLayout(
    worksheet: ExcelJS.Worksheet,
): TpggMonthLayout | null {
    const maxRow = Math.min(HEADER_SCAN_ROWS, worksheet.rowCount)
    const maxColumn = Math.max(worksheet.columnCount, 1)
    for (let rowNumber = 1; rowNumber <= maxRow; rowNumber += 1) {
        const columnsByMonth = new Map<number, number>()
        for (
            let columnNumber = 1;
            columnNumber <= maxColumn;
            columnNumber += 1
        ) {
            const month = matchMonthName(
                getCellText(worksheet.getCell(rowNumber, columnNumber)),
            )
            // Первое вхождение месяца выигрывает: правее могут стоять колонки
            // прошлого года или справочные, они не должны перетирать план.
            if (month && !columnsByMonth.has(month)) {
                columnsByMonth.set(month, columnNumber)
            }
        }
        if (columnsByMonth.size >= MIN_MONTHS_FOR_HEADER) {
            return { monthHeaderRowNumber: rowNumber, columnsByMonth }
        }
    }
    return null
}

function matchMonthName(value: string): number | null {
    // Точка сокращения — единственный мусор, который здесь допустим: ячейка
    // шапки росписи не содержит ничего, кроме названия месяца. «Майские
    // праздники» месяцем не станут — сравнение идёт с полным именем, а не
    // со строкой ячейки.
    const normalized = normalizeText(value).replace(/\.+$/, '')
    if (normalized.length < MIN_MONTH_ABBREVIATION) return null
    const index = MONTH_NAMES.findIndex(
        (name) => name.startsWith(normalized),
    )
    return index < 0 ? null : index + 1
}

function parsePlanEntries(
    worksheet: ExcelJS.Worksheet,
    sheetCode: string,
    header: TpggHeaderLayout,
    months: TpggMonthLayout | null,
): TpggPlanEntry[] {
    const result: TpggPlanEntry[] = []
    // Строка месяцев лежит ниже основной шапки — данные начинаются после неё.
    const firstDataRow = Math.max(
        header.headerRowNumber,
        months?.monthHeaderRowNumber ?? 0,
    ) + 1
    for (
        let rowNumber = firstDataRow;
        rowNumber <= worksheet.rowCount;
        rowNumber += 1
    ) {
        if (
            !isSequenceValue(
                getCellText(worksheet.getCell(rowNumber, 1)),
            )
        ) {
            continue
        }
        const organizationName = cleanText(
            getCellText(
                worksheet.getCell(
                    rowNumber,
                    header.organizationColumnNumber,
                ),
            ),
        )
        if (!organizationName) continue
        const annualValue = readNumericCell(
            worksheet.getCell(
                rowNumber,
                header.annualValueColumnNumber,
            ),
        )
        if (annualValue === null || annualValue < 0) continue
        result.push({
            sheetName: worksheet.name,
            sheetCode,
            rowNumber,
            organizationName,
            normalizedOrganizationName:
                normalizeTpggOrganizationName(organizationName),
            annualValue: roundNumber(annualValue),
            monthlyValues: readMonthlyValues(worksheet, rowNumber, months),
        })
    }
    return result
}

/**
 * Отрицательные и нечитаемые месячные значения пропускаются, а не обнуляются:
 * пустой месяц и месяц с мусором — разные вещи, и накопительный итог по второму
 * лучше не строить молча. Полнота росписи проверяется на уровне листа
 * (`monthColumnCount`), а не здесь.
 */
function readMonthlyValues(
    worksheet: ExcelJS.Worksheet,
    rowNumber: number,
    months: TpggMonthLayout | null,
): TpggMonthlyValues {
    if (!months) return {}
    const values: TpggMonthlyValues = {}
    for (const [month, columnNumber] of months.columnsByMonth) {
        const value = readNumericCell(worksheet.getCell(rowNumber, columnNumber))
        if (value === null || value < 0) continue
        values[month] = roundNumber(value)
    }
    return values
}

function readNumericCell(cell: ExcelJS.Cell): number | null {
    const raw = cell.value
    if (typeof raw === 'number' && Number.isFinite(raw)) return raw
    if (
        raw
        && typeof raw === 'object'
        && 'result' in raw
        && typeof raw.result === 'number'
        && Number.isFinite(raw.result)
    ) {
        return raw.result
    }
    const normalized = cleanText(getCellText(cell))
        .replace(/\s/g, '')
        .replace(',', '.')
    if (!normalized || !/^-?\d+(?:\.\d+)?$/.test(normalized)) return null
    const parsed = Number(normalized)
    return Number.isFinite(parsed) ? parsed : null
}

function isSequenceValue(value: string): boolean {
    const normalized = cleanText(value).replace(',', '.')
    if (!/^\d+(?:\.\d+)?$/.test(normalized)) return false
    return Number(normalized) > 0
}

function detectReportingYear(workbook: ExcelJS.Workbook): number | null {
    const candidates: number[] = []
    for (const worksheet of workbook.worksheets) {
        const searchable = [worksheet.name]
        for (
            let rowNumber = 1;
            rowNumber <= Math.min(3, worksheet.rowCount);
            rowNumber += 1
        ) {
            for (
                let columnNumber = 1;
                columnNumber <= Math.min(8, worksheet.columnCount);
                columnNumber += 1
            ) {
                searchable.push(
                    getCellText(
                        worksheet.getCell(rowNumber, columnNumber),
                    ),
                )
            }
        }
        for (const value of searchable) {
            for (const match of String(value ?? '').matchAll(/\b(20\d{2})\b/g)) {
                candidates.push(Number(match[1]))
            }
        }
    }
    if (candidates.length === 0) return null
    const counts = new Map<number, number>()
    for (const year of candidates) {
        counts.set(year, (counts.get(year) ?? 0) + 1)
    }
    return Array.from(counts.entries())
        .sort((left, right) => (
            right[1] - left[1]
            || right[0] - left[0]
        ))[0][0]
}

function normalizeText(value: string): string {
    return cleanText(value)
        .toLocaleLowerCase('ru-RU')
        .replace(/ё/g, 'е')
}

function cleanText(value: string): string {
    return String(value ?? '')
        .replace(/\s+/g, ' ')
        .trim()
}

function getCellText(cell: ExcelJS.Cell): string {
    try {
        return cell.text ?? ''
    } catch {
        const raw = cell.value
        if (raw === null || typeof raw === 'undefined') return ''
        if (typeof raw === 'string' || typeof raw === 'number') {
            return String(raw)
        }
        if (
            typeof raw === 'object'
            && 'result' in raw
            && (
                typeof raw.result === 'string'
                || typeof raw.result === 'number'
            )
        ) {
            return String(raw.result)
        }
        return ''
    }
}

function roundNumber(value: number): number {
    return Math.round(value * 1_000_000) / 1_000_000
}
