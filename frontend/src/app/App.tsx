import { ThemeProvider, CssBaseline } from '@mui/material'
import { theme } from './theme'
import { RouterProvider } from 'react-router-dom'
import { router } from './router'
import { NotifyProvider } from '@shared/lib'


// Функция App


export const App = () => {
    return (
        <ThemeProvider theme={theme}>
            <CssBaseline />
            <NotifyProvider>
                <RouterProvider router={router} />
            </NotifyProvider>
        </ThemeProvider>
    )
}
