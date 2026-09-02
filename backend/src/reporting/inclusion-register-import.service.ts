import { BadRequestException, Inject, Injectable } from '@nestjs/common'
import { createHash, randomUUID } from 'crypto'
import { Pool, type PoolClient } from 'pg'
import { APP_DB_POOL } from '../database/database.tokens'
import { S3StorageService } from '../storage/s3.service'
import { normalizeSemdName } from './emd-nsi-csv'
import { parseInclusionRegisterXlsx } from './inclusion-register-xlsx'

/**
 * Загрузка перечней входимости ТВСП от Минздрава.
 *
 * Перечень — готовый знаменатель показателя: Минздрав называет поимённо
 * подразделения, обязанные передавать вид СЭМД, и ставит по каждому план и факт.
 *
 * **Вид определяется по заголовку файла, а не задаётся при загрузке.** В шапке
 * стоит «…передачу СЭМД "Справка о постановке на учет по беременности"…»,
 * и это имя сопоставляется со справочником через тот же механизм синонимов,
 * которым сопоставляются виды в выгрузках РЭМД. Просить пользователя выбрать
 * вид руками значило бы дать ему возможность ошибиться там, где файл говорит
 * прямым текстом.
 *
 * **Перечень не привязан к периоду.** Он приходит письмом на регион и действует
 * до следующего письма — как справочник, а не как отчётные данные. Поэтому
 * загрузка одного вида заменяет прежний перечень этого вида целиком.
 */

const REGISTER_SOURCE_TYPE = 'inclusion_register'
const REGISTER_CONTENT_TYPE =
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const MAX_STORED_IMPORT_SIZE =
    Number(process.env.REPORTING_IMPORT_MAX_FILE_SIZE) || 25 * 1024 * 1024
const INSERT_BATCH_SIZE = 200
const TARGET_SUBJECT = 'курган'

export interface InclusionRegisterImportResult {
    importId: string
    sourceName: string
    title: string
    semdTypeCode: string
    semdTypeName: string
    month: number | null
    year: number | null
    rowCount: number
    organizationCount: number
    planTotal: number
    factTotal: number
    skippedOtherSubjects: number
    unmatchedOrganizationOids: string[]
    warnings: string[]
}

@Injectable()
export class InclusionRegisterImportService {
    constructor(
        @Inject(APP_DB_POOL) private readonly pool: Pool,
        private readonly s3: S3StorageService,
    ) {}

