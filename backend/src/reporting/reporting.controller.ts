import {
    BadRequestException,
    Body,
    Controller,
    Delete,
    Get,
    HttpCode,
    HttpStatus,
    InternalServerErrorException,
    Param,
    Post,
    Put,
    Query,
    Req,
    Res,
} from '@nestjs/common'
import { Request, Response } from 'express'
import * as busboy from 'busboy'
import { AuthTokenPayload } from '../auth/auth.service'
import { decodeMultipartFilename } from '../common/decode-multipart-filename'
import { ReportingService } from './reporting.service'
import { CreateReportingPeriodDto, ReportingPeriodsService } from './reporting-periods.service'
import { ReportingImportHistoryService } from './reporting-import-history.service'
import { ReportingValuesService, UpsertReportingValueDto } from './reporting-values.service'
import { RemdWorkbookImportService } from './remd-workbook-import.service'
import { PilotIndicatorCalculationService } from './pilot-indicator-calculation.service'
import { EmdNsiImportService } from './emd-nsi-import.service'
import { EpguDocVisibilityImportService } from './epgu-doc-visibility-import.service'
import { FrmrImportService } from './frmr-import.service'
import { Perechen5prImportService } from './perechen-5pr-import.service'
import { RemdNumeratorImportService } from './remd-numerator-import.service'
import { SemdMonthlySeriesService } from './semd-monthly-series.service'
import { TpggExecutionImportService } from './tpgg-execution-import.service'
import { InclusionRegisterImportService } from './inclusion-register-import.service'
import {
    RemdIntervalImportService,
    type RemdIntervalOverride,
} from './remd-interval-import.service'
import { TpggWorkbookImportService } from './tpgg-workbook-import.service'
import { TargetPlanImportService } from './target-plan-import.service'
import { ApplicabilityMatrixImportService } from './applicability-matrix-import.service'
import { OrganizationDirectoryImportService } from './organization-directory-import.service'
import { ReportingGisAvailabilityService } from './reporting-gis-availability.service'
import {
    CreateExternalIdDto,
    ReportingDirectoryService,
    UpdateOrganizationDto,
} from './reporting-directory.service'

const REPORTING_IMPORT_MAX_SIZE = Number(process.env.REPORTING_IMPORT_MAX_FILE_SIZE) || 25 * 1024 * 1024
const ALLOWED_REMD_IMPORT_EXTS = new Set(['.xlsx'])
const ALLOWED_REMD_IMPORT_MIMES = new Set([
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/octet-stream',
])
const ALLOWED_EMD_NSI_IMPORT_EXTS = new Set(['.csv', '.xlsx'])
const ALLOWED_EMD_NSI_IMPORT_MIMES = new Set([
    'text/csv',
    'text/plain',
    'application/csv',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/octet-stream',
])

@Controller('reporting')
export class ReportingController {
    constructor(
        private readonly reporting: ReportingService,
        private readonly periodsService: ReportingPeriodsService,
        private readonly importHistory: ReportingImportHistoryService,
        private readonly valuesService: ReportingValuesService,
        private readonly remdWorkbookImport: RemdWorkbookImportService,
        private readonly pilotCalculation: PilotIndicatorCalculationService,
        private readonly emdNsiImport: EmdNsiImportService,
        private readonly epguDocVisibilityImport: EpguDocVisibilityImportService,
        private readonly perechen5prImport: Perechen5prImportService,
        private readonly remdNumeratorImport: RemdNumeratorImportService,
        private readonly monthlySeries: SemdMonthlySeriesService,
        private readonly tpggExecutionImport: TpggExecutionImportService,
        private readonly inclusionRegisterImport: InclusionRegisterImportService,
        private readonly remdIntervalImport: RemdIntervalImportService,
        private readonly frmrImport: FrmrImportService,
        private readonly tpggWorkbookImport: TpggWorkbookImportService,
        private readonly targetPlanImport: TargetPlanImportService,
        private readonly applicabilityMatrixImport: ApplicabilityMatrixImportService,
        private readonly organizationDirectoryImport: OrganizationDirectoryImportService,
        private readonly directory: ReportingDirectoryService,
        private readonly gisAvailability: ReportingGisAvailabilityService,
    ) {}

