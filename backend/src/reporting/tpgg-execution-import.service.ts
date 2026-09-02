import { BadRequestException, Inject, Injectable } from '@nestjs/common'
import { createHash, randomUUID } from 'crypto'
import { Pool, type PoolClient } from 'pg'
import { APP_DB_POOL } from '../database/database.tokens'
import { S3StorageService } from '../storage/s3.service'
import {
    buildOrganizationAliasIndex,
    resolveOrganizationByName,
    type AliasIndexOrganization,
} from './tpgg-organization-alias-index'
import { parseTpggExecutionXlsx } from './tpgg-execution-xlsx'
import { normalizeTpggOrganizationName } from './tpgg-workbook-parser'

/**
 * Загрузка исполнения терпрограммы — третья колонка карточки МО (Д-10).
 *
 * Файлы фонда ОМС из папки «ТПГГ 2026 исполнение»: один файл на лист
 * терпрограммы, шестнадцать штук. Грузятся по одному, но выбрать можно все сразу.
 *
 * **Строки, не сопоставленные со справочником, сохраняются.** В файлах фонда
 * встречаются организации вне контура — ЧУЗ «РЖД-Медицина», частные клиники,
 * иногородние. Отбрасывать их молча нельзя: сумма по региону тогда перестанет
 * сходиться с итогом самого файла, и разобраться, куда делись объёмы, будет
 * не по чему. Они лежат с пустым `organization_oid` и в карточку МО не попадают.
 */

const TPGG_EXECUTION_SOURCE_TYPE = 'tpgg_execution'
const TPGG_EXECUTION_CONTENT_TYPE =
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const MAX_STORED_IMPORT_SIZE =
    Number(process.env.REPORTING_IMPORT_MAX_FILE_SIZE) || 25 * 1024 * 1024
const INSERT_BATCH_SIZE = 200

export interface TpggExecutionImportResult {
    importId: string
    periodId: string
    reportingYear: number
    sourceName: string
    sheetName: string
    layout: string
    sheetCodes: string[]
    fromMonth: number | null
    toMonth: number | null
    rowCount: number
    matchedOrganizationCount: number
    unmatchedOrganizationNames: string[]
    ambiguousOrganizationNames: string[]
    planTotal: number
    factTotal: number
    warnings: string[]
}

interface ExecutionRowToSave {
    organizationOid: string | null
    organizationName: string
    normalizedName: string
    sheetCode: string
    planValue: number
    factValue: number
}

@Injectable()
export class TpggExecutionImportService {
    constructor(
        @Inject(APP_DB_POOL) private readonly pool: Pool,
        private readonly s3: S3StorageService,
    ) {}

