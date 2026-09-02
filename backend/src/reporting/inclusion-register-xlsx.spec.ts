import * as ExcelJS from 'exceljs'
import {
    extractSemdNames,
    parseInclusionRegisterXlsx,
    readSnapshot,
} from './inclusion-register-xlsx'

/**
 * Перечни входимости ТВСП от Минздрава. Семь файлов, семь слегка разных шапок —
 * проверяется, что разбор держит все различия, на которых он уже спотыкался.
 */

async function toBuffer(workbook: ExcelJS.Workbook): Promise<Buffer> {
    return Buffer.from(await workbook.xlsx.writeBuffer())
}

/** Перечень уровня здания — таких пять из семи. */
async function buildingRegister(): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet('Курганская область')
    sheet.addRow([
        'Перечень ТВСП МО, оказывающих первичную медико-санитарную помощь '
        + 'по профилю "Акушерство и гинекология", обеспечивающих передачу СЭМД '
        + '"Справка о постановке на учет по беременности" в РЭМД ЕГИСЗ '
        + 'по итогам июня 2026 года',
    ])
    sheet.addRow(['Субъект РФ', 'OID МО', 'Наименование МО', 'ID здания',
        'Наименование здания', 'Адрес здания', 'План', 'Факт'])
    sheet.addRow(['Курганская область', '1.2.3.4264', 'ГБУ "КАТАЙСКАЯ ЦРБ"',
        '55084', 'Поликлиника', 'г. Катайск', 1, 0])
    sheet.addRow(['Курганская область', '1.2.3.4266', 'ГБУ "ПЕРИНАТАЛЬНЫЙ ЦЕНТР"',
        '54566', 'Здание основного корпуса', 'г. Курган', 1, 1])
    return toBuffer(workbook)
}

