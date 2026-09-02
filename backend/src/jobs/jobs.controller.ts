import {
    Controller,
    Get,
    Post,
    Delete,
    Param,
    Body,
    Req,
    HttpCode,
    HttpStatus,
    BadRequestException,
    NotFoundException,
    Sse,
    MessageEvent,
    Header,
} from '@nestjs/common'
import { Request } from 'express'
import { Observable, timer, from, of } from 'rxjs'
import { switchMap, takeWhile, map, catchError } from 'rxjs/operators'
import { JobsService } from './jobs.service'
import type { AuthTokenPayload } from '../auth/auth.service'

@Controller()
export class JobsController {
    constructor(private readonly jobsService: JobsService) {}

    @Get('jobs/:id')
    async getJob(@Param('id') id: string, @Req() req: Request) {
        const userId = this.extractUserId(req)
        return this.jobsService.getJob(id, userId)
    }

    @Sse('jobs/:id/events')
    @Header('X-Accel-Buffering', 'no')
    streamJobEvents(
        @Param('id') id: string,
        @Req() req: Request,
    ): Observable<MessageEvent> {
        const userId = this.extractUserId(req)
        const terminal = new Set(['completed', 'failed', 'cancelled'])
        return timer(0, 500).pipe(
            switchMap(() => from(this.jobsService.getJob(id, userId))),
            takeWhile((job) => !terminal.has(job.status), true),
            map((job): MessageEvent => ({
                data: {
                    id: job.id,
                    status: job.status,
                    progressPercent: job.progressPercent,
                    errorMessage: job.errorMessage,
                },
            })),
            catchError((err) => {
                const status = err instanceof NotFoundException ? 'not_found' : 'error'
                return of({ data: { status } } as MessageEvent)
            }),
        )
    }

    @Delete('jobs/:id')
    @HttpCode(HttpStatus.NO_CONTENT)
    async cancelJob(@Param('id') id: string, @Req() req: Request) {
        const userId = this.extractUserId(req)
        await this.jobsService.cancelJob(id, userId)
    }

    @Get('jobs/:id/artifacts')
    async getJobArtifacts(@Param('id') id: string, @Req() req: Request) {
        const userId = this.extractUserId(req)
        return this.jobsService.getJobArtifacts(id, userId)
    }

    @Get('uploads/:uploadId/jobs')
    async listJobsForUpload(@Param('uploadId') uploadId: string, @Req() req: Request) {
        const userId = this.extractUserId(req)
        return this.jobsService.listJobsForUpload(uploadId, userId)
    }

    @Post('uploads/:uploadId/jobs')
    @HttpCode(HttpStatus.CREATED)
    async createJob(
        @Param('uploadId') uploadId: string,
        @Body() body: { jobType: string; pipelineConfig?: unknown },
        @Req() req: Request,
    ) {
        if (!body.jobType) throw new BadRequestException('jobType обязателен')
        const userId = this.extractUserId(req)
        return this.jobsService.createJob(
            { uploadId, jobType: body.jobType, pipelineConfig: body.pipelineConfig },
            userId,
        )
    }

    private extractUserId(req: Request): number {
        return ((req as any).user as AuthTokenPayload).sub
    }
}
