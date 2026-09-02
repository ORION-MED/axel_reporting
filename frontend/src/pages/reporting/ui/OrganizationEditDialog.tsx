import { useEffect, useState } from 'react'
import {
    Alert,
    Box,
    Button,
    Chip,
    CircularProgress,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    Divider,
    FormControlLabel,
    IconButton,
    MenuItem,
    Stack,
    Switch,
    TextField,
    Typography,
} from '@mui/material'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import AddIcon from '@mui/icons-material/Add'
import {
    addOrganizationExternalId,
    getOrganizationExternalIds,
    removeOrganizationExternalId,
    updateReportingOrganization,
    type ReportingOrganization,
    type ReportingOrganizationExternalId,
    type ReportingOrganizationExternalIdSystem,
} from '@shared/lib/reporting-api'
import { getErrorMessage } from '../lib/reporting-helpers'

const EXTERNAL_ID_SYSTEMS: ReportingOrganizationExternalIdSystem[] = ['фомс', 'фрмо', 'прочее']
const LOCATION_PRECISIONS = ['exact', 'street', 'locality', 'approximate', 'unknown'] as const

const PRECISION_LABEL: Record<string, string> = {
    exact: 'Точный адрес',
    street: 'Улица',
    locality: 'Населенный пункт',
    approximate: 'Приблизительно',
    unknown: 'Неизвестно',
}

interface OrganizationEditDialogProps {
    organization: ReportingOrganization | null
    onClose: () => void
    onSaved: (organization: ReportingOrganization) => void
}

