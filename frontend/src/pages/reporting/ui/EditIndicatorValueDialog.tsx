import type { Dispatch, SetStateAction } from 'react'
import {
    Box,
    Button,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    Divider,
    InputAdornment,
    Stack,
    TextField,
    Typography,
} from '@mui/material'
import SaveOutlinedIcon from '@mui/icons-material/SaveOutlined'
import type { ReportingIndicator } from '@shared/lib/reporting-api'
import type { ValueForm } from '../lib/reporting-helpers'

interface EditIndicatorValueDialogProps {
    editingIndicator: ReportingIndicator | null
    valueForm: ValueForm
    saving: boolean
    selectedPeriodId: string
    onFormChange: Dispatch<SetStateAction<ValueForm>>
    onClose: () => void
    onSave: () => void
}

export function EditIndicatorValueDialog({
    editingIndicator,
    valueForm,
    saving,
    selectedPeriodId,
    onFormChange,
    onClose,
    onSave,
}: EditIndicatorValueDialogProps) {
    return (
        <Dialog open={Boolean(editingIndicator)} onClose={onClose} maxWidth="sm" fullWidth>
            <DialogTitle>{editingIndicator?.code}</DialogTitle>
            <DialogContent sx={{ pt: 1 }}>
                {editingIndicator && (
                    <Stack spacing={1.5} sx={{ mt: 0.5 }}>
                        <Box>
                            <Typography variant="subtitle2" fontWeight={700}>
                                {editingIndicator.title}
                            </Typography>
                            <Typography variant="body2" color="text.secondary">
                                {editingIndicator.formulaText}
                            </Typography>
                        </Box>
                        <Divider />
                        <TextField
                            label="Числитель"
                            type="number"
                            size="small"
                            value={valueForm.numerator}
                            onChange={(event) => onFormChange((prev) => ({ ...prev, numerator: event.target.value }))}
                            helperText={editingIndicator.numeratorLabel}
                            inputProps={{ inputMode: 'decimal', min: 0 }}
                            fullWidth
                        />
                        <TextField
                            label="Знаменатель"
                            type="number"
                            size="small"
                            value={valueForm.denominator}
                            onChange={(event) => onFormChange((prev) => ({ ...prev, denominator: event.target.value }))}
                            helperText={editingIndicator.denominatorLabel}
                            inputProps={{ inputMode: 'decimal', min: 0 }}
                            fullWidth
                        />
                        <TextField
                            label="План"
                            type="number"
                            size="small"
                            value={valueForm.targetValue}
                            onChange={(event) => onFormChange((prev) => ({ ...prev, targetValue: event.target.value }))}
                            inputProps={{ inputMode: 'decimal', min: 0, max: 100 }}
                            InputProps={{
                                endAdornment: <InputAdornment position="end">%</InputAdornment>,
                            }}
                            fullWidth
                        />
                        <TextField
                            label="Источник"
                            size="small"
                            value={valueForm.sourceName}
                            onChange={(event) => onFormChange((prev) => ({ ...prev, sourceName: event.target.value }))}
                            fullWidth
                        />
                        <TextField
                            label="Комментарий"
                            size="small"
                            value={valueForm.note}
                            onChange={(event) => onFormChange((prev) => ({ ...prev, note: event.target.value }))}
                            minRows={2}
                            multiline
                            fullWidth
                        />
                    </Stack>
                )}
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose} disabled={saving}>
                    Отмена
                </Button>
                <Button
                    variant="contained"
                    startIcon={<SaveOutlinedIcon />}
                    onClick={onSave}
                    disabled={saving || !selectedPeriodId}
                >
                    Сохранить
                </Button>
            </DialogActions>
        </Dialog>
    )
}