    @Get('summary')
    async summary(@Query('periodId') periodId?: string) {
        return this.reporting.getSummary(periodId)
    }

    @Get('dashboard')
    async dashboard(
        @Query('periodId') periodId?: string,
        @Query('indicatorId') indicatorId?: string,
    ) {
        return this.reporting.getDashboard(periodId, indicatorId)
    }

    @Get('export/indicator-facts')
    async exportIndicatorFacts(
        @Query('periodId') periodId: string | undefined,
        @Res() res: Response,
    ) {
        if (!periodId) {
            throw new BadRequestException('Укажите отчетный период')
        }
        const { buffer, filename } = await this.reporting.exportIndicatorFacts(periodId)
        res.setHeader(
            'Content-Type',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        )
        res.setHeader('Content-Length', String(buffer.length))
        res.setHeader(
            'Content-Disposition',
            `attachment; filename="indicator-facts.xlsx"; filename*=UTF-8''${encodeURIComponent(filename)}`,
        )
        res.send(buffer)
    }

    @Get('indicators')
    async indicators() {
        return this.valuesService.listIndicators()
    }

    @Get('semd-gis-availability')
    async semdGisAvailability() {
        return this.gisAvailability.list()
    }

    @Put('semd-gis-availability/:semdTypeId')
    async setSemdGisAvailability(
        @Param('semdTypeId') semdTypeId: string,
        @Body() body: { isAvailable?: boolean | null; note?: string },
        @Req() req: Request,
    ) {
        if (
            body.isAvailable !== null
            && body.isAvailable !== undefined
            && typeof body.isAvailable !== 'boolean'
        ) {
            throw new BadRequestException(
                'Укажите доступность в ГИС: true, false или null',
            )
        }
        return this.gisAvailability.set(
            semdTypeId,
            body.isAvailable ?? null,
            body.note ?? '',
            this.extractUserId(req),
        )
    }

    @Get('periods')
    async periods() {
        return this.periodsService.listPeriods()
    }

    @Get('organizations')
    async organizations(@Query('includeInactive') includeInactive?: string) {
        return this.directory.listOrganizations(includeInactive === 'true')
    }

    @Get('organizations/:oid')
    async organization(@Param('oid') oid: string) {
        return this.directory.getOrganization(oid)
    }

    @Put('organizations/:oid')
    async updateOrganization(
        @Param('oid') oid: string,
        @Body() body: UpdateOrganizationDto,
    ) {
        return this.directory.updateOrganization(oid, body)
    }

    @Get('organizations/:oid/external-ids')
    async organizationExternalIds(@Param('oid') oid: string) {
        return this.directory.listExternalIds(oid)
    }

    @Post('organizations/:oid/external-ids')
    @HttpCode(HttpStatus.OK)
    async addOrganizationExternalId(
        @Param('oid') oid: string,
        @Body() body: CreateExternalIdDto,
        @Req() req: Request,
    ) {
        return this.directory.addExternalId(oid, body, this.extractUserId(req))
    }

    @Delete('organizations/:oid/external-ids/:id')
    @HttpCode(HttpStatus.OK)
    async removeOrganizationExternalId(
        @Param('oid') oid: string,
        @Param('id') id: string,
    ) {
        await this.directory.removeExternalId(oid, id)
        return { id, status: 'deleted' }
    }

    @Get('imports')
    async imports(@Query('periodId') periodId?: string) {
        return this.importHistory.listImports(periodId)
    }

    @Get('pilot-calculation')
    async pilotIndicatorCalculation(
        @Query('periodId') periodId?: string,
    ) {
        if (!periodId) {
            throw new BadRequestException('Укажите отчетный период')
        }
        return this.pilotCalculation.recalculate(periodId)
    }

