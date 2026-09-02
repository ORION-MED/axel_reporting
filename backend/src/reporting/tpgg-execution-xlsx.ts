import { BadRequestException } from '@nestjs/common'
import * as ExcelJS from 'exceljs'

/**
 * Исполнение терпрограммы — файлы из папки «ТПГГ 2026 исполнение» (Д-10).
 *
 * Что это за данные. Прямо из листа «Текст ТЗ»: «Обеспечить формирование данных
 * на основе счетов, реестров счетов на оплату медицинской помощи, оказанной
 * застрахованным лицам». То есть территориальный фонд ОМС — то, что Николай
 * Ермаков на ВКС 24.08.2026 назвал «правдой» в отличие от «факта» из ГИС:
 * «реестры претерпевают очень хорошую местами механическую, местами
 * автоматизированную коррекцию… и потом вылизанный, вычищенный реестр уходит
 * в фонды».
 *
 * **Макетов пять, и они не сводятся к одному.** Файлы собраны разными
 * выгрузками фонда, и общего у них только смысл. Поэтому разбор выбирает макет
 * по составу листов, а не пытается угадать колонки универсально.
 *
 * **Код листа берётся из начала имени файла.** Он не записан внутри: в шапке
 * стоит название вида помощи, а не номер. Зато файлы названы ровно теми же
 * именами, что листы терпрограммы («3.2 Дисп.в.н.», «5. Круглосуточный ст.»),
 * и код листа ТПГГ сам берётся из начала имени листа — правило то же самое.
 * Исключение одно: файл «2.обращения…» несёт сразу три листа (2, 3 и 4),
 * они разложены по группам колонок и из имени не выводятся.
 */

/** Макеты, встреченные в выгрузке фонда за январь-июнь 2026. */
export type TpggExecutionLayout =
    | 'prevention'
    | 'emergency'
    | 'outpatient'
    | 'inpatient'
    | 'dispensary'

export interface TpggExecutionRow {
    organizationName: string
    /** Код листа ТПГГ (`reporting_tpgg_plan_values.sheet_code`). */
    sheetCode: string
    planValue: number
    factValue: number
}

export interface TpggExecutionInterval {
    from: { day: number; month: number; year: number }
    to: { day: number; month: number; year: number }
}

export interface TpggExecutionParseResult {
    layout: TpggExecutionLayout
    sheetName: string
    sheetCodes: string[]
    rows: TpggExecutionRow[]
    /** Интервал исполнения, если файл называет его обычными датами. */
    interval: TpggExecutionInterval | null
    warnings: string[]
}

const INTERVAL_PATTERN =
    /(\d{2})\.(\d{2})\.(\d{4})\s*[-–—]\s*(\d{2})\.(\d{2})\.(\d{4})/u
const INTERVAL_SCAN_ROWS = 8
const INTERVAL_SCAN_COLUMNS = 8

/**
 * Второй способ записи периода — месяцами словами: «за период: январь - июнь
 * 2026 г.». Так подписаны как раз файлы амбулаторной помощи, из которых берётся
 * знаменатель 6.1.3.2.8, и без этого разбора интервал у них оставался пустым.
 *
 * Основы даны без окончаний: в файлах встречаются и «январь», и «января».
 */
const MONTH_STEMS = [
    'январ', 'феврал', 'март', 'апрел', 'ма[йя]', 'июн',
    'июл', 'август', 'сентябр', 'октябр', 'ноябр', 'декабр',
]
const MONTH_NAMES_PATTERN = new RegExp(
    `(${MONTH_STEMS.join('|')})\\S*\\s*[-–—]\\s*(${MONTH_STEMS.join('|')})\\S*\\s*(\\d{4})`,
    'iu',
)

