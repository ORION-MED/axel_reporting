import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common'
import { createHash, randomUUID } from 'crypto'
import { Pool, type PoolClient } from 'pg'
import { APP_DB_POOL } from '../database/database.tokens'
import { S3StorageService } from '../storage/s3.service'
import type { ReportingCalculationType } from './reporting-domain.types'
import { WorkbookImportJournal, type WorkbookImportRunRow } from './engine/workbook-import-journal'
import { IndicatorCalculatorRegistry } from './engine/indicator-calculator.registry'
import { calculateBusinessAssessment } from './engine/ratio-percent.calculator'
import type {
    IndicatorCalculationResult,
    IndicatorValueStatus,
} from './engine/indicator-calculator'
import { loadTargetPlanWorkbook, type TargetPlanParseResult, type TargetPlanRow } from './target-plan-parser'

/**
 * Roadmap step 4 (target-value plan importer) — applies the official monthly plan of
 * target values (Прил. 2) to `reporting_indicator_values.target_value` for indicators that
 * are already tracked (6.1.3.2.7-12). Only target_value is touched; numerator/denominator
 * (and therefore fact_value/status) come exclusively from the REMD/TPGG/manual flows and are
 * preserved as-is, then recalculated against the new target through IndicatorCalculatorRegistry.
 */

const TARGET_PLAN_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const PREVIEW_TTL_HOURS = 24
const MAX_STORED_IMPORT_SIZE = Number(process.env.REPORTING_IMPORT_MAX_FILE_SIZE) || 25 * 1024 * 1024
const PLAN_YEAR = 2026
/** semd_type_coverage (6.1.3.2.7) recalculates target_value and target_year_end_value itself from a hardcoded plan constant — see pilot-calculation.types.ts PILOT_TARGET_TYPES. */
const AUTO_MANAGED_CALCULATION_TYPE: ReportingCalculationType = 'semd_type_coverage'

interface ReportingPeriodRow {
    id: string
    dateFrom: string | null
    dateTo: string | null
}

interface IndicatorRow {
    id: string
    code: string
    calculationType: ReportingCalculationType
    methodologyStatus: 'ready' | 'in_development'
    metadata: Record<string, unknown>
}

interface ExistingValueRow {
    indicatorId: string
    numerator: number | null
    denominator: number | null
    targetValue: number | null
}

export interface TargetPlanPreviewItem {
    itemNumber: string
    name: string
    indicatorCode: string | null
    unit: string
    matched: boolean
    applicable: boolean
    note: string
    indicatorId: string | null
    currentTargetValue: number | null
    newTargetValue: number | null
    /** Значение на конец года из «Приложения 2» — вторая цифра на карточке. */
    newTargetYearEndValue: number | null
    willChange: boolean
}

export interface TargetPlanPreview {
    canConfirm: boolean
    planYear: number
    targetMonth: number | null
    rows: TargetPlanPreviewItem[]
    totals: {
        rowCount: number
        matchedCount: number
        applicableCount: number
        changingCount: number
    }
    warnings: string[]
}

export interface TargetPlanPreviewResult {
    importId: string
    periodId: string
    sourceName: string
    fileSha256: string
    previewExpiresAt: string
    preview: TargetPlanPreview
}

export interface TargetPlanConfirmResult {
    importId: string
    periodId: string
    sourceName: string
    updatedCount: number
    warnings: string[]
}

@Injectable()
export class TargetPlanImportService {
    constructor(
        @Inject(APP_DB_POOL) private readonly pool: Pool,
        private readonly s3: S3StorageService,
        private readonly journal: WorkbookImportJournal,
        private readonly calculators: IndicatorCalculatorRegistry,
    ) {}

