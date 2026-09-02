import { BadRequestException } from '@nestjs/common'
import * as ExcelJS from 'exceljs'

/**
 * ТЗ 6.1.3.2.7 (agent_2026-07-15), п.1.2 — файл-числитель РЭМД в «тидy»-формате, как его
 * реально выгружает Марина (лист «Отчет по МО» файла
 * «ЭМД,_успешно_зарегистрированные_в_РЭМД4.xlsx»): одна строка на (МО, вид документа,
 * количество), а не одна колонка на вид документа, как в существующем remd-workbook-parser.ts.
 * «Вид МД» здесь уже дан без OID и без номера редакции — именно поэтому один и тот же «Вид МД»
 * может встречаться в нескольких строках одной МО (разные редакции/форматы) и факт по нему
 * нужно суммировать, а не выбирать одну строку (см. агрегацию в remd-numerator-import.service.ts).
 *
 * Из аналитической системы РЭМД выгрузка приходит в двух видах, и шаг 4 принимает оба:
 * — «тидy» (лист «Отчет по МО») — читается напрямую;
 * — «широкий» («Отчет РЭМД по подразделениям» / «Отчет РЭМД по МО», тот же файл, что читает
 *   remd-workbook-parser.ts) — одна колонка на вид документа; разворачивается в те же строки
 *   прямо здесь. Дальше по цепочке (агрегация, сопоставление алиасов, запись фактов) форматы
 *   неразличимы, поэтому логика импортёра общая.
 */
export const REMD_NUMERATOR_PREFERRED_SHEET = 'Отчет по МО'

/**
 * Листы широкого отчёта в порядке предпочтения. Лист по подразделениям даёт те же итоги, что
 * лист по МО (это сверяет remd-workbook-parser.ts проверкой region_vs_subdivisions), но
 * дополнительно несёт «OID СП МО» — разбивку, которую импортёр пишет отдельной таблицей.
 */
const REMD_WIDE_SHEET_PRIORITY = [
    'Отчет РЭМД по подразделениям',
    'Отчет РЭМД по МО',
]

export interface RemdNumeratorRow {
    organizationOid: string
    organizationName: string
    /** ТЗ delta 2026-07-17, п.2 — «OID СП МО»: структурное подразделение, сформировавшее документ. */
    subdivisionOid: string
    subdivisionName: string
    /**
     * Здание, в котором стоит подразделение. Методолог определила ТВСП именно так:
     * «ТВСП это равно здание, всё, что находится на каждом отдельном своём адресе»
     * (ВКС 24.08.2026). В «тидy»-выгрузке колонок здания нет — там поля пустые.
     */
    buildingId: string
    buildingName: string
    buildingAddress: string
    /** «Вид МД» — наименование документа без OID и номера редакции. */
    documentTypeName: string
    documentCount: number
}

/** Дата из шапки отчёта. Год нужен, чтобы не принять прошлогоднюю выгрузку за свежую. */
export interface RemdReportDate {
    day: number
    month: number
    year: number
}

/**
 * Интервал выгрузки из первой строки широкого отчёта:
 * «Отчет РЭМД за период 01.01.2026 - 31.07.2026».
 *
 * По нему помесячная выгрузка отличается от нарастающей — и это единственный
 * надёжный признак. Имя файла для этого не годится: методолог называет их
 * «7.Отчет СЭМД_РЭМД июль» и «7.Отчет СЭМД_РЭМД янв-июль», то есть номер
 * в начале у разных отчётов совпадает.
 */
export interface RemdReportInterval {
    from: RemdReportDate
    to: RemdReportDate
}

export interface RemdNumeratorParseResult {
    sheetName: string
    /** Формат исходной выгрузки: 'tidy' — лист «Отчет по МО», 'wide' — «Отчет РЭМД по …». */
    layout: 'tidy' | 'wide'
    rows: RemdNumeratorRow[]
    skippedRowCount: number
    warnings: string[]
    /**
     * Интервал выгрузки, если шапка отчёта его называет. `null` у «тидy»-файлов
     * и у широких отчётов без шапки — тогда месяц спрашивается у пользователя,
     * а не угадывается.
     */
    interval: RemdReportInterval | null
}

