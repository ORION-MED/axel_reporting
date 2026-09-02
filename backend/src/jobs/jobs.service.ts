import { Injectable, Inject, NotFoundException, ForbiddenException, BadRequestException, InternalServerErrorException, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common'
import { Pool } from 'pg'
import { randomUUID } from 'crypto'
import * as amqplib from 'amqplib'
import { APP_DB_POOL } from '../database/database.tokens'

const buildRabbitmqUrl = (): string => {
    if (process.env.RABBITMQ_URL) return process.env.RABBITMQ_URL

    const host = process.env.RABBITMQ_HOST || 'localhost'
    const port = process.env.RABBITMQ_PORT || '5672'
    const user = process.env.RABBITMQ_USER
    const pass = process.env.RABBITMQ_PASS
    const vhost = process.env.RABBITMQ_VHOST

    if (!user && !pass) {
        return `amqp://${host}:${port}`
    }

    const auth = `${encodeURIComponent(user || 'guest')}:${encodeURIComponent(pass || 'guest')}`
    const vhostPath = vhost ? `/${encodeURIComponent(vhost)}` : ''
    return `amqp://${auth}@${host}:${port}${vhostPath}`
}

const RABBITMQ_URL = buildRabbitmqUrl()
const RABBITMQ_QUEUE = process.env.RABBITMQ_QUEUE || 'jobs'
const ALLOWED_JOB_TYPES = new Set(['profile', 'process'])
const ALLOWED_EXPORT_FORMATS = new Set(['csv', 'parquet', 'xlsx'])

export interface ProcessingJob {
    id: string
    uploadId: string
    userId: number
    jobType: string
    status: string
    progressPercent: number
    pipelineConfig: unknown
    startedAt: string | null
    finishedAt: string | null
    errorMessage: string | null
    createdAt: string
}

export interface CreateJobDto {
    uploadId: string
    jobType: string
    pipelineConfig?: unknown
}

const SWEEPER_INTERVAL_MS    = 2 * 60 * 1000   // 2 min
const SWEEPER_STALE_SECONDS  = 120             // queued jobs stale after 2 min
const RUNNING_TIMEOUT_MINUTES = parseInt(process.env.JOB_RUNNING_TIMEOUT_MINUTES ?? '60', 10)

@Injectable()
export class JobsService implements OnModuleInit, OnModuleDestroy {
    private readonly log = new Logger(JobsService.name)
    private amqpConnection: amqplib.ChannelModel | null = null
    private amqpChannel: amqplib.Channel | null = null
    private reconnectTimer: NodeJS.Timeout | null = null
    private sweeperTimer: NodeJS.Timeout | null = null
    private isShuttingDown = false

    constructor(@Inject(APP_DB_POOL) private readonly pool: Pool) {}

    async onModuleInit() {
        await this.connectAmqp()
        this.sweeperTimer = setInterval(() => this.sweepStaleJobs(), SWEEPER_INTERVAL_MS)
    }

    async onModuleDestroy() {
        this.isShuttingDown = true
        if (this.sweeperTimer) clearInterval(this.sweeperTimer)
        if (this.reconnectTimer) clearTimeout(this.reconnectTimer)

        const channel = this.amqpChannel
        const connection = this.amqpConnection
        this.amqpChannel = null
        this.amqpConnection = null
        this.reconnectTimer = null
        this.sweeperTimer = null

        try { await channel?.close() } catch {}
        try { await connection?.close() } catch {}
    }

    private async sweepStaleJobs(): Promise<void> {
        try {
            // Re-publish queued jobs that were never picked up by a worker
            const queued = await this.pool.query<{ id: string }>(
                `SELECT id FROM processing_jobs
                 WHERE status = 'queued'
                   AND created_at < now() - ($1 || ' seconds')::interval`,
                [SWEEPER_STALE_SECONDS],
            )
            for (const row of queued.rows) {
                this.log.warn(`Sweeper: re-publishing stale queued job ${row.id}`)
                this.publishJob(row.id)
            }

            // Mark running jobs as failed if the worker crashed and never finished
            const stuck = await this.pool.query<{ id: string }>(
                `UPDATE processing_jobs
                 SET status        = 'failed',
                     finished_at   = now(),
                     error_message = 'Worker timeout — job exceeded maximum run time'
                 WHERE status = 'running'
                   AND started_at < now() - ($1 || ' minutes')::interval
                 RETURNING id`,
                [RUNNING_TIMEOUT_MINUTES],
            )
            for (const row of stuck.rows) {
                this.log.warn(`Sweeper: marked stuck running job ${row.id} as failed`)
            }
        } catch (err) {
            this.log.error(`Sweeper error: ${err}`)
        }
    }

    private async connectAmqp(retries = 15, delayMs = 3000): Promise<void> {
        for (let i = 0; i < retries; i++) {
            if (this.isShuttingDown) return
            try {
                this.amqpConnection = await amqplib.connect(RABBITMQ_URL)
                this.amqpChannel = await this.amqpConnection.createChannel()
                await this.amqpChannel.assertQueue(RABBITMQ_QUEUE, { durable: true })

                const scheduleReconnect = () => {
                    if (this.isShuttingDown || this.reconnectTimer) return
                    this.amqpChannel = null
                    this.amqpConnection = null
                    this.reconnectTimer = setTimeout(() => {
                        this.reconnectTimer = null
                        void this.connectAmqp()
                    }, delayMs)
                    this.reconnectTimer.unref?.()
                }

                this.amqpConnection.on('error', (err) => {
                    if (this.isShuttingDown) return
                    this.log.warn(`RabbitMQ connection error: ${err.message} — reconnecting`)
                    scheduleReconnect()
                })
                this.amqpConnection.on('close', () => {
                    if (this.isShuttingDown) return
                    this.log.warn('RabbitMQ connection closed — reconnecting')
                    scheduleReconnect()
                })

                this.log.log(`Connected to RabbitMQ, queue="${RABBITMQ_QUEUE}"`)
                return
            } catch (err) {
                if (this.isShuttingDown) return
                this.log.warn(`RabbitMQ connect attempt ${i + 1}/${retries} failed: ${err}`)
                if (i < retries - 1) await new Promise((r) => setTimeout(r, delayMs))
            }
        }
        this.log.error('Could not connect to RabbitMQ — jobs will be stored in DB but not dispatched')
    }

    publishJob(jobId: string): void {
        if (!this.amqpChannel) {
            this.log.warn(`RabbitMQ unavailable — job ${jobId} saved in DB but not published`)
            return
        }
        try {
            const ok = this.amqpChannel.sendToQueue(
                RABBITMQ_QUEUE,
                Buffer.from(JSON.stringify({ job_id: jobId })),
                { persistent: true },
            )
            if (!ok) {
                this.log.warn(`RabbitMQ write buffer full — job ${jobId} may be delayed`)
            }
        } catch (err) {
            this.log.error(`Failed to publish job ${jobId}: ${err}`)
        }
    }

    async getJob(jobId: string, userId: number): Promise<ProcessingJob> {
        const res = await this.pool.query(
            `SELECT id,
                    upload_id      AS "uploadId",
                    user_id        AS "userId",
                    job_type       AS "jobType",
                    status,
                    progress_percent AS "progressPercent",
                    pipeline_config  AS "pipelineConfig",
                    started_at     AS "startedAt",
                    finished_at    AS "finishedAt",
                    error_message  AS "errorMessage",
                    created_at     AS "createdAt"
             FROM processing_jobs
             WHERE id = $1 AND user_id = $2`,
            [jobId, userId],
        )
        const job: ProcessingJob | undefined = res.rows[0]
        if (!job) throw new NotFoundException('Задача не найдена')
        return job
    }

    async listJobsForUpload(uploadId: string, userId: number): Promise<ProcessingJob[]> {
        const uploadCheck = await this.pool.query(
            'SELECT id FROM uploads WHERE id = $1 AND user_id = $2',
            [uploadId, userId],
        )
        if (uploadCheck.rowCount === 0) throw new ForbiddenException('Загрузка не найдена или нет доступа')

        const res = await this.pool.query(
            `SELECT id,
                    upload_id      AS "uploadId",
                    user_id        AS "userId",
                    job_type       AS "jobType",
                    status,
                    progress_percent AS "progressPercent",
                    pipeline_config  AS "pipelineConfig",
                    started_at     AS "startedAt",
                    finished_at    AS "finishedAt",
                    error_message  AS "errorMessage",
                    created_at     AS "createdAt"
             FROM processing_jobs
             WHERE upload_id = $1
             ORDER BY created_at ASC`,
            [uploadId],
        )
        return res.rows
    }

    async createJob(dto: CreateJobDto, userId: number): Promise<ProcessingJob> {
        const jobType = this.normalizeJobType(dto.jobType)
        const pipelineConfig = this.normalizePipelineConfig(jobType, dto.pipelineConfig)

        const uploadCheck = await this.pool.query(
            'SELECT id FROM uploads WHERE id = $1 AND user_id = $2',
            [dto.uploadId, userId],
        )
        if (uploadCheck.rowCount === 0) throw new ForbiddenException('Загрузка не найдена или нет доступа')

        const jobId = randomUUID()
        try {
            const res = await this.pool.query(
                `INSERT INTO processing_jobs (id, upload_id, user_id, job_type, status, pipeline_config)
                 VALUES ($1, $2, $3, $4, 'queued', $5)
                 RETURNING id,
                           upload_id      AS "uploadId",
                           user_id        AS "userId",
                           job_type       AS "jobType",
                           status,
                           progress_percent AS "progressPercent",
                           pipeline_config  AS "pipelineConfig",
                           started_at     AS "startedAt",
                           finished_at    AS "finishedAt",
                           error_message  AS "errorMessage",
                           created_at     AS "createdAt"`,
                [jobId, dto.uploadId, userId, jobType, pipelineConfig],
            )
            const job: ProcessingJob = res.rows[0]
            this.publishJob(job.id)
            return job
        } catch {
            throw new InternalServerErrorException('Не удалось создать задачу')
        }
    }

    private normalizeJobType(jobType: string): string {
        if (typeof jobType !== 'string') {
            throw new BadRequestException('jobType должен быть строкой')
        }
        const normalized = jobType.trim().toLowerCase()
        if (!ALLOWED_JOB_TYPES.has(normalized)) {
            throw new BadRequestException(`Неподдерживаемый тип задачи: ${jobType}`)
        }
        return normalized
    }

    private normalizePipelineConfig(jobType: string, pipelineConfig: unknown): Record<string, unknown> {
        if (jobType === 'profile') {
            if (pipelineConfig == null) return {}
            if (typeof pipelineConfig !== 'object' || Array.isArray(pipelineConfig)) {
                throw new BadRequestException('pipelineConfig должен быть объектом')
            }
            return pipelineConfig as Record<string, unknown>
        }

        if (!pipelineConfig || typeof pipelineConfig !== 'object' || Array.isArray(pipelineConfig)) {
            throw new BadRequestException('pipelineConfig должен быть объектом для задачи обработки')
        }

        const cfg = pipelineConfig as Record<string, unknown>
        if (!Array.isArray(cfg.steps)) {
            throw new BadRequestException('pipelineConfig.steps должен быть массивом для задачи обработки')
        }

        const rawFormats = cfg.exportFormats ?? ['parquet']
        if (!Array.isArray(rawFormats) || rawFormats.length === 0) {
            throw new BadRequestException('pipelineConfig.exportFormats должен быть непустым массивом')
        }

        const exportFormats: string[] = []
        for (const raw of rawFormats) {
            if (typeof raw !== 'string') {
                throw new BadRequestException('pipelineConfig.exportFormats должен содержать строки')
            }
            const fmt = raw.trim().toLowerCase()
            if (!ALLOWED_EXPORT_FORMATS.has(fmt)) {
                throw new BadRequestException(`Неподдерживаемый формат экспорта: ${raw}`)
            }
            if (!exportFormats.includes(fmt)) exportFormats.push(fmt)
        }

        if (exportFormats.length === 0) {
            throw new BadRequestException('pipelineConfig.exportFormats должен быть непустым массивом')
        }

        return { ...cfg, exportFormats }
    }

    async cancelJob(jobId: string, userId: number): Promise<void> {
        await this.getJob(jobId, userId)
        await this.pool.query(
            `UPDATE processing_jobs
             SET status = 'cancelled', finished_at = now()
             WHERE id = $1 AND status IN ('queued', 'running')`,
            [jobId],
        )
    }

    async getJobArtifacts(jobId: string, userId: number): Promise<unknown[]> {
        await this.getJob(jobId, userId)

        const res = await this.pool.query(
            `SELECT id,
                    job_id         AS "jobId",
                    artifact_type  AS "artifactType",
                    format,
                    s3_key         AS "s3Key",
                    size_bytes     AS "sizeBytes",
                    created_at     AS "createdAt"
             FROM artifacts
             WHERE job_id = $1
             ORDER BY created_at ASC`,
            [jobId],
        )
        return res.rows
    }
}
