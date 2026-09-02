import { IndicatorCalculatorRegistry } from './engine/indicator-calculator.registry'
import { RatioPercentIndicatorCalculator } from './engine/ratio-percent.calculator'
import { TargetPlanImportService } from './target-plan-import.service'
import type { ReportingCalculationType } from './reporting-domain.types'

/**
 * Пересчёт значения показателя при загрузке плановых значений.
 *
 * Показатели с массовым расчётом — четыре доли к объёмам ТПГГ и показатель 27 —
 * считаются собственными сервисами и в движке не зарегистрированы. Прежний код звал
 * `registry.require()` и падал: подтверждение плана валилось с «No IndicatorCalculator
 * registered for calculation_type "semd_volume_ratio"», а загрузка оставалась
 * в статусе «предпросмотр» — с виду «файл не грузится».
 */

const registry = new IndicatorCalculatorRegistry([new RatioPercentIndicatorCalculator()])
const service = new TargetPlanImportService(
    null as never,
    null as never,
    null as never,
    registry,
)

function recalculate(
    calculationType: ReportingCalculationType,
    input: { numerator: number | null; denominator: number | null; targetValue: number },
    existing: { factValue: number | null; status: string },
    metadata: Record<string, unknown> = {},
) {
    return (service as unknown as {
        recalculateWithTarget: (
            indicator: unknown,
            input: unknown,
            existing: unknown,
        ) => { status: string; factValue: number | null; deviationValue: number | null; businessStatus: string }
    }).recalculateWithTarget(
        { id: 'test', code: 'test', calculationType, methodologyStatus: 'ready', metadata },
        input,
        existing,
    )
}

describe('пересчёт под новый план', () => {
    it('ratio_percent считается движком из числителя и знаменателя', () => {
        const result = recalculate(
            'ratio_percent',
            { numerator: 50, denominator: 200, targetValue: 30 },
            { factValue: null, status: 'awaiting_data' },
        )

        expect(result).toMatchObject({
            status: 'calculated',
            factValue: 25,
            deviationValue: -5,
            businessStatus: 'below_target',
        })
    })

    it('доля к объёмам ТПГГ не падает, а берёт уже посчитанный факт', () => {
        const result = recalculate(
            'semd_volume_ratio',
            { numerator: 53246, denominator: 193314, targetValue: 70 },
            { factValue: 27.54, status: 'calculated' },
        )

        expect(result).toMatchObject({
            status: 'calculated',
            factValue: 27.54,
            deviationValue: -42.46,
            businessStatus: 'critical',
        })
    })

    it('показатель 27 обрабатывается так же', () => {
        const result = recalculate(
            'semd_type_registry',
            { numerator: 70, denominator: 145, targetValue: 40 },
            { factValue: 48.28, status: 'calculated' },
        )

        expect(result.businessStatus).toBe('target_met')
        expect(result.factValue).toBe(48.28)
    })

    it('без посчитанного факта оценка не выставляется', () => {
        // План загрузили раньше, чем выгрузку РЭМД, — сравнивать нечего.
        const result = recalculate(
            'semd_volume_ratio',
            { numerator: null, denominator: null, targetValue: 70 },
            { factValue: null, status: 'awaiting_data' },
        )

        expect(result).toMatchObject({
            status: 'awaiting_data',
            factValue: null,
            deviationValue: null,
            businessStatus: 'not_assessed',
        })
    })

    it('порог критического отклонения берётся из metadata показателя', () => {
        const result = recalculate(
            'semd_volume_ratio',
            { numerator: 1, denominator: 2, targetValue: 60 },
            { factValue: 55, status: 'calculated' },
            { criticalDeviationPoints: 3 },
        )

        expect(result.businessStatus).toBe('critical')
    })
})
