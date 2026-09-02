import * as ExcelJS from 'exceljs'
import { extractRemdNumerators } from './remd-import'

type WorksheetValue = string | number | null

function makeWorksheet(headers: string[], rows: WorksheetValue[][]): ExcelJS.Worksheet {
    const workbook = new ExcelJS.Workbook()
    const worksheet = workbook.addWorksheet('РЭМД')
    worksheet.addRow(['Отчет по количеству и видам СЭМД'])
    worksheet.addRow(headers)
    for (const row of rows) {
        worksheet.addRow(row)
    }
    return worksheet
}

function getItem(
    result: ReturnType<typeof extractRemdNumerators>,
    indicatorId: string,
) {
    const item = result.items.find((candidate) => candidate.indicatorId === indicatorId)
    if (!item) {
        throw new Error(`Indicator ${indicatorId} was not extracted`)
    }
    return item
}

describe('extractRemdNumerators', () => {
    it('applies the official aggregation rules for all five MVP indicators', () => {
        const worksheet = makeWorksheet(
            [
                'Служебная колонка',
                'OID медицинской организации',
                'Наименование медицинской организации',
                'Эпикриз по законченному случаю амбулаторный',
                'Протокол консультации',
                'Результаты профилактического медицинского осмотра (диспансеризации)',
                'Сведения о результатах диспансеризации или профилактического медицинского осмотра',
                'Эпикриз в стационаре выписной',
                'Выписной эпикриз из родильного дома',
                'Карта вызова скорой медицинской помощи',
                'Медицинское свидетельство о рождении',
            ],
            [
                ['x', '1.2.3.1', 'МО №1', 10, 5, 7, 9, 3, 2, 4, 1],
                ['x', '1.2.3.2', 'МО №2', 20, 6, 8, 1, 4, 1, 5, 2],
            ],
        )

        const result = extractRemdNumerators(worksheet, '2026-06-30')

        expect(result.organizationRows).toBe(2)
        expect(getItem(result, 'semd_outpatient_epicrisis').numerator).toBe(41)
        expect(getItem(result, 'semd_preventive_exam').numerator).toBe(15)
        expect(getItem(result, 'semd_inpatient_discharge').numerator).toBe(10)
        expect(getItem(result, 'semd_ambulance_call_card').numerator).toBe(9)
        expect(getItem(result, 'semd_birth_certificate').numerator).toBe(3)

        const preventive = getItem(result, 'semd_preventive_exam')
        expect(preventive.aggregation).toBe('max')
        expect(preventive.groups.find((group) => group.selected)?.key)
            .toBe('preventive_exam_results')
        expect(preventive.organizations.map((organization) => organization.numerator))
            .toEqual([7, 8])
    })

    it('sums the oncological inpatient discharge epicrisis into semd_inpatient_discharge', () => {
        const worksheet = makeWorksheet(
            [
                'Наименование медицинской организации',
                'OID медицинской организации',
                'Эпикриз в стационаре выписной',
                'Эпикриз в стационаре выписной (онкологический)',
                'Выписной эпикриз из родильного дома',
            ],
            [
                ['МО №1', '1.2.3.1', 10, 4, 1],
                ['МО №2', '1.2.3.2', 20, 6, 2],
            ],
        )

        const result = extractRemdNumerators(worksheet, '2026-06-30')

        // aggregation is 'sum', so both the inpatient (10+4 + 20+6 = 40) and
        // maternity (1 + 2 = 3) groups are combined into one numerator.
        expect(getItem(result, 'semd_inpatient_discharge').numerator).toBe(43)
    })

    it('sums all four death-certificate SEMD types into semd_death_certificate', () => {
        const worksheet = makeWorksheet(
            [
                'Наименование медицинской организации',
                'OID медицинской организации',
                'Медицинское свидетельство о смерти',
                'Документ, содержащий сведения медицинского свидетельства о смерти в бумажной форме',
                'Медицинское свидетельство о перинатальной смерти',
                'Документ, содержащий сведения медицинского свидетельства о перинатальной смерти в бумажной форме',
            ],
            [
                ['МО №1', '1.2.3.1', 10, 1, 2, 0],
                ['МО №2', '1.2.3.2', 20, 0, 1, 1],
            ],
        )

        const result = extractRemdNumerators(worksheet, '2026-06-30')

        expect(getItem(result, 'semd_death_certificate').numerator).toBe(35)
    })

    it('uses the globally selected preventive-exam group for organization rows', () => {
        const worksheet = makeWorksheet(
            [
                'Наименование медицинской организации',
                'OID медицинской организации',
                'Результаты профилактического медицинского осмотра (диспансеризации)',
                'Сведения о результатах диспансеризации или профилактического медицинского осмотра',
            ],
            [
                ['МО №1', '1.2.3.1', 9, 1],
                ['МО №2', '1.2.3.2', 0, 20],
            ],
        )

        const result = extractRemdNumerators(worksheet, '2026-12-31')
        const preventive = getItem(result, 'semd_preventive_exam')

        expect(preventive.numerator).toBe(21)
        expect(preventive.groups.find((group) => group.selected)?.key)
            .toBe('preventive_exam_information')
        expect(preventive.organizations.map((organization) => organization.numerator))
            .toEqual([1, 20])
        expect(preventive.organizations.reduce((sum, organization) => sum + organization.numerator, 0))
            .toBe(preventive.numerator)
    })

    it('uses only the Results SEMD for preventive exams from 2027', () => {
        const worksheet = makeWorksheet(
            [
                'Наименование медицинской организации',
                'OID медицинской организации',
                'Результаты профилактического медицинского осмотра (диспансеризации)',
            ],
            [
                ['МО №1', '1.2.3.1', 12],
                ['МО №2', '1.2.3.2', 8],
            ],
        )

        const result = extractRemdNumerators(worksheet, '2027-01-31')
        const preventive = getItem(result, 'semd_preventive_exam')

        expect(preventive.aggregation).toBe('sum')
        expect(preventive.numerator).toBe(20)
        expect(preventive.groups).toHaveLength(1)
        expect(preventive.groups[0].key).toBe('preventive_exam_results')
    })

    it('does not import a partial formula when a required column is missing', () => {
        const worksheet = makeWorksheet(
            [
                'Наименование медицинской организации',
                'OID медицинской организации',
                'Эпикриз по законченному случаю амбулаторный',
                'Карта вызова скорой медицинской помощи',
            ],
            [['МО №1', '1.2.3.1', 10, 4]],
        )

        const result = extractRemdNumerators(worksheet, '2026-06-30')

        expect(result.items.some((item) => item.indicatorId === 'semd_outpatient_epicrisis'))
            .toBe(false)
        expect(getItem(result, 'semd_ambulance_call_card').numerator).toBe(4)
        expect(result.warnings).toContain(
            'Показатель semd_outpatient_epicrisis не рассчитан: не найдена обязательная колонка «Протокол консультации».',
        )
    })

    it('does not confuse a consultation protocol with a protocol for follow-up care', () => {
        const worksheet = makeWorksheet(
            [
                'Наименование медицинской организации',
                'OID медицинской организации',
                'Эпикриз по законченному случаю амбулаторный',
                'Протокол консультации в рамках ДН',
                'Карта вызова СМП',
            ],
            [['МО №1', '1.2.3.1', 10, 100, 4]],
        )

        const result = extractRemdNumerators(worksheet, '2026-06-30')

        expect(result.items.some((item) => item.indicatorId === 'semd_outpatient_epicrisis'))
            .toBe(false)
        expect(getItem(result, 'semd_ambulance_call_card').numerator).toBe(4)
    })

    it('merges repeated organization rows with the same OID', () => {
        const worksheet = makeWorksheet(
            [
                'Наименование медицинской организации',
                'OID медицинской организации',
                'Карта вызова СМП',
            ],
            [
                ['МО №1', '1.2.3.1', 4],
                ['МО №1, филиал', '1.2.3.1', 6],
            ],
        )

        const result = extractRemdNumerators(worksheet, '2026-06-30')
        const ambulance = getItem(result, 'semd_ambulance_call_card')

        expect(result.organizationRows).toBe(2)
        expect(ambulance.numerator).toBe(10)
        expect(ambulance.organizations).toEqual([
            {
                oid: '1.2.3.1',
                name: 'МО №1',
                numerator: 10,
                components: { ambulance_call_card: 10 },
            },
        ])
        expect(result.warnings).toContain(
            'Найдены повторяющиеся строки МО с одинаковым OID: 1; их значения суммированы.',
        )
    })

    it('extracts optional denominators and targets from a combined demo file', () => {
        const worksheet = makeWorksheet(
            [
                'Наименование медицинской организации',
                'OID медицинской организации',
                'Карта вызова СМП',
                'Знаменатель 6.1.3.2.11',
                'Целевое значение 6.1.3.2.11, %',
            ],
            [
                ['МО №1', '1.2.3.1', 90, 100, 95],
                ['МО №2', '1.2.3.2', 180, 200, 95],
            ],
        )

        const result = extractRemdNumerators(worksheet, '2026-06-30')
        const ambulance = getItem(result, 'semd_ambulance_call_card')

        expect(ambulance.numerator).toBe(270)
        expect(ambulance.denominator).toBe(300)
        expect(ambulance.targetValue).toBe(95)
        expect(ambulance.denominatorColumn?.header).toBe('Знаменатель 6.1.3.2.11')
        expect(ambulance.targetColumn?.header).toBe('Целевое значение 6.1.3.2.11, %')
        expect(ambulance.organizations).toEqual([
            {
                oid: '1.2.3.1',
                name: 'МО №1',
                numerator: 90,
                denominator: 100,
                targetValue: 95,
                components: { ambulance_call_card: 90 },
            },
            {
                oid: '1.2.3.2',
                name: 'МО №2',
                numerator: 180,
                denominator: 200,
                targetValue: 95,
                components: { ambulance_call_card: 180 },
            },
        ])
    })

    it('sums optional denominators for repeated organization rows', () => {
        const worksheet = makeWorksheet(
            [
                'Наименование медицинской организации',
                'OID медицинской организации',
                'Карта вызова СМП',
                'Знаменатель 6.1.3.2.11',
                'Цель 6.1.3.2.11, %',
            ],
            [
                ['МО №1', '1.2.3.1', 40, 50, 95],
                ['МО №1, филиал', '1.2.3.1', 50, 60, 95],
            ],
        )

        const result = extractRemdNumerators(worksheet, '2026-06-30')
        const ambulance = getItem(result, 'semd_ambulance_call_card')

        expect(ambulance.denominator).toBe(110)
        expect(ambulance.organizations[0]).toMatchObject({
            oid: '1.2.3.1',
            numerator: 90,
            denominator: 110,
            targetValue: 95,
        })
    })
})
