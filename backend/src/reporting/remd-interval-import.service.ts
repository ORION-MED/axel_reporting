import { BadRequestException, Inject, Injectable } from '@nestjs/common'
import { createHash, randomUUID } from 'crypto'
import { Pool, type PoolClient } from 'pg'
import { APP_DB_POOL } from '../database/database.tokens'
import { S3StorageService } from '../storage/s3.service'
import { normalizeSemdName } from './emd-nsi-csv'
import { ORGANIZATION_GEO_BY_OID } from './organization-geo'
import {
    classifyRemdInterval,
    type RemdIntervalCoverage,
    type RemdIntervalTag,
} from './remd-interval-facts'
import {
    parseRemdNumeratorXlsx,
    type RemdNumeratorRow,
} from './remd-numerator-xlsx'

/**
 * Загрузка выгрузок РЭМД за интервал — помесячных и нарастающих итогом.
 *
 * **Зачем отдельный импортёр, а не расширение шага 4.** Шаг 4 держит числитель
 * всех показателей и перед записью чистит `reporting_remd_facts` по всему
 * периоду. Тринадцать отчётов от 25.08.2026 относятся к одному отчётному
 * периоду, и через шаг 4 каждый следующий стирал бы предыдущий вместе
 * с числителем. Поэтому своя таблица (`reporting_remd_interval_facts`,
 * миграция 0055) и свой импортёр.
 *
 * **Разбор при этом общий.** Файлы того же широкого формата, что читает
 * `parseRemdNumeratorXlsx`, — новый парсер не нужен, и сопоставление видов
 * идёт через тот же справочник синонимов `reporting_semd_type_aliases`.
 *
 * **Организации здесь не создаются.** Шаг 4 при загрузке заводит целевые МО;
 * этот импорт идёт после него и работает по уже существующему справочнику.
 * МО из файла, которой в справочнике нет, попадает в предупреждение — молча
 * появиться в контуре она не должна.
 *
 * **Пересчёт не запускается.** Из показателей эти факты читает только 27-й,
 * а он пересчитывается при открытии вкладки «Показатели»
 * (`ReportingService.getSummary`). Дёргать пересчёт здесь значило бы считать
 * дважды за одну загрузку семи файлов подряд.
 */

const REMD_INTERVAL_SOURCE_TYPE = 'remd_interval_xlsx'
const REMD_INTERVAL_CONTENT_TYPE =
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const MAX_STORED_IMPORT_SIZE =
    Number(process.env.REPORTING_IMPORT_MAX_FILE_SIZE) || 25 * 1024 * 1024
const INSERT_BATCH_SIZE = 300
const TARGET_ORGANIZATION_OIDS = new Set(Object.keys(ORGANIZATION_GEO_BY_OID))

export interface RemdIntervalImportResult {
    importId: string
    periodId: string
    sourceName: string
    sheetName: string
    coverage: RemdIntervalCoverage
    month: number
    year: number
    /** Определился ли интервал по шапке файла или был задан пользователем. */
    intervalFromHeader: boolean
    factCount: number
    matchedOrganizationCount: number
    matchedTypeCount: number
    /** Уникальных видов СЭМД в выгрузке — числитель показателя 27 для нарастающей. */
    uniqueTypeCount: number
    documentCount: number
    unmatchedOrganizationOids: string[]
    unmatchedDocumentTypeNames: string[]
    warnings: string[]
}

/** Пометка, заданная руками, когда шапку отчёта разобрать не удалось. */
export interface RemdIntervalOverride {
    coverage: RemdIntervalCoverage
    month: number
    year: number
}

export interface IntervalFact {
    organizationOid: string
    semdTypeId: string
    documentCount: number
}

export interface BuildingFact {
    organizationOid: string
    buildingId: string
    buildingName: string
    buildingAddress: string
    semdTypeId: string
    documentCount: number
}

export interface IntervalAggregation {
    facts: IntervalFact[]
    /**
     * Те же документы, но с зерном «МО × здание × вид». Нужны показателю 1.24:
     * он считает ТВСП, а ТВСП — это здание, и в своде по «МО × вид» здание
     * теряется.
     */
    buildingFacts: BuildingFact[]
    matchedOrganizationOids: Set<string>
    matchedTypeIds: Set<string>
    unmatchedOrganizationOids: Set<string>
    unmatchedDocumentTypeNames: Set<string>
    documentCount: number
}