    /**
     * Помесячные кривые «план против факта» (Д-9). Без `organizationOid` —
     * по региону, с ним — по одной МО: «хоть суммарно, хоть на восемь графиков
     * разложить» (Николай Ермаков, ВКС 24.08.2026).
     */
    @Get('monthly-series')
    async monthlySeriesForIndicator(
        @Query('periodId') periodId?: string,
        @Query('indicatorId') indicatorId?: string,
        @Query('organizationOid') organizationOid?: string,
    ) {
        if (!periodId) {
            throw new BadRequestException('Укажите отчетный период')
        }
        if (!indicatorId) {
            throw new BadRequestException('Укажите показатель')
        }
        return this.monthlySeries.getSeries(
            periodId,
            indicatorId,
            organizationOid?.trim() || undefined,
        )
    }

    @Get('diagnostics')
    async diagnostics(
        @Query('periodId') periodId?: string,
        @Query('organizationOid') organizationOid?: string,
        @Query('indicatorId') indicatorId?: string,
    ) {
        if (!periodId) {
            throw new BadRequestException('Укажите отчетный период')
        }
        // Н20: без `indicatorId` отдаются находки 6.1.3.2.7 — прежнее поведение.
        return this.pilotCalculation.listDiagnostics({
            periodId,
            organizationOid: organizationOid?.trim() || undefined,
            indicatorId: indicatorId?.trim() || undefined,
        })
    }

    @Get('pilot-institution-details')
    async pilotInstitutionDetails(
        @Query('periodId') periodId?: string,
        @Query('organizationOid') organizationOid?: string,
    ) {
        if (!periodId) {
            throw new BadRequestException('Укажите отчетный период')
        }
        if (!organizationOid?.trim()) {
            throw new BadRequestException('Укажите медицинскую организацию')
        }
        return this.pilotCalculation.getInstitutionDetails({
            periodId,
            organizationOid: organizationOid.trim(),
        })
    }

    @Get('pilot-institution-requirement-history')
    async pilotInstitutionRequirementHistory(
        @Query('periodId') periodId?: string,
        @Query('organizationOid') organizationOid?: string,
        @Query('semdTypeId') semdTypeId?: string,
    ) {
        const trimmedPeriodId = periodId?.trim()
        if (!trimmedPeriodId) {
            throw new BadRequestException('Укажите отчетный период')
        }
        if (!organizationOid?.trim()) {
            throw new BadRequestException('Укажите медицинскую организацию')
        }
        return this.pilotCalculation.listInstitutionRequirementOverrideHistory({
            periodId: trimmedPeriodId,
            organizationOid: organizationOid.trim(),
            semdTypeId: semdTypeId?.trim() || undefined,
        })
    }

    @Put('pilot-institution-requirement')
    async setPilotInstitutionRequirement(
        @Body() body: {
            periodId?: string
            organizationOid?: string
            semdTypeId?: string
            requirementStatus?: 'required' | 'not_required' | null
            reason?: string
        },
        @Req() req: Request,
    ) {
        const periodId = body?.periodId?.trim()
        const organizationOid = body?.organizationOid?.trim()
        const semdTypeId = body?.semdTypeId?.trim()
        if (!periodId) {
            throw new BadRequestException('Укажите отчетный период')
        }
        if (!organizationOid) {
            throw new BadRequestException('Укажите медицинскую организацию')
        }
        if (!semdTypeId) {
            throw new BadRequestException('Укажите вид СЭМД')
        }
        if (
            body.requirementStatus !== null
            && body.requirementStatus !== 'required'
            && body.requirementStatus !== 'not_required'
        ) {
            throw new BadRequestException(
                'Укажите новое значение применимости',
            )
        }
        return this.pilotCalculation.setInstitutionRequirementOverride({
            periodId,
            organizationOid,
            semdTypeId,
            requirementStatus: body.requirementStatus,
            reason: body.reason ?? '',
            userId: this.extractUserId(req),
        })
    }

    @Get('imports/:importId')
    async importSnapshot(@Param('importId') importId: string) {
        return this.importHistory.getImportSnapshot(importId)
    }

