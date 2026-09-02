import type { Migration } from '../migration.types'
import { ensureSeedAdmin } from '../ensure-seed-admin'

export const migration: Migration = {
        id: 3,
        name: 'seed_admin_user',
        up: async (client) => ensureSeedAdmin(client, {
            markSkippedWhenMissing: true,
            bumpTokenVersionOnPasswordChange: false,
        }),
}
