import { Module } from '@nestjs/common'
import { S3StorageService } from '../storage/s3.service'
import { ReportingController } from './reporting.controller'
import { ReportingDirectoryService } from './reporting-directory.service'
import { ReportingService } from './reporting.service'
import { ReportingPeriodsService } from './reporting-periods.service'
import { ReportingImportHistoryService } from './reporting-import-history.service'
import { ReportingValuesService } from './reporting-values.service'
import { RemdWorkbookImportService } from './remd-workbook-import.service'
import { PilotIndicatorCalculationService } from './pilot-indicator-calculation.service'
import { SemdVolumeRatioCalculationService } from './semd-volume-ratio-calculation.service'
import { SemdTypeRegistryCalculationService } from './semd-type-registry-calculation.service'
import { EmdNsiImportService } from './emd-nsi-import.service'
import { EpguDocVisibilityImportService } from './epgu-doc-visibility-import.service'
import { FrmrImportService } from './frmr-import.service'
import { Perechen5prImportService } from './perechen-5pr-import.service'
import { RemdNumeratorImportService } from './remd-numerator-import.service'
import { RemdIntervalImportService } from './remd-interval-import.service'
import { SemdMonthlySeriesService } from './semd-monthly-series.service'
import { TpggExecutionImportService } from './tpgg-execution-import.service'
import { InclusionRegisterImportService } from './inclusion-register-import.service'
import { PregnancyRegistrationCalculationService } from './pregnancy-registration-calculation.service'
import { TpggWorkbookImportService } from './tpgg-workbook-import.service'
import { TargetPlanImportService } from './target-plan-import.service'
import { ApplicabilityMatrixImportService } from './applicability-matrix-import.service'
import { OrganizationDirectoryImportService } from './organization-directory-import.service'
import { ReportingGisAvailabilityService } from './reporting-gis-availability.service'
import { INDICATOR_CALCULATORS, IndicatorCalculatorRegistry } from './engine/indicator-calculator.registry'
import { RatioPercentIndicatorCalculator } from './engine/ratio-percent.calculator'
import { WorkbookImportJournal } from './engine/workbook-import-journal'

@Module({
    controllers: [ReportingController],
    providers: [
        ReportingService,
        ReportingPeriodsService,
        ReportingImportHistoryService,
        ReportingValuesService,
        ReportingDirectoryService,
        PilotIndicatorCalculationService,
        SemdVolumeRatioCalculationService,
        SemdTypeRegistryCalculationService,
        RemdWorkbookImportService,
        EmdNsiImportService,
        EpguDocVisibilityImportService,
        FrmrImportService,
        Perechen5prImportService,
        RemdNumeratorImportService,
        RemdIntervalImportService,
        SemdMonthlySeriesService,
        TpggExecutionImportService,
        InclusionRegisterImportService,
        PregnancyRegistrationCalculationService,
        TpggWorkbookImportService,
        TargetPlanImportService,
        ApplicabilityMatrixImportService,
        OrganizationDirectoryImportService,
        ReportingGisAvailabilityService,
        S3StorageService,
        WorkbookImportJournal,
        RatioPercentIndicatorCalculator,
        {
            provide: INDICATOR_CALCULATORS,
            useFactory: (ratioPercent: RatioPercentIndicatorCalculator) => [ratioPercent],
            inject: [RatioPercentIndicatorCalculator],
        },
        IndicatorCalculatorRegistry,
    ],
    exports: [ReportingDirectoryService, PilotIndicatorCalculationService],
})
export class ReportingModule {}
