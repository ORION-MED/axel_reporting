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
import {
    loadOrganizationDirectoryWorkbook,
    type OrganizationDirectoryEntry,
    type OrganizationDirectoryParseResult,
} from './organization-directory-xlsx'
import { applyOrganizationAliasSeed } from './organization-alias-seed'
import { WorkbookImportJournal } from './engine/workbook-import-journal'

/**
 * Импорт справочника признаков МО региона (файл методолога «МО Курганской области.xlsx»).
 *
 * Место в порядке загрузки — ПЕРЕД матрицей применимости, ровно как у ТПГГ: импортёр
 * матрицы читает справочник в момент подтверждения. Поэтому подтверждение справочника
 * само по себе цифры не двигает; чтобы новые перечни попали в знаменатель, матрицу нужно
 * переимпортировать. Это сказано и в результате подтверждения, чтобы не выглядело
 * как «загрузил, а ничего не изменилось».
 */

const DIRECTORY_SOURCE_TYPE = 'organization_directory'
const DIRECTORY_CONTENT_TYPE =
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const PREVIEW_TTL_HOURS = 24
const MAX_STORED_IMPORT_SIZE =
    Number(process.env.REPORTING_IMPORT_MAX_FILE_SIZE) || 25 * 1024 * 1024

/**
 * Коды лицензий, по которым матрица применимости умеет сузить перечень МО, —
 * ровно те, что распознаёт `classifyCondition` в `applicability-matrix-xlsx.ts`.
 * Лицензия вне этого списка сохраняется, но обязательность никому не сужает,
 * и в предпросмотре это сказано прямо: иначе методолог ждёт от неё эффекта.
 *
 * **1090.5 добавлен 26.08.2026.** До этого список сходился с разбором случайно:
 * ветки на 1090.5 не было, и лицензия честно помечалась как не работающая.
 * Но в матрице она стоит — у видов 8 и 475, — и правильным ответом было
 * научить разбор, а не оставлять условие незамеченным.
 *
 * Оговорка: «участвует в расчёте» здесь означает «сужает состав обязанных МО».
 * На региональное значение 6.1.3.2.7 лицензия 1090.5 всё равно не влияет —
 * виды 8 и 475 не отображаются на ЕПГУ и в 35 целевых не входят.
 */
export const LICENSE_CODES_USED_BY_INDICATOR: readonly string[] = [
    '1080.1',
    '1080.4',
    '1090.4',
    '1090.5',
    '1090.6',
]

export interface OrganizationAttributesRow {
    organizationOid: string
    displayShortName: string
    attachedPopulation: boolean
    attachedChildPopulation: boolean
    /** Участие МО в обеспечении граждан ЛЛО — колонка справочника от 13.08.2026. */
    lloProgram: boolean
    licenses: Record<string, boolean>
}

export interface OrganizationDirectoryPreview {
    canConfirm: boolean
    sheetName: string
    totals: {
        rowCount: number
        matchedOrganizationCount: number
        /** Строки файла, которых в реестре МО ещё нет: они будут созданы. */
        newOrganizationCount: number
        directoryOrganizationCount: number
        missingFromFileCount: number
        attachedPopulationCount: number
        attachedChildPopulationCount: number
    }
    licenses: Array<{
        code: string
        title: string
        organizationCount: number
        usedByIndicator: boolean
    }>
    /**
     * МО из файла, которых в реестре ещё нет, — они будут созданы при подтверждении.
     *
     * До 31.08.2026 такие строки молча пропускались, и состав МО целиком задавала
     * выгрузка РЭМД шага 4: организация без единого зарегистрированного документа
     * в реестр не попадала вовсе. Ровно так выпали два санатория, которые методолог
     * велела считать целевыми, — а у них документов ноль, в этом и была суть вопроса.
     */
    newOrganizations: Array<{ rowNumber: number; oid: string; name: string }>
    /** МО реестра, которых в файле нет: их признаки останутся пустыми. */
    missingFromFile: Array<{ oid: string; name: string }>
    warnings: string[]
}