export async function parseTpggExecutionXlsx(
    fileBuffer: Buffer,
    originalFilename: string,
): Promise<TpggExecutionParseResult> {
    if (!fileBuffer.length) {
        throw new BadRequestException('Файл исполнения ТПГГ пуст')
    }
    const workbook = new ExcelJS.Workbook()
    try {
        await workbook.xlsx.load(fileBuffer as unknown as ExcelJS.Buffer)
    } catch {
        throw new BadRequestException('Не удалось прочитать XLSX файла исполнения ТПГГ')
    }

    const sheetByName = new Map(
        workbook.worksheets.map((sheet) => [sheet.name.trim(), sheet]),
    )

    const outpatient = sheetByName.get('Местное')
    if (outpatient) return parseOutpatient(outpatient)

    const prevention = sheetByName.get('Местные')
    if (prevention) {
        return parsePrevention(prevention, requireSheetCode(originalFilename))
    }

    const emergency = sheetByName.get('скорая')
    if (emergency) {
        return parseEmergency(emergency, requireSheetCode(originalFilename))
    }

    const inpatient = sheetByName.get('Сведения')
    if (inpatient) {
        return parseInpatient(inpatient, requireSheetCode(originalFilename))
    }

    const dispensary = workbook.worksheets.find(
        (sheet) => /диспансерное наблюдение/iu.test(sheet.name),
    )
    if (dispensary) {
        return parseDispensary(dispensary, requireSheetCode(originalFilename))
    }

    throw new BadRequestException(
        'Не удалось распознать файл исполнения ТПГГ: ожидались листы '
        + '«Местное», «Местные», «скорая», «Сведения» или «… Диспансерное '
        + 'наблюдение», а найдены '
        + `«${workbook.worksheets.map((sheet) => sheet.name).join('», «')}».`,
    )
}

/**
 * Профилактика, листы 3.2–3.9. Лист «Местные» — единственный, где есть и план,
 * и факт; «Общий свод» и «Иногородние» несут только факт.
 *
 * **Факт берётся из колонки «Человек», а не «Объемы, комплексных посещений».**
 * Это не очевидно: план подписан как объёмы, и напрашивается брать факт в тех же
 * единицах. Но собственный «Процент выполнения плана» фонда посчитан именно
 * от «Человек» — проверено по всем строкам листа 3.2: суммарное отклонение
 * от колонки «Человек» 0,0072 против 0,5627 от «Объёмов». Разница между
 * колонками по региону — 277 935 против 307 128, около десяти процентов
 * показателя, поэтому выбор не косметический.
 */
function parsePrevention(
    sheet: ExcelJS.Worksheet,
    sheetCode: string,
): TpggExecutionParseResult {
    const rows: TpggExecutionRow[] = []
    for (let rowNumber = 1; rowNumber <= sheet.rowCount; rowNumber += 1) {
        const row = sheet.getRow(rowNumber)
        const name = organizationName(row.getCell(2))
        if (!name) continue
        const plan = readNumber(row.getCell(3))
        const fact = readNumber(row.getCell(7))
        if (plan === null && fact === null) continue
        rows.push({
            organizationName: name,
            sheetCode,
            planValue: plan ?? 0,
            factValue: fact ?? 0,
        })
    }
    return finish('prevention', sheet, [sheetCode], rows)
}

/**
 * Скорая помощь, лист 1. Плоская таблица: план и факт в вызовах, рядом
 * стоимость — она не нужна.
 */
function parseEmergency(
    sheet: ExcelJS.Worksheet,
    sheetCode: string,
): TpggExecutionResultRows {
    const rows: TpggExecutionRow[] = []
    for (let rowNumber = 1; rowNumber <= sheet.rowCount; rowNumber += 1) {
        const row = sheet.getRow(rowNumber)
        const name = organizationName(row.getCell(2))
        if (!name) continue
        const plan = readNumber(row.getCell(3))
        const fact = readNumber(row.getCell(5))
        if (plan === null && fact === null) continue
        rows.push({
            organizationName: name,
            sheetCode,
            planValue: plan ?? 0,
            factValue: fact ?? 0,
        })
    }
    return finish('emergency', sheet, [sheetCode], rows)
}

