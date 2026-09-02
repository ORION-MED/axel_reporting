import { Module } from '@nestjs/common'
import { APP_GUARD } from '@nestjs/core'
import { JwtModule } from '@nestjs/jwt'
import { AuthService } from './auth.service'
import { AuthController } from './auth.controller'
import { JwtAuthGuard } from './jwt-auth.guard'
import { UserModule } from '../user/user.module'

@Module({
    imports: [
        UserModule,
        JwtModule.register({
            global: true,
            secret: (() => {
                const s = process.env.JWT_SECRET
                if (!s) throw new Error('JWT_SECRET environment variable is required')
                return s
            })(),
            signOptions: { expiresIn: '24h' },
        }),
    ],
    controllers: [AuthController],
    providers: [
        AuthService,
        JwtAuthGuard,
        {
            provide: APP_GUARD,
            useExisting: JwtAuthGuard,
        },
    ],
})
export class AuthModule { }