export interface OrganizationDirectoryPreviewResult {
    importId: string
    periodId: string
    sourceName: string
    fileSha256: string
    previewExpiresAt: string
    preview: OrganizationDirectoryPreview
}

export interface OrganizationDirectoryConfirmResult {
    importId: string
    periodId: string
    sourceName: string
    savedOrganizationCount: number
    /** Сколько МО справочник завёл в реестре: их не было ни в одной выгрузке. */
    createdOrganizationCount: number
    attachedPopulationCount: number
    attachedChildPopulationCount: number
    licenseCounts: Record<string, number>
    /** Матрицу нужно переимпортировать — сам справочник знаменатель не пересчитывает. */
    requiresMatrixReimport: true
    warnings: string[]
}

interface OrganizationRow {
    oid: string
    officialShortName: string
}

@Injectable()
export class OrganizationDirectoryImportService {
    constructor(
        @Inject(APP_DB_POOL) private readonly pool: Pool,
        private readonly s3: S3StorageService,
        private readonly journal: WorkbookImportJournal,
    ) {}

    /**
     * Текущий справочник для потребителей расчёта. Пустая карта означает «справочник
     * не загружен» — тогда перечни МО берутся из комментариев матрицы, как раньше.
     */
    async loadDirectory(): Promise<Map<string, OrganizationAttributesRow>> {
        const result = await this.pool.query(
            `
            SELECT organization_oid AS "organizationOid",
                   display_short_name AS "displayShortName",
                   attached_population AS "attachedPopulation",
                   attached_child_population AS "attachedChildPopulation",
                   llo_program AS "lloProgram",
                   licenses
            FROM reporting_organization_attributes;
            `,
        )
        const directory = new Map<string, OrganizationAttributesRow>()
        for (const row of result.rows as OrganizationAttributesRow[]) {
            directory.set(row.organizationOid, {
                ...row,
                licenses: (row.licenses ?? {}) as Record<string, boolean>,
            })
        }
        return directory
    }

