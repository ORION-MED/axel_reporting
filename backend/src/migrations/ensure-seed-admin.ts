import * as bcrypt from 'bcryptjs'

export async function ensureSeedAdmin(
    client: any,
    options: {
        markSkippedWhenMissing?: boolean
        bumpTokenVersionOnPasswordChange?: boolean
    } = {},
): Promise<boolean> {
    const seedPassword = process.env.SEED_ADMIN_PASSWORD
    if (!seedPassword) {
        // eslint-disable-next-line no-console
        console.log('SEED_ADMIN_PASSWORD is not set; admin seed skipped')
        return !options.markSkippedWhenMissing
    }

    const login = 'admin'
    const email = 'admin@mail.com'
    const roleColumnRes = await client.query(`
        SELECT EXISTS (
            SELECT 1
            FROM information_schema.columns
            WHERE table_name = 'users'
              AND column_name = 'role'
        ) AS exists;
    `)
    const hasRoleColumn = Boolean(roleColumnRes.rows[0]?.exists)
    const existingRes = await client.query(
        hasRoleColumn
            ? 'SELECT id, email, password_hash AS "passwordHash", role FROM users WHERE login = $1'
            : 'SELECT id, email, password_hash AS "passwordHash" FROM users WHERE login = $1',
        [login],
    )
    const existing = existingRes.rows[0]

    if (!existing) {
        const passwordHash = await bcrypt.hash(seedPassword, 10)
        if (hasRoleColumn) {
            await client.query(
                'INSERT INTO users (login, email, password_hash, role) VALUES ($1, $2, $3, $4)',
                [login, email, passwordHash, 'admin'],
            )
        } else {
            await client.query(
                'INSERT INTO users (login, email, password_hash) VALUES ($1, $2, $3)',
                [login, email, passwordHash],
            )
        }
        // eslint-disable-next-line no-console
        console.log('Seed admin user created')
        return true
    }

    const passwordMatches = await bcrypt.compare(seedPassword, existing.passwordHash)
    const emailMatches = existing.email === email
    const roleMatches = !hasRoleColumn || existing.role === 'admin'
    if (passwordMatches && emailMatches && roleMatches) {
        // eslint-disable-next-line no-console
        console.log('Seed admin user is up to date')
        return true
    }

    const nextPasswordHash = passwordMatches
        ? existing.passwordHash
        : await bcrypt.hash(seedPassword, 10)

    if (options.bumpTokenVersionOnPasswordChange === false || passwordMatches) {
        await client.query(
            `
            UPDATE users
            SET email = $2,
                password_hash = $3
                ${hasRoleColumn ? ", role = 'admin'" : ''}
            WHERE login = $1
            `,
            [login, email, nextPasswordHash],
        )
    } else {
        await client.query(
            `
            UPDATE users
            SET email = $2,
                password_hash = $3,
                token_version = token_version + 1
                ${hasRoleColumn ? ", role = 'admin'" : ''}
            WHERE login = $1
            `,
            [login, email, nextPasswordHash],
        )
    }
    // eslint-disable-next-line no-console
    console.log(passwordMatches ? 'Seed admin email synchronized' : 'Seed admin password synchronized')
    return true
}
