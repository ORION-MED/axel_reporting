import * as ExcelJS from 'exceljs'
import {
    parseTpggExecutionXlsx,
    requireSheetCode,
} from './tpgg-execution-xlsx'

/**
 * Разбор файлов исполнения терпрограммы (Д-10). Макетов пять, и проверяется
 * каждый: они собраны разными выгрузками фонда и общего в них только смысл.
 *
 * Фикстуры повторяют реальные файлы за январь-июнь 2026 — включая то, из-за чего
 * разбор ломался: объединённую по горизонтали строку наименования у стационаров
 * и строки «Итого:», которые нельзя принять за медорганизацию.
 */

async function toBuffer(workbook: ExcelJS.Workbook): Promise<Buffer> {
    return Buffer.from(await workbook.xlsx.writeBuffer())
}

/** Профилактика: лист «Местные», план в объёмах, факт в колонке «Человек». */
async function buildPreventionWorkbook(): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet('Местные')
    sheet.addRow(['Свод по принятым реестрам счетов'])
    sheet.addRow(['диспансеризации определенных групп'])
    sheet.addRow([null, null, null, 'За период с ', '01.01.2026', ' 2026г.    по', '30.06.2026'])
    sheet.addRow([])
    sheet.addRow([])
    sheet.addRow(['№ п.п.', 'МО', 'План', null, 'Процент выполнения плана'])
    sheet.addRow([null, null, 'Объемы, комплексных посещений', 'Стоимость', 'Объемы', 'Стоимость', 'Человек', 'Объемы, комплексных посещений'])
    sheet.addRow([])
    sheet.addRow([1, 'ГБУ "Шадринская ЦРБ"', 8618, 30200827.94, 0.2736, 0.3326, 2358, 2496])
    sheet.addRow([2, 'ГБУ "ШГБ"', 22349, 78319598.94, 0.3622, 0.4501, 8136, 9827])
    sheet.addRow([null, 'Итого:', 30967, null, null, null, 10494, 12323])
    workbook.addWorksheet('Общий свод')
    workbook.addWorksheet('Иногородние')
    return toBuffer(workbook)
}

/** Скорая: плоская таблица, план и факт в вызовах. */
async function buildEmergencyWorkbook(): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet('скорая')
    sheet.addRow(['Исполнение плановых объемов'])
    sheet.addRow(['№ п/п', 'Наименование медицинской организации', 'План на 2026 год', null, 'факт январь - июнь 2026'])
    sheet.addRow([])
    sheet.addRow([null, null, 'объемы, вызовы ', 'Стоимость', 'объемы, вызовы ', 'стоимость '])
    sheet.addRow([1, 'ГБУ "Курганская БСМП"', 87284, 490079280.22, 30251, 244884481.41])
    sheet.addRow([2, 'ГБУ «Межрайонная больница №8»', 6145, 34802968.32, 2218, 16782178.79])
    sheet.addRow(['Итого:', null, 93429, null, 32469])
    return toBuffer(workbook)
}

/** Амбулаторная помощь: три листа терпрограммы тремя группами колонок. */
async function buildOutpatientWorkbook(): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet('Местное')
    sheet.addRow([])
    sheet.addRow(['Исполнение плановых объемов'])
    sheet.addRow([])
    sheet.addRow(['№ п/п', 'Медицинская организация', 'Неотложная помощь', null, null, 'Обращения по заболеваниям', null, null, 'Посещения с иными целями'])
    sheet.addRow([null, null, 'план ', 'факт ', '%', 'план ', 'факт ', '%', 'план ', 'факт ', '%'])
    sheet.addRow([])
    sheet.addRow([1, 'ГБУ «Межрайонная больница №1»', 10365, 7112, 0.686, 28634, 19094, 0.667, 60165, 38331, 0.637])
    sheet.addRow([null, 'ИТОГО:', 10365, 7112, 0.686, 28634, 19094, 0.667, 60165, 38331, 0.637])
    workbook.addWorksheet('Иногороднее')
    return toBuffer(workbook)
}

/**
 * Стационар: группировка по МО. Строка наименования объединена по горизонтали —
 * ровно на этом разбор и споткнулся: ExcelJS отдаёт для ведомой ячейки значение
 * мастера, и «вторая колонка пуста» перестаёт быть признаком заголовка.
 */