    async createPreview(
        userId: number,
        periodId: string,
        fileBuffer: Buffer,
        originalFilename: string,
    ): Promise<OrganizationDirectoryPreviewResult> {
        const cleanPeriodId = this.cleanText(periodId, 80)
        if (!cleanPeriodId) throw new BadRequestException('Укажите отчетный период')
        if (!fileBuffer.length) throw new BadRequestException('Файл справочника МО пуст')
        if (fileBuffer.length > MAX_STORED_IMPORT_SIZE) {
            throw new BadRequestException('Файл превышает максимально допустимый размер')
        }

        await this.assertPeriodExists(cleanPeriodId)
        const sourceName = this.cleanText(originalFilename, 256) || 'Справочник МО.xlsx'
        const parsed = await loadOrganizationDirectoryWorkbook(fileBuffer)
        const preview = await this.buildPreview(parsed)

        const importId = randomUUID()
        const fileSha256 = createHash('sha256').update(fileBuffer).digest('hex')
        const previewExpiresAt = new Date(Date.now() + PREVIEW_TTL_HOURS * 60 * 60 * 1000)
        const objectKey =
            `reporting/reference/organization-directory/${cleanPeriodId}/${importId}/`
            + this.buildObjectFilename(sourceName)

        await this.journal.createPreviewedRun({
            importId,
            periodId: cleanPeriodId,
            sourceType: DIRECTORY_SOURCE_TYPE,
            importMode: 'replace',
            sourceName,
            fileBuffer,
            contentType: DIRECTORY_CONTENT_TYPE,
            objectKey,
            fileSha256,
            organizationRows: preview.totals.matchedOrganizationCount,
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

    async getPreview(
        userId: number,
        importId: string,
    ): Promise<OrganizationDirectoryPreviewResult> {
        const run = await this.getPreviewRun(userId, importId)
        const preview = run.details?.preview as OrganizationDirectoryPreview | undefined
        if (!preview) {
            throw new NotFoundException('Предпросмотр импорта справочника МО не найден')
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

    async confirmPreview(
        userId: number,
        importId: string,
    ): Promise<OrganizationDirectoryConfirmResult> {
        const run = await this.getPreviewRun(userId, importId)
        this.assertPreviewCanBeConfirmed(run)

        const fileBuffer = await this.readStoredImport(run.objectKey, run.fileSize)
        const storedHash = createHash('sha256').update(fileBuffer).digest('hex')
        if (storedHash !== run.fileSha256) {
            throw new BadRequestException(
                'Сохраненный файл импорта поврежден: контрольная сумма не совпадает',
            )
        }

        const parsed = await loadOrganizationDirectoryWorkbook(fileBuffer)
        const preview = await this.buildPreview(parsed)
        if (!preview.canConfirm) {
            throw new BadRequestException(
                'Справочник МО нельзя применить: проверьте предупреждения предпросмотра',
            )
        }

        let transitionedToProcessing = false
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
                  AND source_type = $3
                  AND status = 'previewed'
                  AND preview_expires_at > now()
                RETURNING id;
                `,
                [run.id, userId, DIRECTORY_SOURCE_TYPE],
            )
            if (transition.rowCount !== 1) {
                throw new BadRequestException(
                    'Предпросмотр уже подтвержден или срок его действия истек',
                )
            }
            transitionedToProcessing = true

            const knownBefore = await this.loadOrganizationOids(client)
            const createdOrganizationCount = await this.createMissingOrganizations(
                client,
                run.id,
                parsed.entries.filter((entry) => !knownBefore.has(entry.oid)),
            )
            // Пересчитываем состав после создания: строка без единого наименования
            // организацией не становится, и признаки ей писать некуда.
            const known = await this.loadOrganizationOids(client)
            const applicable = parsed.entries.filter((entry) => known.has(entry.oid))
            // Замена целиком: справочник отдают одним файлом на весь регион, и строка,
            // исчезнувшая из файла, должна исчезнуть из справочника, а не остаться
            // висеть от прошлой загрузки.
            await client.query('DELETE FROM reporting_organization_attributes;')
            await this.insertEntries(client, run.id, run.originalFilename, applicable)
            await this.applyOrganizationNames(client, applicable)
            // Рабочие сокращения методолога заводятся здесь, а не миграцией: у только что
            // созданной МО синонима иначе не будет вовсе — см. organization-alias-seed.ts.
            await applyOrganizationAliasSeed(client)

            const result: OrganizationDirectoryConfirmResult = {
                importId: run.id,
                periodId: run.periodId,
                sourceName: run.originalFilename,
                savedOrganizationCount: applicable.length,
                createdOrganizationCount,
                attachedPopulationCount: applicable.filter((e) => e.attachedPopulation).length,
                attachedChildPopulationCount:
                    applicable.filter((e) => e.attachedChildPopulation).length,
                licenseCounts: this.countLicenses(applicable, parsed),
                requiresMatrixReimport: true,
                warnings: preview.warnings,
            }

            await client.query(
                `
                UPDATE reporting_import_runs
                SET status = 'completed',
                    organization_rows = $2,
                    organization_values_count = $2,
                    warnings = $3::jsonb,
                    details = $4::jsonb,
                    error_message = '',
                    completed_at = now()
                WHERE id = $1;
                `,
                [
                    run.id,
                    applicable.length,
                    JSON.stringify(preview.warnings),
                    JSON.stringify({ preview, result }),
                ],
            )
            await client.query('COMMIT')
            return result
        } catch (err) {
            await client.query('ROLLBACK')
            if (transitionedToProcessing) await this.markImportFailed(run.id, err)
            throw err
        } finally {
            client.release()
        }
    }

    async cancelPreview(
        userId: number,
        importId: string,
    ): Promise<{ importId: string; status: 'cancelled' }> {
        return this.journal.cancelPreview(
            DIRECTORY_SOURCE_TYPE,
            userId,
            this.cleanText(importId, 80),
        )
    }

    private async buildPreview(
        parsed: OrganizationDirectoryParseResult,
    ): Promise<OrganizationDirectoryPreview> {
        const organizations = await this.loadOrganizations()
        const byOid = new Map(organizations.map((row) => [row.oid, row]))
        const fileOids = new Set(parsed.entries.map((entry) => entry.oid))

        const newOrganizations = parsed.entries
            .filter((entry) => !byOid.has(entry.oid))
            .map((entry) => ({
                rowNumber: entry.rowNumber,
                oid: entry.oid,
                name: entry.officialShortName || entry.officialFullName,
            }))
        const missingFromFile = organizations
            .filter((row) => !fileOids.has(row.oid))
            .map((row) => ({ oid: row.oid, name: row.officialShortName }))

        // Применяются все строки файла: известные обновляются, новые создаются.
        const matched = parsed.entries
        const warnings = [...parsed.warnings]
        if (newOrganizations.length) {
            warnings.push(
                `Новых МО в файле: ${newOrganizations.length}. `
                + 'Они будут созданы в реестре — состав целевых МО задаёт справочник, '
                + 'а не выгрузка РЭМД. Проверьте OID: опечатка тоже создаст организацию.',
            )
        }
        if (missingFromFile.length) {
            warnings.push(
                `В файле нет ${missingFromFile.length} МО из реестра — их признаки останутся пустыми.`,
            )
        }
        const unusedLicenses = parsed.licenseColumns
            .filter((column) => !LICENSE_CODES_USED_BY_INDICATOR.includes(column.licenseCode))
            .map((column) => column.licenseCode)
        if (unusedLicenses.length) {
            warnings.push(
                `Лицензии ${unusedLicenses.join(', ')} будут сохранены, но состав обязанных МО `
                + 'не сузят: в матрице применимости нет ни одного вида с таким условием. '
                + 'Если вид с этой лицензией в матрице есть, значит, разбор его не читает — '
                + 'это доработка, а не ошибка файла.',
            )
        }

        return {
            // Подтверждать можно и с непустыми предупреждениями: ни одно из них
            // не делает справочник неприменимым. Блокирует только пустой результат.
            canConfirm: matched.length > 0,
            sheetName: parsed.sheetName,
            totals: {
                rowCount: parsed.entries.length,
                matchedOrganizationCount: matched.length,
                newOrganizationCount: newOrganizations.length,
                directoryOrganizationCount: organizations.length,
                missingFromFileCount: missingFromFile.length,
                attachedPopulationCount: matched.filter((e) => e.attachedPopulation).length,
                attachedChildPopulationCount:
                    matched.filter((e) => e.attachedChildPopulation).length,
            },
            licenses: parsed.licenseColumns.map((column) => ({
                code: column.licenseCode,
                title: column.title,
                organizationCount: matched.filter((e) => e.licenses[column.licenseCode]).length,
                usedByIndicator: LICENSE_CODES_USED_BY_INDICATOR.includes(column.licenseCode),
            })),
            newOrganizations,
            missingFromFile,
            warnings,
        }
    }

    private countLicenses(
        entries: OrganizationDirectoryEntry[],
        parsed: OrganizationDirectoryParseResult,
    ): Record<string, number> {
        const counts: Record<string, number> = {}
        for (const column of parsed.licenseColumns) {
            counts[column.licenseCode] = entries.filter(
                (entry) => entry.licenses[column.licenseCode],
            ).length
        }
        return counts
    }

    /**
     * Наименования МО из справочника признаков — в `reporting_organizations`.
     *
     * Справочник ведёт методолог, и в нём есть отдельная колонка «краткое
     * наименование для отображения в сервисе». До 17.08.2026 эти имена никуда
     * не переносились: у всех 37 МО полное наименование равнялось краткому,
     * а подписи брались из выгрузки РЭМД. 15.08 выгрузка переименовала
     * «Курганский областной центр медицинской профилактики, лечебной физкультуры
     * и спортивной медицины» в «КОЦОЗМП» — во всех трёх полях сразу.
     *
     * Пустые ячейки не затирают уже известное имя: в справочнике колонка
     * отображаемого имени необязательная, и пустота означает «не задано»,
     * а не «стереть».
     *
     * `nameSource: 'directory'` в метаданных — метка для импорта РЭМД: строку
     * с ней он больше не перезаписывает.
     */
    private async applyOrganizationNames(
        client: PoolClient,
        entries: readonly OrganizationDirectoryEntry[],
    ): Promise<void> {
        for (const entry of entries) {
            await client.query(
                `
                UPDATE reporting_organizations
                SET official_full_name = COALESCE(NULLIF(btrim($2), ''), official_full_name),
                    official_short_name = COALESCE(NULLIF(btrim($3), ''), official_short_name),
                    common_name = COALESCE(
                        NULLIF(btrim($4), ''),
                        NULLIF(btrim($3), ''),
                        common_name
                    ),
                    metadata = metadata || jsonb_build_object(
                        'nameSource', 'directory',
                        'nameLevel', 'full'
                    ),
                    updated_at = now()
                WHERE oid = $1;
                `,
                [
                    entry.oid,
                    entry.officialFullName,
                    entry.officialShortName,
                    entry.displayShortName,
                ],
            )
        }
    }

    /**
     * Заводит в реестре МО, которых там ещё нет.
     *
     * Состав целевых МО задаёт справочник методолога — это и было ответом на вопрос
     * про санатории: у ГБУ «Санаторий "Озеро Горькое"» и ГБУ «Детский санаторий
     * "Космос"» ноль зарегистрированных документов, поэтому в выгрузке РЭМД, которая
     * до сих пор одна создавала организации, их нет и быть не может. Пока строка
     * справочника молча пропускалась, три вида СЭМД оставались без адресата,
     * а сто с лишним пар «МО × вид» висели в «не определено».
     *
     * Адрес и координаты не заполняются: в справочнике их нет. На карте такая МО
     * не появится, пока адрес не придёт из другого источника, — это честнее, чем
     * поставить точку наугад.
     */
    private async createMissingOrganizations(
        client: PoolClient,
        importId: string,
        entries: readonly OrganizationDirectoryEntry[],
    ): Promise<number> {
        let created = 0
        for (const entry of entries) {
            const fullName = entry.officialFullName
                || entry.officialShortName
                || entry.displayShortName
            if (!fullName) {
                // Ограничение таблицы: наименование не может быть пустым. Строка без
                // единого имени — это не МО, а мусор в файле.
                continue
            }
            const result = await client.query(
                `
                INSERT INTO reporting_organizations (
                    oid,
                    official_full_name,
                    official_short_name,
                    common_name,
                    is_active,
                    source_import_id,
                    metadata
                )
                VALUES ($1, $2, $3, $4, TRUE, $5, $6::jsonb)
                ON CONFLICT (oid) DO NOTHING
                RETURNING oid;
                `,
                [
                    entry.oid,
                    fullName,
                    entry.officialShortName || fullName,
                    entry.displayShortName || entry.officialShortName || fullName,
                    importId,
                    JSON.stringify({
                        nameSource: 'directory',
                        nameLevel: 'full',
                        createdBy: 'organization_directory',
                    }),
                ],
            )
            created += result.rowCount ?? 0
        }
        return created
    }

    private async insertEntries(
        client: PoolClient,
        importId: string,
        sourceName: string,
        entries: OrganizationDirectoryEntry[],
    ): Promise<void> {
        for (const entry of entries) {
            await client.query(
                `
                INSERT INTO reporting_organization_attributes (
                    organization_oid,
                    display_short_name,
                    attached_population,
                    attached_child_population,
                    llo_program,
                    licenses,
                    source_name,
                    source_import_id,
                    source_row_number,
                    updated_at
                )
                VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, now());
                `,
                [
                    entry.oid,
                    entry.displayShortName,
                    entry.attachedPopulation,
                    entry.attachedChildPopulation,
                    entry.lloProgram,
                    JSON.stringify(entry.licenses),
                    sourceName,
                    importId,
                    entry.rowNumber,
                ],
            )
        }
    }

    private async loadOrganizations(): Promise<OrganizationRow[]> {
        const result = await this.pool.query(
            `
            SELECT oid, official_short_name AS "officialShortName"
            FROM reporting_organizations
            WHERE is_active = TRUE
            ORDER BY official_short_name;
            `,
        )
        return result.rows as OrganizationRow[]
    }

    private async loadOrganizationOids(client: PoolClient): Promise<Set<string>> {
        const result = await client.query(
            'SELECT oid FROM reporting_organizations WHERE is_active = TRUE;',
        )
        return new Set(result.rows.map((row: { oid: string }) => row.oid))
    }

    private async assertPeriodExists(periodId: string): Promise<void> {
        const result = await this.pool.query(
            'SELECT 1 FROM reporting_periods WHERE id = $1;',
            [periodId],
        )
        if (!result.rows[0]) throw new NotFoundException('Отчетный период не найден')
    }

    private async getPreviewRun(userId: number, importId: string) {
        return this.journal.getPreviewedRun(
            DIRECTORY_SOURCE_TYPE,
            userId,
            this.cleanText(importId, 80),
            'Импорт справочника МО не найден',
        )
    }

    private assertPreviewCanBeConfirmed(run: {
        status: string
        previewExpiresAt: Date | string | null
        details: Record<string, unknown>
    }): void {
        if (run.status !== 'previewed') {
            throw new BadRequestException('Этот импорт уже был обработан')
        }
        const expiresAt = run.previewExpiresAt
            ? new Date(run.previewExpiresAt).getTime()
            : 0
        if (!expiresAt || expiresAt <= Date.now()) {
            throw new BadRequestException(
                'Срок действия предпросмотра истек. Загрузите файл повторно',
            )
        }
        const preview = run.details?.preview as OrganizationDirectoryPreview | undefined
        if (!preview?.canConfirm) {
            throw new BadRequestException(
                'Справочник МО нельзя применить: проверьте предупреждения предпросмотра',
            )
        }
    }

    private async readStoredImport(
        objectKey: string,
        expectedSize: number,
    ): Promise<Buffer> {
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
                throw new BadRequestException(
                    'Сохраненный файл превышает максимально допустимый размер',
                )
            }
            chunks.push(buffer)
        }
        if (totalSize !== Number(expectedSize)) {
            throw new BadRequestException(
                'Сохраненный файл импорта поврежден: размер не совпадает',
            )
        }
        return Buffer.concat(chunks)
    }

    private async markImportFailed(importId: string, err: unknown): Promise<void> {
        const message = err instanceof Error ? err.message : 'Неизвестная ошибка импорта'
        try {
            await this.pool.query(
                `
                UPDATE reporting_import_runs
                SET status = 'failed',
                    error_message = $2,
                    completed_at = now()
                WHERE id = $1;
                `,
                [importId, message.slice(0, 2000)],
            )
        } catch {
            // Исходная ошибка важнее сбоя при её протоколировании.
        }
    }

    private buildObjectFilename(sourceName: string): string {
        const safe = sourceName.replace(/[^\w.\-]+/gu, '_').slice(0, 120)
        return safe || 'organization-directory.xlsx'
    }

    private cleanText(value: unknown, maxLength: number): string {
        return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, maxLength)
    }

    private toIsoString(value: Date | string | null): string {
        if (!value) return ''
        return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
    }
}