export async function parseRemdNumeratorXlsx(
    fileBuffer: Buffer,
): Promise<RemdNumeratorParseResult> {
    if (!fileBuffer.length) {
        throw new BadRequestException('Файл числителя РЭМД пуст')
    }
    const workbook = new ExcelJS.Workbook()
    try {
        await workbook.xlsx.load(fileBuffer as unknown as ExcelJS.Buffer)
    } catch {
        throw new BadRequestException('Не удалось прочитать XLSX файла числителя РЭМД')
    }
    if (workbook.worksheets.length === 0) {
        throw new BadRequestException(
            'В XLSX файла числителя РЭМД не найдено ни одного листа',
        )
    }

    const tidySheet = findTidySheet(workbook)
    if (tidySheet) {
        return parseTidySheet(tidySheet.sheet, tidySheet.layout)
    }

    const wideSheet = findWideSheet(workbook)
    if (wideSheet) {
        return parseWideSheet(wideSheet.sheet, wideSheet.layout)
    }

    const inspectedSheet = workbook.getWorksheet(REMD_NUMERATOR_PREFERRED_SHEET)
        ?? workbook.worksheets[0]
    throw new BadRequestException(
        `На листе «${inspectedSheet.name}» не найдены обязательные колонки «OID МО», «Вид МД», «Количество ЭМД». `
        + 'Ожидается выгрузка РЭМД одного из двух видов: «ЭМД, успешно зарегистрированные в РЭМД» '
        + `(лист «${REMD_NUMERATOR_PREFERRED_SHEET}») либо отчёт РЭМД с листом `
        + `«${REMD_WIDE_SHEET_PRIORITY[0]}» или «${REMD_WIDE_SHEET_PRIORITY[1]}».`,
    )
}

// ---------------------------------------------------------------------------
// «Тидy»-формат: лист «Отчет по МО»
// ---------------------------------------------------------------------------

interface TidyHeaderLayout {
    headerRowNumber: number
    organizationOidColumn: number
    organizationNameColumn: number
    subdivisionOidColumn: number | null
    subdivisionNameColumn: number | null
    documentTypeColumn: number
    documentCountColumn: number
}

function findTidySheet(
    workbook: ExcelJS.Workbook,
): { sheet: ExcelJS.Worksheet; layout: TidyHeaderLayout } | null {
    const preferred = workbook.getWorksheet(REMD_NUMERATOR_PREFERRED_SHEET)
    const candidates = preferred
        ? [preferred, ...workbook.worksheets.filter((sheet) => sheet !== preferred)]
        : workbook.worksheets
    for (const sheet of candidates) {
        const layout = findTidyHeaderLayout(sheet)
        if (layout) return { sheet, layout }
    }
    return null
}