    @Get('imports/:importId/source')
    async importSource(
        @Param('importId') importId: string,
        @Res() res: Response,
    ) {
        const source = await this.importHistory.getImportSource(importId)
        const isCsv = source.originalFilename.toLocaleLowerCase().endsWith('.csv')
        const fallbackName = `reporting-import-${importId}.${isCsv ? 'csv' : 'xlsx'}`
        res.setHeader(
            'Content-Type',
            isCsv
                ? 'text/csv; charset=utf-8'
                : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        )
        res.setHeader('Content-Length', String(source.fileSize))
        res.setHeader(
            'Content-Disposition',
            `attachment; filename="${fallbackName}"; filename*=UTF-8''${encodeURIComponent(source.originalFilename)}`,
        )
        source.stream.pipe(res)
    }

    @Post('periods')
    async createPeriod(@Body() body: CreateReportingPeriodDto, @Req() req: Request) {
        return this.periodsService.createPeriod(this.extractUserId(req), body)
    }

    /** Что исчезнет вместе с периодом — показывается до удаления. */
    @Get('periods/:periodId/deletion-preview')
    async periodDeletionPreview(@Param('periodId') periodId: string) {
        return this.periodsService.getDeletionPreview(periodId)
    }

    /**
     * Удаление периода. Необратимо, поэтому требует подтверждения кодом периода
     * в теле запроса: перепутанный идентификатор иначе молча снесёт не тот период.
     */
    @Delete('periods/:periodId')
    @HttpCode(HttpStatus.OK)
    async deletePeriod(
        @Param('periodId') periodId: string,
        @Body() body: { confirmCode?: string },
    ) {
        return this.periodsService.deletePeriod(periodId, body?.confirmCode ?? '')
    }

    @Put('values/:indicatorId')
    async upsertValue(
        @Param('indicatorId') indicatorId: string,
        @Body() body: UpsertReportingValueDto,
        @Req() req: Request,
    ) {
        return this.valuesService.upsertValue(this.extractUserId(req), indicatorId, body)
    }

    @Post('import/remd-excel')
    @HttpCode(HttpStatus.OK)
    async importRemdExcel(@Req() req: Request) {
        const upload = await this.readRemdMultipart(req)
        return this.valuesService.importRemdExcel(
            this.extractUserId(req),
            upload.periodId,
            upload.fileBuffer,
            upload.originalFilename,
            upload.importMode,
        )
    }

    @Post('import/emd-nsi-csv')
    @HttpCode(HttpStatus.OK)
    async importEmdNsiCsv(@Req() req: Request) {
        const upload = await this.readEmdNsiMultipart(req)
        return this.emdNsiImport.importCsv(
            this.extractUserId(req),
            upload.periodId,
            upload.fileBuffer,
            upload.originalFilename,
        )
    }

    @Post('import/epgu-doc-visibility')
    @HttpCode(HttpStatus.OK)
    async importEpguDocVisibility(@Req() req: Request) {
        const upload = await this.readEmdNsiMultipart(req)
        return this.epguDocVisibilityImport.importXlsx(
            this.extractUserId(req),
            upload.periodId,
            upload.fileBuffer,
            upload.originalFilename,
        )
    }

    @Post('import/perechen-5pr')
    @HttpCode(HttpStatus.OK)
    async importPerechen5pr(@Req() req: Request) {
        const upload = await this.readEmdNsiMultipart(req)
        return this.perechen5prImport.importXlsx(
            this.extractUserId(req),
            upload.periodId,
            upload.fileBuffer,
            upload.originalFilename,
        )
    }

    @Post('import/remd-numerator')
    @HttpCode(HttpStatus.OK)
    async importRemdNumerator(@Req() req: Request) {
        const upload = await this.readRemdMultipart(req)
        return this.remdNumeratorImport.importXlsx(
            this.extractUserId(req),
            upload.periodId,
            upload.fileBuffer,
            upload.originalFilename,
        )
    }

