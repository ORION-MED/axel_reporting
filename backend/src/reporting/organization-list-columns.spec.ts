import * as ExcelJS from 'exceljs'
import { loadApplicabilityMatrixWorkbook } from './applicability-matrix-xlsx'

/**
 * Колонки перечней МО в форме условий — решение ВКС 24.08.2026 по вопросу В-04.
 *
 * До них перечень писался свободным текстом в «Дополнительном условии»
 * («если МО - Бюро СМЭ»), и три наименования из формы — «Санаторий», «Диспансер»,
 * «Психоневрологический диспансер» — три недели не сопоставлялись ни с одной
 * из 37 медорганизаций, держа весь расчёт.
 */

const HEADERS = [
    '№',
    'Код Вид МД',
    'Документ',
    'Решение',
    'Тип подразделения',
    'Вид подразделения',
    'Дополнительное условие',
    'Только эти МО',
    'Все МО, кроме этих',
    'Комментарий методолога',
]

interface RowInput {
    code: string
    decision: string
    condition?: string
    only?: string
    except?: string
    subdivisionType?: string
}

async function parse(rows: RowInput[], withColumns = true) {
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet('Форма условий')
    sheet.addRow(withColumns ? HEADERS : [...HEADERS.slice(0, 7), HEADERS[9]])
    for (const row of rows) {
        const base = [
            '',
            row.code,
            'Документ',
            row.decision,
            row.subdivisionType ?? '',
            '',
            row.condition ?? '',
        ]
        sheet.addRow(withColumns
            ? [...base, row.only ?? '', row.except ?? '', '']
            : [...base, ''])
    }
    const buffer = await workbook.xlsx.writeBuffer()
    return loadApplicabilityMatrixWorkbook(Buffer.from(buffer))
}

describe('колонки перечней МО', () => {
    it('«Только эти МО» читается как перечень-включение', async () => {
        const { rules } = await parse([
            { code: '371', decision: 'обязателен', only: 'КООД' },
        ])

        expect(rules[0].conditionCode).toBe('organization_list')
        expect(rules[0].organizationNames).toEqual(['КООД'])
        expect(rules[0].conditionExcludesOrganizations).toBe(false)
    })

    it('«Все МО, кроме этих» читается как перечень-исключение', async () => {
        const { rules } = await parse([
            { code: '86', decision: 'обязателен', except: 'МАУЗ ГСП' },
        ])

        expect(rules[0].conditionCode).toBe('organization_list_except')
        expect(rules[0].organizationNames).toEqual(['МАУЗ ГСП'])
        expect(rules[0].conditionExcludesOrganizations).toBe(true)
    })

    it('перечень из нескольких МО разбирается через запятую', async () => {
        const { rules } = await parse([
            { code: '13', decision: 'обязателен', only: 'КОПАБ, КОБСМЭ' },
        ])

        expect(rules[0].organizationNames).toEqual(['КОПАБ', 'КОБСМЭ'])
    })

    it('ведущий пробел срезается', async () => {
        // Методолог набирает наименования руками: в форме от 25.08.2026 виды 353
        // и 354 пришли как «" КОПАБ, КОБСМЭ"».
        const { rules } = await parse([
            { code: '353', decision: 'обязателен', only: ' КОПАБ, КОБСМЭ' },
        ])

        expect(rules[0].organizationNames).toEqual(['КОПАБ', 'КОБСМЭ'])
    })

    it('колонка побеждает текст условия', async () => {
        // В новых редакциях формы прежний текст «если МО — …» остаётся следом
        // для сверки и уже не обновляется: у вида 7 в условии пять наименований,
        // а в колонке — четыре.
        const { rules } = await parse([
            {
                code: '7',
                decision: 'обязателен',
                condition: 'если МО НЕ КОПАБ, КОБСМЭ, КОСПК, ГСП, КОЦМП',
                except: 'КОПАБ, КОБСМЭ, КОСПК, МАУЗ ГСП',
            },
        ])

        expect(rules[0].organizationNames).toEqual(['КОПАБ', 'КОБСМЭ', 'КОСПК', 'МАУЗ ГСП'])
    })

    it('перечень работает и у решения «не обязателен»', async () => {
        // Перечень применяется к строке целиком, а не к слову «обязателен»:
        // у вида 85 стоит «не обязателен» с перечнем узкоспециализированных МО.
        const { rules } = await parse([
            { code: '85', decision: 'не обязателен', only: 'КООД, КОПНБ' },
        ])

        expect(rules[0].requirementStatus).toBe('not_required')
        expect(rules[0].conditionCode).toBe('organization_list')
    })

    it('пустые колонки не мешают прежнему разбору условия', async () => {
        const { rules } = await parse([
            { code: '13', decision: 'обязателен', condition: 'если МО НЕ КОПАБ' },
        ])

        expect(rules[0].conditionCode).toBe('organization_list_except')
        expect(rules[0].organizationNames).toEqual(['КОПАБ'])
    })

    it('форма без новых колонок читается по-старому', async () => {
        const { rules } = await parse(
            [{ code: '13', decision: 'обязателен', condition: 'если МО НЕ КОПАБ' }],
            false,
        )

        expect(rules[0].conditionCode).toBe('organization_list_except')
        expect(rules[0].organizationNames).toEqual(['КОПАБ'])
    })

    it('обе колонки сразу — побеждает «Только эти МО»', async () => {
        // Ошибка формы, о которой предупреждает её собственный лист контроля.
        // Сузить состав безопаснее, чем расширить.
        const { rules } = await parse([
            { code: '90', decision: 'обязателен', only: 'КОПНБ', except: 'МАУЗ ГСП' },
        ])

        expect(rules[0].conditionExcludesOrganizations).toBe(false)
        expect(rules[0].organizationNames).toEqual(['КОПНБ'])
    })
})