function parseTidySheet(
    sheet: ExcelJS.Worksheet,
    layout: TidyHeaderLayout,
): RemdNumeratorParseResult {
    const rows: RemdNumeratorRow[] = []
    const warnings: string[] = []
    let skippedRowCount = 0
    for (let rowNumber = layout.headerRowNumber + 1; rowNumber <= sheet.rowCount; rowNumber += 1) {
        const row = sheet.getRow(rowNumber)
        if (row.cellCount === 0) continue

        const organizationOid = cellValueToText(row.getCell(layout.organizationOidColumn).value)
        const organizationName = cellValueToText(row.getCell(layout.organizationNameColumn).value)
        const documentTypeName = cellValueToText(row.getCell(layout.documentTypeColumn).value)
        const countText = cellValueToText(row.getCell(layout.documentCountColumn).value)
        const rawSubdivisionOid = layout.subdivisionOidColumn
            ? cellValueToText(row.getCell(layout.subdivisionOidColumn).value)
            : ''
        const rawSubdivisionName = layout.subdivisionNameColumn
            ? cellValueToText(row.getCell(layout.subdivisionNameColumn).value)
            : ''
        if (!organizationOid && !documentTypeName && !countText) continue

        if (!organizationOid || isEmptyPlaceholder(organizationOid) || !documentTypeName) {
            skippedRowCount += 1
            continue
        }
        const documentCount = Number(countText)
        if (!Number.isFinite(documentCount) || documentCount < 0) {
            throw new BadRequestException(
                `В строке ${rowNumber} листа «${sheet.name}» некорректное значение «Количество ЭМД»: «${countText}»`,
            )
        }

        const subdivisionOid = isEmptyPlaceholder(rawSubdivisionOid) ? '' : rawSubdivisionOid
        const subdivisionName = isEmptyPlaceholder(rawSubdivisionName) ? '' : rawSubdivisionName
        rows.push({
            organizationOid,
            organizationName,
            subdivisionOid,
            subdivisionName,
            // В «тидy»-выгрузке колонок здания нет вовсе.
            buildingId: '',
            buildingName: '',
            buildingAddress: '',
            documentTypeName,
            documentCount,
        })
    }
    if (rows.length === 0) {
        throw new BadRequestException(
            `На листе «${sheet.name}» не найдено ни одной строки с фактами`,
        )
    }
    if (skippedRowCount > 0) {
        warnings.push(
            `Пропущено строк без OID МО или без «Вид МД»: ${skippedRowCount}.`,
        )
    }

    return {
        sheetName: sheet.name,
        layout: 'tidy',
        rows,
        skippedRowCount,
        warnings,
        // «Тидy»-лист шапки с интервалом не несёт: там сразу заголовки колонок.
        interval: readReportInterval(sheet),
    }
}

function findTidyHeaderLayout(sheet: ExcelJS.Worksheet): TidyHeaderLayout | null {
    for (let rowNumber = 1; rowNumber <= Math.min(sheet.rowCount, 20); rowNumber += 1) {
        const row = sheet.getRow(rowNumber)
        const headers = new Map<string, number>()
        row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
            headers.set(normalizeHeader(cellValueToText(cell.value)), colNumber)
        })
        const organizationOidColumn = headers.get('oidмо')
        const documentTypeColumn = headers.get('видмд')
        const documentCountColumn = headers.get('количествоэмд')
        if (organizationOidColumn && documentTypeColumn && documentCountColumn) {
            return {
                headerRowNumber: rowNumber,
                organizationOidColumn,
                organizationNameColumn: headers.get('наименованиемо') ?? organizationOidColumn,
                subdivisionOidColumn: headers.get('oidспмо') ?? null,
                subdivisionNameColumn: headers.get('наименованиеспмо') ?? null,
                documentTypeColumn,
                documentCountColumn,
            }
        }
    }
    return null
}

// ---------------------------------------------------------------------------
// «Широкий» формат: листы «Отчет РЭМД по подразделениям» / «Отчет РЭМД по МО»
// ---------------------------------------------------------------------------

interface WideHeaderLayout {
    headerRowNumber: number
    regionColumn: number | null
    organizationOidColumn: number
    organizationNameColumn: number
    subdivisionOidColumn: number | null
    subdivisionNameColumn: number | null
    buildingIdColumn: number | null
    buildingNameColumn: number | null
    buildingAddressColumn: number | null
    /** «Количество всего» — собственный итог строки, служит контролем разворота. */
    totalDocumentsColumn: number
    semdStartColumn: number
}

interface WideSemdColumn {
    columnNumber: number
    name: string
}

function findWideSheet(
    workbook: ExcelJS.Workbook,
): { sheet: ExcelJS.Worksheet; layout: WideHeaderLayout } | null {
    const byPriority = REMD_WIDE_SHEET_PRIORITY
        .map((name) => workbook.getWorksheet(name))
        .filter((sheet): sheet is ExcelJS.Worksheet => Boolean(sheet))
    const rest = workbook.worksheets.filter((sheet) => !byPriority.includes(sheet))
    for (const sheet of [...byPriority, ...rest]) {
        const layout = findWideHeaderLayout(sheet)
        if (layout) return { sheet, layout }
    }
    return null
}