    /**
     * Помесячные и нарастающие выгрузки РЭМД (Д-9, Д-11). Грузятся по одной,
     * все в один отчётный период: кривая динамики собирается внутри периода,
     * а не раскладывается по нескольким.
     *
     * Разновидность и месяц берутся из шапки отчёта. Поля `coverage`, `month`
     * и `year` — запасной путь для файлов без шапки; заданные, они её перекрывают.
     */
    @Post('import/remd-interval')
    @HttpCode(HttpStatus.OK)
    async importRemdInterval(@Req() req: Request) {
        const upload = await this.readRemdMultipart(req)
        return this.remdIntervalImport.importXlsx(
            this.extractUserId(req),
            upload.periodId,
            upload.fileBuffer,
            upload.originalFilename,
            this.readIntervalOverride(upload.fields),
        )
    }

    /**
     * Ручная пометка выгрузки. Возвращает `undefined`, когда поля не заданы, —
     * это обычный случай: шапка отчёта разбирается сама.
     */
    private readIntervalOverride(
        fields: Record<string, string>,
    ): RemdIntervalOverride | undefined {
        const coverage = fields.coverage
        if (!coverage) return undefined
        if (coverage !== 'month' && coverage !== 'cumulative') {
            throw new BadRequestException(
                'Разновидность выгрузки должна быть «month» или «cumulative»',
            )
        }
        const month = Number(fields.month)
        const year = Number(fields.year)
        if (!Number.isInteger(month) || month < 1 || month > 12) {
            throw new BadRequestException('Укажите месяц выгрузки числом от 1 до 12')
        }
        if (!Number.isInteger(year) || year < 2000 || year > 2100) {
            throw new BadRequestException('Укажите год выгрузки')
        }
        return { coverage, month, year }
    }

    /**
     * Исполнение терпрограммы по реестрам ОМС (Д-10) — третья колонка карточки МО.
     * Шестнадцать файлов фонда, по одному на лист терпрограммы; лист берётся
     * из начала имени файла.
     */
    @Post('import/tpgg-execution')
    @HttpCode(HttpStatus.OK)
    async importTpggExecution(@Req() req: Request) {
        const upload = await this.readRemdMultipart(req)
        return this.tpggExecutionImport.importXlsx(
            this.extractUserId(req),
            upload.periodId,
            upload.fileBuffer,
            upload.originalFilename,
        )
    }

    /**
     * Перечни входимости ТВСП от Минздрава (письмо № ВХ.04-08186_26 от 20.07.2026).
     * Вид СЭМД определяется по заголовку файла — задавать его при загрузке
     * не нужно и нельзя: файл говорит прямым текстом.
     */
    @Post('import/inclusion-register')
    @HttpCode(HttpStatus.OK)
    async importInclusionRegister(@Req() req: Request) {
        const upload = await this.readRemdMultipart(req)
        return this.inclusionRegisterImport.importXlsx(
            this.extractUserId(req),
            upload.periodId,
            upload.fileBuffer,
            upload.originalFilename,
        )
    }

    @Post('import/frmr')
    @HttpCode(HttpStatus.OK)
    async importFrmr(@Req() req: Request) {
        const upload = await this.readEmdNsiMultipart(req)
        return this.frmrImport.importXlsx(
            this.extractUserId(req),
            upload.periodId,
            upload.fileBuffer,
            upload.originalFilename,
        )
    }

    @Post('import/remd-preview')
    @HttpCode(HttpStatus.OK)
    async previewRemdWorkbook(@Req() req: Request) {
        const upload = await this.readRemdMultipart(req)
        return this.remdWorkbookImport.createPreview(
            this.extractUserId(req),
            upload.periodId,
            upload.fileBuffer,
            upload.originalFilename,
            upload.importMode,
        )
    }

    @Get('imports/:importId/preview')
    async remdWorkbookPreview(
        @Param('importId') importId: string,
        @Req() req: Request,
    ) {
        return this.remdWorkbookImport.getPreview(
            this.extractUserId(req),
            importId,
        )
    }

    @Post('imports/:importId/confirm')
    @HttpCode(HttpStatus.OK)
    async confirmRemdWorkbook(
        @Param('importId') importId: string,
        @Body() body: { mode?: string },
        @Req() req: Request,
    ) {
        return this.remdWorkbookImport.confirmPreview(
            this.extractUserId(req),
            importId,
            body?.mode,
        )
    }

