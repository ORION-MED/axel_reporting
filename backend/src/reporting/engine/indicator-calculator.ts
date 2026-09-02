import type { ReportingBusinessStatus } from '../reporting-format.util'
import type { ReportingCalculationType } from '../reporting-domain.types'

/**
 * Roadmap step 2.1 — the pluggable calculation contract per indicator `calculation_type`.
 * Adding indicator #48 with an existing calculation_type (e.g. another ratio_percent
 * indicator) requires zero new code: it just needs a row in `reporting_indicators`.
 * Only a genuinely new calculation semantics needs a new IndicatorCalculator.
 *
 * This contract intentionally covers single-value calculators (one numerator/denominator
 * pair in, one fact/status/business-status out). Bulk, multi-organization calculators
 * (e.g. the 6.1.3.2.7 pilot indicator's semd_type_coverage, which aggregates facts across
 * all organizations in one pass) do not fit this shape and are not yet part of the
 * registry — see PilotIndicatorCalculationService for that case.
 */

export type IndicatorValueStatus =
    | 'awaiting_data'
    | 'calculated'
    | 'methodology_in_development'
    | 'not_calculated'

export interface IndicatorCalculationInput {
    numerator: number | null
    denominator: number | null
    targetValue: number | null
}

export interface IndicatorCalculationResult {
    status: IndicatorValueStatus
    factValue: number | null
    deviationValue: number | null
    businessStatus: ReportingBusinessStatus
}

export interface IndicatorCalculationMetadata {
    methodologyStatus: 'ready' | 'in_development'
    metadata: Record<string, unknown>
}

export interface IndicatorCalculator {
    readonly calculationType: ReportingCalculationType
    calculate(
        indicator: IndicatorCalculationMetadata,
        input: IndicatorCalculationInput,
    ): IndicatorCalculationResult
}