    async importXlsx(
        userId: number,
        periodId: string,
        fileBuffer: Buffer,
        originalFilename: string,
    ): Promise<TpggExecutionImportResult> {
        const cleanPeriodId = this.cleanText(periodId, 80)
        if (!cleanPeriodId) {
            throw new BadRequestException('Укажите отчетный период')
        }
        if (!fileBuffer.length) {
            throw new BadRequestException('Файл исполнения ТПГГ пуст')
        }
        if (fileBuffer.length > MAX_STORED_IMPORT_SIZE) {
            throw new BadRequestException('Файл превышает максимально допустимый размер')
        }
        const reportingYear = await this.loadReportingYear(cleanPeriodId)

        const sourceName = this.cleanText(originalFilename, 256) || 'tpgg-execution.xlsx'
        const parsed = await parseTpggExecutionXlsx(fileBuffer, sourceName)

        const importId = randomUUID()
        const fileSha256 = createHash('sha256').update(fileBuffer).digest('hex')
        const objectKey = `reporting/imports/tpgg-execution/${cleanPeriodId}/${importId}/`
            + this.buildObjectFilename(sourceName)
        await this.s3.uploadBuffer(objectKey, fileBuffer, TPGG_EXECUTION_CONTENT_TYPE)

        const client = await this.pool.connect()
        try {
            await client.query('BEGIN')
            await client.query(
                `INSERT INTO reporting_import_runs (
                    id, period_id, source_type, import_mode,
                    original_filename, object_key, file_sha256, file_size,
                    status, organization_rows, warnings, details, created_by
                )
                VALUES (
                    $1, $2, $3, 'replace',
                    $4, $5, $6, $7,
                    'processing', $8, '[]'::jsonb, '{}'::jsonb, $9
                );`,
                [
                    importId,
                    cleanPeriodId,
                    TPGG_EXECUTION_SOURCE_TYPE,
                    sourceName,
                    objectKey,
                    fileSha256,
                    fileBuffer.length,
                    parsed.rows.length,
                    userId,
                ],
            )

            const organizations = await this.loadOrganizations(client)
            const aliasIndex = buildOrganizationAliasIndex(organizations)

            const rows: ExecutionRowToSave[] = []
            const matchedOids = new Set<string>()
            const unmatchedNames = new Set<string>()
            const ambiguousNames = new Set<string>()
            let planTotal = 0
            let factTotal = 0

            for (const row of parsed.rows) {
                const normalized = normalizeTpggOrganizationName(row.organizationName)
                if (!normalized) continue
                const organization = resolveOrganizationByName(
                    aliasIndex,
                    row.organizationName,
                )
                if (organization) {
                    matchedOids.add(organization.oid)
                } else if ((aliasIndex.get(normalized)?.length ?? 0) > 1) {
                    ambiguousNames.add(row.organizationName)
                } else {
                    unmatchedNames.add(row.organizationName)
                }
                planTotal += row.planValue
                factTotal += row.factValue
                rows.push({
                    organizationOid: organization?.oid ?? null,
                    organizationName: row.organizationName,
                    normalizedName: normalized,
                    sheetCode: row.sheetCode,
                    planValue: row.planValue,
                    factValue: row.factValue,
                })
            }

            if (matchedOids.size === 0) {
                throw new BadRequestException(
                    'Ни одна медорганизация файла не сопоставилась со справочником: '
                    + `распознано строк ${parsed.rows.length}. Прежние данные сохранены. `
                    + 'Проверьте, что загружается выгрузка нужного региона и что '
                    + 'справочник МО (шаг 5) загружен.',
                )
            }

            const fromMonth = parsed.interval?.from.month ?? null
            const toMonth = parsed.interval?.to.month ?? null

            const warnings = [...parsed.warnings]
            if (!parsed.interval) {
                warnings.push(
                    'Интервал исполнения в файле не найден — подпись в карточке МО '
                    + 'останется без месяцев. На расчёт это не влияет.',
                )
            }
            if (unmatchedNames.size > 0) {
                warnings.push(
                    `Вне справочника МО ${unmatchedNames.size} организаций: `
                    + `${[...unmatchedNames].slice(0, 10).join(', ')}`
                    + `${unmatchedNames.size > 10 ? '…' : ''}. `
                    + 'Их объёмы сохранены справочно и в карточки МО не попадут.',
                )
            }
            if (ambiguousNames.size > 0) {
                warnings.push(
                    `Неоднозначно сопоставляются ${ambiguousNames.size} наименований: `
                    + `${[...ambiguousNames].slice(0, 10).join(', ')}.`,
                )
            }

            await this.saveRows(client, {
                periodId: cleanPeriodId,
                reportingYear,
                importId,
                fromMonth,
                toMonth,
                rows,
            })

            await client.query(
                `UPDATE reporting_import_runs
                 SET status = 'completed',
                     indicator_values_count = $2,
                     organization_values_count = $3,
                     warnings = $4::jsonb,
                     details = $5::jsonb,
                     error_message = '',
                     completed_at = now()
                 WHERE id = $1;`,
                [
                    importId,
                    rows.length,
                    matchedOids.size,
                    JSON.stringify(warnings),
                    JSON.stringify({
                        layout: parsed.layout,
                        sheetName: parsed.sheetName,
                        sheetCodes: parsed.sheetCodes,
                        fromMonth,
                        toMonth,
                        planTotal,
                        factTotal,
                        unmatchedOrganizationNames: [...unmatchedNames],
                        ambiguousOrganizationNames: [...ambiguousNames],
                    }),
                ],
            )
            await client.query('COMMIT')

            return {
                importId,
                periodId: cleanPeriodId,
                reportingYear,
                sourceName,
                sheetName: parsed.sheetName,
                layout: parsed.layout,
                sheetCodes: parsed.sheetCodes,
                fromMonth,
                toMonth,
                rowCount: rows.length,
                matchedOrganizationCount: matchedOids.size,
                unmatchedOrganizationNames: [...unmatchedNames],
                ambiguousOrganizationNames: [...ambiguousNames],
                planTotal,
                factTotal,
                warnings,
            }
        } catch (err) {
            await client.query('ROLLBACK')
            await this.markImportFailed(importId, err)
            throw err
        } finally {
            client.release()
        }
    }