    @Post('imports/:importId/cancel')
    @HttpCode(HttpStatus.OK)
    async cancelRemdWorkbook(
        @Param('importId') importId: string,
        @Req() req: Request,
    ) {
        return this.remdWorkbookImport.cancelPreview(
            this.extractUserId(req),
            importId,
        )
    }

    @Post('import/tpgg-preview')
    @HttpCode(HttpStatus.OK)
    async previewTpggWorkbook(@Req() req: Request) {
        const upload = await this.readRemdMultipart(req)
        return this.tpggWorkbookImport.createPreview(
            this.extractUserId(req),
            upload.periodId,
            upload.fileBuffer,
            upload.originalFilename,
        )
    }

    @Get('imports/:importId/tpgg-preview')
    async tpggWorkbookPreview(
        @Param('importId') importId: string,
        @Req() req: Request,
    ) {
        return this.tpggWorkbookImport.getPreview(
            this.extractUserId(req),
            importId,
        )
    }

    @Post('imports/:importId/tpgg-confirm')
    @HttpCode(HttpStatus.OK)
    async confirmTpggWorkbook(
        @Param('importId') importId: string,
        @Req() req: Request,
    ) {
        return this.tpggWorkbookImport.confirmPreview(
            this.extractUserId(req),
            importId,
        )
    }

    @Post('imports/:importId/tpgg-cancel')
    @HttpCode(HttpStatus.OK)
    async cancelTpggWorkbook(
        @Param('importId') importId: string,
        @Req() req: Request,
    ) {
        return this.tpggWorkbookImport.cancelPreview(
            this.extractUserId(req),
            importId,
        )
    }

    @Post('import/target-plan-preview')
    @HttpCode(HttpStatus.OK)
    async previewTargetPlan(@Req() req: Request) {
        const upload = await this.readRemdMultipart(req)
        return this.targetPlanImport.createPreview(
            this.extractUserId(req),
            upload.periodId,
            upload.fileBuffer,
            upload.originalFilename,
        )
    }

    @Get('imports/:importId/target-plan-preview')
    async targetPlanPreview(
        @Param('importId') importId: string,
        @Req() req: Request,
    ) {
        return this.targetPlanImport.getPreview(
            this.extractUserId(req),
            importId,
        )
    }

    @Post('imports/:importId/target-plan-confirm')
    @HttpCode(HttpStatus.OK)
    async confirmTargetPlan(
        @Param('importId') importId: string,
        @Req() req: Request,
    ) {
        return this.targetPlanImport.confirmPreview(
            this.extractUserId(req),
            importId,
        )
    }

    @Post('imports/:importId/target-plan-cancel')
    @HttpCode(HttpStatus.OK)
    async cancelTargetPlan(
        @Param('importId') importId: string,
        @Req() req: Request,
    ) {
        return this.targetPlanImport.cancelPreview(
            this.extractUserId(req),
            importId,
        )
    }

    @Post('import/organization-directory-preview')
    @HttpCode(HttpStatus.OK)
    async previewOrganizationDirectory(@Req() req: Request) {
        const upload = await this.readRemdMultipart(req)
        return this.organizationDirectoryImport.createPreview(
            this.extractUserId(req),
            upload.periodId,
            upload.fileBuffer,
            upload.originalFilename,
        )
    }

    @Get('imports/:importId/organization-directory-preview')
    async organizationDirectoryPreview(
        @Param('importId') importId: string,
        @Req() req: Request,
    ) {
        return this.organizationDirectoryImport.getPreview(
            this.extractUserId(req),
            importId,
        )
    }

    @Post('imports/:importId/organization-directory-confirm')
    @HttpCode(HttpStatus.OK)
    async confirmOrganizationDirectory(
        @Param('importId') importId: string,
        @Req() req: Request,
    ) {
        return this.organizationDirectoryImport.confirmPreview(
            this.extractUserId(req),
            importId,
        )
    }

    @Post('imports/:importId/organization-directory-cancel')
    @HttpCode(HttpStatus.OK)
    async cancelOrganizationDirectory(
        @Param('importId') importId: string,
        @Req() req: Request,
    ) {
        return this.organizationDirectoryImport.cancelPreview(
            this.extractUserId(req),
            importId,
        )
    }

