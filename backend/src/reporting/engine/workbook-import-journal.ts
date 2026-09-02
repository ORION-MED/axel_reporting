import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common'
import { Pool } from 'pg'
import { APP_DB_POOL } from '../../database/database.tokens'
import { S3StorageService } from '../../storage/s3.service'

/**
 * Roadmap step 2.2 — the part of `reporting_import_runs` bookkeeping that is genuinely
 * identical across preview-then-confirm importers (currently REmdWorkbookImportService and
 * TpggWorkbookImportService): upload the raw file to S3, insert/read/cancel the journal row.
 *
 * Parsing, validation, column mapping and persisting into domain tables stay in each
 * importer — those are legitimately different per source and forcing them into one shape
 * would be a false abstraction. Only this S3+journal lifecycle is shared here; a future
 * source (ФОМС, ЕГР ЗАГС) reuses it instead of re-writing the same INSERT/UPDATE by hand.
 */

export interface WorkbookImportRunRow {
    id: string
    periodId: string
    importMode: string
    originalFilename: string
    objectKey: string
    fileSha256: string
    fileSize: number
    status: string
    previewExpiresAt: Date | string | null
    details: Record<string, unknown>
}

export interface CreatePreviewedRunParams {
    importId: string
    periodId: string
    sourceType: string
    importMode: string
    sourceName: string
    fileBuffer: Buffer
    contentType: string
    objectKey: string
    fileSha256: string
    organizationRows: number
    warnings: string[]
    details: Record<string, unknown>
    userId: number
    previewExpiresAt: Date
}

@Injectable()
export class WorkbookImportJournal {
    constructor(
        @Inject(APP_DB_POOL) private readonly pool: Pool,
        private readonly s3: S3StorageService,
    ) {}

    async deleteObjectQuietly(objectKey: string): Promise<void> {
        try {
            await this.s3.deleteObject(objectKey)
        } catch {
            // The original import error is more useful to the caller than a cleanup error.
        }
    }

    /** Uploads the raw file to S3 and inserts the `previewed` journal row; rolls the upload back on DB failure. */
    async createPreviewedRun(params: CreatePreviewedRunParams): Promise<void> {
        await this.s3.uploadBuffer(params.objectKey, params.fileBuffer, params.contentType)
        try {
            await this.pool.query(
                `
                INSERT INTO reporting_import_runs (
                    id,
                    period_id,
                    source_type,
                    import_mode,
                    original_filename,
                    object_key,
                    file_sha256,
                    file_size,
                    status,
                    organization_rows,
                    warnings,
                    details,
                    created_by,
                    preview_expires_at
                )
                VALUES (
                    $1, $2, $3, $4, $5, $6, $7, $8, 'previewed', $9, $10::jsonb, $11::jsonb, $12, $13
                );
                `,
                [
                    params.importId,
                    params.periodId,
                    params.sourceType,
                    params.importMode,
                    params.sourceName,
                    params.objectKey,
                    params.fileSha256,
                    params.fileBuffer.length,
                    params.organizationRows,
                    JSON.stringify(params.warnings),
                    JSON.stringify(params.details),
                    params.userId,
                    params.previewExpiresAt,
                ],
            )
        } catch (err) {
            await this.deleteObjectQuietly(params.objectKey)
            throw err
        }
    }

    async getPreviewedRun(
        sourceType: string,
        userId: number,
        importId: string,
        notFoundMessage: string,
    ): Promise<WorkbookImportRunRow> {
        const result = await this.pool.query(
            `
            SELECT id::text,
                   period_id::text AS "periodId",
                   import_mode AS "importMode",
                   original_filename AS "originalFilename",
                   object_key AS "objectKey",
                   file_sha256 AS "fileSha256",
                   file_size::float8 AS "fileSize",
                   status,
                   preview_expires_at AS "previewExpiresAt",
                   details
            FROM reporting_import_runs
            WHERE id = $1
              AND created_by = $2
              AND source_type = $3;
            `,
            [importId, userId, sourceType],
        )
        if (!result.rows[0]) {
            throw new NotFoundException(notFoundMessage)
        }
        return result.rows[0]
    }

    async cancelPreview(
        sourceType: string,
        userId: number,
        importId: string,
    ): Promise<{ importId: string; status: 'cancelled' }> {
        const result = await this.pool.query(
            `
            UPDATE reporting_import_runs
            SET status = 'cancelled',
                error_message = '',
                completed_at = now()
            WHERE id = $1
              AND created_by = $2
              AND source_type = $3
              AND status = 'previewed'
            RETURNING id::text, object_key AS "objectKey";
            `,
            [importId, userId, sourceType],
        )
        if (!result.rows[0]) {
            throw new BadRequestException('Предпросмотр уже обработан или не найден')
        }
        await this.deleteObjectQuietly(result.rows[0].objectKey)
        return { importId: String(result.rows[0].id), status: 'cancelled' }
    }
}
