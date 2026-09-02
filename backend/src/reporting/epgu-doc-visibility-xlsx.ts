import { BadRequestException } from '@nestjs/common'
import * as ExcelJS from 'exceljs'

/**
 * Roadmap Пакет A, задача 10 — новый справочник «Электронные медицинские документы,
 * отображаемые на ЕПГУ» (1.2.643.5.1.13.13.99.2.1253). В отличие от 1520 (см. emd-nsi-csv.ts),
 * здесь ключ вида МД называется doc_class_id, а признак видимости на ЕПГУ — doc_visible
 * (булево true/false, а не Да/Нет). doc_class_id соответствует тому же «Вид МД», что и TYPE
 * из 1520 — используется как ключ сопоставления с уже существующими reporting_semd_types.
 */
export const EPGU_DOC_VISIBILITY_DIRECTORY_OID = '1.2.643.5.1.13.13.99.2.1253'

const REQUIRED_HEADERS = [
    'doc_kind',
    'doc_title_full',
    'doc_title_short',
    'doc_category_title',
    'doc_class_id',
    'doc_visible',
    'doc_create_date',
] as const

export interface EpguDocVisibilityType {
    /** doc_class_id — «Вид МД», тот же ключ, что TYPE в справочнике 1520. */
    typeCode: string
    /** Представительный официальный OID (doc_kind) одной из строк этого вида МД. */
    officialOid: string
    titleFull: string
    titleShort: string
    categoryTitle: string
    visible: boolean
    rowCount: number
}

export interface EpguDocVisibilityParseResult {
    directoryOid: string
    sourceVersion: string | null
    rowCount: number
    types: EpguDocVisibilityType[]
    warnings: string[]
}

export async function parseEpguDocVisibilityXlsx(
    fileBuffer: Buffer,
    options: { originalFilename?: string },
): Promise<EpguDocVisibilityParseResult> {
    if (!fileBuffer.length) {
        throw new BadRequestException('Файл справочника видимости на ЕПГУ пуст')
    }
    const workbook = new ExcelJS.Workbook()
    try {
        await workbook.xlsx.load(fileBuffer as unknown as ExcelJS.Buffer)
    } catch {
        throw new BadRequestException(
            'Не удалось прочитать XLSX справочника видимости на ЕПГУ',
        )
    }
    const sheet = workbook.getWorksheet('Справочник') ?? workbook.worksheets[0]
    if (!sheet) {
        throw new BadRequestException(
            'В XLSX справочника видимости на ЕПГУ не найден лист «Справочник»',
        )
    }

    const headerRow = sheet.getRow(1)
    const actualHeaders: string[] = []
    headerRow.eachCell({ includeEmpty: false }, (cell) => {
        actualHeaders.push(String(cell.value ?? '').trim())
    })
    const missingHeaders = REQUIRED_HEADERS.filter(
        (header) => !actualHeaders.includes(header),
    )
    if (missingHeaders.length > 0) {
        throw new BadRequestException(
            `В XLSX справочника видимости на ЕПГУ отсутствуют обязательные колонки: ${missingHeaders.join(', ')}`,
        )
    }
    const columnIndex = new Map(
        actualHeaders.map((header, index) => [header, index + 1]),
    )
    const cell = (row: ExcelJS.Row, header: string): string => {
        const index = columnIndex.get(header)
        if (!index) return ''
        return cellValueToText(row.getCell(index).value)
    }

    const grouped = new Map<string, {
        officialOid: string
        titleFull: string
        titleShort: string
        categoryTitle: string
        visible: boolean
        rowCount: number
    }>()
    let rowCount = 0
    for (let rowNumber = 3; rowNumber <= sheet.rowCount; rowNumber += 1) {
        const row = sheet.getRow(rowNumber)
        if (row.cellCount === 0) continue
        const typeCode = cell(row, 'doc_class_id')
        if (!typeCode) continue
        rowCount += 1

        const oid = cell(row, 'doc_kind')
        const titleFull = cell(row, 'doc_title_full')
        const titleShort = cell(row, 'doc_title_short')
        const categoryTitle = cell(row, 'doc_category_title')
        const visible = parseBoolean(cell(row, 'doc_visible'), rowNumber)

        const existing = grouped.get(typeCode)
        if (existing) {
            existing.visible = existing.visible || visible
            existing.rowCount += 1
        } else {
            grouped.set(typeCode, {
                officialOid: oid,
                titleFull,
                titleShort,
                categoryTitle,
                visible,
                rowCount: 1,
            })
        }
    }
    if (rowCount === 0) {
        throw new BadRequestException(
            'XLSX справочника видимости на ЕПГУ не содержит записей',
        )
    }

    const types = Array.from(grouped.entries())
        .map(([typeCode, value]) => ({ typeCode, ...value }))
        .sort((left, right) => (
            numericCode(left.typeCode) - numericCode(right.typeCode)
            || left.typeCode.localeCompare(right.typeCode)
        ))

    return {
        directoryOid: EPGU_DOC_VISIBILITY_DIRECTORY_OID,
        sourceVersion: extractSourceVersion(options.originalFilename),
        rowCount,
        types,
        warnings: [],
    }
}

function parseBoolean(value: string, rowNumber: number): boolean {
    const normalized = value.trim().toLowerCase()
    if (normalized === 'true') return true
    if (normalized === 'false') return false
    throw new BadRequestException(
        `В строке ${rowNumber} поле doc_visible должно содержать true или false`,
    )
}

function cellValueToText(value: ExcelJS.CellValue): string {
    if (value === null || typeof value === 'undefined') return ''
    if (value instanceof Date) {
        return `${String(value.getUTCDate()).padStart(2, '0')}.`
            + `${String(value.getUTCMonth() + 1).padStart(2, '0')}.`
            + `${value.getUTCFullYear()}`
    }
    if (typeof value === 'object' && 'text' in value) {
        return String((value as { text: unknown }).text ?? '').trim()
    }
    if (typeof value === 'object' && 'result' in value) {
        return String((value as { result: unknown }).result ?? '').trim()
    }
    return String(value).trim()
}

function numericCode(value: string): number {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : Number.MAX_SAFE_INTEGER
}

function extractSourceVersion(filename?: string): string | null {
    const match = /_([0-9]+(?:\.[0-9]+)*)\.xlsx$/iu.exec(
        String(filename || '').trim(),
    )
    return match?.[1] ?? null
}
