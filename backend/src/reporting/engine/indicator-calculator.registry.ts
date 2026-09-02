import { Inject, Injectable } from '@nestjs/common'
import type { ReportingCalculationType } from '../reporting-domain.types'
import type { IndicatorCalculator } from './indicator-calculator'

export const INDICATOR_CALCULATORS = Symbol('INDICATOR_CALCULATORS')

/**
 * Looks up the IndicatorCalculator registered for a given `reporting_indicators.calculation_type`
 * (roadmap step 2.1). Populated from the INDICATOR_CALCULATORS multi-provider in ReportingModule —
 * register a new calculator there, nowhere else, to plug in a new calculation_type.
 */
@Injectable()
export class IndicatorCalculatorRegistry {
    private readonly byType = new Map<ReportingCalculationType, IndicatorCalculator>()

    constructor(@Inject(INDICATOR_CALCULATORS) calculators: IndicatorCalculator[]) {
        for (const calculator of calculators) {
            this.byType.set(calculator.calculationType, calculator)
        }
    }

    get(calculationType: ReportingCalculationType): IndicatorCalculator | null {
        return this.byType.get(calculationType) ?? null
    }

    require(calculationType: ReportingCalculationType): IndicatorCalculator {
        const calculator = this.get(calculationType)
        if (!calculator) {
            throw new Error(`No IndicatorCalculator registered for calculation_type "${calculationType}"`)
        }
        return calculator
    }
}
