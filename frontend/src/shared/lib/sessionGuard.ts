import { lsStorage } from './localStorage'
import { idbStorage } from './idb'

const SESSION_KEY = 'dashboard:tab_alive'


export async function sessionGuard(): Promise<void> {
    const isAlive = sessionStorage.getItem(SESSION_KEY)

    if (!isAlive) {

        lsStorage.setTableStates([])
        lsStorage.setActiveTableId(null)
        await idbStorage.clear()
    }


    sessionStorage.setItem(SESSION_KEY, '1')
}
