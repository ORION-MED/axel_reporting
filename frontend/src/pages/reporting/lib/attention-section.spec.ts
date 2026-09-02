import { describe, expect, it } from 'vitest'
import type { PilotInstitutionSemdStatus } from '@shared/lib/reporting-api'
import {
    countAttentionTypes,
    isAttentionType,
    type InstitutionSemdType,
} from './reporting-helpers'

/**
 * В1 (ВКС 31.07.2026): «Внимание» — только виды, которые для МО не обязательны,
 * но она их формирует. Тест фиксирует поведение на всех значениях статуса, чтобы
 * добавление нового статуса в PilotInstitutionSemdStatus не проехало молча.
 */

const ALL_STATUSES: PilotInstitutionSemdStatus[] = [
    'required_registered',
    'required_missing',
    'required_gis_unavailable',
    'required_gis_unknown',
    'not_required',
    'not_required_registered',
    'unknown',
    'unknown_registered',
]

function semdType(
    overrides: Partial<InstitutionSemdType> = {},
): InstitutionSemdType {
    return {
        semdTypeId: Math.random().toString(36).slice(2),
        nsiTypeCode: '5',
        officialOid: null,
        officialName5pr: null,
        name: 'Протокол консультации',
        documentFormat: 'CDA',
        requirementStatus: 'not_required',
        baseRequirementStatus: 'not_required',
        requirementGrounds: [],
        resultStatus: 'not_required',
        documentCount: 0,
        registered: false,
        gisAvailable: null,
        requirementReason: '',
        requirementSource: '',
        baseRequirementReason: '',
        baseRequirementSource: '',
        manualOverride: null,
        evidence: [],
        ...overrides,
    }
}

describe('isAttentionType (В1)', () => {
    it('берёт вид, который не обязателен, но зарегистрирован', () => {
        expect(isAttentionType(semdType({ resultStatus: 'not_required_registered' })))
            .toBe(true)
    })

    it('берёт вид с неопределённой применимостью, но с регистрациями', () => {
        expect(isAttentionType(semdType({ resultStatus: 'unknown_registered' })))
            .toBe(true)
    })

    it('не берёт вид, который не требуется и не формируется', () => {
        // Контрольный пример методолога: «Выписной эпикриз из родильного дома»
        // у поликлиники — в поликлинике не рожают, разбираться не с чем.
        expect(isAttentionType(semdType({
            name: 'Выписной эпикриз из родильного дома',
            resultStatus: 'not_required',
        }))).toBe(false)
    })

    it('не берёт обязательные виды — им место на своих вкладках', () => {
        for (const status of [
            'required_registered',
            'required_missing',
            'required_gis_unavailable',
            'required_gis_unknown',
        ] as PilotInstitutionSemdStatus[]) {
            expect(isAttentionType(semdType({ resultStatus: status }))).toBe(false)
        }
    })

    it('из полного набора статусов во «Внимание» попадают ровно два', () => {
        const taken = ALL_STATUSES.filter(
            (status) => isAttentionType(semdType({ resultStatus: status })),
        )
        expect(taken).toEqual(['not_required_registered', 'unknown_registered'])
    })
})

describe('countAttentionTypes (В1)', () => {
    it('считает по тому же правилу, что и фильтр вкладки', () => {
        const types = [
            semdType({ resultStatus: 'required_registered' }),
            semdType({ resultStatus: 'not_required' }),
            semdType({ resultStatus: 'not_required' }),
            semdType({ resultStatus: 'not_required_registered' }),
            semdType({ resultStatus: 'unknown_registered' }),
        ]

        expect(countAttentionTypes(types)).toBe(2)
        expect(types.filter(isAttentionType)).toHaveLength(2)
    })

    it('на пустом списке даёт ноль', () => {
        expect(countAttentionTypes([])).toBe(0)
    })
})