/**
 * Амбулаторная помощь: один файл на три листа терпрограммы. Колонки идут
 * тройками «план / факт / %», и каждая тройка — свой лист:
 *
 * | Группа колонок | Лист ТПГГ |
 * |---|---|
 * | Неотложная помощь | 4 «Неотложная помощь» |
 * | Обращения по заболеваниям | 2 «обращения по заболеваниям» |
 * | Посещения с иными целями | 3 «Посещения с иными целями» |
 *
 * Соответствие проверено по именам листов терпрограммы, а не угадано: коды
 * 2, 3 и 4 стоят в знаменателе показателя 6.1.3.2.8 все три.
 */
function parseOutpatient(sheet: ExcelJS.Worksheet): TpggExecutionResultRows {
    const groups: Array<{ sheetCode: string; planColumn: number; factColumn: number }> = [
        { sheetCode: '4', planColumn: 3, factColumn: 4 },
        { sheetCode: '2', planColumn: 6, factColumn: 7 },
        { sheetCode: '3', planColumn: 9, factColumn: 10 },
    ]
    const rows: TpggExecutionRow[] = []
    for (let rowNumber = 1; rowNumber <= sheet.rowCount; rowNumber += 1) {
        const row = sheet.getRow(rowNumber)
        const name = organizationName(row.getCell(2))
        if (!name) continue
        for (const group of groups) {
            const plan = readNumber(row.getCell(group.planColumn))
            const fact = readNumber(row.getCell(group.factColumn))
            if (plan === null && fact === null) continue
            rows.push({
                organizationName: name,
                sheetCode: group.sheetCode,
                planValue: plan ?? 0,
                factValue: fact ?? 0,
            })
        }
    }
    return finish('outpatient', sheet, groups.map((group) => group.sheetCode), rows)
}

/**
 * Стационары, листы 5–9. Таблица сгруппирована по медорганизациям: строка
 * с наименованием, под ней строки профилей коек, в конце — «Итого:».
 *
 * Берётся именно строка «Итого:», а не сумма профилей. Она уже посчитана самим
 * фондом, и складывать профили заново значило бы завести второй способ получить
 * то же число — с риском разойтись на профиле, который выгрузка показывает,
 * но в итог не включает.
 *
 * Из тридцати колонок нужны две: «План госпитализаций / Всего» и «Фактически
 * предъявлено госпитализаций / Всего». Койко-дни и рубли к знаменателю
 * показателя 6.1.3.2.10 отношения не имеют — он про случаи.
 */
function parseInpatient(
    sheet: ExcelJS.Worksheet,
    sheetCode: string,
): TpggExecutionResultRows {
    const rows: TpggExecutionRow[] = []
    let currentOrganization = ''
    for (let rowNumber = 1; rowNumber <= sheet.rowCount; rowNumber += 1) {
        const row = sheet.getRow(rowNumber)
        const first = cellText(row.getCell(1))

        if (isTotalRow(first)) {
            if (!currentOrganization) continue
            rows.push({
                organizationName: currentOrganization,
                sheetCode,
                planValue: readNumber(row.getCell(16)) ?? 0,
                factValue: readNumber(row.getCell(20)) ?? 0,
            })
            currentOrganization = ''
            continue
        }
        // Заголовок группы. Проверять «вторая колонка пуста» нельзя: строка
        // наименования объединена по горизонтали, и ExcelJS отдаёт для ведомой
        // ячейки значение мастера — вторая колонка повторяет первую.
        // Отличает заголовок другое: у строк профилей в первой колонке стоит
        // порядковый номер, а у заголовка — текст.
        if (first && !isNumericText(first) && !isServiceHeader(first)) {
            currentOrganization = first
        }
    }
    return finish('inpatient', sheet, [sheetCode], rows)
}