    async importXlsx(
        userId: number,
        periodId: string,
        fileBuffer: Buffer,
        originalFilename: string,
    ): Promise<InclusionRegisterImportResult> {
        if (!fileBuffer.length) {
            throw new BadRequestException('Файл перечня входимости пуст')
        }
        if (fileBuffer.length > MAX_STORED_IMPORT_SIZE) {
            throw new BadRequestException('Файл превышает максимально допустимый размер')
        }
        const cleanPeriodId = this.cleanText(periodId, 80)
        if (!cleanPeriodId) {
            throw new BadRequestException('Укажите отчетный период')
        }

        const sourceName = this.cleanText(originalFilename, 256) || 'register.xlsx'
        const parsed = await parseInclusionRegisterXlsx(fileBuffer)
        if (parsed.semdTypeNames.length === 0) {
            throw new BadRequestException(
                'В заголовке перечня не нашлось наименования вида СЭМД в кавычках. '
                + 'Проверьте, что загружается перечень входимости от Минздрава.',
            )
        }

        const importId = randomUUID()
        const fileSha256 = createHash('sha256').update(fileBuffer).digest('hex')
        const objectKey = `reporting/imports/inclusion-register/${importId}/`
            + this.buildObjectFilename(sourceName)
        await this.s3.uploadBuffer(objectKey, fileBuffer, REGISTER_CONTENT_TYPE)

        const client = await this.pool.connect()
        try {
            await client.query('BEGIN')
            await client.query(
                `INSERT INTO reporting_import_runs (
                    id, period_id, source_type, import_mode,
                    original_filename, object_key, file_sha256, file_size,
                    status, organization_rows, warnings, details, created_by
                 )
                 VALUES ($1, $2, $3, 'replace', $4, $5, $6, $7,
                         'processing', $8, '[]'::jsonb, '{}'::jsonb, $9);`,
                [
                    importId, cleanPeriodId, REGISTER_SOURCE_TYPE, sourceName,
                    objectKey, fileSha256, fileBuffer.length, parsed.rows.length, userId,
                ],
            )

            const semdType = await this.resolveSemdType(client, parsed.semdTypeNames)
            const activeOids = await this.loadActiveOrganizationOids(client)

            const rows = parsed.rows.filter(
                (row) => !row.subjectName
                    || row.subjectName.toLocaleLowerCase('ru-RU').includes(TARGET_SUBJECT),
            )
            const skippedOtherSubjects = parsed.rows.length - rows.length
            if (rows.length === 0) {
                throw new BadRequestException(
                    'В перечне нет ни одной строки по Курганской области.',
                )
            }

            const unmatched = new Set<string>()
            for (const row of rows) {
                if (!activeOids.has(row.organizationOid)) unmatched.add(row.organizationOid)
            }

            const warnings = [...parsed.warnings]
            if (skippedOtherSubjects > 0) {
                warnings.push(
                    `Пропущено строк других субъектов РФ: ${skippedOtherSubjects}.`,
                )
            }
            if (unmatched.size > 0) {
                warnings.push(
                    `${unmatched.size} организаций перечня нет в справочнике МО: `
                    + `${[...unmatched].slice(0, 5).join(', ')}`
                    + `${unmatched.size > 5 ? '…' : ''}. Их строки сохранены, `
                    + 'но в карточки МО не попадут.',
                )
            }

            // Перечень действует до следующего письма, поэтому заменяется целиком.
            await client.query(
                `DELETE FROM reporting_inclusion_registers WHERE semd_type_id = $1;`,
                [semdType.id],
            )
            await this.insertRows(client, {
                importId, semdTypeId: semdType.id, title: parsed.title,
                month: parsed.month, year: parsed.year, rows,
            })

            const planTotal = rows.reduce((sum, row) => sum + row.planValue, 0)
            const factTotal = rows.reduce((sum, row) => sum + row.factValue, 0)
            const organizationCount = new Set(rows.map((row) => row.organizationOid)).size

            await client.query(
                `UPDATE reporting_import_runs
                 SET status = 'completed', indicator_values_count = $2,
                     organization_values_count = $3, warnings = $4::jsonb,
                     details = $5::jsonb, error_message = '', completed_at = now()
                 WHERE id = $1;`,
                [
                    importId, rows.length, organizationCount, JSON.stringify(warnings),
                    JSON.stringify({
                        title: parsed.title,
                        semdTypeCode: semdType.code,
                        semdTypeName: semdType.name,
                        month: parsed.month,
                        year: parsed.year,
                        planTotal,
                        factTotal,
                        skippedOtherSubjects,
                        unmatchedOrganizationOids: [...unmatched],
                    }),
                ],
            )
            await client.query('COMMIT')

            return {
                importId, sourceName, title: parsed.title,
                semdTypeCode: semdType.code, semdTypeName: semdType.name,
                month: parsed.month, year: parsed.year,
                rowCount: rows.length, organizationCount, planTotal, factTotal,
                skippedOtherSubjects,
                unmatchedOrganizationOids: [...unmatched],
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
     * Вид СЭМД по наименованию из заголовка. Сопоставление идёт через тот же
     * справочник синонимов, что и выгрузки РЭМД, — иначе одно и то же
     * наименование читалось бы двумя разными способами.
     *
     * Перечень по диспансеризации называет сразу два вида; берётся первый
     * сопоставившийся: строки в нём общие для обоих, и раскладывать их
     * по двум видам значило бы удвоить знаменатель.
     */
    private async resolveSemdType(
        client: PoolClient,
        names: readonly string[],
    ): Promise<{ id: string; code: string; name: string }> {
        const result = await client.query(
            `SELECT alias.normalized_alias AS "alias",
                    type.id::text AS "id",
                    type.nsi_oid AS "code",
                    type.name AS "name"
             FROM reporting_semd_type_aliases alias
             JOIN reporting_semd_types type ON type.id = alias.semd_type_id;`,
        )
        const byAlias = new Map<string, { id: string; code: string; name: string }>(
            result.rows.map((row) => [
                String(row.alias),
                { id: String(row.id), code: String(row.code ?? ''), name: String(row.name ?? '') },
            ]),
        )
        for (const name of names) {
            const found = byAlias.get(normalizeSemdName(name))
            if (found) return found
        }
        throw new BadRequestException(
            `Вид СЭМД из заголовка перечня не найден в справочнике: `
            + `${names.map((name) => `«${name}»`).join(', ')}. `
            + 'Загрузите справочник видов (шаг 1) или добавьте синоним наименования.',
        )
    }

    private async loadActiveOrganizationOids(client: PoolClient): Promise<Set<string>> {
        const result = await client.query(
            `SELECT oid FROM reporting_organizations WHERE is_active = TRUE;`,
        )
        return new Set(result.rows.map((row) => String(row.oid)))
    }

    private async insertRows(
        client: PoolClient,
        params: {
            importId: string
            semdTypeId: string
            title: string
            month: number | null
            year: number | null
            rows: readonly {
                subjectName: string
                organizationOid: string
                organizationName: string
                buildingId: string
                buildingName: string
                buildingAddress: string
                subdivisionOid: string
                planValue: number
                factValue: number
            }[]
        },
    ): Promise<void> {
        const ROW_PARAMS = 9
        for (let offset = 0; offset < params.rows.length; offset += INSERT_BATCH_SIZE) {
            const batch = params.rows.slice(offset, offset + INSERT_BATCH_SIZE)
            const values: unknown[] = [
                params.semdTypeId, params.title, params.month, params.year, params.importId,
            ]
            const constants = values.length
            const placeholders = batch.map((row, index) => {
                const base = constants + index * ROW_PARAMS
                values.push(
                    row.subjectName, row.organizationOid, row.organizationName,
                    row.buildingId, row.buildingName, row.buildingAddress,
                    row.subdivisionOid, row.planValue, row.factValue,
                )
                return `($1::uuid, $${base + 1}, $${base + 2}, $${base + 3},`
                    + ` $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7},`
                    + ` $${base + 8}, $${base + 9}, $2, $3, $4, $5::uuid)`
            })
            await client.query(
                `INSERT INTO reporting_inclusion_registers (
                    semd_type_id, subject_name, organization_oid, organization_name,
                    building_id, building_name, building_address, subdivision_oid,
                    plan_value, fact_value, register_title, register_month,
                    register_year, source_import_id
                 )
                 VALUES ${placeholders.join(', ')}
                 ON CONFLICT (semd_type_id, organization_oid, building_id, subdivision_oid)
                 DO UPDATE SET plan_value = EXCLUDED.plan_value,
                               fact_value = EXCLUDED.fact_value,
                               building_name = EXCLUDED.building_name,
                               building_address = EXCLUDED.building_address,
                               organization_name = EXCLUDED.organization_name,
                               register_title = EXCLUDED.register_title,
                               register_month = EXCLUDED.register_month,
                               register_year = EXCLUDED.register_year,
                               source_import_id = EXCLUDED.source_import_id,
                               updated_at = now();`,
                values,
            )
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
        return safe || 'register.xlsx'
    }

    private cleanText(value: unknown, maxLength: number): string {
        if (typeof value !== 'string') return ''
        return value.replace(/\s+/gu, ' ').trim().slice(0, maxLength)
    }
}
