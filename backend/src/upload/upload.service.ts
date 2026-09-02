import { Injectable, Inject, InternalServerErrorException, HttpException, Logger } from '@nestjs/common'
import { Pool } from 'pg'
import { createHash, randomUUID } from 'crypto'
import { Transform, Readable } from 'stream'
import { S3StorageService } from '../storage/s3.service'
import { JobsService } from '../jobs/jobs.service'
import { APP_DB_POOL } from '../database/database.tokens'

export interface RegisteredUpload {
    uploadId: string
    jobId: string
}


const MIME_TO_EXT: Record<string, string> = {
    'text/csv': 'csv',
    'application/csv': 'csv',
    'application/vnd.ms-excel': 'xls',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
    'application/vnd.oasis.opendocument.spreadsheet': 'ods',
}

function resolveExtension(mimeType: string, filename: string): string {
    const fromMime = MIME_TO_EXT[mimeType]
    if (fromMime) return fromMime
    const dot = filename.lastIndexOf('.')
    if (dot !== -1) return filename.slice(dot + 1).toLowerCase()
    return 'bin'
}

@Injectable()
export class UploadService {
    private readonly log = new Logger(UploadService.name)

    constructor(
        @Inject(APP_DB_POOL) private readonly pool: Pool,
        private readonly jobsService: JobsService,
        private readonly s3: S3StorageService,
    ) {}

    async registerUploadStream(
        stream: Readable,
        originalFilename: string,
        mimeType: string,
        userId: number,
    ): Promise<RegisteredUpload> {
        const uploadId = randomUUID()
        const ext = resolveExtension(mimeType, originalFilename)
        const s3Key = `raw/${userId}/${uploadId}/source.${ext}`

        const hash = createHash('sha256')
        let sizeBytes = 0

        // Transform stream: compute hash + size while passing data through to S3
        const hashTransform = new Transform({
            transform(chunk, _enc, cb) {
                sizeBytes += chunk.length
                hash.update(chunk)
                this.push(chunk)
                cb()
            },
        })

        stream.pipe(hashTransform)

        try {
            await this.s3.uploadStream(s3Key, hashTransform, mimeType)
        } catch {
            throw new InternalServerErrorException('Не удалось загрузить файл в хранилище')
        }

        const checksum = hash.digest('hex')

        // Dedup: if this user already has a completed profile for the same file, reuse it
        const dedupRes = await this.pool.query<{ upload_id: string; job_id: string }>(
            `SELECT u.id AS upload_id, pj.id AS job_id
             FROM uploads u
             JOIN processing_jobs pj
               ON pj.upload_id = u.id
              AND pj.job_type = 'profile'
              AND pj.status   = 'completed'
             WHERE u.checksum = $1 AND u.user_id = $2
             LIMIT 1`,
            [checksum, userId],
        )

        if (dedupRes.rows.length > 0) {
            // Discard the duplicate S3 object in the background — don't block the response
            this.s3.deleteObject(s3Key).catch((err) =>
                this.log.warn(`Failed to delete duplicate S3 object ${s3Key}: ${err}`),
            )
            const { upload_id, job_id } = dedupRes.rows[0]
            this.log.log(`Dedup hit for user ${userId}: reusing upload ${upload_id}`)
            return { uploadId: upload_id, jobId: job_id }
        }

        const client = await this.pool.connect()
        try {
            await client.query('BEGIN')

            // RETURNING id is empty when ON CONFLICT DO NOTHING fires
            const insertResult = await client.query<{ id: string }>(
                `INSERT INTO uploads (id, user_id, original_filename, mime_type, size_bytes, s3_raw_key, checksum, status)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, 'uploaded')
                 ON CONFLICT (checksum, user_id) WHERE checksum IS NOT NULL DO NOTHING
                 RETURNING id`,
                [uploadId, userId, originalFilename, mimeType, sizeBytes, s3Key, checksum],
            )

            if (!insertResult.rowCount || insertResult.rowCount === 0) {
                // Concurrent upload won the race — roll back and reuse the winner
                await client.query('ROLLBACK')
                this.s3.deleteObject(s3Key).catch((err) =>
                    this.log.warn(`Failed to delete duplicate S3 object ${s3Key}: ${err}`),
                )

                // Return completed profile job if one exists for the existing upload
                const existingRes = await this.pool.query<{ upload_id: string; job_id: string }>(
                    `SELECT u.id AS upload_id, pj.id AS job_id
                     FROM uploads u
                     JOIN processing_jobs pj
                       ON pj.upload_id = u.id
                      AND pj.job_type = 'profile'
                      AND pj.status = 'completed'
                     WHERE u.checksum = $1 AND u.user_id = $2
                     LIMIT 1`,
                    [checksum, userId],
                )
                if (existingRes.rows.length > 0) {
                    return { uploadId: existingRes.rows[0].upload_id, jobId: existingRes.rows[0].job_id }
                }

                // Profile still in progress — find the upload and enqueue another profile job
                const existUploadRes = await this.pool.query<{ id: string }>(
                    `SELECT id FROM uploads WHERE checksum = $1 AND user_id = $2 LIMIT 1`,
                    [checksum, userId],
                )
                if (!existUploadRes.rows[0]) {
                    throw new InternalServerErrorException('Не удалось зарегистрировать загрузку')
                }
                const existingUploadId = existUploadRes.rows[0].id
                const raceJobRes = await this.pool.query<{ id: string }>(
                    `INSERT INTO processing_jobs (id, upload_id, user_id, job_type, status, pipeline_config)
                     VALUES ($1, $2, $3, 'profile', 'queued', '{}'::jsonb)
                     RETURNING id`,
                    [randomUUID(), existingUploadId, userId],
                )
                const raceJobId = raceJobRes.rows[0].id
                this.jobsService.publishJob(raceJobId)
                return { uploadId: existingUploadId, jobId: raceJobId }
            }

            // Fresh upload — insert job inside the same transaction
            const jobRes = await client.query<{ id: string }>(
                `INSERT INTO processing_jobs (id, upload_id, user_id, job_type, status, pipeline_config)
                 VALUES ($1, $2, $3, 'profile', 'queued', '{}'::jsonb)
                 RETURNING id`,
                [randomUUID(), uploadId, userId],
            )
            const jobId: string = jobRes.rows[0].id

            await client.query('COMMIT')
            this.jobsService.publishJob(jobId)
            return { uploadId, jobId }
        } catch (err) {
            this.log.error('Transaction failed during upload registration', err)
            await client.query('ROLLBACK')
            if (err instanceof HttpException) throw err
            throw new InternalServerErrorException('Не удалось зарегистрировать загрузку')
        } finally {
            client.release()
        }
    }

}