    @Post('import/applicability-matrix-preview')
    @HttpCode(HttpStatus.OK)
    async previewApplicabilityMatrix(@Req() req: Request) {
        const upload = await this.readRemdMultipart(req)
        return this.applicabilityMatrixImport.createPreview(
            this.extractUserId(req),
            upload.periodId,
            upload.fileBuffer,
            upload.originalFilename,
        )
    }

    @Get('imports/:importId/applicability-matrix-preview')
    async applicabilityMatrixPreview(
        @Param('importId') importId: string,
        @Req() req: Request,
    ) {
        return this.applicabilityMatrixImport.getPreview(
            this.extractUserId(req),
            importId,
        )
    }

    @Post('imports/:importId/applicability-matrix-confirm')
    @HttpCode(HttpStatus.OK)
    async confirmApplicabilityMatrix(
        @Param('importId') importId: string,
        @Req() req: Request,
    ) {
        return this.applicabilityMatrixImport.confirmPreview(
            this.extractUserId(req),
            importId,
        )
    }

    @Post('imports/:importId/applicability-matrix-cancel')
    @HttpCode(HttpStatus.OK)
    async cancelApplicabilityMatrix(
        @Param('importId') importId: string,
        @Req() req: Request,
    ) {
        return this.applicabilityMatrixImport.cancelPreview(
            this.extractUserId(req),
            importId,
        )
    }

    private readRemdMultipart(req: Request): Promise<{
        periodId: string
        importMode: string
        originalFilename: string
        fileBuffer: Buffer
        /**
         * Прочие текстовые поля формы, как пришли. Нужны импортам, у которых
         * кроме файла есть параметры, — помесячные выгрузки РЭМД задают месяц
         * и разновидность, когда шапка отчёта их не называет.
         */
        fields: Record<string, string>
    }> {
        return new Promise((resolve, reject) => {
            const bb = busboy({ headers: req.headers, limits: { fileSize: REPORTING_IMPORT_MAX_SIZE } })
            let periodId = ''
            let importMode = 'merge'
            let originalFilename = ''
            let fileBuffer: Buffer | null = null
            let fileHandled = false
            let fileTooLarge = false
            let settled = false
            let fileRead: Promise<void> | null = null

            const fail = (err: unknown) => {
                if (settled) return
                settled = true
                reject(err)
            }

            const fields: Record<string, string> = {}
            bb.on('field', (fieldName, value) => {
                const text = String(value || '').trim()
                fields[fieldName] = text
                if (fieldName === 'periodId') {
                    periodId = text
                } else if (fieldName === 'mode') {
                    importMode = text
                }
            })

            bb.on('file', (fieldName, stream, info) => {
                if (fieldName !== 'file' || fileHandled) {
                    stream.resume()
                    return
                }

                const { filename, mimeType } = info
                const decodedFilename = decodeMultipartFilename(filename)
                const ext = '.' + (decodedFilename.split('.').pop() ?? '').toLowerCase()
                if (!ALLOWED_REMD_IMPORT_MIMES.has(mimeType) && !ALLOWED_REMD_IMPORT_EXTS.has(ext)) {
                    stream.resume()
                    fail(new BadRequestException('Загрузите Excel-файл в формате .xlsx'))
                    return
                }

                fileHandled = true
                originalFilename = decodedFilename

                fileRead = new Promise<void>((fileResolve, fileReject) => {
                    const chunks: Buffer[] = []

                    stream.on('data', (chunk: Buffer) => {
                        chunks.push(chunk)
                    })
                    stream.on('limit', () => {
                        fileTooLarge = true
                        stream.destroy(new Error('Reporting import file size limit exceeded'))
                        req.resume()
                        fileReject(new BadRequestException('Файл превышает максимально допустимый размер'))
                    })
                    stream.on('error', (err) => {
                        if (fileTooLarge) return
                        fileReject(new InternalServerErrorException(String(err)))
                    })
                    stream.on('end', () => {
                        if (fileTooLarge) return
                        fileBuffer = Buffer.concat(chunks)
                        fileResolve()
                    })
                })

                fileRead.catch(fail)
            })

            bb.on('finish', () => {
                void (async () => {
                    try {
                        if (fileRead) await fileRead
                        if (!periodId) {
                            throw new BadRequestException('Укажите отчетный период')
                        }
                        if (!fileBuffer) {
                            throw new BadRequestException('Файл не предоставлен')
                        }
                        if (settled) return
                        settled = true
                        resolve({
                            periodId,
                            importMode,
                            originalFilename,
                            fileBuffer,
                            fields,
                        })
                    } catch (err) {
                        fail(err)
                    }
                })()
            })

            bb.on('error', (err) => {
                if (fileTooLarge) return
                fail(new InternalServerErrorException(String(err)))
            })

            req.pipe(bb)
        })
    }

