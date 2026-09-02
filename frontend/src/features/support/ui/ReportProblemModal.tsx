import { useEffect, useMemo, useState } from 'react'
import { useLocation } from 'react-router-dom'
import axios from 'axios'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import OpenInNewIcon from '@mui/icons-material/OpenInNew'
import {
    Alert,
    Button,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    Snackbar,
    Stack,
    TextField,
    Typography,
} from '@mui/material'
import { SUPPORT_PORTAL_URL } from '@shared/config/support'
import { buildSupportMessage, getSupportContext, type SupportUserInfo } from '@shared/lib/supportContext'

type Props = {
    open: boolean
    onClose: () => void
    sectionName?: string
}

async function copyToClipboard(text: string): Promise<boolean> {
    try {
        if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(text)
            return true
        }
    } catch {
        // fallback below
    }

    try {
        const textarea = document.createElement('textarea')
        textarea.value = text
        textarea.setAttribute('readonly', 'true')
        textarea.style.position = 'absolute'
        textarea.style.left = '-9999px'
        document.body.appendChild(textarea)
        textarea.select()
        const copied = document.execCommand('copy')
        document.body.removeChild(textarea)
        return copied
    } catch {
        return false
    }
}

export const ReportProblemModal = ({ open, onClose, sectionName }: Props) => {
    const location = useLocation()
    const [user, setUser] = useState<SupportUserInfo | null>(null)
    const [snackbar, setSnackbar] = useState<{ open: boolean; severity: 'success' | 'error'; message: string }>({
        open: false,
        severity: 'success',
        message: '',
    })

    useEffect(() => {
        if (!open) return

        let cancelled = false

        axios.get('/api/auth/me')
            .then(({ data }) => {
                if (!cancelled) {
                    setUser(data)
                }
            })
            .catch(() => {
                if (!cancelled) {
                    setUser(null)
                }
            })

        return () => {
            cancelled = true
        }
    }, [open])

    const message = useMemo(() => {
        if (!open) return ''

        return buildSupportMessage(
            getSupportContext({
                sectionName,
                pathname: location.pathname,
                user,
            }),
        )
    }, [location.pathname, open, sectionName, user])

    const handleCopy = async () => {
        const copied = await copyToClipboard(message)
        setSnackbar({
            open: true,
            severity: copied ? 'success' : 'error',
            message: copied ? 'Описание скопировано в буфер обмена.' : 'Не удалось скопировать описание.',
        })
    }

    const handleOpenSupport = () => {
        window.open(SUPPORT_PORTAL_URL, '_blank', 'noopener,noreferrer')
    }

    return (
        <>
            <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
                <DialogTitle>Сообщить о проблеме</DialogTitle>
                <DialogContent dividers>
                    <Stack spacing={2}>
                        <Typography variant="body2" color="text.secondary">
                            Приложение подготовило шаблон обращения. Скопируйте описание, затем перейдите в поддержку и вставьте его в заявку.
                        </Typography>

                        <TextField
                            value={message}
                            multiline
                            minRows={14}
                            fullWidth
                            InputProps={{
                                readOnly: true,
                                sx: {
                                    alignItems: 'flex-start',
                                    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, Courier New, monospace',
                                },
                            }}
                        />

                        <Alert severity="info" sx={{ borderRadius: 2 }}>
                            При необходимости дополните шаблон шагами воспроизведения, ожидаемым результатом и скриншотом.
                        </Alert>
                    </Stack>
                </DialogContent>
                <DialogActions sx={{ px: 3, py: 2, flexWrap: 'wrap', gap: 1 }}>
                    <Button onClick={onClose}>Закрыть</Button>
                    <Button variant="outlined" startIcon={<ContentCopyIcon />} onClick={() => void handleCopy()}>
                        Скопировать описание
                    </Button>
                    <Button variant="contained" endIcon={<OpenInNewIcon />} onClick={handleOpenSupport}>
                        Перейти в поддержку
                    </Button>
                </DialogActions>
            </Dialog>

            <Snackbar
                open={snackbar.open}
                autoHideDuration={2500}
                onClose={() => setSnackbar((prev) => ({ ...prev, open: false }))}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
            >
                <Alert
                    severity={snackbar.severity}
                    variant="filled"
                    onClose={() => setSnackbar((prev) => ({ ...prev, open: false }))}
                    sx={{ width: '100%' }}
                >
                    {snackbar.message}
                </Alert>
            </Snackbar>
        </>
    )
}