describe('parseInclusionRegisterXlsx', () => {
    it('читает перечень уровня здания', async () => {
        const parsed = await parseInclusionRegisterXlsx(await buildingRegister())

        expect(parsed.rows).toHaveLength(2)
        expect(parsed.rows[0]).toMatchObject({
            organizationOid: '1.2.3.4264',
            buildingId: '55084',
            planValue: 1,
            factValue: 0,
        })
    })

    it('берёт месяц и год среза из заголовка', async () => {
        // Перечень — снимок, а не состояние: показатель по нему относится
        // к июню, а не к отчётной дате периода.
        const parsed = await parseInclusionRegisterXlsx(await buildingRegister())

        expect(parsed.month).toBe(6)
        expect(parsed.year).toBe(2026)
    })

    it('вид СЭМД берётся из кавычек, профиль помощи — нет', async () => {
        // В заголовке две пары кавычек: профиль «Акушерство и гинекология»
        // и собственно вид. Профиль видом не является.
        const parsed = await parseInclusionRegisterXlsx(await buildingRegister())

        expect(parsed.semdTypeNames)
            .toEqual(['Справка о постановке на учет по беременности'])
    })

    /**
     * «OID МО» набрано латинским OID и кириллическими МО. Сравнение
     * с латинским «oidmo» не срабатывало никогда — на этом разбор падал
     * на всех семи файлах сразу.
     */
    it('находит OID МО, набранный вперемешку латиницей и кириллицей', async () => {
        const parsed = await parseInclusionRegisterXlsx(await buildingRegister())

        expect(parsed.rows[0].organizationOid).toBe('1.2.3.4264')
    })

    /**
     * У перечня по виду 381 рядом с «План» и «Факт» стоят «Плановый список СП»
     * и «Фактический список СП». Поиск по началу строки утащил бы список
     * подразделений вместо числа.
     */
    it('не путает «План» с «Плановым списком СП»', async () => {
        const workbook = new ExcelJS.Workbook()
        const sheet = workbook.addWorksheet('Курганская область')
        sheet.addRow(['Перечень ТВСП МО … СЭМД "Первичный осмотр врачом приемного '
            + 'отделения" в РЭМД ЕГИСЗ по итогам июня 2026 года'])
        sheet.addRow(['Субъект РФ', 'OID МО', 'Наименование МО', 'Id здания',
            'Наименование здания', 'Адрес здания', 'Плановый список СП',
            'Фактический список СП', 'План', 'Факт'])
        sheet.addRow(['Курганская область', '1.2.3.4280', 'ГБУ "БСМП"', '61339',
            'Стационар', 'г. Курган', '1.2.3.4280.0.1', '1.2.3.4280.0.1', 1, 1])

        const parsed = await parseInclusionRegisterXlsx(await toBuffer(workbook))

        expect(parsed.rows[0]).toMatchObject({ planValue: 1, factValue: 1 })
    })

    it('читает перечень уровня подразделения', async () => {
        // У вида 141 строка — подразделение внутри здания, и OID СП не должен
        // попасть в колонку OID МО.
        const workbook = new ExcelJS.Workbook()
        const sheet = workbook.addWorksheet('Лист1')
        sheet.addRow(['Перечень ТВСП МО … СЭМД "Эпикриз по результатам '
            + 'диспансеризации" в РЭМД ЕГИСЗ по итогам июня 2026 года'])
        sheet.addRow(['Субъект РФ', 'OID_МО', 'Наименование', 'Вид_МО', 'Уровень_МО',
            'ID_Здания', 'Наименование_здания', 'Адрес_здания', 'OID_СП', 'Тип_СП',
            'Id вида_СП', 'Вид_СП', 'Наименование_СП', 'План', 'Факт'])
        sheet.addRow(['Курганская область', '1.2.3.4279', 'ГБУ "МРБ 4"', 'Больница',
            'I уровень', '221352', 'Здание', 'Юргамыш', '1.2.3.4279.0.77',
            'Амбулаторный', '1124', 'Поликлиники', 'Поликлиника', 1, 1])

        const parsed = await parseInclusionRegisterXlsx(await toBuffer(workbook))

        expect(parsed.rows[0]).toMatchObject({
            organizationOid: '1.2.3.4279',
            subdivisionOid: '1.2.3.4279.0.77',
            buildingId: '221352',
        })
    })

    it('файл без шапки перечня отклоняется', async () => {
        const workbook = new ExcelJS.Workbook()
        workbook.addWorksheet('Лист1').addRow(['что-то другое'])

        await expect(parseInclusionRegisterXlsx(await toBuffer(workbook)))
            .rejects.toThrow(/шапку перечня/i)
    })

    it('пустой файл отклоняется', async () => {
        await expect(parseInclusionRegisterXlsx(Buffer.alloc(0)))
            .rejects.toThrow(/пуст/i)
    })
})

describe('extractSemdNames', () => {
    it('возвращает оба вида, когда перечень назвал два', () => {
        const title = 'Перечень ТВСП МО, обеспечивающих передачу СЭМД '
            + '"Эпикриз по результатам диспансеризации/профилактического медицинского '
            + 'осмотра" и/или "Сведения о результатах диспансеризации или '
            + 'профилактического медицинского осмотра" в РЭМД ЕГИСЗ'

        expect(extractSemdNames(title)).toHaveLength(2)
    })

    it('кавычки-ёлочки читаются наравне с обычными', () => {
        expect(extractSemdNames('передачу СЭМД «Протокол инструментального исследования» в РЭМД'))
            .toEqual(['Протокол инструментального исследования'])
    })
})

describe('readSnapshot', () => {
    it('читает месяц и год из «по итогам июня 2026 года»', () => {
        expect(readSnapshot('… по итогам июня 2026 года')).toEqual({ month: 6, year: 2026 })
    })

    it('без месяца и года возвращает пустые значения', () => {
        expect(readSnapshot('Перечень ТВСП')).toEqual({ month: null, year: null })
    })
})
