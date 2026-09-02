import { Module } from '@nestjs/common'
import { PublicationService } from './publication.service'
import { PublicationController } from './publication.controller'
import { S3StorageService } from '../storage/s3.service'

@Module({
    providers: [PublicationService, S3StorageService],
    controllers: [PublicationController],
})
export class PublicationModule { }