    /**
     * Строки листов, которые несёт этот файл, заменяются целиком. Точечный
     * `ON CONFLICT` без предварительной чистки оставил бы медорганизацию,
     * выпавшую из новой выгрузки, с прошлыми числами — и та молча продолжила бы
     * показывать исполнение, которого в свежем файле уже нет.
     */
    private async saveRows(
        client: PoolClient,
        params: {
            periodId: string
            reportingYear: number
            importId: string
            fromMonth: number | null
            toMonth: number | null
            rows: readonly ExecutionRowToSave[]
        },
    ): Promise<void> {
        const sheetCodes = [...new Set(params.rows.map((row) => row.sheetCode))]
        await client.query(
            `DELETE FROM reporting_tpgg_execution_values
             WHERE reporting_year = $1 AND sheet_code = ANY($2::text[]);`,
            [params.reportingYear, sheetCodes],
        )

        for (let offset = 0; offset < params.rows.length; offset += INSERT_BATCH_SIZE) {
            const batch = params.rows.slice(offset, offset + INSERT_BATCH_SIZE)
            // Постоянные для пачки значения идут первыми параметрами, а не
            // подставляются в текст запроса: строковая склейка в SQL — привычка,
            // которая однажды доберётся до значения, пришедшего из файла.
            const values: unknown[] = [
                params.importId,
                params.periodId,
                params.reportingYear,
                params.fromMonth,
                params.toMonth,
            ]
            const CONSTANT_PARAMS = values.length
            const ROW_PARAMS = 6
            const placeholders = batch.map((row, index) => {
                const base = CONSTANT_PARAMS + index * ROW_PARAMS
                values.push(
                    row.organizationOid,
                    row.organizationName,
                    row.normalizedName,
                    row.sheetCode,
                    row.planValue,
                    row.factValue,
                )
                return `($2::uuid, $3, $${base + 1}, $${base + 2},`
                    + ` $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6},`
                    + ' $4, $5, $1::uuid)'
            })
            await client.query(
                `INSERT INTO reporting_tpgg_execution_values (
                    period_id, reporting_year, organization_oid, organization_name,
                    normalized_organization_name, sheet_code, plan_value, fact_value,
                    from_month, to_month, source_import_id
                 )
                 VALUES ${placeholders.join(', ')}
                 ON CONFLICT (reporting_year, sheet_code, normalized_organization_name)
                 DO UPDATE SET plan_value = EXCLUDED.plan_value,
                               fact_value = EXCLUDED.fact_value,
                               organization_oid = EXCLUDED.organization_oid,
                               from_month = EXCLUDED.from_month,
                               to_month = EXCLUDED.to_month,
                               source_import_id = EXCLUDED.source_import_id,
                               updated_at = now();`,
                values,
            )
        }
    }

    private async loadOrganizations(
        client: PoolClient,
    ): Promise<AliasIndexOrganization[]> {
        const result = await client.query(
            `
            SELECT organization.oid,
                   organization.official_full_name AS "officialFullName",
                   organization.official_short_name AS "officialShortName",
                   organization.common_name AS "commonName",
                   COALESCE(
                       jsonb_agg(alias.normalized_alias)
                           FILTER (WHERE alias.normalized_alias IS NOT NULL),
                       '[]'::jsonb
                   ) AS aliases
            FROM reporting_organizations organization
            LEFT JOIN reporting_organization_aliases alias
                ON alias.organization_oid = organization.oid
            WHERE organization.is_active = TRUE
            GROUP BY organization.oid,
                     organization.official_full_name,
                     organization.official_short_name,
                     organization.common_name;
            `,
        )
        return result.rows.map((row) => ({
            oid: String(row.oid),
            officialFullName: String(row.officialFullName ?? ''),
            officialShortName: String(row.officialShortName ?? ''),
            commonName: String(row.commonName ?? ''),
            aliases: Array.isArray(row.aliases)
                ? row.aliases.map((alias: unknown) => String(alias))
                : [],
        }))
    }

    private async loadReportingYear(periodId: string): Promise<number> {
        const result = await this.pool.query(
            `SELECT date_from::text AS "dateFrom", date_to::text AS "dateTo"
             FROM reporting_periods WHERE id = $1;`,
            [periodId],
        )
        const period = result.rows[0]
        if (!period) throw new BadRequestException('Отчетный период не найден')
        const parsed = Number(String(period.dateTo ?? period.dateFrom ?? '').slice(0, 4))
        if (!Number.isInteger(parsed)) {
            throw new BadRequestException(
                'У отчётного периода должна быть указана дата: по ней определяется '
                + 'год терпрограммы.',
            )
        }
        return parsed
    }

    private async markImportFailed(importId: string, err: unknown): Promise<void> {
        const message = err instanceof Error ? err.message : 'Неизвестная ошибка импорта'
        try {
            await this.pool.query(
                `UPDATE reporting_import_runs
                 SET status = 'failed', error_message = $2, completed_at = now()
                 WHERE id = $1;`,
                [importId, this.cleanText(message, 1000)],
            )
        } catch {
            // Журнал не должен подменять исходную ошибку импорта.
        }
    }

    private buildObjectFilename(sourceName: string): string {
        const safe = sourceName.replace(/[^\w.-]+/gu, '_').slice(0, 120)
        return safe || 'tpgg-execution.xlsx'
    }

    private cleanText(value: unknown, maxLength: number): string {
        if (typeof value !== 'string') return ''
        return value.replace(/\s+/gu, ' ').trim().slice(0, maxLength)
    }
}
