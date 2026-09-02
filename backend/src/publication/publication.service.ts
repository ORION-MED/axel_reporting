import { Injectable, Inject, BadRequestException, ForbiddenException, InternalServerErrorException } from '@nestjs/common'
import { Pool } from 'pg'
import { S3StorageService } from '../storage/s3.service'
import { APP_DB_POOL } from '../database/database.tokens'

interface S3WorkspaceRef { s3Key: string }

export interface PublicationRow {
    id: number
    title: string
    description: string
    tags: string[]
    createdAt: string
    updatedAt: string
    ownerLogin: string
    isPublic: boolean
}

export interface PublicationWithState extends PublicationRow {
    workspaceState: unknown
}

export interface UpdatePublicationFields {
    title?: string
    description?: string
    tags?: string[]
}

@Injectable()
export class PublicationService {
    private static readonly PRESIGN_EXPIRES_SEC = 300

    constructor(
        @Inject(APP_DB_POOL) private readonly pool: Pool,
        private readonly s3: S3StorageService,
    ) {}

    presignWorkspaceUpload(ownerUserId: number): Promise<{ uploadUrl: string; s3Key: string }> {
        const s3Key = `publications/${ownerUserId}/${Date.now()}-${Math.random().toString(36).slice(2)}.json`
        return this.s3
            .getPresignedPutUrl(s3Key, 'application/json', PublicationService.PRESIGN_EXPIRES_SEC)
            .then((uploadUrl) => ({ uploadUrl, s3Key }))
    }

    private async validatePreUploadedWorkspaceKey(ownerUserId: number, s3Key: string): Promise<void> {
        const expectedPrefix = `publications/${ownerUserId}/`
        if (!s3Key.startsWith(expectedPrefix) || !s3Key.endsWith('.json')) {
            throw new ForbiddenException('Недопустимый ключ workspaceState')
        }
        const exists = await this.s3.objectExists(s3Key)
        if (!exists) {
            throw new BadRequestException('Загруженный workspaceState не найден')
        }
    }

    async createPublication(
        ownerUserId: number,
        title: string,
        description: string,
        tags: string[],
        workspaceStateOrS3Key: unknown | { _preUploadedS3Key: string },
    ): Promise<PublicationRow> {
        let uploadedS3Key: string | null = null
        try {
            let storedWorkspaceState: unknown

            const preUploaded = workspaceStateOrS3Key as { _preUploadedS3Key?: string }
            if (preUploaded?._preUploadedS3Key) {
                await this.validatePreUploadedWorkspaceKey(ownerUserId, preUploaded._preUploadedS3Key)
                storedWorkspaceState = { s3Key: preUploaded._preUploadedS3Key }
            } else {
                const key = `publications/${ownerUserId}/${Date.now()}-${Math.random().toString(36).slice(2)}.json`
                await this.s3.uploadJson(key, workspaceStateOrS3Key)
                uploadedS3Key = key
                storedWorkspaceState = { s3Key: key }
            }

            const res = await this.pool.query(
                `
                INSERT INTO publications (owner_user_id, title, description, tags, workspace_state, is_public)
                VALUES ($1, $2, $3, $4, $5, FALSE)
                RETURNING id,
                          title,
                          description,
                          tags,
                          created_at as "createdAt",
                          updated_at as "updatedAt",
                          is_public as "isPublic",
                          (SELECT login FROM users u WHERE u.id = publications.owner_user_id) as "ownerLogin";
                `,
                [ownerUserId, title, description, tags, storedWorkspaceState],
            )
            return res.rows[0]
        } catch (err) {
            if (uploadedS3Key) {
                this.s3.deleteObject(uploadedS3Key).catch(() => {})
            }
            if (err instanceof BadRequestException || err instanceof ForbiddenException) {
                throw err
            }
            throw new InternalServerErrorException('Не удалось сохранить публикацию')
        }
    }

