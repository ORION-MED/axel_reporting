import { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert, Box, Chip, CircularProgress, IconButton, Stack, Tooltip, Typography } from '@mui/material'
import EditOutlinedIcon from '@mui/icons-material/EditOutlined'
import RefreshIcon from '@mui/icons-material/Refresh'
import { getReportingOrganizations, type ReportingOrganization } from '@shared/lib/reporting-api'
import { getErrorMessage } from '../lib/reporting-helpers'
import { IndicatorDetailTable, type IndicatorDetailColumn } from './IndicatorDetailTable'
import { OrganizationEditDialog } from './OrganizationEditDialog'

type OrganizationListFilter = 'all' | 'active' | 'inactive' | 'missing_geo'

/**
 * Roadmap step 4.2 — master-data organizations directory. Replaces the frozen
 * organization-geo.ts TS file as the place to fix an address or coordinates: edits here
 * are persisted in reporting_organizations and survive the next REMD re-import.
 */
export function OrganizationsTab() {
    const [organizations, setOrganizations] = useState<ReportingOrganization[]>([])
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [search, setSearch] = useState('')
    const [filter, setFilter] = useState<OrganizationListFilter>('all')
    const [editing, setEditing] = useState<ReportingOrganization | null>(null)

    const load = useCallback(async () => {
        setLoading(true)
        setError(null)
        try {
            setOrganizations(await getReportingOrganizations(true))
        } catch (err) {
            setError(getErrorMessage(err))
        } finally {
            setLoading(false)
        }
    }, [])

    useEffect(() => {
        void load()
    }, [load])

    const filtered = useMemo(() => {
        const query = search.trim().toLocaleLowerCase('ru-RU')
        return organizations.filter((organization) => {
            if (filter === 'active' && !organization.isActive) return false
            if (filter === 'inactive' && organization.isActive) return false
            if (filter === 'missing_geo' && organization.address.trim() !== '') return false
            if (!query) return true
            return [
                organization.officialFullName,
                organization.officialShortName,
                organization.commonName,
                organization.oid,
                organization.address,
                organization.activityType ?? '',
            ].join(' ').toLocaleLowerCase('ru-RU').includes(query)
        })
    }, [organizations, search, filter])

    const columns: Array<IndicatorDetailColumn<ReportingOrganization>> = [
        {
            key: 'name',
            header: 'Организация',
            width: '32%',
            render: (organization) => (
                <>
                    <Typography variant="body2" fontWeight={600}>
                        {organization.officialShortName || organization.officialFullName}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" fontFamily="monospace" display="block">
                        {organization.oid}
                    </Typography>
                </>
            ),
        },
        {
            key: 'address',
            header: 'Адрес',
            render: (organization) => (
                organization.address
                    ? <Typography variant="body2">{organization.address}</Typography>
                    : <Typography variant="body2" color="text.disabled">не указан</Typography>
            ),
        },
        {
            key: 'coordinates',
            header: 'Координаты',
            width: 170,
            render: (organization) => (
                organization.latitude === null || organization.longitude === null
                    ? <Typography variant="body2" color="text.disabled">—</Typography>
                    : (
                        <Typography variant="body2" fontFamily="monospace">
                            {organization.latitude.toFixed(5)}, {organization.longitude.toFixed(5)}
                        </Typography>
                    )
            ),
        },
        {
            key: 'activityType',
            header: 'Вид деятельности',
            width: 160,
            render: (organization) => (
                organization.activityType
                    ? <Typography variant="body2">{organization.activityType}</Typography>
                    : <Typography variant="body2" color="text.disabled">не указан</Typography>
            ),
        },
        {
            key: 'status',
            header: 'Статус',
            width: 110,
            render: (organization) => (
                <Chip
                    size="small"
                    label={organization.isActive ? 'Активна' : 'Неактивна'}
                    color={organization.isActive ? 'success' : 'default'}
                    variant={organization.isActive ? 'filled' : 'outlined'}
                />
            ),
        },
        {
            key: 'actions',
            header: '',
            width: 56,
            align: 'right',
            render: (organization) => (
                <Tooltip title="Редактировать">
                    <IconButton size="small" onClick={() => setEditing(organization)}>
                        <EditOutlinedIcon fontSize="small" />
                    </IconButton>
                </Tooltip>
            ),
        },
    ]

    return (
        <Stack spacing={1} sx={{ flex: 1, minHeight: 0 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <Typography variant="body2" color="text.secondary">
                    Справочник медицинских организаций и сопоставление их OID с внешними системами.
                </Typography>
                <Tooltip title="Обновить">
                    <span>
                        <IconButton size="small" onClick={() => void load()} disabled={loading}>
                            <RefreshIcon fontSize="small" />
                        </IconButton>
                    </span>
                </Tooltip>
            </Box>

            {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}

            {loading && organizations.length === 0 ? (
                <Box sx={{ display: 'grid', placeItems: 'center', minHeight: 280 }}>
                    <CircularProgress size={28} />
                </Box>
            ) : (
                <IndicatorDetailTable
                    rows={filtered}
                    getRowId={(organization) => organization.oid}
                    columns={columns}
                    filters={[
                        { value: 'all', label: 'Все' },
                        { value: 'active', label: 'Активные' },
                        { value: 'inactive', label: 'Неактивные' },
                        { value: 'missing_geo', label: 'Без адреса' },
                    ]}
                    activeFilter={filter}
                    onFilterChange={setFilter}
                    searchValue={search}
                    onSearchChange={setSearch}
                    searchPlaceholder="Поиск по названию, OID или адресу"
                    emptyMessage="Организации не найдены"
                    rowCountLabel={(count) => `${count} МО`}
                    tableMinWidth={900}
                />
            )}

            <OrganizationEditDialog
                organization={editing}
                onClose={() => setEditing(null)}
                onSaved={(saved) => {
                    setOrganizations((current) => current.map((item) => (item.oid === saved.oid ? saved : item)))
                    setEditing(null)
                }}
            />
        </Stack>
    )
}

export type { OrganizationListFilter }
