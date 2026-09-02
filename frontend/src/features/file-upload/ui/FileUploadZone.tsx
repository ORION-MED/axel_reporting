import { useCallback, useState } from 'react'
import { useDropzone, type FileRejection } from 'react-dropzone'
import {
    Alert,
    Box,
    LinearProgress,
    Paper,
    Typography,
} from '@mui/material'
import CloudUploadIcon from '@mui/icons-material/CloudUpload'
import InsertDriveFileIcon from '@mui/icons-material/InsertDriveFile'
import { useTableStore } from '@entities/table'
import { useNotify } from '@shared/lib'
import { parseFile } from '../lib/parseFile'

interface FileUploadZoneProps {
    compact?: boolean
}

type UploadStage = 'idle' | 'parsing' | 'uploading'

export const FileUploadZone = ({ compact = false }: FileUploadZoneProps) => {
    const uploadTable = useTableStore((s) => s.uploadTable)
    const { showError } = useNotify()
    const [stage, setStage] = useState<UploadStage>('idle')
    const [parsePercent, setParsePercent] = useState(0)
    const [uploadPercent, setUploadPercent] = useState(0)
    const [stageText, setStageText] = useState('')
    const [error, setError] = useState<string | null>(null)

    const loading = stage !== 'idle'
    const progressValue = stage === 'uploading' ? uploadPercent : parsePercent
    const isIndeterminate =
        (stage === 'parsing' && parsePercent === 0) ||
        (stage === 'uploading' && uploadPercent === 0)
    const stageLabel = loading
        ? `${stageText || (stage === 'parsing' ? 'Разбор файла' : 'Загрузка на сервер')}${progressValue > 0 ? `... ${progressValue}%` : '...'}`
        : ''

    const onDrop = useCallback(
        async (acceptedFiles: File[]) => {
            if (acceptedFiles.length === 0) return
            const file = acceptedFiles[0]
            setStage('parsing')
            setParsePercent(0)
            setUploadPercent(0)
            setStageText('Разбор файла')
            setError(null)
            try {
                const { columns, rows, uploadId, jobId } = await parseFile(file, (s, pct, label) => {
                    if (s === 'parsing') {
                        setStage('parsing')
                        setParsePercent(pct)
                        setStageText(label ?? 'Разбор файла')
                    } else {
                        setStage('uploading')
                        setUploadPercent(pct)
                        setStageText(label ?? 'Загрузка на сервер')
                    }
                })
                await uploadTable(file.name, columns, rows, uploadId, jobId)
            } catch (e) {
                setError(e instanceof Error ? e.message : 'Ошибка при разборе файла')
            } finally {
                setStage('idle')
                setParsePercent(0)
                setUploadPercent(0)
                setStageText('')
            }
        },
        [uploadTable],
    )

    const onDropRejected = useCallback((rejections: FileRejection[]) => {
        const code = rejections[0]?.errors[0]?.code
        if (code === 'file-too-large') {
            showError('Файл слишком большой. Максимальный размер - 300 MB.')
        } else {
            showError('Неподдерживаемый формат файла. Используйте CSV, XLS, XLSX или ODS.')
        }
    }, [showError])

    const { getRootProps, getInputProps, isDragActive } = useDropzone({
        onDrop,
        onDropRejected,
        accept: {
            'text/csv': ['.csv'],
            'application/vnd.ms-excel': ['.xls'],
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
            'application/vnd.oasis.opendocument.spreadsheet': ['.ods'],
        },
        maxSize: 300 * 1024 * 1024,
        multiple: false,
        disabled: loading,
    })

    return (
        <Box sx={{ width: '100%' }}>
            <Paper
                {...getRootProps()}
                elevation={0}
                sx={{
                    border: '2px dashed',
                    borderColor: isDragActive ? 'primary.main' : 'divider',
                    borderRadius: 2,
                    p: compact ? 1.5 : 5,
                    textAlign: 'center',
                    cursor: loading ? 'not-allowed' : 'pointer',
                    backgroundColor: isDragActive
                        ? 'rgba(25, 118, 210, 0.06)'
                        : 'background.paper',
                    transition: 'all 0.2s ease',
                    '&:hover': {
                        borderColor: 'primary.main',
                        backgroundColor: 'rgba(25, 118, 210, 0.04)',
                    },
                }}
            >
                <input {...getInputProps()} />
                {loading ? (
                    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1.5, justifyContent: 'center', width: '100%' }}>
                        <Typography color="text.secondary" variant={compact ? 'body2' : 'body1'}>
                            {stageLabel}
                        </Typography>
                        <LinearProgress
                            variant={isIndeterminate ? 'indeterminate' : 'determinate'}
                            value={isIndeterminate ? undefined : progressValue}
                            sx={{ width: '100%', borderRadius: 1, height: 6 }}
                        />
                    </Box>
                ) : compact ? (
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, justifyContent: 'center' }}>
                        {isDragActive
                            ? <InsertDriveFileIcon sx={{ fontSize: 20, color: 'primary.main' }} />
                            : <CloudUploadIcon sx={{ fontSize: 20, color: 'text.disabled' }} />
                        }
                        <Typography variant="body2" color={isDragActive ? 'primary.main' : 'text.secondary'}>
                            {isDragActive ? 'Отпустите файл здесь' : 'Добавить еще файл (CSV, XLS, XLSX, ODS)'}
                        </Typography>
                    </Box>
                ) : (
                    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1.5 }}>
                        {isDragActive ? (
                            <InsertDriveFileIcon sx={{ fontSize: 56, color: 'primary.main' }} />
                        ) : (
                            <CloudUploadIcon sx={{ fontSize: 56, color: 'text.disabled' }} />
                        )}
                        <Typography variant="h6" color={isDragActive ? 'primary.main' : 'text.primary'}>
                            {isDragActive ? 'Отпустите файл здесь' : 'Перетащите файл или нажмите для выбора'}
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                            CSV, XLS, XLSX, ODS · до 300 MB
                        </Typography>
                    </Box>
                )}
            </Paper>
            {error && (
                <Alert severity="error" sx={{ mt: 1.5 }} onClose={() => setError(null)}>
                    {error}
                </Alert>
            )}
        </Box>
    )
}
