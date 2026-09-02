import type { Dispatch, SetStateAction } from 'react'
import {
    Button,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    Stack,
    TextField,
} from '@mui/material'
import SaveOutlinedIcon from '@mui/icons-material/SaveOutlined'
import type { PeriodForm } from '../lib/reporting-helpers'

interface PeriodDialogProps {
    open: boolean
    saving: boolean
    periodForm: PeriodForm
    onFormChange: Dispatch<SetStateAction<PeriodForm>>
    onClose: () => void
    onSave: () => void
}

export function PeriodDialog({
    open,
    saving,
    periodForm,
    onFormChange,
    onClose,
    onSave,
}: PeriodDialogProps) {
    return (
        <Dialog open={open} onClose={() => !saving && onClose()} maxWidth="xs" fullWidth>
            <DialogTitle>Отчетный период</DialogTitle>
            <DialogContent sx={{ pt: 1 }}>
                <Stack spacing={1.5} sx={{ mt: 0.5 }}>
                    <TextField
                        label="Название"
                        size="small"
                        value={periodForm.name}
                        onChange={(event) => onFormChange((prev) => ({ ...prev, name: event.target.value }))}
                        fullWidth
                        autoFocus
                    />
                    <TextField
                        label="Код"
                        size="small"
                        value={periodForm.code}
                        onChange={(event) => onFormChange((prev) => ({ ...prev, code: event.target.value }))}
                        fullWidth
                    />
                    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                        <TextField
                            label="Начало"
                            type="date"
                            size="small"
                            value={periodForm.dateFrom}
                            onChange={(event) => onFormChange((prev) => ({ ...prev, dateFrom: event.target.value }))}
                            InputLabelProps={{ shrink: true }}
                            fullWidth
                        />
                        <TextField
                            label="Окончание"
                            type="date"
                            size="small"
                            value={periodForm.dateTo}
                            onChange={(event) => onFormChange((prev) => ({ ...prev, dateTo: event.target.value }))}
                            InputLabelProps={{ shrink: true }}
                            fullWidth
                        />
                    </Stack>
                </Stack>
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose} disabled={saving}>
                    Отмена
                </Button>
                <Button
                    variant="contained"
                    startIcon={<SaveOutlinedIcon />}
                    onClick={onSave}
                    disabled={saving || !periodForm.name.trim()}
                >
                    Сохранить
                </Button>
            </DialogActions>
        </Dialog>
    )
}
