import { RatioPercentIndicatorCalculator, calculateBusinessAssessment } from './ratio-percent.calculator'

describe('RatioPercentIndicatorCalculator (6.1.3.2.8-6.1.3.2.12 legacy indicators)', () => {
    const calculator = new RatioPercentIndicatorCalculator()
    const readyIndicator = { methodologyStatus: 'ready' as const, metadata: {} }

    it('reports methodology_in_development regardless of numerator/denominator', () => {
        expect(calculator.calculate(
            { methodologyStatus: 'in_development', metadata: {} },
            { numerator: 10, denominator: 20, targetValue: 90 },
        )).toEqual({
            status: 'methodology_in_development',
            factValue: null,
            deviationValue: null,
            businessStatus: 'not_assessed',
        })
    })

    it('awaits data when numerator or denominator is missing', () => {
        expect(calculator.calculate(readyIndicator, {
            numerator: null,
            denominator: 100,
            targetValue: 90,
        }).status).toBe('awaiting_data')

        expect(calculator.calculate(readyIndicator, {
            numerator: 10,
            denominator: null,
            targetValue: 90,
        }).status).toBe('awaiting_data')

        expect(calculator.calculate(readyIndicator, {
            numerator: 10,
            denominator: 0,
            targetValue: 90,
        }).status).toBe('awaiting_data')
    })

    it('calculates fact_value as numerator / denominator * 100', () => {
        const result = calculator.calculate(readyIndicator, {
            numerator: 850,
            denominator: 1000,
            targetValue: 90,
        })
        expect(result.status).toBe('calculated')
        expect(result.factValue).toBe(85)
    })

    it('marks the indicator as target_met once fact_value reaches the target', () => {
        const result = calculator.calculate(readyIndicator, {
            numerator: 95,
            denominator: 100,
            targetValue: 90,
        })
        expect(result.businessStatus).toBe('target_met')
        expect(result.deviationValue).toBe(5)
    })

    it('uses the default 10-point critical threshold when metadata does not override it', () => {
        const belowTarget = calculator.calculate(readyIndicator, {
            numerator: 85,
            denominator: 100,
            targetValue: 90,
        })
        expect(belowTarget.businessStatus).toBe('below_target')

        const critical = calculator.calculate(readyIndicator, {
            numerator: 79,
            denominator: 100,
            targetValue: 90,
        })
        expect(critical.businessStatus).toBe('critical')
    })

    it('honors a per-indicator criticalDeviationPoints override from metadata', () => {
        const indicator = {
            methodologyStatus: 'ready' as const,
            metadata: { criticalDeviationPoints: 3 },
        }
        const result = calculator.calculate(indicator, {
            numerator: 86,
            denominator: 100,
            targetValue: 90,
        })
        expect(result.deviationValue).toBe(-4)
        expect(result.businessStatus).toBe('critical')
    })

    it('does not assess business status without a target value', () => {
        const assessment = calculateBusinessAssessment(85, null)
        expect(assessment).toEqual({ deviationValue: null, businessStatus: 'not_assessed' })
    })
})
