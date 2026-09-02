import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import axios from 'axios'
import AttachFileOutlinedIcon from '@mui/icons-material/AttachFileOutlined'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import UploadFileOutlinedIcon from '@mui/icons-material/UploadFileOutlined'
import {
    Alert,
    Box,
    Button,
    CircularProgress,
    IconButton,
    MenuItem,
    Paper,
    Stack,
    TextField,
    Typography,
} from '@mui/material'
import {
    SUPPORT_ATTACHMENT_ACCEPT_ATTR,
    SUPPORT_ATTACHMENT_ALLOWED_MIME_TYPES,
    SUPPORT_ATTACHMENT_MAX_FILE_SIZE_BYTES,
    SUPPORT_ATTACHMENT_MAX_FILE_SIZE_MB,
    SUPPORT_ATTACHMENT_MAX_FILES,
} from '@shared/config/support'
import { buildSupportPrefill, type SupportPrefill, type SupportUserInfo } from '@shared/lib/supportContext'

const CATEGORY_OPTIONS = [
    'Авторизация и доступ',
    'Загрузка данных',
    'Фильтрация данных',
    'Обработка данных',
    'Временные ряды',
    'Статистика',
    'Визуализация и дашборды',
    'Публикации и экспорт',
    'Ошибка интерфейса',
    'Общий вопрос / Консультация',
]
const PRIORITY_OPTIONS = [
    { value: 'Низкий', label: 'Низкий' },
    { value: 'Средний', label: 'Средний' },
    { value: 'Высокий', label: 'Высокий' },
    { value: 'Критический', label: 'Критический' },
]
const SUPPORT_ATTACHMENT_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.pdf', '.txt', '.csv', '.zip', '.xlsx']

type FormState = {
    name: string
    email: string
    category: string
    priority: string
    subject: string
    description: string
    stepsToReproduce: string
    expectedResult: string
    actualResult: string
    sectionName: string
    pageUrl: string
    browserInfo: string
    datasetId: string
    publicationId: string
}

type LocationState = {
    supportPrefill?: SupportPrefill
} | null

function createInitialForm(prefill: SupportPrefill): FormState {
    return {
        name: prefill.name || '',
        email: prefill.email || '',
        category: 'Общий вопрос / Консультация',
        priority: 'Средний',
        subject: '',
        description: '',
        stepsToReproduce: '',
        expectedResult: '',
        actualResult: '',
        sectionName: prefill.sectionName || '',
        pageUrl: prefill.pageUrl || '',
        browserInfo: prefill.browserInfo || '',
        datasetId: prefill.datasetId || '',
        publicationId: prefill.publicationId || '',
    }
}

function extractErrorMessage(error: any): string {
    const rawMessage = error?.response?.data?.message
    const message = Array.isArray(rawMessage)
        ? rawMessage.join('; ')
        : rawMessage || error?.message || 'Не удалось отправить обращение в поддержку'

    if (/LIMIT_FILE_SIZE|File too large/i.test(message)) {
        return `Размер каждого файла не должен превышать ${SUPPORT_ATTACHMENT_MAX_FILE_SIZE_MB} МБ.`
    }

    if (/LIMIT_UNEXPECTED_FILE|Unexpected field/i.test(message)) {
        return `Можно прикрепить не более ${SUPPORT_ATTACHMENT_MAX_FILES} файлов.`
    }

    if (/Неподдерживаемый тип файла|unsupported|mime/i.test(message)) {
        return 'Неподдерживаемый тип файла. Разрешены PNG, JPG/JPEG, PDF, TXT, CSV, ZIP и XLSX.'
    }

    return message
}

function formatFileSize(size: number): string {
    if (size >= 1024 * 1024) {
        return `${(size / (1024 * 1024)).toFixed(2)} МБ`
    }

    return `${Math.max(1, Math.round(size / 1024))} КБ`
}

function getFileExtension(fileName: string): string {
    const parts = fileName.split('.')
    const ext = parts[parts.length - 1]
    return ext ? `.${ext.toLowerCase()}` : ''
}