/**
 * Разворачивает широкий отчёт в те же строки, что даёт «тидy»-лист. Один и тот же вид документа
 * может занимать несколько колонок (CDA и PDF/A-1 — шапка объединена по горизонтали): каждая
 * непустая колонка даёт отдельную строку, а суммирование по «Виду МД» уже делает импортёр —
 * ровно так же, как для нескольких строк одной МО в «тидy»-файле.
 */
function parseWideSheet(
    sheet: ExcelJS.Worksheet,
    layout: WideHeaderLayout,
): RemdNumeratorParseResult {
    const semdColumns = readWideSemdColumns(sheet, layout)
    if (semdColumns.length === 0) {
        throw new BadRequestException(
            `На листе «${sheet.name}» не найдены колонки видов СЭМД`,
        )
    }

    const rows: RemdNumeratorRow[] = []
    const warnings: string[] = []
    let skippedRowCount = 0
    let dataRowCount = 0
    // Контроль разворота: сумма колонок видов должна сойтись с собственным итогом отчёта.
    let declaredTotal = 0
    let unpivotedTotal = 0
    // Шапка занимает две строки: наименования видов и под ними форматы документов.
    for (let rowNumber = layout.headerRowNumber + 2; rowNumber <= sheet.rowCount; rowNumber += 1) {
        const row = sheet.getRow(rowNumber)
        if (row.cellCount === 0) continue

        const regionName = layout.regionColumn
            ? cellValueToText(row.getCell(layout.regionColumn).value)
            : ''
        // Итоговая строка отчёта — не факт МО, её счётчики дублируют сумму по строкам.
        if (normalizeHeader(regionName) === 'итого') continue

        const organizationOid = cellValueToText(row.getCell(layout.organizationOidColumn).value)
        const organizationName = cellValueToText(row.getCell(layout.organizationNameColumn).value)
        if (!organizationOid && !organizationName && !regionName) continue

        dataRowCount += 1
        if (!organizationOid || isEmptyPlaceholder(organizationOid)) {
            skippedRowCount += 1
            continue
        }

        const rawSubdivisionOid = layout.subdivisionOidColumn
            ? cellValueToText(row.getCell(layout.subdivisionOidColumn).value)
            : ''
        const rawSubdivisionName = layout.subdivisionNameColumn
            ? cellValueToText(row.getCell(layout.subdivisionNameColumn).value)
            : ''
        const subdivisionOid = isEmptyPlaceholder(rawSubdivisionOid) ? '' : rawSubdivisionOid
        const subdivisionName = isEmptyPlaceholder(rawSubdivisionName) ? '' : rawSubdivisionName
        const building = {
            id: readWideText(row, layout.buildingIdColumn),
            name: readWideText(row, layout.buildingNameColumn),
            address: readWideText(row, layout.buildingAddressColumn),
        }
        declaredTotal += readWideCount(
            row.getCell(layout.totalDocumentsColumn).value,
            sheet.name,
            rowNumber,
        )

        for (const column of semdColumns) {
            const cell = row.getCell(column.columnNumber)
            // Выгрузка РЭМД объединяет ячейки данных по горизонтали (пары колонок форматов
            // одного вида), а ExcelJS отдаёт для «ведомой» ячейки значение мастера. Без этой
            // проверки такой факт учитывается дважды: на реальной выгрузке за 07.2026 сумма
            // расходилась с итогом отчёта ровно на объединённые ячейки.
            if (isMergedSlave(cell)) continue
            const documentCount = readWideCount(cell.value, sheet.name, rowNumber)
            if (documentCount === 0) continue
            unpivotedTotal += documentCount
            rows.push({
                organizationOid,
                organizationName,
                subdivisionOid,
                subdivisionName,
                buildingId: building.id,
                buildingName: building.name,
                buildingAddress: building.address,
                documentTypeName: column.name,
                documentCount,
            })
        }
    }

    if (rows.length === 0) {
        throw new BadRequestException(
            `На листе «${sheet.name}» не найдено ни одной строки с фактами`,
        )
    }
    warnings.push(
        `Файл распознан как широкий отчёт РЭМД: лист «${sheet.name}», `
        + `${semdColumns.length} колонок видов документов развёрнуты в ${rows.length} строк `
        + `по ${dataRowCount - skippedRowCount} записям.`,
    )
    if (skippedRowCount > 0) {
        warnings.push(
            `Пропущено строк без OID МО или без «Вид МД»: ${skippedRowCount}.`,
        )
    }
    // Собственный итог отчёта — единственная независимая проверка того, что развёрнуты ровно
    // те колонки и ровно один раз. Расхождение означает ошибку чтения файла, а не данных, и
    // должно быть видно в результате импорта, а не растворяться в факте показателя.
    if (declaredTotal !== unpivotedTotal) {
        warnings.push(
            `Сумма развёрнутых колонок (${unpivotedTotal}) не сошлась с колонкой «Количество всего» `
            + `листа «${sheet.name}» (${declaredTotal}); расхождение ${unpivotedTotal - declaredTotal}. `
            + 'Проверьте структуру выгрузки перед использованием факта.',
        )
    }

    return {
        sheetName: sheet.name,
        layout: 'wide',
        rows,
        skippedRowCount,
        warnings,
        interval: readReportInterval(sheet),
    }
}

