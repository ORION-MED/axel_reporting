import 'reflect-metadata'
import { Test, TestingModule } from '@nestjs/testing'
import { ConflictException } from '@nestjs/common'
import * as bcrypt from 'bcryptjs'
import { UserService } from './user.service'
import { APP_DB_POOL } from '../database/database.tokens'

describe('UserService', () => {
    let service: UserService
    let pool: { query: jest.Mock }

    beforeEach(async () => {
        pool = { query: jest.fn() }
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                UserService,
                { provide: APP_DB_POOL, useValue: pool },
            ],
        }).compile()
        service = module.get<UserService>(UserService)
    })

    afterEach(() => jest.restoreAllMocks())

    describe('validateCredentials', () => {
        it('runs bcrypt.compare even when user does not exist', async () => {
            pool.query.mockResolvedValue({ rows: [] })
            const spy = jest.spyOn(bcrypt, 'compare')
            const result = await service.validateCredentials('ghost', 'anypass1')
            expect(result).toBeNull()
            expect(spy).toHaveBeenCalledTimes(1)
        })

        it('returns null for wrong password', async () => {
            const hash = await bcrypt.hash('right1pass', 10)
            pool.query.mockResolvedValue({
                rows: [{ id: 1, login: 'alice', email: 'a@a.com', passwordHash: hash, createdAt: new Date(), bio: '', tokenVersion: 0 }],
            })
            expect(await service.validateCredentials('alice', 'wrong1pass')).toBeNull()
        })

        it('returns user for correct credentials', async () => {
            const hash = await bcrypt.hash('right1pass', 10)
            pool.query.mockResolvedValue({
                rows: [{ id: 1, login: 'alice', email: 'a@a.com', passwordHash: hash, createdAt: new Date(), bio: '', tokenVersion: 0 }],
            })
            const user = await service.validateCredentials('alice', 'right1pass')
            expect(user?.login).toBe('alice')
        })
    })

    describe('createUser', () => {
        it('throws ConflictException when login or email is already taken', async () => {
            pool.query.mockResolvedValueOnce({ rowCount: 1 })
            await expect(service.createUser('alice', 'a@a.com', 'pass1234')).rejects.toThrow(ConflictException)
        })
    })
})
