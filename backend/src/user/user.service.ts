import { Injectable, Inject, ConflictException, InternalServerErrorException, NotFoundException, UnauthorizedException } from '@nestjs/common'
import { Pool } from 'pg'
import * as bcrypt from 'bcryptjs'
import { User } from './user.entity'
import { APP_DB_POOL } from '../database/database.tokens'

// Pre-computed at startup so non-existent-user logins take the same time as existing ones.
const BCRYPT_DUMMY_HASH = bcrypt.hashSync('__non_existent_user_sentinel__', 10)

@Injectable()
export class UserService {
    constructor(@Inject(APP_DB_POOL) private readonly pool: Pool) {}

    async findByLogin(login: string): Promise<User | null> {
        const res = await this.pool.query(
            'SELECT id, login, email, password_hash as "passwordHash", created_at as "createdAt", bio, token_version as "tokenVersion", role FROM users WHERE login = $1',
            [login],
        )
        return res.rows[0] || null
    }

    async findById(id: number): Promise<User | null> {
        const res = await this.pool.query(
            'SELECT id, login, email, password_hash as "passwordHash", created_at as "createdAt", bio, token_version as "tokenVersion", role FROM users WHERE id = $1',
            [id],
        )
        return res.rows[0] || null
    }

    async incrementTokenVersion(id: number): Promise<void> {
        await this.pool.query('UPDATE users SET token_version = token_version + 1 WHERE id = $1', [id])
    }

    async createUser(login: string, email: string, password: string): Promise<User> {
        const existing = await this.pool.query(
            'SELECT 1 FROM users WHERE login = $1 OR email = $2',
            [login, email],
        )
        if (existing.rowCount > 0) {
            throw new ConflictException('Пользователь с таким логином или почтой уже существует')
        }

        const hash = await bcrypt.hash(password, 10)

        try {
            const res = await this.pool.query(
                'INSERT INTO users (login, email, password_hash, bio, role) VALUES ($1, $2, $3, $4, $5) RETURNING id, login, email, password_hash as "passwordHash", created_at as "createdAt", bio, token_version as "tokenVersion", role',
                [login, email, hash, '', 'user'],
            )
            return res.rows[0]
        } catch (err: unknown) {
            // На случай гонки по уникальным индексам
            if ((err as { code?: string }).code === '23505') {
                throw new ConflictException('Пользователь с таким логином или почтой уже существует')
            }
            throw new InternalServerErrorException('Не удалось создать пользователя')
        }
    }

    async validateCredentials(login: string, password: string): Promise<User | null> {
        const user = await this.findByLogin(login)
        const hash = user?.passwordHash ?? BCRYPT_DUMMY_HASH
        const ok = await bcrypt.compare(password, hash)
        if (!ok || !user) return null
        return user
    }

    async updateProfile(userId: number, bio: string): Promise<User> {
        const res = await this.pool.query(
            'UPDATE users SET bio = $1 WHERE id = $2 RETURNING id, login, email, password_hash as "passwordHash", created_at as "createdAt", bio, token_version as "tokenVersion", role',
            [bio, userId],
        )
        if (res.rowCount === 0) {
            throw new NotFoundException('Пользователь не найден')
        }
        return res.rows[0]
    }

    async changePassword(userId: number, currentPassword: string, newPassword: string): Promise<void> {
        const user = await this.findById(userId)
        if (!user) {
            throw new NotFoundException('Пользователь не найден')
        }

        const ok = await bcrypt.compare(currentPassword, user.passwordHash)
        if (!ok) {
            throw new UnauthorizedException('Текущий пароль неверный')
        }

        const hash = await bcrypt.hash(newPassword, 10)

        await this.pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, userId])
    }
}
