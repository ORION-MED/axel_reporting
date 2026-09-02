import {
    aggregateRemdFacts,
    groupRemdSubdivisionRows,
} from './remd-workbook-import.service'
import type {
    RemdSparseFact,
    RemdSubdivisionRow,
} from './remd-workbook-parser'

function subdivisionRow(
    overrides: Partial<RemdSubdivisionRow> = {},
): RemdSubdivisionRow {
    return {
        rowNumber: 10,
        regionName: 'Курганская область',
        institutionName: 'МО 1',
        institutionOid: '1.2.3',
        subdivisionOid: '1.2.3.1',
        subdivisionName: 'Поликлиника',
        isUnassigned: false,
        buildingId: '10',
        buildingName: 'Корпус',
        buildingAddress: 'Адрес',
        totalDocuments: 5,
        facts: [
            { columnKey: 'a|cda', typeKey: 'a', count: 3 },
            { columnKey: 'a|pdf', typeKey: 'a', count: 2 },
        ],
        ...overrides,
    }
}

describe('REMD workbook import aggregation', () => {
    it('sums document formats into one fact per SEMD type', () => {
        const facts: RemdSparseFact[] = [
            { columnKey: 'a|cda', typeKey: 'a', count: 3 },
            { columnKey: 'a|pdf', typeKey: 'a', count: 2 },
            { columnKey: 'b|cda', typeKey: 'b', count: 7 },
        ]

        expect(Object.fromEntries(aggregateRemdFacts(facts))).toEqual({
            a: 5,
            b: 7,
        })
    })

    it('keeps rows without subdivision identity in a synthetic subdivision', () => {
        const grouped = groupRemdSubdivisionRows([
            subdivisionRow({
                rowNumber: 20,
                subdivisionOid: null,
                subdivisionName: 'Без привязки к подразделению',
                isUnassigned: true,
                buildingId: '',
                buildingName: '',
                buildingAddress: '',
                totalDocuments: 4000,
                facts: [
                    { columnKey: 'a|cda', typeKey: 'a', count: 4000 },
                ],
            }),
            subdivisionRow({
                rowNumber: 21,
                subdivisionOid: null,
                subdivisionName: 'Без привязки к подразделению',
                isUnassigned: true,
                buildingId: '',
                buildingName: '',
                buildingAddress: '',
                totalDocuments: 568,
                facts: [
                    { columnKey: 'a|pdf', typeKey: 'a', count: 568 },
                ],
            }),
            subdivisionRow(),
        ])

        expect(grouped).toHaveLength(2)
        expect(grouped).toContainEqual(expect.objectContaining({
            organizationOid: '1.2.3',
            sourceKey: 'unassigned:1.2.3',
            externalOid: null,
            name: 'Без привязки к подразделению',
            isUnassigned: true,
            totalDocuments: 4568,
            rowNumbers: [20, 21],
            facts: new Map([['a', 4568]]),
        }))
    })
})
