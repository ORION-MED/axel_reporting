import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
    Avatar,
    Box,
    Button,
    Container,
    Grid,
    Paper,
    TextField,
    Typography,
    Alert,
    Tooltip,
    IconButton,
    Dialog,
    DialogTitle,
    DialogContent,
    DialogContentText,
    DialogActions,
} from '@mui/material'
import EditIcon from '@mui/icons-material/Edit'
import PersonIcon from '@mui/icons-material/Person'
import CloseIcon from '@mui/icons-material/Close'
import PublicIcon from '@mui/icons-material/Public'
import PublicOffIcon from '@mui/icons-material/PublicOff'
import axios from 'axios'
import type { PublicationMine } from '@shared/types'

interface MeResponse {
    id: number
    login: string
    email: string
    createdAt?: string
    bio?: string
}

export const ProfilePage = () => {
    const [user, setUser] = useState<MeResponse | null>(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [bioDraft, setBioDraft] = useState('')
    const [bioSaving, setBioSaving] = useState(false)
    const [bioError, setBioError] = useState<string | null>(null)
    const [bioSuccess, setBioSuccess] = useState(false)
    const [editingBio, setEditingBio] = useState(true)
    const [publications, setPublications] = useState<PublicationMine[]>([])
    const [pubLoading, setPubLoading] = useState(true)
    const [pubSearch, setPubSearch] = useState('')
    const [selectedTag, setSelectedTag] = useState<string | null>(null)
    const [pubDeletingId, setPubDeletingId] = useState<number | null>(null)
    const [pubPublishingId, setPubPublishingId] = useState<number | null>(null)
    const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null)
    const [editPub, setEditPub] = useState<PublicationMine | null>(null)
    const [editTitle, setEditTitle] = useState('')
    const [editDescription, setEditDescription] = useState('')
    const [editTagsInput, setEditTagsInput] = useState('')
    const [editSaving, setEditSaving] = useState(false)

    const navigate = useNavigate()

    useEffect(() => {
        let cancelled = false
        ; (async () => {
            setLoading(true)
            setError(null)
            try {
                const { data } = await axios.get<MeResponse>('/api/auth/me')
                if (cancelled) return
                setUser(data)
                setBioDraft(data.bio ?? '')
                setEditingBio(!(data.bio && data.bio.trim().length > 0))
            } catch (err: any) {
                if (cancelled) return
                setError(err?.response?.data?.message || err.message || 'Ошибка загрузки профиля')
            } finally {
                if (!cancelled) setLoading(false)
            }
        })()

        return () => {
            cancelled = true
        }
    }, [])

    useEffect(() => {
        let cancelled = false
        ; (async () => {
            setPubLoading(true)
            try {
                const { data } = await axios.get<PublicationMine[]>('/api/publications/mine')
                if (cancelled) return
                setPublications(data)
            } finally {
                if (!cancelled) setPubLoading(false)
            }
        })()

        return () => {
            cancelled = true
        }
    }, [])

    useEffect(() => {
        if (!bioSuccess) return
        const timer = setTimeout(() => {
            setBioSuccess(false)
        }, 5000)
        return () => clearTimeout(timer)
    }, [bioSuccess])

    const handleSaveBio = async (e: React.FormEvent) => {
        e.preventDefault()
        setBioError(null)
        setBioSuccess(false)

        try {
            setBioSaving(true)
            const { data } = await axios.post<MeResponse>('/api/auth/profile', { bio: bioDraft })
            setUser(data)
            setBioDraft(data.bio ?? '')
            setBioSuccess(true)
            setEditingBio(false)
        } catch (err: any) {
            setBioError(
                err?.response?.data?.message || err.message || 'Не удалось сохранить описание',
            )
        } finally {
            setBioSaving(false)
        }
    }

    const displayName = user?.login || 'User'
    const email = user?.email || 'user@example.com'
    const created = user?.createdAt ? new Date(user.createdAt) : null

    const allTags = Array.from(
        new Set(
            publications.flatMap((p) => (p.tags || [])).filter((t) => t && t.trim().length > 0),
        ),
    )

    const filteredPublications = publications.filter((p) => {
        const matchesTag = selectedTag ? p.tags?.includes(selectedTag) : true
        const q = pubSearch.trim().toLowerCase()
        const matchesSearch = q
            ? p.title.toLowerCase().includes(q) || (p.description || '').toLowerCase().includes(q)
            : true
        return matchesTag && matchesSearch
    })

    const handleDeleteClick = (id: number) => {
        setConfirmDeleteId(id)
    }

    const handleConfirmDelete = async () => {
        if (confirmDeleteId == null) return
        setPubDeletingId(confirmDeleteId)
        try {
            await axios.delete(`/api/publications/${confirmDeleteId}`)
            setPublications((prev) => prev.filter((p) => p.id !== confirmDeleteId))
        } finally {
            setPubDeletingId(null)
            setConfirmDeleteId(null)
        }
    }

    const handleCloseDialog = () => {
        if (pubDeletingId != null) return
        setConfirmDeleteId(null)
    }

    const handleOpenPublication = (id: number) => {
        navigate(`/work?publicationId=${id}&append=true`)
    }

    const handleOpenEdit = (pub: PublicationMine) => {
        setEditPub(pub)
        setEditTitle(pub.title)
        setEditDescription(pub.description || '')
        setEditTagsInput((pub.tags || []).join(', '))
    }

    const handleCloseEdit = () => {
        if (editSaving) return
        setEditPub(null)
        setEditTitle('')
        setEditDescription('')
        setEditTagsInput('')
    }

    const handleSaveEdit = async () => {
        if (!editPub) return
        const title = editTitle.trim()
        if (!title) return

        const tags = Array.from(
            new Set(
                editTagsInput
                    .split(',')
                    .map((t) => t.trim())
                    .filter((t) => t.length > 0),
            ),
        )

        setEditSaving(true)
        try {
            const { data } = await axios.patch<PublicationMine>(`/api/publications/${editPub.id}`, {
                title,
                description: editDescription.trim(),
                tags,
            })
            setPublications((prev) => prev.map((p) => (p.id === data.id ? { ...p, ...data } : p)))
            handleCloseEdit()
        } finally {
            setEditSaving(false)
        }
    }

    const handleTogglePublish = async (pub: PublicationMine) => {
        setPubPublishingId(pub.id)
        try {
            const endpoint = pub.isPublic
                ? `/api/publications/${pub.id}/unpublish`
                : `/api/publications/${pub.id}/publish`
            const { data } = await axios.post<PublicationMine>(endpoint)
            setPublications((prev) => prev.map((p) => (p.id === pub.id ? { ...p, ...data } : p)))
        } finally {
            setPubPublishingId(null)
        }
    }

    return (
        <Box sx={{ py: 3, px: 2, bgcolor: 'background.default', minHeight: '100%' }}>
            <Container maxWidth="lg">
                <Grid container spacing={3}>
                    <Grid item xs={12}>
                        <Paper
                            elevation={2}
                            sx={{
                                p: 3,
                                display: 'flex',
                                alignItems: 'center',
                                gap: 3,
                                borderRadius: 3,
                            }}
                        >
                            <Avatar
                                sx={{
                                    width: 96,
                                    height: 96,
                                    border: '4px solid',
                                    borderColor: 'primary.main',
                                    boxShadow: 2,
                                    background: 'linear-gradient(135deg, #60a5fa 0%, #3b82f6 100%)',
                                    fontSize: '2rem',
                                }}
                            >
                                <PersonIcon fontSize="large" />
                            </Avatar>

                            <Box sx={{ flex: 1, minWidth: 0 }}>
                                <Typography variant="h5" fontWeight={700} noWrap>
                                    {displayName}
                                </Typography>
                                <Typography variant="body1" color="text.secondary" noWrap>
                                    {email}
                                </Typography>
                                {created && (
                                    <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                                        Аккаунт создан {created.toLocaleDateString()}
                                    </Typography>
                                )}
                            </Box>
                        </Paper>
                    </Grid>

                    <Grid item xs={12} md={12}>
                        <Paper elevation={1} sx={{ p: 3, borderRadius: 3, position: 'relative' }}>
                            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                                <Typography variant="h6" fontWeight={600}>
                                    Описание
                                </Typography>
                                {!editingBio && (
                                    <IconButton
                                        size="small"
                                        onClick={() => {
                                            setEditingBio(true)
                                            setBioSuccess(false)
                                        }}
                                    >
                                        <EditIcon fontSize="small" />
                                    </IconButton>
                                )}
                            </Box>

                            {bioError && (
                                <Alert severity="error" sx={{ mb: 2 }}>
                                    {bioError}
                                </Alert>
                            )}
                            {bioSuccess && (
                                <Alert severity="success" sx={{ mb: 2 }}>
                                    Описание сохранено
                                </Alert>
                            )}

                            {editingBio ? (
                                <Box
                                    component="form"
                                    onSubmit={handleSaveBio}
                                    sx={{ mt: 1, display: 'flex', flexDirection: 'column', gap: 2 }}
                                >
                                    <TextField
                                        multiline
                                        minRows={4}
                                        maxRows={8}
                                        placeholder="Расскажите о себе, специализации, интересах..."
                                        value={bioDraft}
                                        onChange={(e) => setBioDraft(e.target.value)}
                                        fullWidth
                                    />
                                    <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
                                        <Button
                                            type="submit"
                                            variant="contained"
                                            size="small"
                                            disabled={bioSaving}
                                        >
                                            Сохранить
                                        </Button>
                                    </Box>
                                </Box>
                            ) : (
                                <Typography variant="body2" color="text.secondary" sx={{ mt: 1, whiteSpace: 'pre-line' }}>
                                    {bioDraft || 'Описание пока не заполнено.'}
                                </Typography>
                            )}
                        </Paper>

                        <Box sx={{ height: 16 }} />

                        <Paper elevation={1} sx={{ p: 3, borderRadius: 3 }}>
                            <Typography variant="h6" fontWeight={600} gutterBottom>
                                Мои работы
                            </Typography>
                            {pubLoading ? (
                                <Typography variant="body2" color="text.secondary">
                                    Загрузка публикаций...
                                </Typography>
                            ) : publications.length === 0 ? (
                                <Box sx={{ textAlign: 'center', py: 4 }}>
                                    <Typography variant="body2" color="text.secondary">
                                        У вас пока нет публикаций.
                                    </Typography>
                                </Box>
                            ) : (
                                <>
                                    <Box
                                        sx={{
                                            display: 'flex',
                                            flexWrap: 'wrap',
                                            gap: 1.5,
                                            alignItems: 'center',
                                            mb: 2,
                                        }}
                                    >
                                        <TextField
                                            size="small"
                                            placeholder="Поиск по названию и описанию"
                                            value={pubSearch}
                                            onChange={(e) => setPubSearch(e.target.value)}
                                            sx={{ minWidth: 240, maxWidth: 360 }}
                                        />
                                        {allTags.length > 0 && (
                                            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                                                <Button
                                                    variant={selectedTag === null ? 'contained' : 'outlined'}
                                                    size="small"
                                                    onClick={() => setSelectedTag(null)}
                                                >
                                                    Все теги
                                                </Button>
                                                {allTags.map((tag) => (
                                                    <Button
                                                        key={tag}
                                                        variant={selectedTag === tag ? 'contained' : 'outlined'}
                                                        size="small"
                                                        onClick={() =>
                                                            setSelectedTag(
                                                                selectedTag === tag ? null : tag,
                                                            )
                                                        }
                                                    >
                                                        {tag}
                                                    </Button>
                                                ))}
                                            </Box>
                                        )}
                                    </Box>

                                    {filteredPublications.length === 0 ? (
                                        <Box sx={{ textAlign: 'center', py: 4 }}>
                                            <Typography variant="body2" color="text.secondary">
                                                По выбранным фильтрам публикаций не найдено.
                                            </Typography>
                                        </Box>
                                    ) : (
                                        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                                            {filteredPublications.map((p) => (
                                                <Box
                                                    key={p.id}
                                                    sx={{
                                                        display: 'flex',
                                                        justifyContent: 'space-between',
                                                        alignItems: 'flex-start',
                                                        gap: 1.5,
                                                        py: 1.25,
                                                        borderBottom: '1px solid',
                                                        borderColor: 'divider',
                                                    }}
                                                >
                                                    <Box sx={{ minWidth: 0, flex: 1 }}>
                                                        <Typography
                                                            variant="body2"
                                                            fontWeight={600}
                                                            sx={{
                                                                mb: 0.25,
                                                                cursor: 'pointer',
                                                                '&:hover': { textDecoration: 'underline' },
                                                            }}
                                                            noWrap
                                                            onClick={() => handleOpenPublication(p.id)}
                                                        >
                                                            {p.title}
                                                        </Typography>
                                                        {!p.isPublic && (
                                                            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.25 }}>
                                                                Черновик
                                                            </Typography>
                                                        )}
                                                        <Typography
                                                            variant="body2"
                                                            color="text.secondary"
                                                            sx={{ mb: 0.5, maxHeight: 40, overflow: 'hidden' }}
                                                        >
                                                            {p.description || 'Без описания'}
                                                        </Typography>
                                                        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                                                            {(p.tags || []).map((tag) => (
                                                                <Box
                                                                    key={tag}
                                                                    sx={{
                                                                        px: 0.75,
                                                                        py: 0.25,
                                                                        borderRadius: 999,
                                                                        bgcolor: 'action.hover',
                                                                        fontSize: '0.75rem',
                                                                    }}
                                                                >
                                                                    {tag}
                                                                </Box>
                                                            ))}
                                                        </Box>
                                                    </Box>

                                                    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 0.75, minWidth: 120 }}>
                                                        <Box sx={{ display: 'flex', gap: 0.25 }}>
                                                            <IconButton size="small" onClick={() => handleOpenEdit(p)}>
                                                                <EditIcon fontSize="small" />
                                                            </IconButton>
                                                            <Tooltip title={p.isPublic ? 'Снять с публикации' : 'Опубликовать'}>
                                                                <IconButton
                                                                    size="small"
                                                                    color={p.isPublic ? 'success' : 'primary'}
                                                                    onClick={() => void handleTogglePublish(p)}
                                                                    disabled={pubPublishingId === p.id}
                                                                >
                                                                    {p.isPublic ? <PublicOffIcon fontSize="small" /> : <PublicIcon fontSize="small" />}
                                                                </IconButton>
                                                            </Tooltip>
                                                            <IconButton
                                                                size="small"
                                                                color="error"
                                                                onClick={() => handleDeleteClick(p.id)}
                                                                disabled={pubDeletingId === p.id}
                                                            >
                                                                <CloseIcon fontSize="small" />
                                                            </IconButton>
                                                        </Box>
                                                    </Box>
                                                </Box>
                                            ))}
                                        </Box>
                                    )}
                                </>
                            )}
                        </Paper>
                    </Grid>
                </Grid>

                {error && (
                    <Box sx={{ mt: 2 }}>
                        <Alert severity="error">{error}</Alert>
                    </Box>
                )}

                {loading && !error && (
                    <Box sx={{ mt: 2 }}>
                        <Typography variant="body2" color="text.secondary">
                            Загрузка профиля...
                        </Typography>
                    </Box>
                )}

                <Dialog
                    open={confirmDeleteId != null}
                    onClose={handleCloseDialog}
                    maxWidth="xs"
                    fullWidth
                >
                    <DialogTitle>Удаление публикации</DialogTitle>
                    <DialogContent>
                        <DialogContentText>
                            Вы действительно хотите удалить публикации?
                        </DialogContentText>
                    </DialogContent>
                    <DialogActions>
                        <Button onClick={handleCloseDialog} disabled={pubDeletingId != null}>
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

                <Dialog
                    open={!!editPub}
                    onClose={handleCloseEdit}
                    maxWidth="sm"
                    fullWidth
                >
                    <DialogTitle>Редактировать публикацию</DialogTitle>
                    <DialogContent sx={{ pt: 1.5 }}>
                        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
                            <TextField
                                label="Название"
                                fullWidth
                                size="small"
                                value={editTitle}
                                onChange={(e) => setEditTitle(e.target.value)}
                            />
                            <TextField
                                label="Описание"
                                fullWidth
                                size="small"
                                multiline
                                minRows={3}
                                value={editDescription}
                                onChange={(e) => setEditDescription(e.target.value)}
                            />
                            <TextField
                                label="Теги (через запятую)"
                                fullWidth
                                size="small"
                                value={editTagsInput}
                                onChange={(e) => setEditTagsInput(e.target.value)}
                                helperText="Например: cardiology, ICU, demo"
                            />
                        </Box>
                    </DialogContent>
                    <DialogActions>
                        <Button onClick={handleCloseEdit} disabled={editSaving}>
                            Отмена
                        </Button>
                        <Button
                            onClick={handleSaveEdit}
                            variant="contained"
                            disabled={editSaving || !editTitle.trim()}
                        >
                            Сохранить
                        </Button>
                    </DialogActions>
                </Dialog>
            </Container>
        </Box>
    )
}