async function buildInpatientWorkbook(): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet('Сведения')
    sheet.addRow(['Исполнение плана госпитализаций'])
    sheet.addRow(['МО', 'По всем'])
    sheet.addRow(['За период', ' -  01.01.2026 - 30.06.2026'])
    sheet.addRow(['Плановый период', '01.01.2026 - 31.12.2026'])
    sheet.addRow(['Тип счета', 'Местные'])
    sheet.addRow(['Вид данных', 'с учетом МЭК'])
    sheet.addRow(['№ п/п', 'Профиль отделений (коек)', 'Количество коек', 'План койко-дней'])
    sheet.addRow([null, null, null, '1 уровень ', '2 уровень ', '3 уровень ', 'Всего'])

    sheet.addRow(['ГБУ "ДАЛМАТОВСКАЯ ЦРБ" '])
    sheet.mergeCells(9, 1, 9, 4)
    sheet.addRow([null, 'Круглосуточный стационар'])
    const first = new Array(21).fill(null)
    first[0] = 1
    first[1] = 'гинекологические'
    first[15] = 150
    first[19] = 76
    sheet.addRow(first)
    const total = new Array(21).fill(null)
    total[0] = 'Итого:'
    total[15] = 1974
    total[19] = 1009
    sheet.addRow(total)

    sheet.addRow(['ГБУ "КАТАЙСКАЯ ЦРБ" '])
    sheet.mergeCells(13, 1, 13, 4)
    const secondTotal = new Array(21).fill(null)
    secondTotal[0] = 'Итого:'
    secondTotal[15] = 1978
    secondTotal[19] = 928
    sheet.addRow(secondTotal)
    return toBuffer(workbook)
}

describe('requireSheetCode', () => {
    it('берёт код листа из начала имени файла', () => {
        expect(requireSheetCode('3.2 Дисп.в.н..xlsx')).toBe('3.2')
        expect(requireSheetCode('5. Круглосуточный ст..xlsx')).toBe('5')
        expect(requireSheetCode('1.Скорая помощь.xlsx')).toBe('1')
    })

    it('без номера в имени отказывается угадывать', () => {
        // Сопоставить строку с терпрограммой без кода листа нечем, и молча
        // взять «какой-нибудь» значило бы сложить чужие объёмы.
        expect(() => requireSheetCode('исполнение.xlsx')).toThrow(/лист терпрограммы/i)
    })
})