    async createPreview(
        userId: number,
        periodId: string,
        fileBuffer: Buffer,
        originalFilename: string,
    ): Promise<TargetPlanPreviewResult> {
        const cleanPeriodId = this.cleanText(periodId, 80)
        if (!cleanPeriodId) {
            throw new BadRequestException('Укажите отчетный период')
        }
        if (!fileBuffer.length) {
            throw new BadRequestException('Файл плана показателей пуст')
        }
        if (fileBuffer.length > MAX_STORED_IMPORT_SIZE) {
            throw new BadRequestException('Файл превышает максимально допустимый размер')
        }

        const period = await this.getPeriod(cleanPeriodId)
        const sourceName = this.cleanText(originalFilename, 256) || 'plan.xlsx'
        const parsed = await loadTargetPlanWorkbook(fileBuffer)
        const preview = await this.buildPreview(cleanPeriodId, period, parsed)

        const importId = randomUUID()
        const fileSha256 = createHash('sha256').update(fileBuffer).digest('hex')
        const previewExpiresAt = new Date(Date.now() + PREVIEW_TTL_HOURS * 60 * 60 * 1000)
        const objectKey = `reporting/reference/target-plan/${cleanPeriodId}/${importId}/${this.buildObjectFilename(sourceName)}`

        await this.journal.createPreviewedRun({
            importId,
            periodId: cleanPeriodId,
            sourceType: 'target_plan',
            importMode: 'merge',
            sourceName,
            fileBuffer,
            contentType: TARGET_PLAN_CONTENT_TYPE,
            objectKey,
            fileSha256,
            organizationRows: 0,
            warnings: preview.warnings,
            details: { preview },
            userId,
            previewExpiresAt,
        })

        return {
            importId,
            periodId: cleanPeriodId,
            sourceName,
            fileSha256,
            previewExpiresAt: previewExpiresAt.toISOString(),
            preview,
        }
    }

    async getPreview(userId: number, importId: string): Promise<TargetPlanPreviewResult> {
        const run = await this.getPreviewRun(userId, importId)
        const preview = run.details?.preview as TargetPlanPreview | undefined
        if (!preview) {
            throw new NotFoundException('Предпросмотр импорта плана показателей не найден')
        }
        return {
            importId: run.id,
            periodId: run.periodId,
            sourceName: run.originalFilename,
            fileSha256: run.fileSha256,
            previewExpiresAt: this.toIsoString(run.previewExpiresAt),
            preview,
        }
    }

    async confirmPreview(userId: number, importId: string): Promise<TargetPlanConfirmResult> {
        const run = await this.getPreviewRun(userId, importId)
        this.assertPreviewCanBeConfirmed(run)
        const fileBuffer = await this.readStoredImport(run.objectKey, run.fileSize)
        const storedHash = createHash('sha256').update(fileBuffer).digest('hex')
        if (storedHash !== run.fileSha256) {
            throw new BadRequestException('Сохраненный файл импорта поврежден: контрольная сумма не совпадает')
        }

        const period = await this.getPeriod(run.periodId)
        const parsed = await loadTargetPlanWorkbook(fileBuffer)
        const preview = await this.buildPreview(run.periodId, period, parsed)
        if (!preview.canConfirm) {
            throw new BadRequestException('План показателей нельзя применить: нет ни одного применимого сопоставленного показателя')
        }
        const indicators = await this.loadIndicators()
        const indicatorById = new Map(indicators.map((indicator) => [indicator.id, indicator]))

        let transitionedToProcessing = false
        let updatedCount = 0
        const client = await this.pool.connect()
        try {
            await client.query('BEGIN')
            const transition = await client.query(
                `
                UPDATE reporting_import_runs
                SET status = 'processing',
                    confirmed_at = now(),
                    error_message = ''
                WHERE id = $1
                  AND created_by = $2
                  AND source_type = 'target_plan'
                  AND status = 'previewed'
                  AND preview_expires_at > now()
                RETURNING id;
                `,
                [run.id, userId],
            )
            if (transition.rowCount !== 1) {
                throw new BadRequestException('Предпросмотр уже подтвержден или срок его действия истек')
            }
            transitionedToProcessing = true

            await client.query(
                `SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2));`,
                ['reporting_target_plan', run.periodId],
            )

            for (const item of preview.rows) {
                if (!item.applicable || !item.indicatorId || item.newTargetValue === null) continue
                const indicator = indicatorById.get(item.indicatorId)
                if (!indicator) continue
                updatedCount += await this.applyTargetValue(
                    client,
                    run,
                    indicator,
                    item.newTargetValue,
                    item.newTargetYearEndValue,
                    userId,
                )
            }

            await client.query(
                `
                UPDATE reporting_import_runs
                SET status = 'completed',
                    indicator_values_count = $2,
                    warnings = $3::jsonb,
                    details = $4::jsonb,
                    error_message = '',
                    completed_at = now()
                WHERE id = $1;
                `,
                [
                    run.id,
                    updatedCount,
                    JSON.stringify(preview.warnings),
                    JSON.stringify({ preview, updatedCount }),
                ],
            )
            await client.query('COMMIT')
        } catch (err) {
            await client.query('ROLLBACK')
            if (transitionedToProcessing) {
                await this.markImportFailed(run.id, err)
            }
            throw err
        } finally {
            client.release()
        }

        return {
            importId: run.id,
            periodId: run.periodId,
            sourceName: run.originalFilename,
            updatedCount,
            warnings: preview.warnings,
        }
    }

