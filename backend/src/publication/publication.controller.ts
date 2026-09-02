import {
    BadRequestException,
    ForbiddenException,
    Body,
    Controller,
    Delete,
    Get,
    Param,
    ParseIntPipe,
    Post,
    Query,
    Req,
    Patch,
} from '@nestjs/common'
import { Request } from 'express'
import { PublicationService } from './publication.service'
import { AuthTokenPayload } from '../auth/auth.service'

interface CreatePublicationDto {
    title: string
    description?: string
    tags?: string[]
    workspaceState?: unknown
    s3Key?: string
}

interface UpdatePublicationDto {
    title?: string
    description?: string
    tags?: string[]
}

@Controller('publications')
export class PublicationController {
    constructor(private readonly publications: PublicationService) { }

    @Post('presign')
    async presign(@Req() req: Request) {
        const payload = (req as any).user as AuthTokenPayload | undefined
        if (!payload) throw new BadRequestException('Необходима авторизация')
        return this.publications.presignWorkspaceUpload(payload.sub)
    }

    @Post()
    async create(@Body() body: CreatePublicationDto, @Req() req: Request) {
        const payload = (req as any).user as AuthTokenPayload | undefined
        if (!payload) {
            throw new BadRequestException('Необходима авторизация')
        }

        const title = (body.title || '').trim()
        const description = (body.description || '').trim()
        const tags = Array.isArray(body.tags)
            ? body.tags.map((t) => t.trim()).filter((t) => t.length > 0)
            : []

        if (!title) {
            throw new BadRequestException('Укажите заголовок публикации')
        }
        if (title.length < 3 || title.length > 200) {
            throw new BadRequestException('Заголовок должен быть от 3 до 200 символов')
        }
        if (!body.s3Key && !body.workspaceState) {
            throw new BadRequestException('Необходимо передать s3Key или workspaceState')
        }

        const workspaceArg = body.s3Key
            ? { _preUploadedS3Key: body.s3Key }
            : body.workspaceState

        const pub = await this.publications.createPublication(
            payload.sub,
            title,
            description,
            tags,
            workspaceArg,
        )
        return pub
    }

    @Get()
    async latest(@Query('limit') limitQ?: string, @Query('offset') offsetQ?: string) {
        const limit = Math.min(Math.max(Number(limitQ) || 4, 1), 40)
        const offset = Math.max(Number(offsetQ) || 0, 0)
        return this.publications.getLatest(limit, offset)
    }

    @Get('mine')
    async mine(@Req() req: Request, @Query('tags') tagsQ?: string) {
        const payload = (req as any).user as AuthTokenPayload | undefined
        if (!payload) {
            throw new BadRequestException('Необходима авторизация')
        }

        const tags = tagsQ
            ? tagsQ
                .split(',')
                .map((t) => t.trim())
                .filter((t) => t.length > 0)
            : undefined

        return this.publications.getMine(payload.sub, tags)
    }

    @Get(':id')
    async byId(@Param('id', ParseIntPipe) id: number, @Req() req: Request) {
        const pub = await this.publications.getById(id)
        if (!pub) {
            throw new BadRequestException('Публикация не найдена')
        }
        const payload = (req as any).user as AuthTokenPayload | undefined
        if (!pub.isPublic && payload?.sub !== pub.ownerUserId) {
            throw new ForbiddenException('Публикация недоступна')
        }
        return pub
    }

    @Post(':id/publish')
    async publish(@Param('id', ParseIntPipe) id: number, @Req() req: Request) {
        const payload = (req as any).user as AuthTokenPayload | undefined
        if (!payload) {
            throw new BadRequestException('Необходима авторизация')
        }
        return this.publications.setPublicationPublic(payload.sub, id, true)
    }

    @Post(':id/unpublish')
    async unpublish(@Param('id', ParseIntPipe) id: number, @Req() req: Request) {
        const payload = (req as any).user as AuthTokenPayload | undefined
        if (!payload) {
            throw new BadRequestException('Необходима авторизация')
        }
        return this.publications.setPublicationPublic(payload.sub, id, false)
    }

    @Patch(':id')
    async update(
        @Param('id', ParseIntPipe) id: number,
        @Body() body: UpdatePublicationDto,
        @Req() req: Request,
    ) {
        const payload = (req as any).user as AuthTokenPayload | undefined
        if (!payload) {
            throw new BadRequestException('Необходима авторизация')
        }

        const hasTitle = typeof body.title === 'string'
        const hasDescription = typeof body.description === 'string'
        const hasTags = Array.isArray(body.tags)
        if (!hasTitle && !hasDescription && !hasTags) {
            throw new BadRequestException('Нет данных для обновления')
        }

        const update: UpdatePublicationDto = {}

        if (hasTitle) {
            const t = (body.title || '').trim()
            if (!t) {
                throw new BadRequestException('Заголовок не может быть пустым')
            }
            if (t.length < 3 || t.length > 200) {
                throw new BadRequestException('Заголовок должен быть от 3 до 200 символов')
            }
            update.title = t
        }

        if (hasDescription) {
            update.description = (body.description || '').trim()
        }

        if (hasTags) {
            update.tags = body.tags
                ?.map((t) => (t || '').trim())
                .filter((t) => t.length > 0)
        }

        const pub = await this.publications.updatePublication(payload.sub, id, update)
        return pub
    }

    @Delete(':id')
    async remove(@Param('id', ParseIntPipe) id: number, @Req() req: Request) {
        const payload = (req as any).user as AuthTokenPayload | undefined
        if (!payload) {
            throw new BadRequestException('Необходима авторизация')
        }

        await this.publications.deletePublication(payload.sub, id)
        return { success: true }
    }
}
