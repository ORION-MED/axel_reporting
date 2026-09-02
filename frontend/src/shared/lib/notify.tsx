import { createContext, useContext, useState, useCallback, type ReactNode } from 'react'
import { Snackbar, Alert, type AlertColor } from '@mui/material'

interface NotifyState {
    open: boolean
    message: string
    severity: AlertColor
}

interface NotifyCtx {
    showError: (msg: string) => void
    showSuccess: (msg: string) => void
    showWarning: (msg: string) => void
}

const NotifyContext = createContext<NotifyCtx>({
    showError: () => {},
    showSuccess: () => {},
    showWarning: () => {},
})

export const useNotify = () => useContext(NotifyContext)

export const NotifyProvider = ({ children }: { children: ReactNode }) => {
    const [state, setState] = useState<NotifyState>({ open: false, message: '', severity: 'error' })

    const show = useCallback((message: string, severity: AlertColor) => {
        setState({ open: true, message, severity })
    }, [])

    const showError = useCallback((msg: string) => show(msg, 'error'), [show])
    const showSuccess = useCallback((msg: string) => show(msg, 'success'), [show])
    const showWarning = useCallback((msg: string) => show(msg, 'warning'), [show])

    const handleClose = useCallback(() => setState((s) => ({ ...s, open: false })), [])

    return (
        <NotifyContext.Provider value={{ showError, showSuccess, showWarning }}>
            {children}
            <Snackbar
                open={state.open}
                autoHideDuration={6000}
                onClose={handleClose}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
            >
                <Alert
                    onClose={handleClose}
                    severity={state.severity}
                    variant="filled"
                    sx={{ minWidth: 300, maxWidth: 600 }}
                >
                    {state.message}
                </Alert>
            </Snackbar>
        </NotifyContext.Provider>
    )
}
