import type { TableState } from '@shared/types'

const STATES_KEY = 'dashboard:tableStates'
const ACTIVE_KEY = 'dashboard:activeTableId'

export const lsStorage = {

    getTableStates(): TableState[] {
        try {
            const raw = localStorage.getItem(STATES_KEY)
            return raw ? (JSON.parse(raw) as TableState[]) : []
        } catch {
            return []
        }
    },


    setTableStates(states: TableState[]): void {
        localStorage.setItem(STATES_KEY, JSON.stringify(states))
    },


    upsertTableState(state: TableState): void {
        const states = lsStorage.getTableStates()
        // Функция idx
        const idx = states.findIndex((s) => s.id === state.id)
        if (idx >= 0) {
            states[idx] = state
        } else {
            states.push(state)
        }
        lsStorage.setTableStates(states)
    },


    removeTableState(id: string): void {
        // Функция states
        const states = lsStorage.getTableStates().filter((s) => s.id !== id)
        lsStorage.setTableStates(states)
    },


    getActiveTableId(): string | null {
        return localStorage.getItem(ACTIVE_KEY)
    },


    setActiveTableId(id: string | null): void {
        if (id) {
            localStorage.setItem(ACTIVE_KEY, id)
        } else {
            localStorage.removeItem(ACTIVE_KEY)
        }
    },
}
