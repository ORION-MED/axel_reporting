import { Injectable } from '@nestjs/common'
import { PilotIndicatorCalculationService } from './pilot-indicator-calculation.service'
import { SemdVolumeRatioCalculationService } from './semd-volume-ratio-calculation.service'
import { PregnancyRegistrationCalculationService } from './pregnancy-registration-calculation.service'
import {
    SEMD_TYPE_REGISTRY_INDICATOR_ID,
    SemdTypeRegistryCalculationService,
    type SemdTypeRegistryTypeView,
} from './semd-type-registry-calculation.service'
import {
    PILOT_INDICATOR_ID,
    type PilotCalculationResult,
    type PilotDiagnosticFinding,
} from './pilot-calculation.types'
import { ReportingPeriodsService, type ReportingPeriod } from './reporting-periods.service'
import {
    ReportingValuesService,
    type ReportingIndicator,
    type ReportingIndicatorValue,
    type ReportingOrganizationIndicatorValue,
} from './reporting-values.service'
import { buildTargetPlanFactWorkbook } from './target-plan-export'
import { buildTargetPlanFactRows } from './target-plan-fact-rows'

/**
 * Thin orchestrator for the two cross-cutting overview endpoints (summary/dashboard),
 * which need periods + legacy indicator values + the pilot calculation together.
 * Everything else has its own narrow service — see ReportingPeriodsService,
 * ReportingImportHistoryService and ReportingValuesService.
 */
@Injectable()
export class ReportingService {
    constructor(
        private readonly periods: ReportingPeriodsService,
        private readonly values: ReportingValuesService,
        private readonly pilotCalculation: PilotIndicatorCalculationService,
        private readonly semdVolumeRatio: SemdVolumeRatioCalculationService,
        private readonly semdTypeRegistry: SemdTypeRegistryCalculationService,
        private readonly pregnancyRegistration: PregnancyRegistrationCalculationService,
    ) {}

    async getSummary(periodId?: string): Promise<{
        periods: ReportingPeriod[]
        selectedPeriodId: string | null
        organizationCount: number
        indicators: ReportingIndicator[]
        values: ReportingIndicatorValue[]
    }> {
        const [periods, indicators] = await Promise.all([
            this.periods.listPeriods(),
            this.values.listIndicators(),
        ])
        const selectedPeriodId = this.periods.resolveSelectedPeriodId(periods, periodId)
        if (selectedPeriodId) {
            await this.pilotCalculation.recalculate(selectedPeriodId)
            // Четыре доли к объёмам ТПГГ считаются здесь же: на вкладке «Показатели»
            // они стоят рядом с 6.1.3.2.7, и пустая строка читалась бы как «нет данных».
            await this.semdVolumeRatio.recalculateAll(selectedPeriodId)
            await this.semdTypeRegistry.recalculate(selectedPeriodId)
            // 1.24 считается по перечню входимости Минздрава; перечня может
            // не быть — тогда показатель остаётся в «ожидаются данные».
            await this.pregnancyRegistration.recalculate(selectedPeriodId)
        }
        const [values, organizationCount] = selectedPeriodId
            ? await Promise.all([
                this.values.listValues(selectedPeriodId),
                this.values.countPeriodOrganizations(selectedPeriodId),
            ])
            : [[], 0]

        return {
            periods,
            selectedPeriodId,
            organizationCount,
            indicators,
            values,
        }
    }

    async getDashboard(periodId?: string, indicatorId?: string): Promise<{
        periods: ReportingPeriod[]
        selectedPeriodId: string | null
        indicators: ReportingIndicator[]
        selectedIndicatorId: string | null
        organizations: ReportingOrganizationIndicatorValue[]
        diagnostics: PilotDiagnosticFinding[]
        pilotRegionSemdTypes: PilotCalculationResult['region']['types'] | null
        semdTypeRegistryTypes: SemdTypeRegistryTypeView[] | null
    }> {
        const [periods, indicators] = await Promise.all([
            this.periods.listPeriods(),
            this.values.listIndicators(),
        ])
        const selectedPeriodId = this.periods.resolveSelectedPeriodId(periods, periodId)
        const selectedIndicatorId =
            indicatorId && indicators.some((indicator) => indicator.id === indicatorId)
                ? indicatorId
                : indicators[0]?.id ?? null

        // Задача 8 (Пакет A) — региональный список видов СЭМД: recalculate() уже считает
        // это на каждую загрузку дашборда пилотного показателя, раньше результат просто
        // не сохранялся в ответ.
        let pilotRegionSemdTypes: PilotCalculationResult['region']['types'] | null = null
        if (
            selectedPeriodId
            && selectedIndicatorId === PILOT_INDICATOR_ID
        ) {
            const pilotResult = await this.pilotCalculation.recalculate(selectedPeriodId)
            pilotRegionSemdTypes = pilotResult.region.types
        }
        // Соты и список МО читают reporting_organization_indicator_values, поэтому
        // выбранную долю надо пересчитать до чтения — так же, как пилотный показатель.
        if (
            selectedPeriodId
            && selectedIndicatorId
            && this.semdVolumeRatio.supports(selectedIndicatorId)
        ) {
            await this.semdVolumeRatio.recalculate(selectedPeriodId, selectedIndicatorId)
        }
        // Разбор по видам для окна показателя (Н18.1): расчёт всё равно выполняется
        // здесь, оставалось только не выбрасывать его результат.
        let semdTypeRegistryTypes: SemdTypeRegistryTypeView[] | null = null
        if (selectedPeriodId && selectedIndicatorId === SEMD_TYPE_REGISTRY_INDICATOR_ID) {
            const registryResult = await this.semdTypeRegistry.recalculate(selectedPeriodId)
            semdTypeRegistryTypes = registryResult.regionTypes
        }
        const organizations = selectedPeriodId && selectedIndicatorId
            ? await this.values.listOrganizationValues(selectedPeriodId, selectedIndicatorId)
            : []
        const diagnostics: PilotDiagnosticFinding[] = []

        return {
            periods,
            selectedPeriodId,
            indicators,
            selectedIndicatorId,
            organizations,
            diagnostics,
            pilotRegionSemdTypes,
            semdTypeRegistryTypes,
        }
    }

    /**
     * Н19 (ВКС 15.08.2026) — выгрузка всех показателей MVP в структуре шаблона
     * «Приложение 2»: «чтобы получилась выгрузка по типу приложения 2, но уже
     * с рассчитанными показателями». До этого выгружался один 6.1.3.2.7.
     *
     * Пересчёт берётся у `getSummary`, а не запускается заново: он и так считает
     * все шесть показателей при открытии вкладки «Показатели», и второй путь
     * расчёта разошёлся бы с первым молча. Раскладка по колонкам — в чистой
     * функции `buildTargetPlanFactRows`, здесь только сборка файла.
     */
    async exportIndicatorFacts(periodId: string): Promise<{ buffer: Buffer; filename: string }> {
        await this.periods.ensurePeriodExists(periodId)
        const [summary, reportingDate] = await Promise.all([
            this.getSummary(periodId),
            this.periods.getPeriodReportingDate(periodId),
        ])

        const rows = buildTargetPlanFactRows({
            indicators: summary.indicators,
            values: summary.values,
            reportingDate,
        })

        const buffer = await buildTargetPlanFactWorkbook('Помесячный план КО', rows)
        const fileDate = reportingDate ?? periodId
        return {
            buffer,
            filename: `Показатели_факт_${fileDate}.xlsx`,
        }
    }
}