    async cancelPreview(userId: number, importId: string): Promise<{ importId: string; status: 'cancelled' }> {
        return this.journal.cancelPreview('target_plan', userId, this.cleanText(importId, 80))
    }

    private async applyTargetValue(
        client: PoolClient,
        run: WorkbookImportRunRow,
        indicator: IndicatorRow,
        newTargetValue: number,
        newTargetYearEndValue: number | null,
        userId: number,
    ): Promise<number> {
        const existingResult = await client.query(
            `
            SELECT numerator::float8 AS numerator,
                   denominator::float8 AS denominator,
                   fact_value::float8 AS "factValue",
                   status
            FROM reporting_indicator_values
            WHERE indicator_id = $1 AND period_id = $2;
            `,
            [indicator.id, run.periodId],
        )
        const existingRow = existingResult.rows[0]
        const numerator = existingRow ? this.toNullableNumber(existingRow.numerator) : null
        const denominator = existingRow ? this.toNullableNumber(existingRow.denominator) : null
        const calculated = this.recalculateWithTarget(
            indicator,
            { numerator, denominator, targetValue: newTargetValue },
            existingRow
                ? {
                    factValue: this.toNullableNumber(existingRow.factValue),
                    status: String(existingRow.status ?? 'awaiting_data') as IndicatorValueStatus,
                }
                : { factValue: null, status: 'awaiting_data' },
        )

        const result = await client.query(
            `
            INSERT INTO reporting_indicator_values (
                indicator_id,
                period_id,
                target_value,
                target_year_end_value,
                status,
                fact_value,
                deviation_value,
                business_status,
                source_name,
                updated_by
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            ON CONFLICT (indicator_id, period_id) DO UPDATE SET
                target_value = EXCLUDED.target_value,
                target_year_end_value = EXCLUDED.target_year_end_value,
                status = EXCLUDED.status,
                fact_value = EXCLUDED.fact_value,
                deviation_value = EXCLUDED.deviation_value,
                business_status = EXCLUDED.business_status,
                source_name = EXCLUDED.source_name,
                updated_by = EXCLUDED.updated_by,
                updated_at = now();
            `,
            [
                indicator.id,
                run.periodId,
                newTargetValue,
                newTargetYearEndValue,
                calculated.status,
                calculated.factValue,
                calculated.deviationValue,
                calculated.businessStatus,
                run.originalFilename,
                userId,
            ],
        )
        return result.rowCount ?? 0
    }

    /**
     * Пересчёт значения под новый план.
     *
     * Показатели с расчётом через движок (`ratio_percent`) считают факт заново из
     * числителя и знаменателя. Показатели с массовым расчётом — доли к объёмам ТПГГ
     * и показатель 27 — считаются собственными сервисами и в движке не зарегистрированы:
     * `require()` на них падал, и подтверждение плана валилось с «No IndicatorCalculator
     * registered for calculation_type "semd_volume_ratio"».
     *
     * Для них факт уже посчитан и лежит в строке — от загрузки плана меняется только
     * оценка выполнения. Пересчитываем её той же чистой функцией, что и движок,
     * чтобы отклонение и статус считались одинаково.
     */
    private recalculateWithTarget(
        indicator: IndicatorRow,
        input: { numerator: number | null; denominator: number | null; targetValue: number },
        existing: { factValue: number | null; status: IndicatorValueStatus },
    ): IndicatorCalculationResult {
        const calculator = this.calculators.get(indicator.calculationType)
        if (calculator) {
            return calculator.calculate(
                { methodologyStatus: indicator.methodologyStatus, metadata: indicator.metadata },
                input,
            )
        }

        const assessment = calculateBusinessAssessment(
            existing.factValue,
            input.targetValue,
            indicator.metadata?.criticalDeviationPoints,
        )
        return {
            status: existing.status,
            factValue: existing.factValue,
            ...assessment,
        }
    }