describe('parseTpggExecutionXlsx', () => {
    it('профилактика: факт берётся из колонки «Человек»', async () => {
        // Не из «Объёмов»: собственный процент фонда посчитан от «Человек».
        // Разница по региону — 277 935 против 307 128, десятая часть показателя.
        const parsed = await parseTpggExecutionXlsx(
            await buildPreventionWorkbook(),
            '3.2 Дисп.в.н..xlsx',
        )

        expect(parsed.layout).toBe('prevention')
        expect(parsed.sheetCodes).toEqual(['3.2'])
        expect(parsed.rows).toEqual([
            {
                organizationName: 'ГБУ "Шадринская ЦРБ"',
                sheetCode: '3.2',
                planValue: 8618,
                factValue: 2358,
            },
            {
                organizationName: 'ГБУ "ШГБ"',
                sheetCode: '3.2',
                planValue: 22349,
                factValue: 8136,
            },
        ])
    })

    it('строка «Итого:» не становится медорганизацией', async () => {
        const parsed = await parseTpggExecutionXlsx(
            await buildPreventionWorkbook(),
            '3.2 Дисп.в.н..xlsx',
        )

        expect(parsed.rows.map((row) => row.organizationName))
            .not.toContain('Итого:')
    })

    it('скорая: план и факт в вызовах', async () => {
        const parsed = await parseTpggExecutionXlsx(
            await buildEmergencyWorkbook(),
            '1.Скорая помощь.xlsx',
        )

        expect(parsed.layout).toBe('emergency')
        expect(parsed.rows).toHaveLength(2)
        expect(parsed.rows[0]).toEqual({
            organizationName: 'ГБУ "Курганская БСМП"',
            sheetCode: '1',
            planValue: 87284,
            factValue: 30251,
        })
    })

    it('амбулаторный файл раскладывается на три листа терпрограммы', async () => {
        // Один файл — три знаменателя показателя 6.1.3.2.8.
        const parsed = await parseTpggExecutionXlsx(
            await buildOutpatientWorkbook(),
            '2.обращения по заболеваниям.xlsx',
        )

        expect(parsed.layout).toBe('outpatient')
        expect(parsed.sheetCodes).toEqual(['4', '2', '3'])
        const byCode = new Map(parsed.rows.map((row) => [row.sheetCode, row]))
        expect(byCode.get('4')).toMatchObject({ planValue: 10365, factValue: 7112 })
        expect(byCode.get('2')).toMatchObject({ planValue: 28634, factValue: 19094 })
        expect(byCode.get('3')).toMatchObject({ planValue: 60165, factValue: 38331 })
    })

    it('стационар: берётся строка «Итого:» своей медорганизации', async () => {
        // Наименование лежит в объединённой ячейке, и вторая колонка повторяет
        // первую — признаком заголовка служит текст вместо порядкового номера.
        const parsed = await parseTpggExecutionXlsx(
            await buildInpatientWorkbook(),
            '5. Круглосуточный ст..xlsx',
        )

        expect(parsed.layout).toBe('inpatient')
        expect(parsed.rows).toEqual([
            {
                organizationName: 'ГБУ "ДАЛМАТОВСКАЯ ЦРБ"',
                sheetCode: '5',
                planValue: 1974,
                factValue: 1009,
            },
            {
                organizationName: 'ГБУ "КАТАЙСКАЯ ЦРБ"',
                sheetCode: '5',
                planValue: 1978,
                factValue: 928,
            },
        ])
    })

    it('стационар: строки профилей в итог не попадают', async () => {
        // Складывать профили заново значило бы завести второй способ получить
        // то же число — фонд уже посчитал «Итого:».
        const parsed = await parseTpggExecutionXlsx(
            await buildInpatientWorkbook(),
            '5. Круглосуточный ст..xlsx',
        )

        expect(parsed.rows.map((row) => row.factValue)).not.toContain(76)
    })

    it('интервал исполнения читается, когда файл называет его датами', async () => {
        const parsed = await parseTpggExecutionXlsx(
            await buildInpatientWorkbook(),
            '5. Круглосуточный ст..xlsx',
        )

        expect(parsed.interval).toEqual({
            from: { day: 1, month: 1, year: 2026 },
            to: { day: 30, month: 6, year: 2026 },
        })
    })

    it('интервал читается и когда период назван месяцами словами', async () => {
        // Так подписаны файлы амбулаторной помощи — те самые, из которых берётся
        // знаменатель 6.1.3.2.8. Пока разбор знал только даты, интервал у них
        // оставался пустым, и блок «от факта» не знал, за какие месяцы считать план.
        const workbook = new ExcelJS.Workbook()
        const sheet = workbook.addWorksheet('Местное')
        sheet.addRow([])
        sheet.addRow([
            'Исполнение плановых объемов медицинской помощи в амбулаторных '
            + 'условиях за период: январь - июнь 2026 г.',
        ])
        sheet.addRow([])
        sheet.addRow(['№ п/п', 'Медицинская организация', 'Неотложная помощь', null, null, 'Обращения по заболеваниям', null, null, 'Посещения с иными целями'])
        sheet.addRow([null, null, 'план ', 'факт ', '%', 'план ', 'факт ', '%', 'план ', 'факт ', '%'])
        sheet.addRow([])
        sheet.addRow([1, 'ГБУ «Межрайонная больница №1»', 10365, 7112, 0.686, 28634, 19094, 0.667, 60165, 38331, 0.637])
        workbook.addWorksheet('Иногороднее')

        const parsed = await parseTpggExecutionXlsx(
            await toBuffer(workbook),
            '2.обращения по заболеваниям.xlsx',
        )

        expect(parsed.interval).toEqual({
            from: { day: 1, month: 1, year: 2026 },
            to: { day: 30, month: 6, year: 2026 },
        })
    })

    it('диспансерное наблюдение: наименование в третьей колонке, итоговые объёмы', async () => {
        // Лист 2.2 ни в один знаменатель не входит — разбирается ради Д-21,
        // чтобы файл не ронял загрузку остальных пятнадцати.
        const workbook = new ExcelJS.Workbook()
        const sheet = workbook.addWorksheet('6 Диспансерное наблюдение')
        sheet.addRow([])
        sheet.addRow(['Сведения о фактическом исполнении'])
        sheet.addRow([])
        sheet.addRow(['№ п/п', null, 'Медицинская организация', 'БСК, объемы'])
        sheet.addRow([null, null, null, 'план', 'факт', '%'])
        const data = new Array(19).fill(null)
        data[0] = 2
        data[1] = '450040'
        data[2] = 'ГБУ "Шадринская ЦРБ"'
        data[3] = 2497
        data[4] = 584
        data[15] = 3787
        data[17] = 750
        sheet.addRow(data)
        const total = new Array(19).fill(null)
        total[2] = 'ИТОГО'
        total[15] = 3787
        total[17] = 750
        sheet.addRow(total)

        const parsed = await parseTpggExecutionXlsx(
            await toBuffer(workbook),
            '2.2 Диспансерное наблюдение.xlsx',
        )

        expect(parsed.layout).toBe('dispensary')
        expect(parsed.rows).toEqual([
            {
                organizationName: 'ГБУ "Шадринская ЦРБ"',
                sheetCode: '2.2',
                planValue: 3787,
                factValue: 750,
            },
        ])
    })

    it('незнакомый набор листов отклоняется с перечислением найденных', async () => {
        const workbook = new ExcelJS.Workbook()
        workbook.addWorksheet('Что-то другое').addRow(['данные'])

        await expect(
            parseTpggExecutionXlsx(await toBuffer(workbook), '1.Файл.xlsx'),
        ).rejects.toThrow(/Что-то другое/)
    })

    it('пустой файл отклоняется', async () => {
        await expect(
            parseTpggExecutionXlsx(Buffer.alloc(0), '1.Файл.xlsx'),
        ).rejects.toThrow(/пуст/i)
    })
})