/**
 * Свод строк выгрузки в факты «МО × вид».
 *
 * Вынесено из импорта отдельной функцией, потому что здесь живёт вся логика,
 * которую стоит проверять: широкий отчёт несёт разрез по подразделениям, и один
 * вид приходит у МО несколькими строками — их надо сложить, а не заменить.
 * На реальной июльской выгрузке разница между «сложить» и «взять последнюю» —
 * сотни тысяч документов.
 *
 * МО вне целевого контура пропускаются молча (их в показателе нет вовсе),
 * а известная контуру, но отсутствующая в справочнике — попадает
 * в `unmatchedOrganizationOids`: это признак того, что шаг 4 ещё не загружен.
 */
export function aggregateIntervalFacts(
    rows: readonly RemdNumeratorRow[],
    lookup: {
        targetOrganizationOids: ReadonlySet<string>
        activeOrganizationOids: ReadonlySet<string>
        semdTypeIdByAlias: ReadonlyMap<string, string>
    },
): IntervalAggregation {
    const factByKey = new Map<string, IntervalFact>()
    const buildingByKey = new Map<string, BuildingFact>()
    const matchedOrganizationOids = new Set<string>()
    const matchedTypeIds = new Set<string>()
    const unmatchedOrganizationOids = new Set<string>()
    const unmatchedDocumentTypeNames = new Set<string>()
    let documentCount = 0

    for (const row of rows) {
        if (!lookup.targetOrganizationOids.has(row.organizationOid)) continue
        if (!lookup.activeOrganizationOids.has(row.organizationOid)) {
            unmatchedOrganizationOids.add(row.organizationOid)
            continue
        }
        const semdTypeId = lookup.semdTypeIdByAlias.get(
            normalizeSemdName(row.documentTypeName),
        )
        if (!semdTypeId) {
            unmatchedDocumentTypeNames.add(row.documentTypeName)
            continue
        }
        matchedOrganizationOids.add(row.organizationOid)
        matchedTypeIds.add(semdTypeId)
        documentCount += row.documentCount

        const key = `${row.organizationOid} ${semdTypeId}`
        const existing = factByKey.get(key)
        if (existing) {
            existing.documentCount += row.documentCount
        } else {
            factByKey.set(key, {
                organizationOid: row.organizationOid,
                semdTypeId,
                documentCount: row.documentCount,
            })
        }

        // Строки без здания — это «тидy»-выгрузка шага 4, там колонок здания нет.
        // В подсчёт ТВСП они не попадают, и это правильно: неизвестное здание
        // не должно становиться ещё одним.
        if (!row.buildingId) continue
        const buildingKey = `${row.organizationOid} ${row.buildingId} ${semdTypeId}`
        const building = buildingByKey.get(buildingKey)
        if (building) {
            building.documentCount += row.documentCount
        } else {
            buildingByKey.set(buildingKey, {
                organizationOid: row.organizationOid,
                buildingId: row.buildingId,
                buildingName: row.buildingName,
                buildingAddress: row.buildingAddress,
                semdTypeId,
                documentCount: row.documentCount,
            })
        }
    }

    return {
        facts: Array.from(factByKey.values()),
        buildingFacts: Array.from(buildingByKey.values()),
        matchedOrganizationOids,
        matchedTypeIds,
        unmatchedOrganizationOids,
        unmatchedDocumentTypeNames,
        documentCount,
    }
}

@Injectable()
export class RemdIntervalImportService {
    constructor(
        @Inject(APP_DB_POOL) private readonly pool: Pool,
        private readonly s3: S3StorageService,
    ) {}

