import {
    BadRequestException,
    Inject,
    Injectable,
    NotFoundException,
} from '@nestjs/common'
import { createHash, randomUUID } from 'crypto'
import { Pool, type PoolClient } from 'pg'
import { APP_DB_POOL } from '../database/database.tokens'
import { S3StorageService } from '../storage/s3.service'
import { PilotIndicatorCalculationService } from './pilot-indicator-calculation.service'
import { normalizeSemdName } from './emd-nsi-csv'
import {
    parseRemdNumeratorXlsx,
    type RemdNumeratorRow,
} from './remd-numerator-xlsx'
import {
    getOrganizationGeo,
    ORGANIZATION_GEO_BY_OID,
} from './organization-geo'

const REMD_NUMERATOR_SOURCE_TYPE = 'remd_numerator_tidy_xlsx'
const REMD_NUMERATOR_CONTENT_TYPE =
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const MAX_STORED_IMPORT_SIZE =
    Number(process.env.REPORTING_IMPORT_MAX_FILE_SIZE) || 25 * 1024 * 1024
const INSERT_BATCH_SIZE = 300
const TARGET_ORGANIZATION_OIDS = new Set(
    Object.keys(ORGANIZATION_GEO_BY_OID),
)

export interface RemdNumeratorImportResult {
    importId: string
    periodId: string
    sourceName: string
    sheetName: string
    rowCount: number
    skippedRowCount: number
    directoryOrganizationCount: number
    matchedOrganizationCount: number
    unmatchedOrganizationOids: string[]
    excludedOrganizationOids: string[]
    matchedTypeCount: number
    unmatchedDocumentTypeNames: string[]
    factCount: number
    subdivisionFactCount: number
    matchedSubdivisionCount: number
    unknownSubdivisionFactCount: number
    warnings: string[]
}

interface SubdivisionFact {
    organizationOid: string
    subdivisionOid: string | null
    subdivisionName: string
    semdTypeId: string
    documentCount: number
}

interface TargetOrganization {
    oid: string
    name: string
}

/**
 * ТЗ 6.1.3.2.7 (agent_2026-07-15), п.1.2 — импорт числителя РЭМД из реального «тидy»-файла
 * Марины (лист «Отчет по МО»). Сопоставление «Вид МД» делается через уже существующую таблицу
 * reporting_semd_type_aliases (тот же механизм, что использует remd-workbook-import.service.ts
 * для сопоставления колонок) — это автоматически суммирует факт по всем строкам, которые в
 * реальности являются разными OID/редакциями одного и того же «Вида МД» (они используют один
 * и тот же нормализованный алиас), а не выбирает одну строку. Пишет в ту же reporting_remd_facts,
 * что и существующий remd-workbook-import.service.ts (scope_level='organization'), но помечает
 * свои строки source-тегом в metadata и очищает перед перезаписью только их — факты, ранее
 * загруженные широкоформатным импортёром «Отчет РЭМД», не трогает.
 *
 * Этот же файл является первичным источником состава 37 целевых МО: на чистой базе импорт
 * создаёт/актуализирует только организации, OID которых уже входят в контур дашборда.
 * Остальные организации из региональной выгрузки РЭМД не добавляются и в расчёт 6.1.3.2.7
 * не попадают.
 */
@Injectable()
export class RemdNumeratorImportService {
    constructor(
        @Inject(APP_DB_POOL) private readonly pool: Pool,
        private readonly s3: S3StorageService,
        private readonly pilotCalculation: PilotIndicatorCalculationService,
    ) {}