/**
 * Диспансерное наблюдение, лист 2.2. Отличается от прочих тем, что наименование
 * МО стоит в третьей колонке, а объёмы разложены по группам заболеваний — БСК,
 * онкология, сахарный диабет, прочие.
 *
 * Берутся итоговые колонки «Диспансерное наблюдение, всего», а не сумма групп:
 * фонд посчитал их сам, и складывать заново значило бы завести второй способ
 * получить то же число.
 *
 * **Ни в один знаменатель этот лист не входит** — отдельного показателя
 * по диспансерному наблюдению нет. Файл разбирается, потому что методолог
 * прислала его вместе с остальными и попросила «подумать, как прикрутить
 * фактическое количество случаев к кривой количества СЭМДов в показателе 27»
 * (задача Д-21). До постановки данные просто лежат.
 */
function parseDispensary(
    sheet: ExcelJS.Worksheet,
    sheetCode: string,
): TpggExecutionParseResult {
    const rows: TpggExecutionRow[] = []
    for (let rowNumber = 1; rowNumber <= sheet.rowCount; rowNumber += 1) {
        const row = sheet.getRow(rowNumber)
        const name = organizationName(row.getCell(3))
        if (!name) continue
        const plan = readNumber(row.getCell(16))
        const fact = readNumber(row.getCell(18))
        if (plan === null && fact === null) continue
        rows.push({
            organizationName: name,
            sheetCode,
            planValue: plan ?? 0,
            factValue: fact ?? 0,
        })
    }
    return finish('dispensary', sheet, [sheetCode], rows)
}

type TpggExecutionResultRows = TpggExecutionParseResult

function finish(
    layout: TpggExecutionLayout,
    sheet: ExcelJS.Worksheet,
    sheetCodes: string[],
    rows: TpggExecutionRow[],
): TpggExecutionParseResult {
    if (rows.length === 0) {
        throw new BadRequestException(
            `На листе «${sheet.name}» не найдено ни одной строки исполнения`,
        )
    }
    const warnings = [
        `Файл распознан как исполнение ТПГГ (${layout}): лист «${sheet.name}», `
        + `листы терпрограммы ${sheetCodes.join(', ')}, строк ${rows.length}.`,
    ]
    return {
        layout,
        sheetName: sheet.name,
        sheetCodes,
        rows,
        interval: readInterval(sheet),
        warnings,
    }
}

/**
 * Код листа из имени файла: «3.2 Дисп.в.н..xlsx» → `3.2`, «5. Круглосуточный
 * ст..xlsx» → `5`. Без него строку не с чем сопоставить в терпрограмме, поэтому
 * это ошибка, а не предупреждение.
 */
export function requireSheetCode(originalFilename: string): string {
    const match = /^\s*(\d+(?:\.\d+)?)/u.exec(originalFilename)
    if (!match) {
        throw new BadRequestException(
            `Не удалось определить лист терпрограммы по имени файла «${originalFilename}». `
            + 'Имя должно начинаться с номера листа, как в терпрограмме: '
            + '«1.Скорая помощь.xlsx», «3.2 Дисп.в.н..xlsx».',
        )
    }
    return match[1]
}

/**
 * Интервал исполнения. Ищется двумя способами: обычными датами
 * («01.01.2026 - 30.06.2026») и месяцами словами («январь - июнь 2026 г.»).
 *
 * Даты пробуются первыми: они точнее и встречаются в файлах стационаров.
 * В файлах профилактики интервал записан так, что Excel превратил его
 * в «1999-01-01», — оттуда его не достать ни тем, ни другим способом,
 * и тогда `null`, а подпись в интерфейсе останется без месяцев.
 */
function readInterval(sheet: ExcelJS.Worksheet): TpggExecutionInterval | null {
    const lastRow = Math.min(sheet.rowCount, INTERVAL_SCAN_ROWS)
    const texts: string[] = []
    for (let rowNumber = 1; rowNumber <= lastRow; rowNumber += 1) {
        const row = sheet.getRow(rowNumber)
        for (let columnNumber = 1; columnNumber <= INTERVAL_SCAN_COLUMNS; columnNumber += 1) {
            const text = cellText(row.getCell(columnNumber))
            if (text) texts.push(text)
        }
    }

    for (const text of texts) {
        const match = INTERVAL_PATTERN.exec(text)
        if (!match) continue
        return {
            from: { day: Number(match[1]), month: Number(match[2]), year: Number(match[3]) },
            to: { day: Number(match[4]), month: Number(match[5]), year: Number(match[6]) },
        }
    }

    for (const text of texts) {
        const match = MONTH_NAMES_PATTERN.exec(text)
        if (!match) continue
        const from = monthNumberByStem(match[1])
        const to = monthNumberByStem(match[2])
        if (!from || !to) continue
        const year = Number(match[3])
        // День здесь не указан: период назван месяцами. Ставим первое и последнее
        // число, чтобы интервал оставался обычным диапазоном дат, — в базу всё
        // равно уходят только номера месяцев.
        return {
            from: { day: 1, month: from, year },
            to: { day: daysInMonth(to, year), month: to, year },
        }
    }

    return null
}

