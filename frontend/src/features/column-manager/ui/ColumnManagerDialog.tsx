import {
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    Button,
    List,
    ListItem,
    ListItemText,
    Switch,
    Box,
    Typography,
    Chip,
    Divider,
    IconButton,
} from '@mui/material'
import CloseIcon from '@mui/icons-material/Close'
import VisibilityIcon from '@mui/icons-material/Visibility'
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff'
import { useTableStore } from '@entities/table'

interface Props {
    open: boolean
    onClose: () => void
}

const TYPE_LABELS: Record<string, { label: string; color: 'primary' | 'secondary' | 'default' }> =
{
    number: { label: 'Число', color: 'primary' },
    date: { label: 'Дата', color: 'secondary' },
    string: { label: 'Строка', color: 'default' },
}

// Функция ColumnManagerDialog

export const ColumnManagerDialog = ({ open, onClose }: Props) => {
    // Функция activeState
    const activeState = useTableStore((s) => s.getActiveState())
    // Устанавливает column visibility
    const setColumnVisibility = useTableStore((s) => s.setColumnVisibility)
    // Устанавливает all columns visibility
    const setAllColumnsVisibility = useTableStore((s) => s.setAllColumnsVisibility)

    if (!activeState) return null

    const columns = activeState.columns
    // Функция visibleCount
    const visibleCount = columns.filter((c) => c.visible).length

    // Обрабатывает событие/действие show all

    const handleShowAll = () => setAllColumnsVisibility(true)
    // Обрабатывает событие/действие hide all
    const handleHideAll = () => setAllColumnsVisibility(false)

    return (
        <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
            <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <VisibilityIcon color="primary" />
                <Box sx={{ flex: 1 }}>
                    Настроить столбцы
                    <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 400 }}>
                        Показано {visibleCount} из {columns.length} столбцов
                    </Typography>
                </Box>
                <IconButton size="small" onClick={onClose}>
                    <CloseIcon fontSize="small" />
                </IconButton>
            </DialogTitle>

            <DialogContent dividers sx={{ p: 0 }}>
                <Box sx={{ px: 2, py: 1, display: 'flex', gap: 1, borderBottom: '1px solid', borderColor: 'divider' }}>
                    <Button size="small" startIcon={<VisibilityIcon />} onClick={handleShowAll}>
                        Показать все
                    </Button>
                    <Button size="small" startIcon={<VisibilityOffIcon />} onClick={handleHideAll} color="inherit">
                        Скрыть все
                    </Button>
                </Box>
                <List disablePadding>
                    {columns.map((col, idx) => (
                        <Box key={col.field}>
                            <ListItem
                                sx={{
                                    px: 2,
                                    py: 0.75,
                                    opacity: col.visible ? 1 : 0.5,
                                    transition: 'opacity 0.2s',
                                }}
                            >
                                <ListItemText
                                    primary={
                                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                            <Typography variant="body2" sx={{ fontWeight: 500 }}>
                                                {col.headerName}
                                            </Typography>
                                            <Chip
                                                label={TYPE_LABELS[col.type]?.label ?? col.type}
                                                color={TYPE_LABELS[col.type]?.color ?? 'default'}
                                                size="small"
                                                variant="outlined"
                                                sx={{ height: 18, fontSize: '0.68rem' }}
                                            />
                                        </Box>
                                    }
                                />
                                <Switch
                                    checked={col.visible}
                                    onChange={(e) => setColumnVisibility(col.field, e.target.checked)}
                                    size="small"
                                    color="primary"
                                />
                            </ListItem>
                            {idx < columns.length - 1 && <Divider />}
                        </Box>
                    ))}
                </List>
            </DialogContent>

            <DialogActions>
                <Button onClick={onClose} variant="contained" disableElevation>
                    Готово
                </Button>
            </DialogActions>
        </Dialog>
    )
}