export function OrganizationEditDialog({ organization, onClose, onSaved }: OrganizationEditDialogProps) {
    const [officialFullName, setOfficialFullName] = useState('')
    const [officialShortName, setOfficialShortName] = useState('')
    const [commonName, setCommonName] = useState('')
    const [address, setAddress] = useState('')
    const [latitude, setLatitude] = useState('')
    const [longitude, setLongitude] = useState('')
    const [locationPrecision, setLocationPrecision] = useState('unknown')
    const [isActive, setIsActive] = useState(true)
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const [externalIds, setExternalIds] = useState<ReportingOrganizationExternalId[]>([])
    const [externalIdsLoading, setExternalIdsLoading] = useState(false)
    const [newSystem, setNewSystem] = useState<ReportingOrganizationExternalIdSystem>('фомс')
    const [newExternalId, setNewExternalId] = useState('')
    const [newNote, setNewNote] = useState('')
    const [addingExternalId, setAddingExternalId] = useState(false)

    useEffect(() => {
        if (!organization) return
        setOfficialFullName(organization.officialFullName)
        setOfficialShortName(organization.officialShortName)
        setCommonName(organization.commonName)
        setAddress(organization.address)
        setLatitude(organization.latitude === null ? '' : String(organization.latitude))
        setLongitude(organization.longitude === null ? '' : String(organization.longitude))
        setLocationPrecision(organization.locationPrecision)
        setIsActive(organization.isActive)
        setError(null)
        setNewSystem('фомс')
        setNewExternalId('')
        setNewNote('')

        setExternalIdsLoading(true)
        getOrganizationExternalIds(organization.oid)
            .then(setExternalIds)
            .catch((err) => setError(getErrorMessage(err)))
            .finally(() => setExternalIdsLoading(false))
    }, [organization])

    if (!organization) return null

    const handleSave = async () => {
        setSaving(true)
        setError(null)
        try {
            const saved = await updateReportingOrganization(organization.oid, {
                officialFullName,
                officialShortName,
                commonName,
                address,
                latitude: latitude.trim() === '' ? null : latitude,
                longitude: longitude.trim() === '' ? null : longitude,
                locationPrecision,
                isActive,
            })
            onSaved(saved)
        } catch (err) {
            setError(getErrorMessage(err))
        } finally {
            setSaving(false)
        }
    }

    const handleAddExternalId = async () => {
        if (!newExternalId.trim()) return
        setAddingExternalId(true)
        setError(null)
        try {
            const created = await addOrganizationExternalId(organization.oid, {
                system: newSystem,
                externalId: newExternalId.trim(),
                note: newNote.trim(),
            })
            setExternalIds((current) => [...current, created])
            setNewExternalId('')
            setNewNote('')
        } catch (err) {
            setError(getErrorMessage(err))
        } finally {
            setAddingExternalId(false)
        }
    }

    const handleRemoveExternalId = async (id: string) => {
        setError(null)
        try {
            await removeOrganizationExternalId(organization.oid, id)
            setExternalIds((current) => current.filter((item) => item.id !== id))
        } catch (err) {
            setError(getErrorMessage(err))
        }
    }

    return (
        <Dialog open={Boolean(organization)} onClose={() => { if (!saving) onClose() }} maxWidth="sm" fullWidth>
            <DialogTitle>Медицинская организация</DialogTitle>
            <DialogContent dividers>
                <Stack spacing={1.5}>
                    <Typography variant="caption" color="text.secondary" fontFamily="monospace">
                        OID: {organization.oid}
                    </Typography>

                    {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}

                    <TextField
                        label="Официальное полное наименование"
                        value={officialFullName}
                        onChange={(event) => setOfficialFullName(event.target.value)}
                        size="small"
                        fullWidth
                    />
                    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                        <TextField
                            label="Краткое наименование"
                            value={officialShortName}
                            onChange={(event) => setOfficialShortName(event.target.value)}
                            size="small"
                            fullWidth
                        />
                        <TextField
                            label="Общеупотребимое название"
                            value={commonName}
                            onChange={(event) => setCommonName(event.target.value)}
                            size="small"
                            fullWidth
                        />
                    </Stack>

                    <TextField
                        label="Адрес"
                        value={address}
                        onChange={(event) => setAddress(event.target.value)}
                        size="small"
                        fullWidth
                    />
                    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                        <TextField
                            label="Широта"
                            value={latitude}
                            onChange={(event) => setLatitude(event.target.value)}
                            size="small"
                            fullWidth
                        />
                        <TextField
                            label="Долгота"
                            value={longitude}
                            onChange={(event) => setLongitude(event.target.value)}
                            size="small"
                            fullWidth
                        />
                        <TextField
                            select
                            label="Точность"
                            value={locationPrecision}
                            onChange={(event) => setLocationPrecision(event.target.value)}
                            size="small"
                            fullWidth
                        >
                            {LOCATION_PRECISIONS.map((precision) => (
                                <MenuItem key={precision} value={precision}>
                                    {PRECISION_LABEL[precision]}
                                </MenuItem>
                            ))}
                        </TextField>
                    </Stack>
                    {organization.locationSource && (
                        <Typography variant="caption" color="text.secondary">
                            Источник геоданных: {organization.locationSource}
                        </Typography>
                    )}

                    <FormControlLabel
                        control={<Switch checked={isActive} onChange={(event) => setIsActive(event.target.checked)} />}
                        label="Активна (участвует в текущей отчетности)"
                    />

                    <Divider />

                    <Typography variant="subtitle2" fontWeight={700}>
                        Сопоставление с внешними системами
                    </Typography>

                    {externalIdsLoading ? (
                        <Box sx={{ display: 'flex', justifyContent: 'center', py: 1 }}>
                            <CircularProgress size={20} />
                        </Box>
                    ) : externalIds.length === 0 ? (
                        <Typography variant="body2" color="text.secondary">
                            Сопоставлений пока нет.
                        </Typography>
                    ) : (
                        <Stack spacing={0.5}>
                            {externalIds.map((item) => (
                                <Stack key={item.id} direction="row" spacing={1} alignItems="center">
                                    <Chip size="small" label={item.system} />
                                    <Typography variant="body2" fontFamily="monospace" sx={{ flex: 1 }}>
                                        {item.externalId}
                                    </Typography>
                                    {item.note && (
                                        <Typography variant="caption" color="text.secondary">
                                            {item.note}
                                        </Typography>
                                    )}
                                    <IconButton size="small" onClick={() => void handleRemoveExternalId(item.id)}>
                                        <DeleteOutlineIcon fontSize="small" />
                                    </IconButton>
                                </Stack>
                            ))}
                        </Stack>
                    )}

                    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ sm: 'center' }}>
                        <TextField
                            select
                            size="small"
                            label="Система"
                            value={newSystem}
                            onChange={(event) => setNewSystem(event.target.value as ReportingOrganizationExternalIdSystem)}
                            sx={{ width: { sm: 120 } }}
                        >
                            {EXTERNAL_ID_SYSTEMS.map((system) => (
                                <MenuItem key={system} value={system}>{system}</MenuItem>
                            ))}
                        </TextField>
                        <TextField
                            size="small"
                            label="Идентификатор"
                            value={newExternalId}
                            onChange={(event) => setNewExternalId(event.target.value)}
                            sx={{ flex: 1 }}
                        />
                        <TextField
                            size="small"
                            label="Примечание"
                            value={newNote}
                            onChange={(event) => setNewNote(event.target.value)}
                            sx={{ flex: 1 }}
                        />
                        <Button
                            size="small"
                            variant="outlined"
                            startIcon={addingExternalId ? <CircularProgress size={14} /> : <AddIcon />}
                            disabled={addingExternalId || !newExternalId.trim()}
                            onClick={() => void handleAddExternalId()}
                            sx={{ textTransform: 'none', whiteSpace: 'nowrap' }}
                        >
                            Добавить
                        </Button>
                    </Stack>
                </Stack>
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose} disabled={saving}>Закрыть</Button>
                <Button
                    variant="contained"
                    onClick={() => void handleSave()}
                    disabled={saving || !officialFullName.trim()}
                    startIcon={saving ? <CircularProgress size={16} /> : undefined}
                >
                    Сохранить
                </Button>
            </DialogActions>
        </Dialog>
    )
}