function isAllowedAttachment(file: File): boolean {
    const mimeType = (file.type || '').toLowerCase()
    return SUPPORT_ATTACHMENT_ALLOWED_MIME_TYPES.includes(mimeType as (typeof SUPPORT_ATTACHMENT_ALLOWED_MIME_TYPES)[number])
        || SUPPORT_ATTACHMENT_EXTENSIONS.includes(getFileExtension(file.name))
}

function validateAttachmentSelection(files: File[]): string | null {
    if (files.length > SUPPORT_ATTACHMENT_MAX_FILES) {
        return `Можно прикрепить не более ${SUPPORT_ATTACHMENT_MAX_FILES} файлов.`
    }

    for (const file of files) {
        if (file.size > SUPPORT_ATTACHMENT_MAX_FILE_SIZE_BYTES) {
            return `Файл «${file.name}» превышает ${SUPPORT_ATTACHMENT_MAX_FILE_SIZE_MB} МБ.`
        }

        if (!isAllowedAttachment(file)) {
            return `Файл «${file.name}» имеет неподдерживаемый тип. Разрешены PNG, JPG/JPEG, PDF, TXT, CSV, ZIP и XLSX.`
        }
    }

    return null
}

export const NewSupportTicketPage = () => {
    const navigate = useNavigate()
    const location = useLocation()
    const routeState = (location.state as LocationState) ?? null

    const prefill = useMemo(
        () => routeState?.supportPrefill ?? buildSupportPrefill(),
        [routeState],
    )

    const [form, setForm] = useState<FormState>(() => createInitialForm(prefill))
    const [submitting, setSubmitting] = useState(false)
    const [submitError, setSubmitError] = useState<string | null>(null)
    const [submitSuccess, setSubmitSuccess] = useState<string | null>(null)
    const [user, setUser] = useState<SupportUserInfo | null>(null)
    const [attachments, setAttachments] = useState<File[]>([])

    useEffect(() => {
        setForm((prev) => ({
            ...prev,
            sectionName: prev.sectionName || prefill.sectionName || '',
            pageUrl: prev.pageUrl || prefill.pageUrl || '',
            browserInfo: prev.browserInfo || prefill.browserInfo || '',
            datasetId: prev.datasetId || prefill.datasetId || '',
            publicationId: prev.publicationId || prefill.publicationId || '',
        }))
    }, [prefill])

    useEffect(() => {
        let cancelled = false

        axios.get('/api/auth/me')
            .then(({ data }) => {
                if (cancelled || !data) return

                const nextUser: SupportUserInfo = {
                    login: data.login,
                    email: data.email,
                    name: data.login,
                }

                setUser(nextUser)
                setForm((prev) => ({
                    ...prev,
                    name: prev.name || nextUser.name || nextUser.login || '',
                    email: prev.email || nextUser.email || '',
                }))
            })
            .catch(() => {
                if (!cancelled) {
                    setUser(null)
                }
            })

        return () => {
            cancelled = true
        }
    }, [])

    const handleFieldChange = (field: keyof FormState) => (
        event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
    ) => {
        setForm((prev) => ({ ...prev, [field]: event.target.value }))
    }

    const handleBack = () => {
        if (window.history.length > 1) {
            navigate(-1)
            return
        }

        navigate('/support')
    }

    const handleAttachmentChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const selectedFiles = Array.from(event.target.files || [])
        event.target.value = ''

        if (selectedFiles.length === 0) {
            return
        }

        const nextFiles = [...attachments]
        for (const file of selectedFiles) {
            const alreadyAdded = nextFiles.some(
                (item) => item.name === file.name && item.size === file.size && item.lastModified === file.lastModified,
            )

            if (!alreadyAdded) {
                nextFiles.push(file)
            }
        }

        const validationError = validateAttachmentSelection(nextFiles)
        if (validationError) {
            setSubmitError(validationError)
            return
        }

        setAttachments(nextFiles)
        setSubmitError(null)
    }

    const handleRemoveAttachment = (index: number) => {
        setAttachments((prev) => prev.filter((_, fileIndex) => fileIndex !== index))
        setSubmitError(null)
    }

    const handleReset = () => {
        setSubmitSuccess(null)
        setSubmitError(null)
        setAttachments([])
        setForm({
            ...createInitialForm({
                ...prefill,
                name: user?.name || user?.login || prefill.name,
                email: user?.email || prefill.email,
            }),
            category: 'Общий вопрос / Консультация',
            priority: 'Средний',
        })
    }

    const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault()
        setSubmitError(null)
        setSubmitSuccess(null)

        if (!form.email.trim()) {
            setSubmitError('Укажите email для связи.')
            return
        }

        if (!form.subject.trim()) {
            setSubmitError('Укажите тему обращения.')
            return
        }

        if (!form.description.trim()) {
            setSubmitError('Опишите проблему в поле «Описание проблемы».')
            return
        }

        const attachmentError = validateAttachmentSelection(attachments)
        if (attachmentError) {
            setSubmitError(attachmentError)
            return
        }

        setSubmitting(true)
        try {
            const payload = {
                ...form,
                name: form.name.trim(),
                email: form.email.trim(),
                subject: form.subject.trim(),
                description: form.description.trim(),
                stepsToReproduce: form.stepsToReproduce.trim(),
                expectedResult: form.expectedResult.trim(),
                actualResult: form.actualResult.trim(),
                sectionName: form.sectionName.trim(),
                pageUrl: form.pageUrl.trim(),
                browserInfo: form.browserInfo.trim(),
                datasetId: form.datasetId.trim(),
                publicationId: form.publicationId.trim(),
            }

            const formData = new FormData()
            Object.entries(payload).forEach(([key, value]) => {
                formData.append(key, value)
            })
            attachments.forEach((file) => {
                formData.append('attachments', file)
            })

            const { data } = await axios.post('/api/support/tickets', formData)
            setAttachments([])
            setSubmitSuccess(data?.message || 'Обращение отправлено в поддержку.')
        } catch (error: any) {
            setSubmitError(extractErrorMessage(error))
        } finally {
            setSubmitting(false)
        }
    }

    if (submitSuccess) {
        return (
            <Box sx={{ p: 3 }}>
                <Paper variant="outlined" sx={{ p: 3, borderRadius: 2 }}>
                    <Stack spacing={2}>
                        <Typography variant="h5" fontWeight={700}>
                            Обращение отправлено
                        </Typography>
                        <Alert severity="success" sx={{ borderRadius: 2 }}>
                            {submitSuccess}
                        </Alert>
                        <Typography variant="body2" color="text.secondary">
                            Команда поддержки получит письмо, после чего HESK создаст тикет автоматически через почтовую интеграцию.
                        </Typography>
                        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
                            <Button variant="contained" onClick={handleReset}>
                                Создать ещё одно обращение
                            </Button>
                            <Button variant="outlined" onClick={() => navigate('/support')}>
                                К разделу поддержки
                            </Button>
                        </Stack>
                    </Stack>
                </Paper>
            </Box>
        )
    }

    return (
        <Box sx={{ p: 3 }}>
            <Stack spacing={3}>
                <Box
                    sx={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: { xs: 'flex-start', md: 'center' },
                        gap: 2,
                        flexWrap: 'wrap',
                    }}
                >
                    <Box>
                        <Typography variant="h5" fontWeight={700} gutterBottom>
                            Создать обращение в поддержку
                        </Typography>
                    </Box>

                </Box>

                <Paper variant="outlined" sx={{ p: 3, borderRadius: 2 }}>
                    <Stack component="form" spacing={2.5} onSubmit={handleSubmit}>
                        {submitError && (
                            <Alert severity="error" sx={{ borderRadius: 2 }}>
                                {submitError}
                            </Alert>
                        )}


                        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2 }}>
                            <TextField
                                label="Имя"
                                value={form.name}
                                onChange={handleFieldChange('name')}
                                fullWidth
                            />
                            <TextField
                                label="Email *"
                                type="email"
                                value={form.email}
                                onChange={handleFieldChange('email')}
                                required
                                fullWidth
                            />
                            <TextField
                                select
                                label="Категория *"
                                value={form.category}
                                onChange={handleFieldChange('category')}
                                required
                                fullWidth
                            >
                                {CATEGORY_OPTIONS.map((option) => (
                                    <MenuItem key={option} value={option}>
                                        {option}
                                    </MenuItem>
                                ))}
                            </TextField>
                            <TextField
                                select
                                label="Приоритет *"
                                value={form.priority}
                                onChange={handleFieldChange('priority')}
                                required
                                fullWidth
                            >
                                {PRIORITY_OPTIONS.map((option) => (
                                    <MenuItem key={option.value} value={option.value}>
                                        {option.label}
                                    </MenuItem>
                                ))}
                            </TextField>
                        </Box>

                        <TextField
                            label="Тема обращения *"
                            value={form.subject}
                            onChange={handleFieldChange('subject')}
                            required
                            fullWidth
                        />

                        <TextField
                            label="Описание проблемы *"
                            value={form.description}
                            onChange={handleFieldChange('description')}
                            multiline
                            minRows={4}
                            required
                            fullWidth
                        />

                        <TextField
                            label="Шаги воспроизведения"
                            value={form.stepsToReproduce}
                            onChange={handleFieldChange('stepsToReproduce')}
                            multiline
                            minRows={3}
                            fullWidth
                        />

                        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2 }}>
                            <TextField
                                label="Ожидаемый результат"
                                value={form.expectedResult}
                                onChange={handleFieldChange('expectedResult')}
                                multiline
                                minRows={3}
                                fullWidth
                            />
                            <TextField
                                label="Фактический результат"
                                value={form.actualResult}
                                onChange={handleFieldChange('actualResult')}
                                multiline
                                minRows={3}
                                fullWidth
                            />
                        </Box>

                        <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, bgcolor: 'grey.50' }}>
                            <Stack spacing={1.5}>
                                <Box>
                                    <Typography variant="subtitle1" fontWeight={700}>
                                        Вложения
                                    </Typography>
                                    <Typography variant="body2" color="text.secondary">
                                        Можно прикрепить до {SUPPORT_ATTACHMENT_MAX_FILES} файлов, не более {SUPPORT_ATTACHMENT_MAX_FILE_SIZE_MB} МБ каждый.
                                        Разрешены: PNG, JPG/JPEG, PDF, TXT, CSV, ZIP, XLSX.
                                    </Typography>
                                </Box>

                                <Box>
                                    <Button component="label" variant="outlined" startIcon={<UploadFileOutlinedIcon />}>
                                        Добавить файлы
                                        <input
                                            hidden
                                            type="file"
                                            multiple
                                            accept={SUPPORT_ATTACHMENT_ACCEPT_ATTR}
                                            onChange={handleAttachmentChange}
                                        />
                                    </Button>
                                </Box>

                                {attachments.length > 0 && (
                                    <Stack spacing={1}>
                                        {attachments.map((file, index) => (
                                            <Paper
                                                key={`${file.name}-${file.size}-${file.lastModified}`}
                                                variant="outlined"
                                                sx={{
                                                    px: 1.5,
                                                    py: 1,
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    justifyContent: 'space-between',
                                                    gap: 1,
                                                }}
                                            >
                                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
                                                    <AttachFileOutlinedIcon fontSize="small" color="action" />
                                                    <Box sx={{ minWidth: 0 }}>
                                                        <Typography variant="body2" noWrap>
                                                            {file.name}
                                                        </Typography>
                                                        <Typography variant="caption" color="text.secondary">
                                                            {formatFileSize(file.size)}
                                                        </Typography>
                                                    </Box>
                                                </Box>
                                                <IconButton
                                                    size="small"
                                                    aria-label={`Удалить ${file.name}`}
                                                    onClick={() => handleRemoveAttachment(index)}
                                                >
                                                    <DeleteOutlineIcon fontSize="small" />
                                                </IconButton>
                                            </Paper>
                                        ))}
                                    </Stack>
                                )}
                            </Stack>
                        </Paper>

                        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} justifyContent="flex-end">
                            <Button onClick={handleBack} disabled={submitting}>
                                Отмена
                            </Button>
                            <Button
                                type="submit"
                                variant="contained"
                                disabled={submitting}
                                startIcon={submitting ? <CircularProgress size={16} color="inherit" /> : undefined}
                            >
                                {submitting ? 'Отправка…' : 'Отправить обращение'}
                            </Button>
                        </Stack>
                    </Stack>
                </Paper>
            </Stack>
        </Box>
    )
}