function monthNumberByStem(value: string): number | null {
    const low = value.toLowerCase()
    const index = MONTH_STEMS.findIndex(
        (stem) => new RegExp(`^(${stem})`, 'u').test(low),
    )
    return index >= 0 ? index + 1 : null
}

function daysInMonth(month: number, year: number): number {
    return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

/** Наименование МО или пусто, если строка — шапка, нумерация или итог. */
function organizationName(cell: ExcelJS.Cell): string {
    const text = cellText(cell)
    if (!text) return ''
    if (isNumericText(text)) return ''
    if (isTotalRow(text)) return ''
    if (isServiceHeader(text)) return ''
    return text
}

function isTotalRow(text: string): boolean {
    return /^итого/iu.test(text.trim())
}

/**
 * Строки шапки, попадающие в ту же колонку, что и наименования. Проверяются
 * по началу текста: у фонда в разных выгрузках они подписаны по-разному.
 */
function isServiceHeader(text: string): boolean {
    const normalized = text.trim().toLocaleLowerCase('ru-RU')
    return normalized === 'мо'
        || normalized === '№ п/п'
        || normalized === '№ п.п.'
        || normalized.startsWith('наименование медицинской')
        || normalized.startsWith('медицинская организаци')
        || normalized.startsWith('профиль отделений')
        || normalized.startsWith('круглосуточный стационар')
        || normalized.startsWith('дневной стационар')
        || normalized.startsWith('за период')
        || normalized.startsWith('плановый период')
        || normalized.startsWith('тип счета')
        || normalized.startsWith('вид данных')
        || normalized.startsWith('исполнение план')
        || normalized.startsWith('свод по принятым')
        // Служебная строка выборки в стационарных файлах: выглядит как
        // организация, но означает «все ЛПУ разом» и продублировала бы итог.
        || normalized.startsWith('все выбранные лпу')
}

function isNumericText(text: string): boolean {
    return /^\d+(?:[.,]\d+)?$/u.test(text.trim())
}

function readNumber(cell: ExcelJS.Cell): number | null {
    const value = cell.value
    if (value === null || value === undefined) return null
    if (typeof value === 'number') return Number.isFinite(value) ? value : null
    if (typeof value === 'object' && 'result' in value) {
        const result = (value as { result?: unknown }).result
        return typeof result === 'number' && Number.isFinite(result) ? result : null
    }
    const text = cellText(cell).replace(/\s/gu, '').replace(',', '.')
    if (!text) return null
    const parsed = Number(text)
    return Number.isFinite(parsed) ? parsed : null
}

function cellText(cell: ExcelJS.Cell): string {
    const value = cell.value
    if (value === null || value === undefined) return ''
    if (typeof value === 'string') return value.trim()
    if (typeof value === 'number') return String(value)
    if (value instanceof Date) return value.toISOString()
    if (typeof value === 'object') {
        if ('richText' in value && Array.isArray((value as ExcelJS.CellRichTextValue).richText)) {
            return (value as ExcelJS.CellRichTextValue).richText
                .map((part) => part.text)
                .join('')
                .trim()
        }
        if ('text' in value) return String((value as { text: unknown }).text ?? '').trim()
        if ('result' in value) return String((value as { result: unknown }).result ?? '').trim()
    }
    return String(value).trim()
}
