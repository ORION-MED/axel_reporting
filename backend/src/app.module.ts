import { Module } from '@nestjs/common'
import { UploadModule } from './upload/upload.module'
import { DatabaseModule } from './database/database.module'
import { AppDatabaseModule } from './database/app-database.module'
import { AuthModule } from './auth/auth.module'
import { UserModule } from './user/user.module'
import { PublicationModule } from './publication/publication.module'
import { SupportModule } from './support/support.module'
import { JobsModule } from './jobs/jobs.module'
import { ArtifactsModule } from './artifacts/artifacts.module'
import { ReportingModule } from './reporting/reporting.module'

@Module({
    imports: [
        AppDatabaseModule,
        AuthModule,
        UserModule,
        UploadModule,
        DatabaseModule,
        PublicationModule,
        SupportModule,
        JobsModule,
        ArtifactsModule,
        ReportingModule,
    ],
})
export class AppModule {}
