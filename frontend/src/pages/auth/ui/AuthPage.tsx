import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import axios from 'axios'
import {
    Box,
    Button,
    Container,
    TextField,
    Typography,
    Paper,
    Alert,
} from '@mui/material'

export const AuthPage = () => {
    const [login, setLogin] = useState('')
    const [password, setPassword] = useState('')
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const navigate = useNavigate()

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        setError(null)

        setLoading(true)

        try {
            await axios.post('/api/auth/login', { login, password })
            navigate('/', { replace: true })
        } catch (err: any) {
            const msg = err?.response?.data?.message || err.message || 'Ошибка авторизации'
            setError(msg)
        } finally {
            setLoading(false)
        }
    }

    return (
        <Box sx={{ minHeight: '100vh', bgcolor: 'background.default', display: 'flex', alignItems: 'center' }}>
            <Container maxWidth="xs">
                <Paper elevation={3} sx={{ p: 4, borderRadius: 3 }}>
                    <Box sx={{ textAlign: 'center', mb: 3 }}>
                        <Typography variant="h5" fontWeight={700} gutterBottom>
                            Авторизация
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                            Регистрация новых пользователей выполняется администратором.
                        </Typography>
                    </Box>

                    {error && (
                        <Alert severity="error" sx={{ mb: 2 }}>
                            {error}
                        </Alert>
                    )}

                    <Box component="form" onSubmit={handleSubmit} sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                        <TextField
                            label="Логин"
                            value={login}
                            onChange={(e) => setLogin(e.target.value)}
                            fullWidth
                            size="small"
                            required
                            autoFocus
                        />

                        <TextField
                            label="Пароль"
                            type="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            fullWidth
                            size="small"
                            required
                        />

                        <Button
                            type="submit"
                            variant="contained"
                            fullWidth
                            disabled={loading}
                            sx={{ mt: 1 }}
                        >
                            Войти
                        </Button>
                    </Box>
                </Paper>
            </Container>
        </Box>
    )
}
