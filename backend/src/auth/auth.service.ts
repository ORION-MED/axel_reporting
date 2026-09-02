import { Injectable, UnauthorizedException } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { UserService } from '../user/user.service'
import { User } from '../user/user.entity'

export interface AuthTokenPayload {
    sub: number
    login: string
    email: string
    role: 'admin' | 'user'
    tv: number
}

@Injectable()
export class AuthService {
    constructor(
        private readonly users: UserService,
        private readonly jwt: JwtService,
    ) { }

    async register(login: string, email: string, password: string): Promise<User> {
        return this.users.createUser(login, email, password)
    }

    async login(login: string, password: string): Promise<{ user: User; token: string }> {
        const user = await this.users.validateCredentials(login, password)
        if (!user) {
            throw new UnauthorizedException('Неверный логин или пароль')
        }
        const token = this.signToken(user)
        return { user, token }
    }

    async getUserFromTokenPayload(payload: AuthTokenPayload): Promise<User | null> {
        return this.users.findById(payload.sub)
    }

    async changePassword(userId: number, currentPassword: string, newPassword: string): Promise<void> {
        await this.users.changePassword(userId, currentPassword, newPassword)
        await this.users.incrementTokenVersion(userId)
    }

    async updateProfile(userId: number, bio: string): Promise<User> {
        return this.users.updateProfile(userId, bio)
    }

    async invalidateToken(userId: number): Promise<void> {
        await this.users.incrementTokenVersion(userId)
    }

    private signToken(user: User): string {
        const payload: AuthTokenPayload = {
            sub: user.id,
            login: user.login,
            email: user.email,
            role: user.role,
            tv: user.tokenVersion,
        }
        return this.jwt.sign(payload)
    }
}