    private async buildPreview(
        periodId: string,
        period: ReportingPeriodRow,
        parsed: TargetPlanParseResult,
    ): Promise<TargetPlanPreview> {
        const [indicators, existingValues] = await Promise.all([
            this.loadIndicators(),
            this.loadExistingValues(periodId),
        ])
        const indicatorByCode = new Map(indicators.map((indicator) => [indicator.code, indicator]))
        const existingByIndicatorId = new Map(existingValues.map((value) => [value.indicatorId, value]))
        const targetMonth = this.resolveTargetMonth(period)

        const warnings: string[] = []
        if (targetMonth === null) {
            warnings.push(`Не удалось определить месяц отчетного периода; использованы значения на конец ${PLAN_YEAR} года.`)
        } else if (targetMonth < 6 || targetMonth > 11) {
            warnings.push(`Месяц выбранного периода (${targetMonth}) вне диапазона помесячного плана (июнь-ноябрь); использованы значения на конец ${PLAN_YEAR} года.`)
        }

        const rows = parsed.rows.map((row) => this.buildPreviewItem(row, indicatorByCode, existingByIndicatorId, targetMonth))
        const matchedCount = rows.filter((row) => row.matched).length
        const applicableCount = rows.filter((row) => row.applicable).length
        const changingCount = rows.filter((row) => row.willChange).length

        return {
            canConfirm: applicableCount > 0,
            planYear: PLAN_YEAR,
            targetMonth,
            rows,
            totals: {
                rowCount: rows.length,
                matchedCount,
                applicableCount,
                changingCount,
            },
            warnings,
        }
    }

    private buildPreviewItem(
        row: TargetPlanRow,
        indicatorByCode: Map<string, IndicatorRow>,
        existingByIndicatorId: Map<string, ExistingValueRow>,
        targetMonth: number | null,
    ): TargetPlanPreviewItem {
        const base = {
            itemNumber: row.itemNumber,
            name: row.name,
            indicatorCode: row.indicatorCode,
            unit: row.unit,
        }

        if (!row.indicatorCode) {
            return {
                ...base,
                matched: false,
                applicable: false,
                note: 'В строке плана не удалось определить номер показателя',
                indicatorId: null,
                currentTargetValue: null,
                newTargetValue: null,
                newTargetYearEndValue: null,
                willChange: false,
            }
        }

        const indicator = indicatorByCode.get(row.indicatorCode)
        if (!indicator) {
            return {
                ...base,
                matched: false,
                applicable: false,
                note: `Показатель ${row.indicatorCode} отсутствует в справочнике показателей отчетности`,
                indicatorId: null,
                currentTargetValue: null,
                newTargetValue: null,
                newTargetYearEndValue: null,
                willChange: false,
            }
        }

        const currentTargetValue = existingByIndicatorId.get(indicator.id)?.targetValue ?? null
        if (indicator.calculationType === AUTO_MANAGED_CALCULATION_TYPE) {
            return {
                ...base,
                matched: true,
                applicable: false,
                note: 'Целевое значение для этого показателя рассчитывается автоматически модулем пилотного расчета и не может быть изменено этим импортом',
                indicatorId: indicator.id,
                currentTargetValue,
                newTargetValue: null,
                newTargetYearEndValue: null,
                willChange: false,
            }
        }

        const newTargetValue = (targetMonth !== null ? row.monthlyValues[targetMonth] ?? null : null) ?? row.yearEndValue
        if (newTargetValue === null) {
            return {
                ...base,
                matched: true,
                applicable: false,
                note: 'В плане не указано целевое значение для этого показателя на выбранный период',
                indicatorId: indicator.id,
                currentTargetValue,
                newTargetValue: null,
                newTargetYearEndValue: null,
                willChange: false,
            }
        }

        return {
            ...base,
            matched: true,
            applicable: true,
            note: '',
            indicatorId: indicator.id,
            currentTargetValue,
            newTargetValue,
            newTargetYearEndValue: row.yearEndValue,
            willChange: currentTargetValue !== newTargetValue,
        }
    }

    private resolveTargetMonth(period: ReportingPeriodRow): number | null {
        const source = period.dateTo ?? period.dateFrom
        if (!source) return null
        const month = Number(source.slice(5, 7))
        return Number.isInteger(month) && month >= 1 && month <= 12 ? month : null
    }

    private async loadIndicators(): Promise<IndicatorRow[]> {
        const result = await this.pool.query(`
            SELECT id,
                   code,
                   calculation_type AS "calculationType",
                   methodology_status AS "methodologyStatus",
                   metadata
            FROM reporting_indicators;
        `)
        return result.rows.map((row) => ({
            id: String(row.id),
            code: String(row.code),
            calculationType: row.calculationType as ReportingCalculationType,
            methodologyStatus: row.methodologyStatus === 'in_development' ? 'in_development' : 'ready',
            metadata: row.metadata ?? {},
        }))
    }