    async importXlsx(
        userId: number,
        periodId: string,
        fileBuffer: Buffer,
        originalFilename: string,
        override?: RemdIntervalOverride,
    ): Promise<RemdIntervalImportResult> {
        const cleanPeriodId = this.cleanText(periodId, 80)
        if (!cleanPeriodId) {
            throw new BadRequestException('Укажите отчетный период')
        }
        if (!fileBuffer.length) {
            throw new BadRequestException('Файл выгрузки РЭМД пуст')
        }
        if (fileBuffer.length > MAX_STORED_IMPORT_SIZE) {
            throw new BadRequestException('Файл превышает максимально допустимый размер')
        }
        await this.ensurePeriodExists(cleanPeriodId)

        const sourceName = this.cleanText(originalFilename, 256) || 'remd-interval.xlsx'
        const parsed = await parseRemdNumeratorXlsx(fileBuffer)
        const headerTag = classifyRemdInterval(parsed.interval)
        const tag = this.resolveTag(headerTag, override, sourceName)

        const importId = randomUUID()
        const fileSha256 = createHash('sha256').update(fileBuffer).digest('hex')
        const objectKey = `reporting/imports/remd-interval/${cleanPeriodId}/${importId}/`
            + this.buildObjectFilename(sourceName)

        await this.s3.uploadBuffer(objectKey, fileBuffer, REMD_INTERVAL_CONTENT_TYPE)

        const client = await this.pool.connect()
        try {
            await client.query('BEGIN')
            // Год периода — из текста даты, а не через `new Date`: конструктор
            // снова завёл бы разговор про часовой пояс, как 20.08.2026.
            const yearResult = await client.query(
                `SELECT date_from::text AS "dateFrom", date_to::text AS "dateTo"
                 FROM reporting_periods WHERE id = $1;`,
                [cleanPeriodId],
            )
            const periodRow = yearResult.rows[0]
            const parsedYear = Number(
                String(periodRow?.dateTo ?? periodRow?.dateFrom ?? '').slice(0, 4),
            )
            const reportingYear = Number.isInteger(parsedYear)
                ? parsedYear
                : new Date().getFullYear()
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
                    REMD_INTERVAL_SOURCE_TYPE,
                    sourceName,
                    objectKey,
                    fileSha256,
                    fileBuffer.length,
                    parsed.rows.length,
                    userId,
                ],
            )

            const [aliasResult, organizationResult] = await Promise.all([
                client.query(
                    `SELECT normalized_alias AS "normalizedAlias",
                            semd_type_id::text AS "semdTypeId"
                     FROM reporting_semd_type_aliases;`,
                ),
                client.query(
                    `SELECT oid FROM reporting_organizations WHERE is_active = TRUE;`,
                ),
            ])
            const semdTypeIdByAlias = new Map<string, string>(
                aliasResult.rows.map((row) => [
                    String(row.normalizedAlias),
                    String(row.semdTypeId),
                ]),
            )
            const activeOrganizationOids = new Set<string>(
                organizationResult.rows.map((row) => String(row.oid)),
            )

            const aggregation = aggregateIntervalFacts(parsed.rows, {
                targetOrganizationOids: TARGET_ORGANIZATION_OIDS,
                activeOrganizationOids,
                semdTypeIdByAlias,
            })
            const {
                matchedOrganizationOids,
                matchedTypeIds,
                unmatchedOrganizationOids,
                unmatchedDocumentTypeNames,
                documentCount,
            } = aggregation

            // Тот же отказ, что у шага 4: синтаксически верный файл чужого региона
            // не должен выглядеть как честный ноль на графике.
            if (aggregation.facts.length === 0) {
                throw new BadRequestException(
                    'Выгрузка РЭМД не дала ни одного сопоставленного факта: '
                    + `распознано строк ${parsed.rows.length}, `
                    + `не сопоставлено организаций ${unmatchedOrganizationOids.size}, `
                    + `не сопоставлено видов документов ${unmatchedDocumentTypeNames.size}. `
                    + 'Прежние данные периода сохранены.',
                )
            }

            const warnings = [...parsed.warnings]
            if (!headerTag) {
                warnings.push(
                    'Интервал выгрузки не найден в шапке отчёта — разновидность и месяц '
                    + 'заданы вручную. Проверьте, что файл соответствует указанному месяцу.',
                )
            }
            if (unmatchedOrganizationOids.size > 0) {
                warnings.push(
                    `Не найдено среди активных целевых МО ${unmatchedOrganizationOids.size} `
                    + 'OID организаций из файла — строки пропущены. Загрузите числитель РЭМД '
                    + '(шаг 4) до помесячных выгрузок.',
                )
            }
            if (unmatchedDocumentTypeNames.size > 0) {
                warnings.push(
                    'Не найдено сопоставление «Вид МД» → вид СЭМД для: '
                    + `${Array.from(unmatchedDocumentTypeNames).slice(0, 20).join(', ')}`
                    + `${unmatchedDocumentTypeNames.size > 20 ? '…' : ''}. `
                    + 'Загрузите актуальный справочник 1520.',
                )
            }

