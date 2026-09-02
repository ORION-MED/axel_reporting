import {
    Alert,
    Box,
    Button,
    CircularProgress,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    MenuItem,
    Stack,
    TextField,
    Typography,
} from '@mui/material'
import SaveOutlinedIcon from '@mui/icons-material/SaveOutlined'
import { requirementStatusView, type InstitutionSemdType } from '../lib/reporting-helpers'

interface RequirementOverrideDialogProps {
    editingInstitutionType: InstitutionSemdType | null
    requirementOverrideStatus: 'required' | 'not_required'
    requirementOverrideReason: string
    requirementOverrideSaving: boolean
    requirementOverrideError: string | null
    onClose: () => void
    onStatusChange: (status: 'required' | 'not_required') => void
    onReasonChange: (reason: string) => void
    onSave: (requirementStatus: 'required' | 'not_required' | null) => void
}

export function RequirementOverrideDialog({
    editingInstitutionType,
    requirementOverrideStatus,
    requirementOverrideReason,
    requirementOverrideSaving,
    requirementOverrideError,
    onClose,
    onStatusChange,
    onReasonChange,
    onSave,
}: RequirementOverrideDialogProps) {
    return (
        <Dialog
            open={Boolean(editingInstitutionType)}
            onClose={() => {
                if (!requirementOverrideSaving) onClose()
            }}
            maxWidth="sm"
            fullWidth
        >
            <DialogTitle>Уточнение применимости СЭМД</DialogTitle>
            <DialogContent dividers>
                {editingInstitutionType && (
                    <Stack spacing={2}>
                        <Box>
                            <Typography variant="subtitle2" fontWeight={800}>
                                TYPE={editingInstitutionType.nsiTypeCode}
                                {' · '}
                                {editingInstitutionType.name}
                            </Typography>
                            <Typography variant="caption" color="text.secondary">
                                Исходное правило:
                                {' '}
                                {requirementStatusView(
                                    editingInstitutionType.baseRequirementStatus,
                                ).label}
                                {editingInstitutionType.baseRequirementSource
                                    ? ` · ${editingInstitutionType.baseRequirementSource}`
                                    : ''}
                            </Typography>
                        </Box>

                        {editingInstitutionType.manualOverride && (
                            <Alert severity="info">
                                Сейчас действует ручное уточнение:
                                {' '}
                                {requirementStatusView(
                                    editingInstitutionType.manualOverride.status,
                                ).label}
                                . Основание:
                                {' '}
                                {editingInstitutionType.manualOverride.reason}
                            </Alert>
                        )}

                        <TextField
                            select
                            fullWidth
                            label="Применимость для выбранного МО"
                            value={requirementOverrideStatus}
                            disabled={requirementOverrideSaving}
                            onChange={(event) => onStatusChange(
                                event.target.value as 'required' | 'not_required',
                            )}
                        >
                            <MenuItem value="required">
                                Обязательно формировать
                            </MenuItem>
                            <MenuItem value="not_required">
                                Не требуется
                            </MenuItem>
                        </TextField>

                        <TextField
                            fullWidth
                            required
                            multiline
                            minRows={3}
                            label="Основание изменения"
                            placeholder="Например: подтверждено государственным заданием МО"
                            value={requirementOverrideReason}
                            disabled={requirementOverrideSaving}
                            error={Boolean(requirementOverrideError)}
                            helperText={
                                requirementOverrideError
                                ?? 'Основание сохранится в журнале вместе с пользователем и временем изменения.'
                            }
                            onChange={(event) => {
                                onReasonChange(event.target.value)
                            }}
                        />
                    </Stack>
                )}
            </DialogContent>
            <DialogActions>
                <Button
                    disabled={requirementOverrideSaving}
                    onClick={onClose}
                >
                    Отмена
                </Button>
                {editingInstitutionType?.manualOverride && (
                    <Button
                        color="warning"
                        disabled={
                            requirementOverrideSaving
                            || !requirementOverrideReason.trim()
                        }
                        onClick={() => onSave(null)}
                    >
                        Снять уточнение
                    </Button>
                )}
                <Button
                    variant="contained"
                    disabled={
                        requirementOverrideSaving
                        || !requirementOverrideReason.trim()
                    }
                    startIcon={
                        requirementOverrideSaving
                            ? <CircularProgress size={16} color="inherit" />
                            : <SaveOutlinedIcon />
                    }
                    onClick={() => onSave(requirementOverrideStatus)}
                >
                    Сохранить и пересчитать
                </Button>
            </DialogActions>
        </Dialog>
    )
}