function findWideHeaderLayout(sheet: ExcelJS.Worksheet): WideHeaderLayout | null {
    for (let rowNumber = 1; rowNumber <= Math.min(sheet.rowCount, 20); rowNumber += 1) {
        const row = sheet.getRow(rowNumber)
        const headers = new Map<number, string>()
        row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
            headers.set(colNumber, normalizeWideHeader(cellValueToText(cell.value)))
        })

        const organizationOidColumn = findWideColumn(headers, 'oid медицинской организации')
        const organizationNameColumn = findWideColumn(headers, 'наименование медицинской организации')
        // Колонки видов СЭМД начинаются сразу за общим итогом строки — та же договорённость,
        // что и в remd-workbook-parser.ts.
        const totalDocumentsColumn = findWideColumn(headers, 'количество всего')
        if (!organizationOidColumn || !organizationNameColumn || !totalDocumentsColumn) {
            continue
        }
        return {
            headerRowNumber: rowNumber,
            regionColumn: findWideColumn(headers, 'наименование субъекта российской федерации'),
            organizationOidColumn,
            organizationNameColumn,
            subdivisionOidColumn: findWideColumn(headers, 'oid сп мо'),
            subdivisionNameColumn: findWideColumn(headers, 'название сп мо'),
            buildingIdColumn: findWideColumn(headers, 'id здания'),
            buildingNameColumn: findWideColumn(headers, 'название здания'),
            buildingAddressColumn: findWideColumn(headers, 'адрес здания'),
            totalDocumentsColumn,
            semdStartColumn: totalDocumentsColumn + 1,
        }
    }
    return null
}

function readWideSemdColumns(
    sheet: ExcelJS.Worksheet,
    layout: WideHeaderLayout,
): WideSemdColumn[] {
    const headerRow = sheet.getRow(layout.headerRowNumber)
    const formatRow = sheet.getRow(layout.headerRowNumber + 1)
    const maxColumn = Math.max(sheet.columnCount, headerRow.cellCount, formatRow.cellCount)
    const columns: WideSemdColumn[] = []
    let currentName = ''

    for (let columnNumber = layout.semdStartColumn; columnNumber <= maxColumn; columnNumber += 1) {
        const headerCell = headerRow.getCell(columnNumber)
        const headerName = cellValueToText(headerCell.value)
        const documentFormat = cellValueToText(formatRow.getCell(columnNumber).value)
        if (headerName) currentName = headerName
        if (!currentName) continue
        // Наименование вида объединено по колонкам форматов (CDA / PDF/A-1), поэтому имя
        // переносится вправо. Признак конца таблицы — пустая колонка и в шапке, и в строке
        // форматов: дальше идут служебные колонки листа, их разворачивать не нужно.
        if (!headerName && !documentFormat && !isMergedSlave(headerCell)) {
            currentName = ''
            continue
        }
        columns.push({ columnNumber, name: currentName })
    }

    return columns
}