    private async loadExistingValues(periodId: string): Promise<ExistingValueRow[]> {
        const result = await this.pool.query(
            `
            SELECT indicator_id AS "indicatorId",
                   numerator::float8 AS numerator,
                   denominator::float8 AS denominator,
                   target_value::float8 AS "targetValue"
            FROM reporting_indicator_values
            WHERE period_id = $1;
            `,
            [periodId],
        )
        return result.rows.map((row) => ({
            indicatorId: String(row.indicatorId),
            numerator: this.toNullableNumber(row.numerator),
            denominator: this.toNullableNumber(row.denominator),
            targetValue: this.toNullableNumber(row.targetValue),
        }))
    }

    private toNullableNumber(value: unknown): number | null {
        if (value === null || typeof value === 'undefined') return null
        const parsed = Number(value)
        return Number.isFinite(parsed) ? parsed : null
    }

    private async getPeriod(periodId: string): Promise<ReportingPeriodRow> {
        const result = await this.pool.query(
            `
            SELECT id::text,
                   date_from::text AS "dateFrom",
                   date_to::text AS "dateTo"
            FROM reporting_periods
            WHERE id = $1;
            `,
            [periodId],
        )
        if (!result.rows[0]) {
            throw new NotFoundException('Отчетный период не найден')
        }
        return result.rows[0]
    }

    private async getPreviewRun(userId: number, importId: string): Promise<WorkbookImportRunRow> {
        return this.journal.getPreviewedRun(
            'target_plan',
            userId,
            this.cleanText(importId, 80),
            'Импорт плана показателей не найден',
        )
    }

    private assertPreviewCanBeConfirmed(run: WorkbookImportRunRow): void {
        if (run.status !== 'previewed') {
            throw new BadRequestException('Этот импорт уже был обработан')
        }
        const expiresAt = run.previewExpiresAt ? new Date(run.previewExpiresAt).getTime() : 0
        if (!expiresAt || expiresAt <= Date.now()) {
            throw new BadRequestException('Срок действия предпросмотра истек. Загрузите файл повторно')
        }
        const preview = run.details?.preview as TargetPlanPreview | undefined
        if (!preview?.canConfirm) {
            throw new BadRequestException('План показателей нельзя применить: проверьте предупреждения предпросмотра')
        }
    }

    private async readStoredImport(objectKey: string, expectedSize: number): Promise<Buffer> {
        if (expectedSize < 0 || expectedSize > MAX_STORED_IMPORT_SIZE) {
            throw new BadRequestException('Размер сохраненного файла импорта недопустим')
        }
        const stream = await this.s3.getObjectStream(objectKey)
        const chunks: Buffer[] = []
        let totalSize = 0
        for await (const chunk of stream) {
            const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
            totalSize += buffer.length
            if (totalSize > MAX_STORED_IMPORT_SIZE) {
                stream.destroy()
                throw new BadRequestException('Сохраненный файл превышает максимально допустимый размер')
            }
            chunks.push(buffer)
        }
        if (totalSize !== Number(expectedSize)) {
            throw new BadRequestException('Сохраненный файл импорта поврежден: размер не совпадает')
        }
        return Buffer.concat(chunks)
    }

    private buildObjectFilename(sourceName: string): string {
        const withoutPath = sourceName.replace(/\\/g, '/').split('/').pop()!
        const safe = withoutPath
            .replace(/[^\p{L}\p{N}._-]+/gu, '_')
            .replace(/^_+|_+$/g, '')
            .slice(0, 180)
        return safe.toLocaleLowerCase('ru-RU').endsWith('.xlsx') ? safe : `${safe || 'target-plan'}.xlsx`
    }

    private async markImportFailed(importId: string, err: unknown): Promise<void> {
        const errorMessage = this.cleanText(err instanceof Error ? err.message : String(err), 2000)
        await this.pool.query(
            `
            UPDATE reporting_import_runs
            SET status = 'failed',
                error_message = $2,
                completed_at = now()
            WHERE id = $1
              AND status = 'processing';
            `,
            [importId, errorMessage],
        )
    }

    private cleanText(value: unknown, maxLength: number = 1000): string {
        return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, maxLength)
    }

    private toIsoString(value: Date | string | null): string {
        if (!value) return ''
        return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
    }
}
