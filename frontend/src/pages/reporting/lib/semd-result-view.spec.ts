import { describe, expect, it } from 'vitest'
import type { PilotInstitutionSemdStatus } from '@shared/lib/reporting-api'
import {
    compactRequirementReason,
    requirementMarker,
    semdResultView,
    type InstitutionSemdType,
} from './reporting-helpers'

/**
 * В2 (ВКС 31.07.2026): в графе «Результат» остаётся только факт регистрации в РЭМД,
 * колонка «Применимость» убрана. Тест держит формулировки: методолог согласовала
 * ровно пару «Зарегистрирован / Не зарегистрирован в РЭМД», и разъезжаться она
 * не должна ни по одному из восьми статусов.
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
        semdTypeId: 'type-1',
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

describe('semdResultView (В2)', () => {
    it('говорит только о регистрации в РЭМД — других формулировок нет', () => {
        const labels = [...new Set(
            ALL_STATUSES.map((status) => semdResultView(status).label),
        )].sort()

        expect(labels).toEqual([
            'Зарегистрирован в РЭМД',
            'Не зарегистрирован в РЭМД',
        ])
    })

    it('зарегистрированным считает три статуса с фактом в РЭМД', () => {
        const registered = ALL_STATUSES.filter(
            (status) => semdResultView(status).label === 'Зарегистрирован в РЭМД',
        )

        expect(registered).toEqual([
            'required_registered',
            'not_required_registered',
            'unknown_registered',
        ])
    })

    it('различает случаи цветом, а не текстом', () => {
        expect(semdResultView('required_missing').color).toBe('error')
        expect(semdResultView('required_gis_unavailable').color).toBe('warning')
        expect(semdResultView('not_required').color).toBe('default')
        expect(semdResultView('not_required_registered').color).toBe('info')
    })

    it('прячет подробности в описание, а не в подпись', () => {
        expect(semdResultView('required_gis_unavailable').description)
            .toContain('региональная ГИС')
        expect(semdResultView('not_required_registered').description)
            .toContain('не обязателен')
    })
})

describe('requirementMarker (В2)', () => {
    it('помечает обязательные виды', () => {
        expect(requirementMarker(semdType({ resultStatus: 'required_missing' })))
            .toEqual({ label: 'обязателен', color: 'error' })
    })

    it('помечает неопределённую применимость', () => {
        expect(requirementMarker(semdType({
            resultStatus: 'unknown',
            requirementStatus: 'unknown',
        }))).toEqual({ label: 'применимость не определена', color: 'warning' })
    })

    it('остальное считает необязательным', () => {
        expect(requirementMarker(semdType({ resultStatus: 'not_required_registered' })))
            .toEqual({ label: 'не обязателен', color: 'default' })
    })
})

/**
 * Рекомендации методолога от 22.08.2026: у вида с голубым статусом («не обязателен,
 * но регистрируется») «По ТПГГ не требуется для этой МО» читалось как указание
 * перестать его формировать. Отсутствие требования в ТПГГ ничего не запрещает,
 * поэтому в «Основании» у таких видов теперь пусто.
 */
describe('compactRequirementReason (рекомендации 22.08.2026)', () => {
    it('оставляет «Основание» пустым у необязательного, но регистрируемого вида', () => {
        expect(compactRequirementReason(semdType({
            resultStatus: 'not_required_registered',
            registered: true,
            documentCount: 18,
        }))).toBe('')
    })

    it('пустое «Основание» не отменяет ручного уточнения', () => {
        expect(compactRequirementReason(semdType({
            resultStatus: 'not_required_registered',
            manualOverride: {
                reason: 'МО подтвердила профиль',
            } as InstitutionSemdType['manualOverride'],
        }))).toBe('Ручное уточнение: МО подтвердила профиль')
    })

    it('у незарегистрированного необязательного вида пояснение остаётся', () => {
        expect(compactRequirementReason(semdType({ resultStatus: 'not_required' })))
            .toBe('По ТПГГ не требуется для этой МО')
    })
})