            const facts = aggregation.facts
            // Выгрузка за прошлый год — не точка на кривой, а справочный срез
            // (Д-28). Она нужна методологу, чтобы увидеть виды, которые в 2025
            // регистрировались, а в 2026 ещё нет. Кривая строится внутри года,
            // поэтому такие факты живут отдельно и к периоду не привязаны.
            const isPriorYear = tag.year !== reportingYear
            if (isPriorYear) {
                await client.query(
                    `DELETE FROM reporting_remd_annual_facts WHERE reporting_year = $1;`,
                    [tag.year],
                )
                await this.insertAnnualFacts(client, tag.year, importId, sourceName, facts)
            } else {
                // Повторная загрузка того же месяца заменяет только его: остальные точки
                // кривой и нарастающие итоги остаются на месте.
                await client.query(
                    `DELETE FROM reporting_remd_interval_facts
                     WHERE period_id = $1 AND coverage = $2 AND month = $3;`,
                    [cleanPeriodId, tag.coverage, tag.month],
                )
                await this.insertFacts(client, cleanPeriodId, importId, sourceName, tag, facts)

                await client.query(
                    `DELETE FROM reporting_remd_building_facts
                     WHERE period_id = $1 AND coverage = $2 AND month = $3;`,
                    [cleanPeriodId, tag.coverage, tag.month],
                )
                await this.insertBuildingFacts(
                    client, cleanPeriodId, importId, tag, aggregation.buildingFacts,
                )
            }

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
                    facts.length,
                    matchedOrganizationOids.size,
                    JSON.stringify(warnings),
                    JSON.stringify({
                        coverage: tag.coverage,
                        month: tag.month,
                        year: tag.year,
                        intervalFromHeader: headerTag !== null,
                        uniqueTypeCount: matchedTypeIds.size,
                        documentCount,
                        sheetName: parsed.sheetName,
                        sourceLayout: parsed.layout,
                        rowCount: parsed.rows.length,
                        unmatchedOrganizationOids: Array.from(unmatchedOrganizationOids),
                        unmatchedDocumentTypeNames: Array.from(unmatchedDocumentTypeNames),
                    }),
                ],
            )
            await client.query('COMMIT')

            return {
                importId,
                periodId: cleanPeriodId,
                sourceName,
                sheetName: parsed.sheetName,
                coverage: tag.coverage,
                month: tag.month,
                year: tag.year,
                intervalFromHeader: headerTag !== null,
                factCount: facts.length,
                matchedOrganizationCount: matchedOrganizationOids.size,
                matchedTypeCount: matchedTypeIds.size,
                uniqueTypeCount: matchedTypeIds.size,
                documentCount,
                unmatchedOrganizationOids: Array.from(unmatchedOrganizationOids),
                unmatchedDocumentTypeNames: Array.from(unmatchedDocumentTypeNames),
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
     * Пометка файла. Шапка отчёта — источник по умолчанию; ручное указание
     * перекрывает её, потому что разобранный интервал бывает верным, но не тем:
     * методолог может прислать «01.01 - 31.07» и иметь в виду замену июльской
     * точки, а не нарастающий итог.
     */
    private resolveTag(
        headerTag: RemdIntervalTag | null,
        override: RemdIntervalOverride | undefined,
        sourceName: string,
    ): RemdIntervalTag {
        if (override) {
            if (override.month < 1 || override.month > 12) {
                throw new BadRequestException('Месяц выгрузки должен быть от 1 до 12')
            }
            return {
                coverage: override.coverage,
                month: override.month,
                year: override.year,
            }
        }
        if (headerTag) return headerTag
        throw new BadRequestException(
            `Не удалось определить интервал выгрузки «${sourceName}»: в шапке отчёта `
            + 'нет строки вида «Отчет РЭМД за период 01.01.2026 - 31.07.2026». '
            + 'Укажите месяц и разновидность выгрузки вручную.',
        )
    }

    /**
     * Итоги прошлого года: разрез по медорганизациям, без месяцев и зданий.
     *
     * Месяцы не нужны — методолог просила «столбик с количеством зарег. СЭМД
     * и МО», а не вторую кривую. Здания тоже: показатель 1.24 считается
     * по текущему году, прошлогодние здания ему не нужны.
     */
    private async insertAnnualFacts(
        client: PoolClient,
        reportingYear: number,
        importId: string,
        sourceName: string,
        facts: readonly IntervalFact[],
    ): Promise<void> {
        for (let offset = 0; offset < facts.length; offset += INSERT_BATCH_SIZE) {
            const batch = facts.slice(offset, offset + INSERT_BATCH_SIZE)
            const values: unknown[] = []
            const rows = batch.map((fact, index) => {
                const base = index * 6
                values.push(
                    reportingYear,
                    fact.organizationOid,
                    fact.semdTypeId,
                    fact.documentCount,
                    importId,
                    sourceName,
                )
                return `($${base + 1}, $${base + 2}, $${base + 3}::uuid, `
                    + `$${base + 4}, $${base + 5}::uuid, $${base + 6})`
            })
            await client.query(
                `INSERT INTO reporting_remd_annual_facts (
                    reporting_year, organization_oid, semd_type_id,
                    document_count, source_import_id, source_name
                 )
                 VALUES ${rows.join(', ')}
                 ON CONFLICT (reporting_year, organization_oid, semd_type_id)
                 DO UPDATE SET document_count = EXCLUDED.document_count,
                               source_import_id = EXCLUDED.source_import_id,
                               source_name = EXCLUDED.source_name,
                               updated_at = now();`,
                values,
            )
        }
    }

    private async insertFacts(
        client: PoolClient,
        periodId: string,
        importId: string,
        sourceName: string,
        tag: RemdIntervalTag,
        facts: readonly IntervalFact[],
    ): Promise<void> {
        for (let offset = 0; offset < facts.length; offset += INSERT_BATCH_SIZE) {
            const batch = facts.slice(offset, offset + INSERT_BATCH_SIZE)
            const values: unknown[] = []
            const placeholders = batch.map((fact, index) => {
                const base = index * 8
                values.push(
                    periodId,
                    tag.coverage,
                    tag.month,
                    fact.organizationOid,
                    fact.semdTypeId,
                    fact.documentCount,
                    importId,
                    sourceName,
                )
                return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4},`
                    + ` $${base + 5}::uuid, $${base + 6}, $${base + 7}::uuid, $${base + 8})`
            })
            await client.query(
                `INSERT INTO reporting_remd_interval_facts (
                    period_id, coverage, month, organization_oid,
                    semd_type_id, document_count, source_import_id, source_name
                 )
                 VALUES ${placeholders.join(', ')}
                 ON CONFLICT (period_id, coverage, month, organization_oid, semd_type_id)
                 DO UPDATE SET document_count = EXCLUDED.document_count,
                               source_import_id = EXCLUDED.source_import_id,
                               source_name = EXCLUDED.source_name,
                               updated_at = now();`,
                values,
            )
        }
    }

    /**
     * Здания, передавшие вид. Отдельная таблица, потому что зерно другое:
     * в своде фактов строки подразделений сложены по «МО × вид», и здание там
     * сохранить нельзя.
     */
    private async insertBuildingFacts(
        client: PoolClient,
        periodId: string,
        importId: string,
        tag: RemdIntervalTag,
        facts: readonly BuildingFact[],
    ): Promise<void> {
        const ROW_PARAMS = 6
        for (let offset = 0; offset < facts.length; offset += INSERT_BATCH_SIZE) {
            const batch = facts.slice(offset, offset + INSERT_BATCH_SIZE)
            const values: unknown[] = [periodId, tag.coverage, tag.month, importId]
            const constants = values.length
            const placeholders = batch.map((fact, index) => {
                const base = constants + index * ROW_PARAMS
                values.push(
                    fact.organizationOid, fact.buildingId, fact.buildingName,
                    fact.buildingAddress, fact.semdTypeId, fact.documentCount,
                )
                return `($1::uuid, $2, $3, $${base + 1}, $${base + 2}, $${base + 3},`
                    + ` $${base + 4}, $${base + 5}::uuid, $${base + 6}, $4::uuid)`
            })
            if (placeholders.length === 0) continue
            await client.query(
                `INSERT INTO reporting_remd_building_facts (
                    period_id, coverage, month, organization_oid, building_id,
                    building_name, building_address, semd_type_id, document_count,
                    source_import_id
                 )
                 VALUES ${placeholders.join(', ')}
                 ON CONFLICT (period_id, coverage, month, organization_oid,
                              building_id, semd_type_id)
                 DO UPDATE SET document_count = EXCLUDED.document_count,
                               building_name = EXCLUDED.building_name,
                               building_address = EXCLUDED.building_address,
                               source_import_id = EXCLUDED.source_import_id,
                               updated_at = now();`,
                values,
            )
        }
    }

    private async ensurePeriodExists(periodId: string): Promise<void> {
        const result = await this.pool.query(
            `SELECT 1 FROM reporting_periods WHERE id = $1;`,
            [periodId],
        )
        if (result.rowCount === 0) {
            throw new BadRequestException('Отчетный период не найден')
        }
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
        return safe || 'remd-interval.xlsx'
    }

    private cleanText(value: unknown, maxLength: number): string {
        if (typeof value !== 'string') return ''
        return value.replace(/\s+/gu, ' ').trim().slice(0, maxLength)
    }
}
