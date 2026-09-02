import { Injectable } from '@nestjs/common'
import type { ReportingBusinessStatus } from '../reporting-format.util'
import type {
    IndicatorCalculationInput,
    IndicatorCalculationMetadata,
    IndicatorCalculationResult,
    IndicatorCalculator,
} from './indicator-calculator'

/**
 * Pure formula shared by every indicator whose methodology is a plain
 * fact_value = numerator / denominator * 100, compared against a target with a
 * critical-deviation threshold (metadata.criticalDeviationPoints, default 10 points).
 * This currently covers the 5 legacy indicators (6.1.3.2.8-6.1.3.2.12) — see roadmap
 * step 2.4 — and any future indicator that shares the same calculation_type.
 */
export function calculateBusinessAssessment(
    factValue: number | null,
    targetValue: number | null,
    criticalDeviationPoints: unknown = 10,
): {
    deviationValue: number | null
    businessStatus: ReportingBusinessStatus
} {
    if (factValue === null || targetValue === null) {
        return { deviationValue: null, businessStatus: 'not_assessed' }
    }

    const deviationValue = Math.round((factValue - targetValue) * 100) / 100
    const parsedThreshold = Number(criticalDeviationPoints)
    const threshold = Number.isFinite(parsedThreshold) && parsedThreshold > 0
        ? parsedThreshold
        : 10

    if (deviationValue >= 0) {
        return { deviationValue, businessStatus: 'target_met' }
    }
    if (deviationValue <= -threshold) {
        return { deviationValue, businessStatus: 'critical' }
    }
    return { deviationValue, businessStatus: 'below_target' }
}

@Injectable()
export class RatioPercentIndicatorCalculator implements IndicatorCalculator {
    readonly calculationType = 'ratio_percent' as const

    calculate(
        indicator: IndicatorCalculationMetadata,
        input: IndicatorCalculationInput,
    ): IndicatorCalculationResult {
        if (indicator.methodologyStatus === 'in_development') {
            return {
                status: 'methodology_in_development',
                factValue: null,
                deviationValue: null,
                businessStatus: 'not_assessed',
            }
        }

        if (input.numerator === null || input.denominator === null || input.denominator <= 0) {
            return {
                status: 'awaiting_data',
                factValue: null,
                deviationValue: null,
                businessStatus: 'not_assessed',
            }
        }

        const factValue = Math.round((input.numerator / input.denominator) * 10_000) / 100
        const assessment = calculateBusinessAssessment(
            factValue,
            input.targetValue,
            indicator.metadata?.criticalDeviationPoints,
        )
        return {
            status: 'calculated',
            factValue,
            ...assessment,
        }
    }
}
