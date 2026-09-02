import { Module } from '@nestjs/common'
import { ArtifactsController } from './artifacts.controller'
import { ArtifactsService } from './artifacts.service'
import { S3StorageService } from '../storage/s3.service'

@Module({
    controllers: [ArtifactsController],
    providers: [ArtifactsService, S3StorageService],
})
export class ArtifactsModule {}
