import { Injectable, Inject, NotFoundException, ForbiddenException } from '@nestjs/common'
import { Pool } from 'pg'
import { S3StorageService } from '../storage/s3.service'
import { APP_DB_POOL } from '../database/database.tokens'
import type { Readable } from 'stream'

export interface Artifact {
    id: string
    jobId: string
    artifactType: string
    format: string
    s3Key: string
    sizeBytes: number | null
    createdAt: string
}

@Injectable()
export class ArtifactsService {
    constructor(
        @Inject(APP_DB_POOL) private readonly pool: Pool,
        private readonly s3: S3StorageService,
    ) {}

    async getArtifact(artifactId: string, userId: number): Promise<Artifact> {
        const res = await this.pool.query(
            `SELECT a.id,
                    a.job_id        AS "jobId",
                    a.artifact_type AS "artifactType",
                    a.format,
                    a.s3_key        AS "s3Key",
                    a.size_bytes    AS "sizeBytes",
                    a.created_at    AS "createdAt",
                    j.user_id       AS "ownerUserId"
             FROM artifacts a
             JOIN processing_jobs j ON j.id = a.job_id
             WHERE a.id = $1`,
            [artifactId],
        )
        const row = res.rows[0]
        if (!row) throw new NotFoundException('Артефакт не найден')
        if (row.ownerUserId !== userId) throw new ForbiddenException('Нет доступа к артефакту')

        const { ownerUserId: _, ...artifact } = row
        return artifact as Artifact
    }

    async getArtifactStream(artifactId: string, userId: number): Promise<{ stream: Readable; artifact: Artifact }> {
        const artifact = await this.getArtifact(artifactId, userId)
        const stream = await this.s3.getObjectStream(artifact.s3Key)
        return { stream, artifact }
    }
}
