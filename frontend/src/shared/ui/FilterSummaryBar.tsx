import { Box, Button, Chip, Tooltip, type ChipProps } from '@mui/material'

export interface FilterChipItem {
    id: string
    label: string
    onDelete?: () => void
    color?: ChipProps['color']
    variant?: ChipProps['variant']
}

interface FilterSummaryBarProps {
    items: FilterChipItem[]
    onClearAll?: () => void
    clearAllLabel?: string
}

export function FilterSummaryBar({
    items,
    onClearAll,
    clearAllLabel = 'Очистить все',
}: FilterSummaryBarProps) {
    if (items.length === 0) return null

    return (
        <Box
            sx={{
                px: 2,
                py: 1,
                borderBottom: '1px solid',
                borderColor: 'divider',
                display: 'flex',
                alignItems: 'center',
                gap: 1,
                flexWrap: 'wrap',
                bgcolor: 'background.paper',
            }}
        >
            {items.map((item) => (
                <Tooltip key={item.id} title={item.label} placement="top" arrow>
                    <Chip
                        label={item.label}
                        onDelete={item.onDelete}
                        size="small"
                        color={item.color ?? 'warning'}
                        variant={item.variant ?? 'outlined'}
                        sx={{
                            maxWidth: 280,
                            '& .MuiChip-label': {
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                            },
                        }}
                    />
                </Tooltip>
            ))}
            {onClearAll && (
                <Button
                    size="small"
                    color="inherit"
                    onClick={onClearAll}
                    sx={{ ml: 'auto', whiteSpace: 'nowrap', minWidth: 'auto', px: 1 }}
                >
                    {clearAllLabel}
                </Button>
            )}
        </Box>
    )
}