/** Текст необязательной колонки: её может не быть в макете вовсе. */
function readWideText(row: ExcelJS.Row, column: number | null | undefined): string {
    if (!column) return ''
    const text = cellValueToText(row.getCell(column).value)
    return isEmptyPlaceholder(text) ? '' : text
}

function readWideCount(
    value: ExcelJS.CellValue,
    sheetName: string,
    rowNumber: number,
): number {
    const text = cellValueToText(value)
    if (!text) return 0
    const documentCount = Number(text.replace(/\s/g, '').replace(',', '.'))
    if (!Number.isFinite(documentCount) || documentCount < 0) {
        throw new BadRequestException(
            `В строке ${rowNumber} листа «${sheetName}» некорректное значение «Количество ЭМД»: «${text}»`,
        )
    }
    return documentCount
}

function findWideColumn(
    headers: Map<number, string>,
    expectedStart: string,
): number | null {
    for (const [columnNumber, header] of headers) {
        if (header.startsWith(expectedStart)) return columnNumber
    }
    return null
}

function isMergedSlave(cell: ExcelJS.Cell): boolean {
    return cell.isMerged && cell.master.address !== cell.address
}

// ---------------------------------------------------------------------------
// Общее
// ---------------------------------------------------------------------------

/**
 * Интервал выгрузки из шапки отчёта. Ищется в первых строках листа, потому что
 * в присланных файлах строка стоит первой, но лишний отступ сверху — обычная
 * правка вручную, из-за которой разбор не должен ломаться.
 *
 * Формат дат в шапке один: `дд.мм.гггг`. Разделитель между датами встречается
 * и обычным дефисом, и длинным тире — берём любой.
 */
function readReportInterval(sheet: ExcelJS.Worksheet): RemdReportInterval | null {
    const lastRow = Math.min(sheet.rowCount, REPORT_INTERVAL_SCAN_ROWS)
    for (let rowNumber = 1; rowNumber <= lastRow; rowNumber += 1) {
        const row = sheet.getRow(rowNumber)
        if (row.cellCount === 0) continue
        const text = cellValueToText(row.getCell(1).value)
        const match = REPORT_INTERVAL_PATTERN.exec(text)
        if (!match) continue
        const from = toReportDate(match[1], match[2], match[3])
        const to = toReportDate(match[4], match[5], match[6])
        if (!from || !to) continue
        return { from, to }
    }
    return null
}

const REPORT_INTERVAL_SCAN_ROWS = 5
const REPORT_INTERVAL_PATTERN =
    /(\d{2})\.(\d{2})\.(\d{4})\s*[-–—]\s*(\d{2})\.(\d{2})\.(\d{4})/u

/** `null` вместо выброса: неразобранная шапка — повод спросить месяц, а не отклонить файл. */
function toReportDate(day: string, month: string, year: string): RemdReportDate | null {
    const parsed = {
        day: Number(day),
        month: Number(month),
        year: Number(year),
    }
    if (parsed.month < 1 || parsed.month > 12) return null
    if (parsed.day < 1 || parsed.day > 31) return null
    return parsed
}

function normalizeHeader(value: string): string {
    return value.replace(/\s+/g, '').toLowerCase()
}

/**
 * Заголовки широкого отчёта многострочные («Количество всего\n(суммарное количество ЭМД…)»),
 * поэтому сравниваем по началу строки, а пробелы схлопываем, а не удаляем.
 */
function normalizeWideHeader(value: string): string {
    return value
        .replace(/ё/gi, 'е')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase()
}

function isEmptyPlaceholder(value: string): boolean {
    return value === '<Пусто>' || value === ''
}

function cellValueToText(value: ExcelJS.CellValue): string {
    if (value === null || typeof value === 'undefined') return ''
    if (typeof value === 'object' && 'richText' in value && Array.isArray(value.richText)) {
        return value.richText
            .map((part) => String(part?.text ?? ''))
            .join('')
            .trim()
    }
    if (typeof value === 'object' && 'text' in value) {
        return String((value as { text: unknown }).text ?? '').trim()
    }
    if (typeof value === 'object' && 'result' in value) {
        return String((value as { result: unknown }).result ?? '').trim()
    }
    return String(value).trim()
}