    async updatePublication(
        ownerUserId: number,
        id: number,
        fields: UpdatePublicationFields,
    ): Promise<PublicationRow> {
        const sets: string[] = []
        const values: (string | string[] | number)[] = []

        if (typeof fields.title === 'string') {
            sets.push('title = $' + (values.length + 1))
            values.push(fields.title)
        }
        if (typeof fields.description === 'string') {
            sets.push('description = $' + (values.length + 1))
            values.push(fields.description)
        }
        if (Array.isArray(fields.tags)) {
            sets.push('tags = $' + (values.length + 1))
            values.push(fields.tags)
        }

        if (sets.length === 0) {
            throw new InternalServerErrorException('Нет полей для обновления')
        }

        values.push(id)
        values.push(ownerUserId)

        const res = await this.pool.query(
            `
            UPDATE publications
            SET ${sets.join(', ')}, updated_at = NOW()
            WHERE id = $${values.length - 1} AND owner_user_id = $${values.length}
            RETURNING id,
                      title,
                      description,
                      tags,
                      created_at as "createdAt",
                      updated_at as "updatedAt",
                      is_public as "isPublic",
                      (SELECT login FROM users u WHERE u.id = publications.owner_user_id) as "ownerLogin";
            `,
            values,
        )

        if (res.rowCount === 0) {
            throw new ForbiddenException('Публикация не найдена или вы не являетесь её владельцем')
        }

        return res.rows[0]
    }

    async getLatest(limit: number, offset: number): Promise<PublicationRow[]> {
        const res = await this.pool.query(
            `
            SELECT p.id,
                   p.title,
                   p.description,
                   p.tags,
                   p.created_at as "createdAt",
                   p.updated_at as "updatedAt",
                     p.is_public as "isPublic",
                   u.login as "ownerLogin"
            FROM publications p
            JOIN users u ON u.id = p.owner_user_id
                 WHERE p.is_public = TRUE
            ORDER BY p.created_at DESC
            LIMIT $1 OFFSET $2;
            `,
            [limit, offset],
        )
        return res.rows
    }

    async getMine(ownerUserId: number, tags?: string[]): Promise<PublicationRow[]> {
        const res = await this.pool.query(
            `SELECT p.id,
                    p.title,
                    p.description,
                    p.tags,
                    p.created_at as "createdAt",
                    p.updated_at as "updatedAt",
                    p.is_public as "isPublic",
                    u.login as "ownerLogin"
             FROM publications p
             JOIN users u ON u.id = p.owner_user_id
             WHERE p.owner_user_id = $1
               AND ($2::text[] IS NULL OR p.tags && $2::text[])
             ORDER BY p.created_at DESC`,
            [ownerUserId, tags?.length ? tags : null],
        )
        return res.rows
    }

    async getById(id: number): Promise<(PublicationWithState & { ownerUserId: number; isPublic: boolean }) | null> {
        const res = await this.pool.query(
            `
            SELECT p.id,
                   p.title,
                   p.description,
                   p.tags,
                   p.created_at as "createdAt",
                   p.updated_at as "updatedAt",
                   p.owner_user_id as "ownerUserId",
                   p.is_public as "isPublic",
                   u.login as "ownerLogin",
                   p.workspace_state as "workspaceState"
            FROM publications p
            JOIN users u ON u.id = p.owner_user_id
            WHERE p.id = $1;
            `,
            [id],
        )
        const row = res.rows[0]
        if (!row) return null

        // Если включён режим S3 и в workspace_state лежит ссылка на ключ — подтягиваем JSON из S3
        const wsRef = row.workspaceState as S3WorkspaceRef | null
        if (wsRef?.s3Key) {
            try {
                row.workspaceState = await this.s3.getJson(wsRef.s3Key)
            } catch {
                // В случае ошибки чтения из S3 просто вернём как есть
            }
        }

        return row
    }

    async setPublicationPublic(ownerUserId: number, id: number, isPublic: boolean): Promise<PublicationRow> {
        const res = await this.pool.query(
            `
            UPDATE publications
            SET is_public = $1, updated_at = NOW()
            WHERE id = $2 AND owner_user_id = $3
            RETURNING id,
                      title,
                      description,
                      tags,
                      created_at as "createdAt",
                      updated_at as "updatedAt",
                      is_public as "isPublic",
                      (SELECT login FROM users u WHERE u.id = publications.owner_user_id) as "ownerLogin";
            `,
            [isPublic, id, ownerUserId],
        )

        if (res.rowCount === 0) {
            throw new ForbiddenException('Публикация не найдена или вы не являетесь её владельцем')
        }

        return res.rows[0]
    }

    async deletePublication(ownerUserId: number, id: number): Promise<void> {
        const res = await this.pool.query(
            'DELETE FROM publications WHERE id = $1 AND owner_user_id = $2 RETURNING workspace_state',
            [id, ownerUserId],
        )
        if (res.rowCount === 0) {
            throw new ForbiddenException('Публикация не найдена или вы не являетесь её владельцем')
        }

        const row = res.rows[0]
        if (row?.workspace_state?.s3Key) {
            try {
                await this.s3.deleteObject(row.workspace_state.s3Key)
            } catch {
                // игнорируем ошибки удаления из S3
            }
        }
    }
}
