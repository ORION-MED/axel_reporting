import { Fragment, lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { Outlet, NavLink, useLocation, useNavigate } from 'react-router-dom'
import {
    Box,
    IconButton,
    Typography,
    Tooltip,
    Divider,
    Avatar,
    Drawer,
    List,
    ListItemButton,
    ListItemIcon,
    ListItemText,
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    Button,
    TableContainer,
    Table,
    TableHead,
    TableBody,
    TableRow,
    TableCell,
    Paper,
    Link,
} from '@mui/material'
import MenuIcon from '@mui/icons-material/Menu'
import TableChartIcon from '@mui/icons-material/TableChart'
import WorkIcon from '@mui/icons-material/Work'
import StorageIcon from '@mui/icons-material/Storage'
import QueryStatsIcon from '@mui/icons-material/QueryStats'
import DashboardIcon from '@mui/icons-material/Dashboard'
import AssessmentIcon from '@mui/icons-material/Assessment'
import PersonOutlineIcon from '@mui/icons-material/PersonOutline'
import LogoutIcon from '@mui/icons-material/Logout'
import SettingsIcon from '@mui/icons-material/Settings'
import PersonIcon from '@mui/icons-material/Person'
import HelpOutlineIcon from '@mui/icons-material/HelpOutline'
import SupportAgentIcon from '@mui/icons-material/SupportAgent'
import axios from 'axios'
import { USER_GUIDE_ASSET_URLS, USER_GUIDE_MARKDOWN, USER_GUIDE_TITLE } from '@shared/lib/userGuide'

const SIDEBAR_EXPANDED = 220
const SIDEBAR_COLLAPSED = 56
const WorkPage = lazy(() => import('@pages/work').then((m) => ({ default: m.WorkPage })))

interface NavItem {
    label: string
    to: string
    icon: React.ReactNode
}

const NAV_ITEMS: NavItem[] = [
    { label: 'Публикации', to: '/', icon: <StorageIcon fontSize="small" /> },
    { label: 'Рабочее место', to: '/work', icon: <WorkIcon fontSize="small" /> },
    { label: 'Визуализация', to: '/dashboard', icon: <DashboardIcon fontSize="small" /> },
    { label: 'Отчетность', to: '/reporting', icon: <AssessmentIcon fontSize="small" /> },
    { label: 'Статистика', to: '/stats', icon: <QueryStatsIcon fontSize="small" /> },
    { label: 'Базы данных', to: '/database', icon: <TableChartIcon fontSize="small" /> },
    { label: 'Поддержка', to: '/support', icon: <SupportAgentIcon fontSize="small" /> },
]

// Функция Layout

export const Layout = () => {
    const [expanded, setExpanded] = useState(true)
    const [profileOpen, setProfileOpen] = useState(false)
    const [helpOpen, setHelpOpen] = useState(false)
    const [authChecked, setAuthChecked] = useState(false)
    const [user, setUser] = useState<{ login: string; email: string } | null>(null)
    const location = useLocation()
    const navigate = useNavigate()
    const width = expanded ? SIDEBAR_EXPANDED : SIDEBAR_COLLAPSED

    const guideContent = useMemo(() => {
        const renderInline = (text: string) => {
            const tokenRe = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^\)]+\))/g
            const parts = text.split(tokenRe)

            return parts.map((part, idx) => {
                if (!part) return null

                if (part.startsWith('**') && part.endsWith('**')) {
                    return (
                        <Box key={idx} component="strong" sx={{ fontWeight: 700, color: 'text.primary' }}>
                            {part.slice(2, -2)}
                        </Box>
                    )
                }

                if (part.startsWith('`') && part.endsWith('`')) {
                    return (
                        <Box
                            key={idx}
                            component="code"
                            sx={{
                                px: 0.5,
                                py: 0.15,
                                borderRadius: 0.5,
                                bgcolor: 'action.hover',
                                color: 'text.primary',
                                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, Courier New, monospace',
                                fontSize: '0.8rem',
                            }}
                        >
                            {part.slice(1, -1)}
                        </Box>
                    )
                }

                const linkMatch = part.match(/^\[([^\]]+)\]\(([^\)]+)\)$/)
                if (linkMatch) {
                    const label = linkMatch[1]
                    const rawHref = linkMatch[2]
                    const href = USER_GUIDE_ASSET_URLS[rawHref] || rawHref
                    const isExternal = /^https?:\/\//i.test(href)
                    return (
                        <Link
                            key={idx}
                            href={href}
                            target={isExternal ? '_blank' : undefined}
                            rel={isExternal ? 'noreferrer' : undefined}
                            underline="hover"
                            color="primary"
                            sx={{ fontWeight: 500 }}
                        >
                            {label}
                        </Link>
                    )
                }

                return <Fragment key={idx}>{part}</Fragment>
            })
        }

        const lines = USER_GUIDE_MARKDOWN.split('\n')
        const nodes: React.ReactNode[] = []

        for (let i = 0; i < lines.length; i += 1) {
            const line = lines[i].trim()
            if (!line) {
                continue
            }

            const imageMatch = line.match(/^!\[(.*?)]\((.*?)\)$/)
            if (imageMatch) {
                const alt = imageMatch[1] || 'Иллюстрация'
                const rawPath = imageMatch[2]
                const src = USER_GUIDE_ASSET_URLS[rawPath] || rawPath
                nodes.push(
                    <Box key={`img-${i}`} sx={{ my: 1.5 }}>
                        <Box
                            component="img"
                            src={src}
                            alt={alt}
                            sx={{
                                width: '100%',
                                maxWidth: 900,
                                borderRadius: 1,
                                border: '1px solid',
                                borderColor: 'divider',
                                display: 'block',
                            }}
                        />
                        <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
                            {alt}
                        </Typography>
                    </Box>,
                )
                continue
            }

            if (line.startsWith('### ')) {
                nodes.push(
                    <Typography key={`h3-${i}`} variant="subtitle1" fontWeight={700} sx={{ mt: 1.5 }}>
                        {line.slice(4)}
                    </Typography>,
                )
                continue
            }

            if (line.startsWith('## ')) {
                nodes.push(
                    <Typography key={`h2-${i}`} variant="h6" fontWeight={700} sx={{ mt: 2 }}>
                        {line.slice(3)}
                    </Typography>,
                )
                continue
            }

            if (/^\s*-\s+/.test(lines[i])) {
                const items: string[] = []
                let j = i
                while (j < lines.length && /^\s*-\s+/.test(lines[j])) {
                    items.push(lines[j].replace(/^\s*-\s+/, '').trim())
                    j += 1
                }
                nodes.push(
                    <Box key={`ul-${i}`} component="ul" sx={{ m: 0, pl: 2.5, mb: 0.5 }}>
                        {items.map((item, idx) => (
                            <Box key={idx} component="li" sx={{ mb: 0.5 }}>
                                <Typography variant="body2" color="text.secondary" component="span">
                                    {renderInline(item)}
                                </Typography>
                            </Box>
                        ))}
                    </Box>,
                )
                i = j - 1
                continue
            }

            if (/^\d+\.\s+/.test(line)) {
                const items: string[] = []
                let j = i
                while (j < lines.length && /^\d+\.\s+/.test(lines[j].trim())) {
                    items.push(lines[j].trim().replace(/^\d+\.\s+/, ''))
                    j += 1
                }
                nodes.push(
                    <Box key={`ol-${i}`} component="ol" sx={{ m: 0, pl: 2.5, mb: 0.5 }}>
                        {items.map((item, idx) => (
                            <Box key={idx} component="li" sx={{ mb: 0.5 }}>
                                <Typography variant="body2" color="text.secondary" component="span">
                                    {renderInline(item)}
                                </Typography>
                            </Box>
                        ))}
                    </Box>,
                )
                i = j - 1
                continue
            }

            if (line.startsWith('|')) {
                const tableLines: string[] = []
                let j = i
                while (j < lines.length && lines[j].trim().startsWith('|')) {
                    tableLines.push(lines[j].trim())
                    j += 1
                }

                const rows = tableLines
                    .filter((row) => !/^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(row))
                    .map((row) => row.replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim()))
                    .filter((row) => row.length > 0)

                const header = rows[0] || []
                const bodyRows = rows.slice(1)

                nodes.push(
                    <TableContainer
                        key={`tbl-${i}`}
                        component={Paper}
                        variant="outlined"
                        sx={{
                            borderColor: 'divider',
                            borderRadius: 1,
                            boxShadow: 'none',
                            mb: 1,
                        }}
                    >
                        <Table size="small" sx={{ minWidth: 520 }}>
                            {header.length > 0 && (
                                <TableHead>
                                    <TableRow>
                                        {header.map((cell, idx) => (
                                            <TableCell key={idx} sx={{ fontWeight: 700 }}>
                                                <Typography variant="body2" color="text.primary">
                                                    {renderInline(cell)}
                                                </Typography>
                                            </TableCell>
                                        ))}
                                    </TableRow>
                                </TableHead>
                            )}
                            {bodyRows.length > 0 && (
                                <TableBody>
                                    {bodyRows.map((row, rowIdx) => (
                                        <TableRow key={rowIdx}>
                                            {row.map((cell, cellIdx) => (
                                                <TableCell key={cellIdx}>
                                                    <Typography variant="body2" color="text.secondary">
                                                        {renderInline(cell)}
                                                    </Typography>
                                                </TableCell>
                                            ))}
                                        </TableRow>
                                    ))}
                                </TableBody>
                            )}
                        </Table>
                    </TableContainer>,
                )
                i = j - 1
                continue
            }

            nodes.push(
                <Typography key={`p-${i}`} variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                    {renderInline(line)}
                </Typography>,
            )
        }

        return nodes
    }, [])

    useEffect(() => {
        let cancelled = false
            ; (async () => {
                try {
                    const { data } = await axios.get('/api/auth/me')
                    if (cancelled) return
                    setUser(data)
                    // Привязываем сессию Яндекс.Метрики к пользователю по id из БД
                    setAuthChecked(true)
                } catch {
                    if (cancelled) return
                    navigate('/auth', { replace: true })
                }
            })()

        return () => {
            cancelled = true
        }
    }, [navigate])

    const handleLogout = async () => {
        try {
            await axios.post('/api/auth/logout')
        } finally {
            navigate('/auth', { replace: true })
        }
    }

    if (!authChecked) {
        return null
    }

    return (
        <Box sx={{ display: 'flex', height: '100vh', bgcolor: 'background.default' }}>
            { }
            <Box
                component="nav"
                sx={{
                    width,
                    flexShrink: 0,
                    display: 'flex',
                    flexDirection: 'column',
                    borderRight: '1px solid',
                    borderColor: 'divider',
                    bgcolor: 'background.paper',
                    transition: 'width 0.2s ease',
                    overflow: 'hidden',
                    position: 'sticky',
                    top: 0,
                    height: '100vh',
                }}
            >
                { }
                <Box sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1,
                    px: 1,
                    height: 56,
                    flexShrink: 0,
                    borderBottom: '1px solid',
                    borderColor: 'divider',
                }}>
                    <IconButton size="small" onClick={() => setExpanded((v) => !v)} sx={{ flexShrink: 0 }}>
                        <MenuIcon fontSize="small" />
                    </IconButton>
                    {expanded && (
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, overflow: 'hidden' }}>
                            <TableChartIcon color="primary" fontSize="small" sx={{ flexShrink: 0 }} />
                            <Typography variant="subtitle1" fontWeight={700} noWrap color="primary" sx={{ letterSpacing: 0.3 }}>
                                Аксель
                            </Typography>
                        </Box>
                    )}
                </Box>

                { }
                <Box sx={{ flex: 1, py: 1 }}>
                    {NAV_ITEMS.map((item) => {
                        const active =
                            item.to === '/'
                                ? location.pathname === '/'
                                : location.pathname.startsWith(item.to)

                        return (
                            <Tooltip key={item.to} title={!expanded ? item.label : ''} placement="right" arrow>
                                <Box
                                    component={NavLink}
                                    to={item.to}
                                    sx={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: 1.5,
                                        px: expanded ? 2 : 0,
                                        justifyContent: expanded ? 'flex-start' : 'center',
                                        height: 44,
                                        mx: 1,
                                        borderRadius: 2,
                                        textDecoration: 'none',
                                        color: active ? 'primary.main' : 'text.secondary',
                                        bgcolor: active ? 'primary.50' : 'transparent',
                                        fontWeight: active ? 600 : 400,
                                        fontSize: '0.875rem',
                                        transition: 'background 0.15s, color 0.15s',
                                        '&:hover': {
                                            bgcolor: active ? 'primary.50' : 'action.hover',
                                            color: active ? 'primary.main' : 'text.primary',
                                        },
                                    }}
                                >
                                    <Box sx={{ flexShrink: 0, display: 'flex', alignItems: 'center', color: 'inherit' }}>
                                        {item.icon}
                                    </Box>
                                    {expanded && (
                                        <Typography variant="body2" fontWeight="inherit" noWrap sx={{ color: 'inherit' }}>
                                            {item.label}
                                        </Typography>
                                    )}
                                </Box>
                            </Tooltip>
                        )
                    })}
                </Box>

                { }
                <Divider />
            </Box>

            { }
            <Box component="main" sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                { }
                <Box sx={{
                    flexShrink: 0,
                    display: 'flex',
                    justifyContent: 'flex-end',
                    alignItems: 'center',
                    gap: 0.5,
                    px: 1.5,
                    height: 56,
                    borderBottom: '1px solid',
                    borderColor: 'divider',
                    bgcolor: 'background.paper',
                }}>
                    <Tooltip title="Справка" arrow>
                        <IconButton
                            size="small"
                            onClick={() => setHelpOpen(true)}
                            sx={{ bgcolor: 'background.paper', '&:hover': { bgcolor: 'action.hover' } }}
                        >
                            <HelpOutlineIcon fontSize="small" />
                        </IconButton>
                    </Tooltip>
                    <Tooltip title="Профиль" arrow>
                        <IconButton
                            size="small"
                            onClick={() => setProfileOpen(true)}
                            sx={{ bgcolor: 'background.paper', '&:hover': { bgcolor: 'action.hover' } }}
                        >
                            <Avatar sx={{
                                width: 28, height: 28,
                                background: 'linear-gradient(135deg, #60a5fa 0%, #3b82f6 100%)',
                            }}>
                                <PersonIcon sx={{ fontSize: 18 }} />
                            </Avatar>
                        </IconButton>
                    </Tooltip>
                </Box>
                {/* WorkPage stays mounted permanently so AG Grid never re-initialises */}
                <Box sx={{
                    flex: 1,
                    display: location.pathname.startsWith('/work') ? 'flex' : 'none',
                    flexDirection: 'column',
                    minHeight: 0,
                    overflow: 'hidden',
                }}>
                    <Suspense fallback={null}>
                        <WorkPage />
                    </Suspense>
                </Box>

                {/* All other pages rendered normally via Outlet */}
                {!location.pathname.startsWith('/work') && (
                    <Box
                        sx={{
                            flex: 1,
                            display: 'flex',
                            flexDirection: 'column',
                            minHeight: 0,
                            overflow: location.pathname.startsWith('/reporting') ? 'hidden' : 'auto',
                        }}
                    >
                        <Outlet />
                    </Box>
                )}
            </Box>

            { }
            <Drawer
                anchor="right"
                open={profileOpen}
                onClose={() => setProfileOpen(false)}
                slotProps={{ paper: { sx: { width: 280, borderRadius: '12px 0 0 12px' } } }}
            >
                { }
                <Box sx={{ p: 3, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1.5 }}>
                    <Avatar
                        sx={{
                            width: 72, height: 72,
                            background: 'linear-gradient(135deg, #60a5fa 0%, #3b82f6 100%)',
                            fontSize: '1.8rem',
                        }}
                    >
                        <PersonIcon fontSize="large" />
                    </Avatar>
                    <Box sx={{ textAlign: 'center' }}>
                        <Typography variant="subtitle1" fontWeight={700}>
                            {user?.login || 'User'}
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                            {user?.email || 'user@example.com'}
                        </Typography>
                    </Box>
                </Box>

                <Divider />

                <List sx={{ px: 1, py: 1.5, flex: 1 }}>
                    <ListItemButton
                        sx={{ borderRadius: 2, mb: 0.5 }}
                        onClick={() => {
                            setProfileOpen(false)
                            navigate('/profile')
                        }}
                    >
                        <ListItemIcon sx={{ minWidth: 36 }}>
                            <PersonOutlineIcon fontSize="small" />
                        </ListItemIcon>
                        <ListItemText
                            primary="Профиль"
                            secondary="Редактировать данные"
                            slotProps={{ primary: { variant: 'body2', fontWeight: 500 } }}
                        />
                    </ListItemButton>
                    <ListItemButton
                        sx={{ borderRadius: 2, mb: 0.5 }}
                        onClick={() => {
                            setProfileOpen(false)
                            navigate('/settings')
                        }}
                    >
                        <ListItemIcon sx={{ minWidth: 36 }}>
                            <SettingsIcon fontSize="small" />
                        </ListItemIcon>
                        <ListItemText
                            primary="Настройки"
                            secondary="Смена пароля и параметры"
                            slotProps={{ primary: { variant: 'body2', fontWeight: 500 } }}
                        />
                    </ListItemButton>
                </List>

                <Divider />

                <List sx={{ px: 1, py: 1 }}>
                    <ListItemButton
                        sx={{ borderRadius: 2, color: 'error.main' }}
                        onClick={() => {
                            setProfileOpen(false)
                            handleLogout()
                        }}
                    >
                        <ListItemIcon sx={{ minWidth: 36, color: 'error.main' }}>
                            <LogoutIcon fontSize="small" />
                        </ListItemIcon>
                        <ListItemText
                            primary="Выйти"
                            slotProps={{ primary: { variant: 'body2', fontWeight: 500 } }}
                        />
                    </ListItemButton>
                </List>
            </Drawer>

            <Dialog
                open={helpOpen}
                onClose={() => setHelpOpen(false)}
                maxWidth="md"
                fullWidth
            >
                <DialogTitle>{USER_GUIDE_TITLE}</DialogTitle>
                <DialogContent dividers>
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>{guideContent}</Box>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setHelpOpen(false)} variant="contained" size="small">
                        Закрыть
                    </Button>
                </DialogActions>
            </Dialog>
        </Box>
    )
}