    private readEmdNsiMultipart(req: Request): Promise<{
        periodId: string
        originalFilename: string
        fileBuffer: Buffer
    }> {
        return new Promise((resolve, reject) => {
            const bb = busboy({
                headers: req.headers,
                limits: { fileSize: REPORTING_IMPORT_MAX_SIZE },
            })
            let periodId = ''
            let originalFilename = ''
            let fileBuffer: Buffer | null = null
            let fileHandled = false
            let fileTooLarge = false
            let settled = false
            let fileRead: Promise<void> | null = null

            const fail = (err: unknown) => {
                if (settled) return
                settled = true
                reject(err)
            }

            bb.on('field', (fieldName, value) => {
                if (fieldName === 'periodId') {
                    periodId = String(value || '').trim()
                }
            })

            bb.on('file', (fieldName, stream, info) => {
                if (fieldName !== 'file' || fileHandled) {
                    stream.resume()
                    return
                }
                const decodedFilename = decodeMultipartFilename(info.filename)
                const ext = '.'
                    + (decodedFilename.split('.').pop() ?? '').toLowerCase()
                if (
                    !ALLOWED_EMD_NSI_IMPORT_MIMES.has(info.mimeType)
                    && !ALLOWED_EMD_NSI_IMPORT_EXTS.has(ext)
                ) {
                    stream.resume()
                    fail(new BadRequestException(
                        'Загрузите CSV или XLSX выгрузку справочника',
                    ))
                    return
                }

                fileHandled = true
                originalFilename = decodedFilename
                fileRead = new Promise<void>((fileResolve, fileReject) => {
                    const chunks: Buffer[] = []
                    stream.on('data', (chunk: Buffer) => chunks.push(chunk))
                    stream.on('limit', () => {
                        fileTooLarge = true
                        stream.destroy(new Error(
                            'Reporting import file size limit exceeded',
                        ))
                        req.resume()
                        fileReject(new BadRequestException(
                            'Файл превышает максимально допустимый размер',
                        ))
                    })
                    stream.on('error', (err) => {
                        if (!fileTooLarge) {
                            fileReject(
                                new InternalServerErrorException(String(err)),
                            )
                        }
                    })
                    stream.on('end', () => {
                        if (fileTooLarge) return
                        fileBuffer = Buffer.concat(chunks)
                        fileResolve()
                    })
                })
                fileRead.catch(fail)
            })

            bb.on('finish', () => {
                void (async () => {
                    try {
                        if (fileRead) await fileRead
                        if (!periodId) {
                            throw new BadRequestException(
                                'Укажите отчетный период',
                            )
                        }
                        if (!fileBuffer) {
                            throw new BadRequestException(
                                'Файл справочника ЭМД не предоставлен',
                            )
                        }
                        if (settled) return
                        settled = true
                        resolve({
                            periodId,
                            originalFilename,
                            fileBuffer,
                        })
                    } catch (err) {
                        fail(err)
                    }
                })()
            })

            bb.on('error', (err) => {
                if (!fileTooLarge) {
                    fail(new InternalServerErrorException(String(err)))
                }
            })
            req.pipe(bb)
        })
    }

    private extractUserId(req: Request): number {
        return ((req as any).user as AuthTokenPayload).sub
    }
}
