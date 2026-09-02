import { useState } from 'react'
import {
    Alert,
    Box,
    Button,
    Container,
    Paper,
    TextField,
    Typography,
} from '@mui/material'
import axios from 'axios'

export const SettingsPage = () => {
    const [currentPassword, setCurrentPassword] = useState('')
    const [newPassword, setNewPassword] = useState('')
    const [repeatPassword, setRepeatPassword] = useState('')
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [success, setSuccess] = useState(false)

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        setError(null)
        setSuccess(false)

        if (!newPassword || newPassword.length < 6) {
            setError('Новый пароль должен содержать не менее 6 символов')
            return
        }
        if (newPassword !== repeatPassword) {
            setError('Новый пароль и подтверждение не совпадают')
            return
        }

        try {
            setLoading(true)
            await axios.post('/api/auth/change-password', {
                currentPassword,
                newPassword,
            })
            setSuccess(true)
            setCurrentPassword('')
            setNewPassword('')
            setRepeatPassword('')
        } catch (err: any) {
            setError(
                err?.response?.data?.message || err.message || 'Не удалось сменить пароль',
            )
        } finally {
            setLoading(false)
        }
    }

    return (
        <Box sx={{ py: 3, px: 2, bgcolor: 'background.default', minHeight: '100%' }}>
            <Container maxWidth="sm">
                <Paper elevation={2} sx={{ p: 3, borderRadius: 3 }}>
                    <Typography variant="h6" fontWeight={600} gutterBottom>
                        Настройки аккаунта
                    </Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                        Здесь вы можете изменить пароль от своей учётной записи.
                    </Typography>

                    {error && (
                        <Alert severity="error" sx={{ mb: 2 }}>
                            {error}
                        </Alert>
                    )}
                    {success && (
                        <Alert severity="success" sx={{ mb: 2 }}>
                            Пароль успешно изменён
                        </Alert>
                    )}

                    <Box
                        component="form"
                        onSubmit={handleSubmit}
                        sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}
                    >
                        <TextField
                            label="Текущий пароль"
                            type="password"
                            size="small"
                            fullWidth
                            value={currentPassword}
                            onChange={(e) => setCurrentPassword(e.target.value)}
                            required
                        />
                        <TextField
                            label="Новый пароль"
                            type="password"
                            size="small"
                            fullWidth
                            value={newPassword}
                            onChange={(e) => setNewPassword(e.target.value)}
                            required
                        />
                        <TextField
                            label="Повторите новый пароль"
                            type="password"
                            size="small"
                            fullWidth
                            value={repeatPassword}
                            onChange={(e) => setRepeatPassword(e.target.value)}
                            required
                        />

                        <Button
                            type="submit"
                            variant="contained"
                            fullWidth
                            disabled={loading}
                        >
                            Изменить пароль
                        </Button>
                    </Box>
                </Paper>
            </Container>
        </Box>
    )
}
