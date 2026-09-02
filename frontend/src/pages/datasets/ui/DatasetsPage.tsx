import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
    Box,
    Typography,
    Container,
    Grid,
    Card,
    CardActionArea,
    CardContent,
    Chip,
    Skeleton,
    Button,
    TextField,
    IconButton,
    Dialog,
    DialogTitle,
    DialogContent,
    DialogContentText,
    DialogActions,
    Alert,
} from '@mui/material'
import CloseIcon from '@mui/icons-material/Close'
import axios from 'axios'
import type { PublicationSummary } from '@shared/types'

// Функция DatasetsPage
export const DatasetsPage = () => {
    const [items, setItems] = useState<PublicationSummary[]>([])
    const [loading, setLoading] = useState(true)
    const [search, setSearch] = useState('')
    const [selectedTag, setSelectedTag] = useState<string | null>(null)
    const [listMode, setListMode] = useState<'public' | 'mine'>('public')
    const [pubDeletingId, setPubDeletingId] = useState<number | null>(null)
    const [pubPublishingId, setPubPublishingId] = useState<number | null>(null)
    const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null)
    const [deleteError, setDeleteError] = useState<string | null>(null)
    const navigate = useNavigate()

    useEffect(() => {
        let cancelled = false
            ; (async () => {
                try {
                    setLoading(true)
                    const { data } = await axios.get<PublicationSummary[]>(
                        listMode === 'mine' ? '/api/publications/mine' : '/api/publications?limit=40',
                    )
                    if (cancelled) return
                    setItems(data)
                } finally {
                    if (!cancelled) setLoading(false)
                }
            })()

        return () => {
            cancelled = true
        }
    }, [listMode])

    const allTags = useMemo(
        () =>
            Array.from(
                new Set(
                    items.flatMap((p) => p.tags || []).filter((t) => t && t.trim().length > 0),
                ),
            ),
        [items],
    )

    const filteredItems = useMemo(() => {
        const q = search.trim().toLowerCase()
        return items.filter((p) => {
            const matchesTag = selectedTag ? p.tags?.includes(selectedTag) : true
            const matchesSearch = q
                ? p.title.toLowerCase().includes(q) || (p.description || '').toLowerCase().includes(q)
                : true
            return matchesTag && matchesSearch
        })
    }, [items, search, selectedTag])

    const handleDeleteClick = (id: number) => {
        setDeleteError(null)
        setConfirmDeleteId(id)
    }

    const handleCloseDeleteDialog = () => {
        if (pubDeletingId != null) return
        setConfirmDeleteId(null)
    }

    const handleConfirmDelete = async () => {
        if (confirmDeleteId == null) return
        setDeleteError(null)
        setPubDeletingId(confirmDeleteId)
        try {
            await axios.delete(`/api/publications/${confirmDeleteId}`)
            setItems((prev) => prev.filter((p) => p.id !== confirmDeleteId))
            setConfirmDeleteId(null)
        } catch (err: any) {
            setDeleteError(err?.response?.data?.message || err?.message || 'Не удалось удалить публикацию')
        } finally {
            setPubDeletingId(null)
        }
    }

    const handlePublish = async (id: number) => {
        setPubPublishingId(id)
        try {
            const { data } = await axios.post<PublicationSummary>(`/api/publications/${id}/publish`)
            setItems((prev) => prev.map((p) => (p.id === id ? { ...p, ...data, isPublic: true } : p)))
        } finally {
            setPubPublishingId(null)
        }
    }

    const handleUnpublish = async (id: number) => {
        setPubPublishingId(id)
        try {
            const { data } = await axios.post<PublicationSummary>(`/api/publications/${id}/unpublish`)
            setItems((prev) => prev.map((p) => (p.id === id ? { ...p, ...data, isPublic: false } : p)))
        } finally {
            setPubPublishingId(null)
        }
    }

    return (
        <Box sx={{ py: 3, bgcolor: 'background.default', minHeight: '100%' }}>
            <Container maxWidth="lg">
                <Box sx={{ display: 'flex', flexDirection: { xs: 'column', sm: 'row' }, justifyContent: 'space-between', alignItems: { xs: 'flex-start', sm: 'center' }, gap: 2, mb: 3 }}>
                    <Box>
                        <Typography variant="h4" fontWeight={700} gutterBottom>
                            Публикации
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                            {listMode === 'mine'
                                ? 'Мои работы: черновики и опубликованные публикации.'
                                : 'Общедоступные публикации с рабочими пространствами и настройками анализа.'}
                        </Typography>
                    </Box>
                    <Box sx={{ display: 'flex', gap: 1, flexShrink: 0 }}>
                        <Button variant={listMode === 'public' ? 'contained' : 'outlined'} onClick={() => setListMode('public')} sx={{ textTransform: 'none' }}>
                            Общие
                        </Button>
                        <Button variant={listMode === 'mine' ? 'contained' : 'outlined'} onClick={() => setListMode('mine')} sx={{ textTransform: 'none' }}>
                            Мои работы
                        </Button>
                    </Box>
                </Box>

                <Box sx={{ mb: 3, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                    <TextField
                        size="small"
                        placeholder="Поиск по названию и описанию"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        fullWidth
                    />
                    {allTags.length > 0 && (
                        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                            <Chip
                                label="Все теги"
                                clickable
                                color={selectedTag === null ? 'primary' : 'default'}
                                variant={selectedTag === null ? 'filled' : 'outlined'}
                                onClick={() => setSelectedTag(null)}
                            />
                            {allTags.map((tag) => (
                                <Chip
                                    key={tag}
                                    label={tag}
                                    clickable
                                    color={selectedTag === tag ? 'primary' : 'default'}
                                    variant={selectedTag === tag ? 'filled' : 'outlined'}
                                    onClick={() =>
                                        setSelectedTag(selectedTag === tag ? null : tag)
                                    }
                                />
                            ))}
                        </Box>
                    )}
                </Box>

                {loading ? (
                    <Grid container spacing={2}>
                        {Array.from({ length: 4 }).map((_, idx) => (
                            <Grid item xs={12} sm={6} md={4} lg={3} key={idx}>
                                <Skeleton variant="rectangular" height={180} />
                            </Grid>
                        ))}
                    </Grid>
                ) : items.length === 0 ? (
                    <Box sx={{ mt: 4 }}>
                        <Typography variant="body2" color="text.secondary">
                            Пока нет опубликованных наборов данных.
                        </Typography>
                    </Box>
                ) : filteredItems.length === 0 ? (
                    <Box sx={{ mt: 4 }}>
                        <Typography variant="body2" color="text.secondary">
                            По выбранным фильтрам публикаций не найдено.
                        </Typography>
                    </Box>
                ) : (
                    <Grid container spacing={2}>
                        {filteredItems.map((p) => (
                            <Grid item xs={12} sm={6} md={4} lg={3} key={p.id}>
                                <Card
                                    elevation={1}
                                    sx={{
                                        position: 'relative',
                                        aspectRatio: '1 / 1',
                                        display: 'flex',
                                        flexDirection: 'column',
                                        '& .dataset-delete-btn': {
                                            opacity: 0,
                                            pointerEvents: 'none',
                                        },
                                        '&:hover .dataset-delete-btn': {
                                            opacity: 1,
                                            pointerEvents: 'auto',
                                        },
                                    }}
                                >
                                    <IconButton
                                        size="small"
                                        className="dataset-delete-btn"
                                        onClick={(e) => {
                                            e.preventDefault()
                                            e.stopPropagation()
                                            handleDeleteClick(p.id)
                                        }}
                                        disabled={pubDeletingId === p.id || listMode !== 'mine'}
                                        sx={{
                                            position: 'absolute',
                                            top: 6,
                                            right: 6,
                                            zIndex: 2,
                                            bgcolor: 'background.paper',
                                            color: 'text.secondary',
                                            p: 0.25,
                                            transition: 'opacity 0.15s ease',
                                            '&:hover': {
                                                bgcolor: 'action.hover',
                                            },
                                            ...(listMode !== 'mine'
                                                ? { display: 'none' }
                                                : null),
                                        }}
                                    >
                                        <CloseIcon sx={{ fontSize: 14 }} />
                                    </IconButton>
                                    <CardActionArea
                                        component="div"
                                        role="button"
                                        tabIndex={0}
                                        onClick={() => {
                                            navigate(`/work?publicationId=${p.id}&append=true`)
                                        }}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter' || e.key === ' ') {
                                                e.preventDefault()
                                                navigate(`/work?publicationId=${p.id}&append=true`)
                                            }
                                        }}
                                        sx={{ height: '100%', display: 'flex', alignItems: 'stretch' }}
                                    >
                                        <CardContent sx={{ display: 'flex', flexDirection: 'column', height: '100%', width: '100%', p: 1.5, overflow: 'hidden' }}>
                                            {listMode === 'mine' && (
                                                <Box sx={{ mb: 1, display: 'flex', alignItems: 'center', gap: 0.5, flexWrap: 'wrap', rowGap: 0.5 }}>
                                                    <Chip
                                                        size="small"
                                                        label={p.isPublic ? 'Опубликовано' : 'Черновик'}
                                                        color={p.isPublic ? 'success' : 'default'}
                                                        variant={p.isPublic ? 'filled' : 'outlined'}
                                                        sx={{
                                                            height: 22,
                                                            '& .MuiChip-label': {
                                                                px: 0.75,
                                                                fontSize: '0.72rem',
                                                                lineHeight: 1,
                                                                whiteSpace: 'nowrap',
                                                            },
                                                        }}
                                                    />
                                                    {!p.isPublic ? (
                                                        <Button
                                                            size="small"
                                                            variant="contained"
                                                            disableElevation
                                                            sx={{
                                                                textTransform: 'none',
                                                                borderRadius: 999,
                                                                minHeight: 22,
                                                                px: 0.9,
                                                                minWidth: 0,
                                                                maxWidth: '100%',
                                                                fontSize: '0.69rem',
                                                                lineHeight: 1,
                                                                whiteSpace: 'nowrap',
                                                                overflow: 'hidden',
                                                                textOverflow: 'ellipsis',
                                                            }}
                                                            disabled={pubPublishingId === p.id}
                                                            onClick={(e) => {
                                                                e.preventDefault()
                                                                e.stopPropagation()
                                                                void handlePublish(p.id)
                                                            }}
                                                        >
                                                            Опубликовать
                                                        </Button>
                                                    ) : (
                                                        <Button
                                                            size="small"
                                                            variant="outlined"
                                                            color="inherit"
                                                            sx={{
                                                                textTransform: 'none',
                                                                borderRadius: 999,
                                                                minHeight: 22,
                                                                px: 0.9,
                                                                minWidth: 0,
                                                                maxWidth: '100%',
                                                                fontSize: '0.69rem',
                                                                lineHeight: 1,
                                                                whiteSpace: 'nowrap',
                                                                overflow: 'hidden',
                                                                textOverflow: 'ellipsis',
                                                            }}
                                                            disabled={pubPublishingId === p.id}
                                                            onClick={(e) => {
                                                                e.preventDefault()
                                                                e.stopPropagation()
                                                                void handleUnpublish(p.id)
                                                            }}
                                                        >
                                                            Снять с публикации
                                                        </Button>
                                                    )}
                                                </Box>
                                            )}
                                            <Typography
                                                variant="subtitle1"
                                                fontWeight={600}
                                                gutterBottom
                                                sx={{
                                                    minHeight: 44,
                                                    display: '-webkit-box',
                                                    WebkitLineClamp: 2,
                                                    WebkitBoxOrient: 'vertical',
                                                    overflow: 'hidden',
                                                }}
                                            >
                                                {p.title}
                                            </Typography>
                                            <Typography
                                                variant="body2"
                                                color="text.secondary"
                                                sx={{
                                                    mb: 1.5,
                                                    minHeight: 36,
                                                    display: '-webkit-box',
                                                    WebkitLineClamp: 2,
                                                    WebkitBoxOrient: 'vertical',
                                                    overflow: 'hidden',
                                                }}
                                            >
                                                {p.description || 'Без описания'}
                                            </Typography>
                                            <Box sx={{ mt: 'auto' }}>
                                                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, minHeight: 24, maxHeight: 24, overflow: 'hidden', alignItems: 'center' }}>
                                                    {p.tags.slice(0, 3).map((tag) => (
                                                        <Chip key={tag} label={tag} size="small" />
                                                    ))}
                                                </Box>
                                                <Typography
                                                    variant="caption"
                                                    color="text.secondary"
                                                    sx={{ display: 'block', mt: 0.5 }}
                                                >
                                                    Автор: {p.ownerLogin}
                                                </Typography>
                                            </Box>
                                        </CardContent>
                                    </CardActionArea>
                                </Card>
                            </Grid>
                        ))}
                    </Grid>
                )}
            </Container>

            <Dialog
                open={confirmDeleteId != null}
                onClose={handleCloseDeleteDialog}
                maxWidth="xs"
                fullWidth
            >
                <DialogTitle>Удаление публикации</DialogTitle>
                <DialogContent>
                    <DialogContentText>
                        Вы действительно хотите удалить публикации?
                    </DialogContentText>
                    {deleteError && (
                        <Alert severity="error" sx={{ mt: 1.5 }}>
                            {deleteError}
                        </Alert>
                    )}
                </DialogContent>
                <DialogActions>
                    <Button onClick={handleCloseDeleteDialog} disabled={pubDeletingId != null}>
                        Нет
                    </Button>
                    <Button
                        onClick={handleConfirmDelete}
                        color="error"
                        variant="contained"
                        disabled={pubDeletingId != null}
                    >
                        Да
                    </Button>
                </DialogActions>
            </Dialog>
        </Box>
    )
}
