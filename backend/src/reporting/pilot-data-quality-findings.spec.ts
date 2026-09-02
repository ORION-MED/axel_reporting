import {
    addDataQualityFindings,
    addGisDirectoryConflictFindings,
} from './pilot-calculation.pure'
import type { FindingToSave } from './pilot-calculation.types'

const emptyInput = {
    numeratorImport: null,
    unknownSubdivisions: [],
    applicabilityRuleCount: 44,
    organizationsWithoutSubdivisions: [],
}

describe('addDataQualityFindings (правила P1–P5, согласовательный файл 23.07)', () => {
    it('P3: сообщает о видах из РЭМД, не сопоставленных со справочником 1520', () => {
        const findings: FindingToSave[] = []
        addDataQualityFindings(findings, {
            ...emptyInput,
            numeratorImport: {
                unmatchedDocumentTypeNames: ['Рецепт 107-1/у', 'Неизвестный вид'],
                unmatchedOrganizationOids: [],
            },
        })

        expect(findings).toHaveLength(1)
        expect(findings[0].findingCode).toBe('numerator_document_unmapped')
        expect(findings[0].severity).toBe('error')
        // Конкретика живёт в evidence и выводится чипами: в тексте причины перечисления нет.
        expect(findings[0].cause).not.toContain('Рецепт 107-1/у')
        expect(findings[0].cause).toContain('Для 2 видов документов')
        expect(findings[0].evidence).toEqual(expect.objectContaining({
            unmappedTypeCount: 2,
            unmappedTypeNames: ['Рецепт 107-1/у', 'Неизвестный вид'],
        }))
    })

    it('P3: молчит, когда все виды сопоставлены', () => {
        const findings: FindingToSave[] = []
        addDataQualityFindings(findings, {
            ...emptyInput,
            numeratorImport: {
                unmatchedDocumentTypeNames: [],
                unmatchedOrganizationOids: [],
            },
        })

        expect(findings).toHaveLength(0)
    })

    it('P1: по каждой несопоставленной организации даёт региональную находку', () => {
        const findings: FindingToSave[] = []
        addDataQualityFindings(findings, {
            ...emptyInput,
            numeratorImport: {
                unmatchedDocumentTypeNames: [],
                unmatchedOrganizationOids: ['1.2.643.5.1.13.13.12.3.45.999'],
            },
        })

        expect(findings).toHaveLength(1)
        expect(findings[0].findingCode).toBe('organization_not_in_directory')
        expect(findings[0].organizationOid).toBeNull()
        expect(findings[0].cause).toContain('1.2.643.5.1.13.13.12.3.45.999')
    })

    it('P2: сводит все подразделения без ФРМР в одну находку', () => {
        const findings: FindingToSave[] = []
        addDataQualityFindings(findings, {
            ...emptyInput,
            unknownSubdivisions: [
                { oid: '1.2.3.1', organizationName: 'МРБ №4', documentCount: 10 },
                { oid: '1.2.3.2', organizationName: 'МРБ №4', documentCount: 20 },
                { oid: '1.2.3.3', organizationName: 'КОПТД', documentCount: 30 },
            ],
        })

        expect(findings).toHaveLength(1)
        expect(findings[0].findingCode).toBe('subdivision_not_in_frmr')
        expect(findings[0].cause).toContain('3 подразделений')
        // OID не подставляются в текст — иначе причина превращается в стену из идентификаторов.
        expect(findings[0].cause).not.toContain('1.2.3.1')
        expect(findings[0].evidence).toEqual(expect.objectContaining({
            unknownSubdivisionCount: 3,
        }))
    })

    it('P2: тяжёлые подразделения идут первыми', () => {
        // Список читают сверху. Если первым встанет подразделение с одним документом,
        // методолог потратит время не на тот случай — а просила она именно примеры.
        const findings: FindingToSave[] = []
        addDataQualityFindings(findings, {
            ...emptyInput,
            unknownSubdivisions: [
                { oid: '1.2.3.1', organizationName: 'МРБ №4', documentCount: 10 },
                { oid: '1.2.3.2', organizationName: 'КОПТД', documentCount: 8081 },
                { oid: '1.2.3.3', organizationName: 'КООД', documentCount: 30 },
            ],
        })

        expect(findings[0].evidence).toEqual(expect.objectContaining({
            unknownSubdivisionOids: ['1.2.3.2', '1.2.3.3', '1.2.3.1'],
        }))
    })

    it('P2: основание называет МО и объём, а не только OID', () => {
        // По одному OID подразделение не найти. Методолог написала «мне надо посмотреть
        // пример, какое подразделение дало такой результат» — вот на это и отвечаем.
        const findings: FindingToSave[] = []
        addDataQualityFindings(findings, {
            ...emptyInput,
            unknownSubdivisions: [
                { oid: '1.2.3.1', organizationName: 'ГБУ «МРБ №4»', documentCount: 22798 },
            ],
        })

        expect(findings[0].evidence).toEqual(expect.objectContaining({
            unknownSubdivisions: [
                { oid: '1.2.3.1', organizationName: 'ГБУ «МРБ №4»', documentCount: 22798 },
            ],
        }))
    })

    it('P2: молчит, когда все подразделения нашлись в ФРМР', () => {
        // Находка считается от текущего справочника, а не от снимка импорта числителя:
        // после переимпорта ФРМР она должна пропадать сама, без перезагрузки числителя.
        const findings: FindingToSave[] = []
        addDataQualityFindings(findings, { ...emptyInput, unknownSubdivisions: [] })

        expect(findings).toHaveLength(0)
    })

    it('P4: сообщает, что матрица применимости не загружена вовсе', () => {
        const findings: FindingToSave[] = []
        addDataQualityFindings(findings, {
            ...emptyInput,
            applicabilityRuleCount: 0,
        })

        expect(findings).toHaveLength(1)
        expect(findings[0].findingCode).toBe('applicability_matrix_not_loaded')
        expect(findings[0].severity).toBe('error')
    })

    it('P5: адресует находку конкретной МО без подразделений в ФРМР', () => {
        const findings: FindingToSave[] = []
        addDataQualityFindings(findings, {
            ...emptyInput,
            organizationsWithoutSubdivisions: [
                { oid: '1.2.643.5.1.13.13.12.3.45.167', name: 'АО «Курганфармация»' },
            ],
        })

        expect(findings).toHaveLength(1)
        expect(findings[0].findingCode).toBe('organization_without_subdivisions')
        expect(findings[0].organizationOid).toBe('1.2.643.5.1.13.13.12.3.45.167')
        expect(findings[0].cause).toContain('АО «Курганфармация»')
    })
})

describe('addGisDirectoryConflictFindings (Р3, расхождение справочника и факта)', () => {
    it('сообщает о виде, помеченном «не реализован», но зарегистрированном в РЭМД', () => {
        const findings: FindingToSave[] = []
        addGisDirectoryConflictFindings(findings, [
            {
                semdTypeId: 'type-121',
                semdTypeName: 'Протокол цитологического исследования',
                registeredOrganizationCount: 1,
            },
        ])

        expect(findings).toHaveLength(1)
        expect(findings[0].findingCode).toBe('gis_directory_contradicts_remd_fact')
        expect(findings[0].severity).toBe('warning')
        expect(findings[0].semdTypeId).toBe('type-121')
        expect(findings[0].cause).toContain('организаций — 1')
    })

    it('молчит, когда расхождений нет', () => {
        const findings: FindingToSave[] = []
        addGisDirectoryConflictFindings(findings, [])

        expect(findings).toHaveLength(0)
    })
})