    async importXlsx(
        userId: number,
        periodId: string,
        fileBuffer: Buffer,
        originalFilename: string,
    ): Promise<RemdNumeratorImportResult> {
        const cleanPeriodId = this.cleanText(periodId, 80)
        if (!cleanPeriodId) {
            throw new BadRequestException('Укажите отчетный период')
        }
        if (!fileBuffer.length) {
            throw new BadRequestException('Файл числителя РЭМД пуст')
        }
        if (fileBuffer.length > MAX_STORED_IMPORT_SIZE) {
            throw new BadRequestException(
                'Файл превышает максимально допустимый размер',
            )
        }
        await this.ensurePeriodExists(cleanPeriodId)

        const sourceName = this.cleanText(originalFilename, 256)
            || 'remd-numerator.xlsx'
        const parsed = await parseRemdNumeratorXlsx(fileBuffer)
        const targetOrganizations = this.collectTargetOrganizations(parsed.rows)
        const excludedOrganizationOids = new Set(
            parsed.rows
                .map((row) => row.organizationOid)
                .filter((oid) => !TARGET_ORGANIZATION_OIDS.has(oid)),
        )

        const importId = randomUUID()
        const fileSha256 = createHash('sha256').update(fileBuffer).digest('hex')
        const objectFilename = this.buildObjectFilename(sourceName)
        const objectKey =
            `reporting/imports/remd-numerator/${cleanPeriodId}/${importId}/${objectFilename}`

        await this.s3.uploadBuffer(objectKey, fileBuffer, REMD_NUMERATOR_CONTENT_TYPE)

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
                    REMD_NUMERATOR_SOURCE_TYPE,
                    sourceName,
                    objectKey,
                    fileSha256,
                    fileBuffer.length,
                    parsed.rows.length,
                    userId,
                ],
            )
            await this.upsertTargetOrganizations(
                client,
                targetOrganizations,
                importId,
            )

            const [aliasResult, organizationResult, subdivisionResult] = await Promise.all([
                client.query(
                    `SELECT normalized_alias AS "normalizedAlias",
                            semd_type_id::text AS "semdTypeId"
                     FROM reporting_semd_type_aliases;`,
                ),
                client.query(
                    `SELECT oid FROM reporting_organizations WHERE is_active = TRUE;`,
                ),
                client.query(
                    `SELECT subdivision_oid AS "subdivisionOid"
                     FROM reporting_organization_subdivisions
                     WHERE is_active = TRUE;`,
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
            // ТЗ delta 2026-07-17, п.2 — известные подразделения из ФРМР, чтобы отличить
            // «подразделение неизвестно» от сопоставленного.
            const knownSubdivisionOids = new Set<string>(
                subdivisionResult.rows.map((row) => String(row.subdivisionOid)),
            )

            const factByKey = new Map<string, {
                organizationOid: string
                semdTypeId: string
                documentCount: number
            }>()
            const subdivisionFactByKey = new Map<string, SubdivisionFact>()
            const matchedSubdivisionOids = new Set<string>()
            let unknownSubdivisionFactCount = 0
            const unmatchedOrganizationOids = new Set<string>()
            const unmatchedDocumentTypeNames = new Set<string>()
            const matchedOrganizationOids = new Set<string>()
            const matchedTypeIds = new Set<string>()

            for (const row of parsed.rows) {
                if (!TARGET_ORGANIZATION_OIDS.has(row.organizationOid)) {
                    continue
                }
                if (!activeOrganizationOids.has(row.organizationOid)) {
                    unmatchedOrganizationOids.add(row.organizationOid)
                    continue
                }
                const semdTypeId = semdTypeIdByAlias.get(
                    normalizeSemdName(row.documentTypeName),
                )
                if (!semdTypeId) {
                    unmatchedDocumentTypeNames.add(row.documentTypeName)
                    continue
                }
                matchedOrganizationOids.add(row.organizationOid)
                matchedTypeIds.add(semdTypeId)

                const key = `${row.organizationOid} ${semdTypeId}`
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

                // Разбивка по подразделению — дополнительно к агрегату на уровне организации,
                // не вместо него. Ключ включает OID подразделения (или '' — «неизвестно»).
                const subdivisionOid = row.subdivisionOid || null
                const subdivisionKey =
                    this.subdivisionFactKey(row.organizationOid, subdivisionOid, semdTypeId)
                const existingSubdivision = subdivisionFactByKey.get(subdivisionKey)
                if (existingSubdivision) {
                    existingSubdivision.documentCount += row.documentCount
                } else {
                    subdivisionFactByKey.set(subdivisionKey, {
                        organizationOid: row.organizationOid,
                        subdivisionOid,
                        subdivisionName: row.subdivisionName,
                        semdTypeId,
                        documentCount: row.documentCount,
                    })
                }
            }

            const subdivisionFacts = Array.from(subdivisionFactByKey.values())
            // P2 (согласовательный файл 23.07): подразделение из РЭМД, которого нет в ФРМР —
            // его вид определить нельзя, применимость по подразделению не рассчитывается.
            const unknownSubdivisionOids = new Set<string>()
            for (const fact of subdivisionFacts) {
                if (fact.subdivisionOid && knownSubdivisionOids.has(fact.subdivisionOid)) {
                    matchedSubdivisionOids.add(fact.subdivisionOid)
                } else {
                    unknownSubdivisionFactCount += 1
                    if (fact.subdivisionOid) {
                        unknownSubdivisionOids.add(fact.subdivisionOid)
                    }
                }
            }

            // Этап 5 плана 24.07: техническая ошибка источника не должна выглядеть как
            // бизнес-результат 0 %. Файл может быть синтаксически корректным, но не дать ни
            // одного сопоставленного факта (чужой регион, устаревшие наименования видов,
            // сбитые OID). В этом случае импорт отклоняется целиком: транзакция откатывается,
            // удаление прежних фактов не применяется и последний подтверждённый расчёт живёт.
            if (factByKey.size === 0) {
                throw new BadRequestException(
                    'Файл числителя РЭМД не дал ни одного сопоставленного факта: '
                    + `распознано строк ${parsed.rows.length}, `
                    + `не сопоставлено организаций ${unmatchedOrganizationOids.size}, `
                    + `не сопоставлено видов документов ${unmatchedDocumentTypeNames.size}. `
                    + 'Прежние данные периода сохранены. Проверьте, что загружается выгрузка '
                    + 'нужного региона и что справочник 1520 актуален.',
                )
            }

            const warnings = [...parsed.warnings]
            if (targetOrganizations.length < TARGET_ORGANIZATION_OIDS.size) {
                warnings.push(
                    `В файле найдены данные для ${targetOrganizations.length} из ${TARGET_ORGANIZATION_OIDS.size} целевых МО. Отсутствующие МО сохраняются в справочнике, если были загружены ранее.`,
                )
            }
            if (unmatchedOrganizationOids.size > 0) {
                warnings.push(
                    `Не удалось создать или найти среди активных целевых МО ${unmatchedOrganizationOids.size} OID организаций из файла — строки пропущены.`,
                )
            }
            if (unmatchedDocumentTypeNames.size > 0) {
                warnings.push(
                    `Не найдено сопоставление «Вид МД» → вид СЭМД для: ${Array.from(unmatchedDocumentTypeNames).slice(0, 20).join(', ')}${unmatchedDocumentTypeNames.size > 20 ? '…' : ''}. Загрузите актуальный справочник 1520.`,
                )
            }

            await client.query(
                `DELETE FROM reporting_remd_facts
                 WHERE period_id = $1
                   AND scope_level = 'organization'
                   AND metadata->>'source' = $2;`,
                [cleanPeriodId, REMD_NUMERATOR_SOURCE_TYPE],
            )

            const facts = Array.from(factByKey.values())
            await this.insertFacts(
                client,
                cleanPeriodId,
                importId,
                sourceName,
                facts,
            )

            // ТЗ delta 2026-07-17, п.2 — разбивка факта по подразделению (отдельная таблица).
            await client.query(
                `DELETE FROM reporting_remd_subdivision_facts
                 WHERE period_id = $1
                   AND metadata->>'source' = $2;`,
                [cleanPeriodId, REMD_NUMERATOR_SOURCE_TYPE],
            )
            await this.insertSubdivisionFacts(
                client,
                cleanPeriodId,
                importId,
                sourceName,
                subdivisionFacts,
            )

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
                    // Причины P1/P2/P3 согласовательного файла 23.07 строятся по этим
                    // структурированным итогам импорта: расчёт читает их из последнего
                    // успешного прогона числителя и превращает в диагностические находки.
                    JSON.stringify({
                        unmatchedDocumentTypeNames: Array.from(unmatchedDocumentTypeNames),
                        unmatchedOrganizationOids: Array.from(unmatchedOrganizationOids),
                        unknownSubdivisionOids: Array.from(unknownSubdivisionOids),
                        unknownSubdivisionFactCount,
                        skippedRowCount: parsed.skippedRowCount,
                        rowCount: parsed.rows.length,
                        sheetName: parsed.sheetName,
                        // 'wide' — исходный файл был широким отчётом РЭМД и развёрнут парсером;
                        // строки ниже считаются уже после разворота.
                        sourceLayout: parsed.layout,
                    }),
                ],
            )
            await client.query('COMMIT')

            await this.pilotCalculation.recalculate(cleanPeriodId)

            return {
                importId,
                periodId: cleanPeriodId,
                sourceName,
                sheetName: parsed.sheetName,
                rowCount: parsed.rows.length,
                skippedRowCount: parsed.skippedRowCount,
                directoryOrganizationCount: targetOrganizations.length,
                matchedOrganizationCount: matchedOrganizationOids.size,
                unmatchedOrganizationOids: Array.from(unmatchedOrganizationOids),
                excludedOrganizationOids: Array.from(excludedOrganizationOids),
                matchedTypeCount: matchedTypeIds.size,
                unmatchedDocumentTypeNames: Array.from(unmatchedDocumentTypeNames),
                factCount: facts.length,
                subdivisionFactCount: subdivisionFacts.length,
                matchedSubdivisionCount: matchedSubdivisionOids.size,
                unknownSubdivisionFactCount,
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

    private collectTargetOrganizations(
        rows: RemdNumeratorRow[],
    ): TargetOrganization[] {
        const organizations = new Map<string, TargetOrganization>()
        for (const row of rows) {
            if (!TARGET_ORGANIZATION_OIDS.has(row.organizationOid)) continue
            const name = this.cleanText(row.organizationName, 500)
            const existing = organizations.get(row.organizationOid)
            if (!existing || (!existing.name && name)) {
                organizations.set(row.organizationOid, {
                    oid: row.organizationOid,
                    name: name || row.organizationOid,
                })
            }
        }
        return Array.from(organizations.values())
            .sort((left, right) => left.oid.localeCompare(right.oid))
    }

    private async upsertTargetOrganizations(
        client: PoolClient,
        organizations: TargetOrganization[],
        importId: string,
    ): Promise<void> {
        for (let start = 0; start < organizations.length; start += INSERT_BATCH_SIZE) {
            const batch = organizations.slice(start, start + INSERT_BATCH_SIZE)
            const values: unknown[] = []
            const placeholders = batch.map((organization, index) => {
                const offset = index * 10
                const geo = getOrganizationGeo(organization.oid)
                values.push(
                    organization.oid,
                    organization.name,
                    geo?.address ?? '',
                    geo?.latitude ?? null,
                    geo?.longitude ?? null,
                    geo?.locationSource ?? '',
                    geo?.locationPrecision ?? 'unknown',
                    importId,
                    JSON.stringify({
                        nameSource: REMD_NUMERATOR_SOURCE_TYPE,
                        targetDirectory: true,
                    }),
                    organization.name,
                )
                return `(
                    $${offset + 1},
                    $${offset + 2},
                    $${offset + 10},
                    $${offset + 2},
                    $${offset + 3},
                    $${offset + 4},
                    $${offset + 5},
                    $${offset + 6},
                    $${offset + 7},
                    TRUE,
                    $${offset + 8},
                    $${offset + 9}::jsonb
                )`
            })
            await client.query(
                `INSERT INTO reporting_organizations (
                    oid,
                    official_full_name,
                    official_short_name,
                    common_name,
                    address,
                    latitude,
                    longitude,
                    location_source,
                    location_precision,
                    is_active,
                    source_import_id,
                    metadata
                )
                VALUES ${placeholders.join(',')}
                ON CONFLICT (oid) DO UPDATE SET
                    -- Имена из справочника признаков МО выгрузка не перетирает:
                    -- справочник ведёт методолог, и в нём есть отдельная колонка
                    -- отображаемого имени. 15.08.2026 выгрузка переименовала
                    -- «Курганский областной центр медицинской профилактики...»
                    -- в «КОЦОЗМП» во всех трёх полях сразу.
                    official_full_name = CASE
                        WHEN reporting_organizations.metadata->>'nameSource' = 'directory'
                            THEN reporting_organizations.official_full_name
                        ELSE EXCLUDED.official_full_name
                    END,
                    official_short_name = CASE
                        WHEN reporting_organizations.metadata->>'nameSource' = 'directory'
                            THEN reporting_organizations.official_short_name
                        ELSE EXCLUDED.official_short_name
                    END,
                    common_name = CASE
                        WHEN reporting_organizations.metadata->>'nameSource' = 'directory'
                            THEN reporting_organizations.common_name
                        ELSE EXCLUDED.common_name
                    END,
                    address = CASE
                        WHEN EXCLUDED.address <> '' THEN EXCLUDED.address
                        ELSE reporting_organizations.address
                    END,
                    latitude = COALESCE(EXCLUDED.latitude, reporting_organizations.latitude),
                    longitude = COALESCE(EXCLUDED.longitude, reporting_organizations.longitude),
                    location_source = CASE
                        WHEN EXCLUDED.location_source <> '' THEN EXCLUDED.location_source
                        ELSE reporting_organizations.location_source
                    END,
                    location_precision = CASE
                        WHEN EXCLUDED.location_precision <> 'unknown'
                            THEN EXCLUDED.location_precision
                        ELSE reporting_organizations.location_precision
                    END,
                    is_active = TRUE,
                    source_import_id = EXCLUDED.source_import_id,
                    -- Оператор слияния отдаёт победу правой стороне, поэтому метку
                    -- nameSource = directory надо беречь отдельно: иначе первый же
                    -- импорт сбросил бы её и защита выше сработала бы один раз.
                    metadata = CASE
                        WHEN reporting_organizations.metadata->>'nameSource' = 'directory'
                            THEN reporting_organizations.metadata
                                || (EXCLUDED.metadata - 'nameSource' - 'nameLevel')
                        ELSE reporting_organizations.metadata || EXCLUDED.metadata
                    END,
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
        facts: Array<{ organizationOid: string; semdTypeId: string; documentCount: number }>,
    ): Promise<void> {
        for (let start = 0; start < facts.length; start += INSERT_BATCH_SIZE) {
            const batch = facts.slice(start, start + INSERT_BATCH_SIZE)
            const values: unknown[] = []
            const placeholders = batch.map((fact, index) => {
                const offset = index * 6
                values.push(
                    periodId,
                    fact.organizationOid,
                    fact.semdTypeId,
                    fact.documentCount,
                    importId,
                    sourceName,
                )
                return `(
                    $${offset + 1},
                    'organization',
                    $${offset + 2},
                    $${offset + 3},
                    $${offset + 4},
                    $${offset + 5},
                    $${offset + 6},
                    jsonb_build_object('source', '${REMD_NUMERATOR_SOURCE_TYPE}')
                )`
            })
            await client.query(
                `INSERT INTO reporting_remd_facts (
                    period_id,
                    scope_level,
                    organization_oid,
                    semd_type_id,
                    document_count,
                    source_import_id,
                    source_name,
                    metadata
                )
                VALUES ${placeholders.join(',')}
                ON CONFLICT (period_id, organization_oid, semd_type_id)
                    WHERE scope_level = 'organization'
                DO UPDATE SET
                    document_count = EXCLUDED.document_count,
                    source_import_id = EXCLUDED.source_import_id,
                    source_name = EXCLUDED.source_name,
                    metadata = EXCLUDED.metadata,
                    updated_at = now();`,
                values,
            )
        }
    }

    private subdivisionFactKey(
        organizationOid: string,
        subdivisionOid: string | null,
        semdTypeId: string,
    ): string {
        return `${organizationOid} ${subdivisionOid ?? ''} ${semdTypeId}`
    }

    private async insertSubdivisionFacts(
        client: PoolClient,
        periodId: string,
        importId: string,
        sourceName: string,
        facts: SubdivisionFact[],
    ): Promise<void> {
        for (let start = 0; start < facts.length; start += INSERT_BATCH_SIZE) {
            const batch = facts.slice(start, start + INSERT_BATCH_SIZE)
            const values: unknown[] = []
            const placeholders = batch.map((fact, index) => {
                const offset = index * 8
                values.push(
                    periodId,
                    fact.organizationOid,
                    fact.subdivisionOid,
                    fact.subdivisionName,
                    fact.semdTypeId,
                    fact.documentCount,
                    importId,
                    sourceName,
                )
                return `(
                    $${offset + 1},
                    $${offset + 2},
                    $${offset + 3},
                    $${offset + 4},
                    $${offset + 5},
                    $${offset + 6},
                    $${offset + 7},
                    $${offset + 8},
                    jsonb_build_object('source', '${REMD_NUMERATOR_SOURCE_TYPE}')
                )`
            })
            await client.query(
                `INSERT INTO reporting_remd_subdivision_facts (
                    period_id,
                    organization_oid,
                    subdivision_oid,
                    subdivision_name,
                    semd_type_id,
                    document_count,
                    source_import_id,
                    source_name,
                    metadata
                )
                VALUES ${placeholders.join(',')};`,
                values,
            )
        }
    }

    private async ensurePeriodExists(periodId: string): Promise<void> {
        const result = await this.pool.query(
            `SELECT 1 FROM reporting_periods WHERE id = $1;`,
            [periodId],
        )
        if (!result.rows[0]) {
            throw new NotFoundException('Отчетный период не найден')
        }
    }

    private async markImportFailed(importId: string, err: unknown): Promise<void> {
        const errorMessage = this.cleanText(
            err instanceof Error ? err.message : String(err),
            2000,
        )
        try {
            await this.pool.query(
                `UPDATE reporting_import_runs
                 SET status = 'failed',
                     error_message = $2,
                     completed_at = now()
                 WHERE id = $1;`,
                [importId, errorMessage],
            )
        } catch {
            // The original import error is more useful to the caller.
        }
    }

    private buildObjectFilename(originalFilename: string): string {
        const fileName = originalFilename.split(/[\\/]/).pop()
            || 'remd-numerator.xlsx'
        const withoutControlChars = Array.from(fileName)
            .filter((char) => char.charCodeAt(0) > 0x1f)
            .join('')
        const sanitized = withoutControlChars
            .replace(/[<>:"|?*]+/g, '_')
            .replace(/\s+/g, ' ')
            .trim()
        return sanitized || 'remd-numerator.xlsx'
    }

    private cleanText(value: unknown, maxLength: number): string {
        return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, maxLength)
    }
}
