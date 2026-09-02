import React, { useMemo, useState, useEffect, useRef, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
    Box, Typography, Tabs, Tab, Chip, Alert,
    Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
    Paper, LinearProgress, Tooltip, Grid,
    Accordion, AccordionSummary, AccordionDetails,
    ToggleButton, ToggleButtonGroup,
    FormControl, InputLabel, Select, MenuItem,
    Button, Dialog, DialogTitle, DialogContent, IconButton,
} from '@mui/material'
import BarChartIcon from '@mui/icons-material/BarChart'
import TableChartIcon from '@mui/icons-material/TableChart'
import BubbleChartIcon from '@mui/icons-material/BubbleChart'
import HealthAndSafetyIcon from '@mui/icons-material/HealthAndSafety'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import FunctionsIcon from '@mui/icons-material/Functions'
import CandlestickChartIcon from '@mui/icons-material/CandlestickChart'
import AutoGraphIcon from '@mui/icons-material/AutoGraph'
import TimelineIcon from '@mui/icons-material/Timeline'
import ShowChartIcon from '@mui/icons-material/ShowChart'
import GpsFixedIcon from '@mui/icons-material/GpsFixed'
import CloseIcon from '@mui/icons-material/Close'
import {
    BarChart, Bar, XAxis, YAxis, Tooltip as RTooltip, ResponsiveContainer,
    Cell, CartesianGrid, ScatterChart, Scatter, LineChart, Line, Legend, ReferenceLine, LabelList,
} from 'recharts'
import { useTableStore } from '@entities/table'
import { computeUnivariateTests } from '@features/file-upload'
import { ReportProblemButton } from '@features/support'
import type { NumericColStats, CategoricalColStats, DatasetStats, DatasetOverview, PairwisePValue, NormalityResult, UnivariateResult } from '@features/file-upload'
import type { CorrWorkerOutput } from '@shared/lib/correlationWorker'
import { getDatasetOverviewArtifact, getDatasetStatsArtifact, getPvalueMatrixArtifact } from '@shared/lib/api'
import { projectRows } from '@shared/lib'
import type { ParsedRow } from '@shared/types'



// Функция fmt



const fmt = (n: number, digits = 3): string => {
    if (n == null || !isFinite(n) || isNaN(n)) return '—'
    if (Math.abs(n) >= 1e6 || (Math.abs(n) < 0.001 && n !== 0)) return n.toExponential(2)
    return +n.toFixed(digits) + ''
}
// Функция pct
const pct = (n: number) => isNaN(n) ? '—' : (n * 100).toFixed(1) + '%'

function TruncatedText({
    value,
    maxWidth = 180,
    fontWeight,
    fontSize,
}: {
    value: unknown
    maxWidth?: number
    fontWeight?: number
    fontSize?: string
}) {
    const text = String(value ?? '')
    return (
        <Tooltip title={text} arrow disableHoverListener={text.length < 24}>
            <Box
                component="span"
                sx={{
                    display: 'inline-block',
                    maxWidth,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    verticalAlign: 'bottom',
                    fontWeight,
                    fontSize,
                }}
            >
                {text}
            </Box>
        </Tooltip>
    )
}

const CORR_PALETTES = [
    { id: 'blue_red',     label: 'Синий → Красный',    colors: ['#1a237e','#1565c0','#1976d2','#42a5f5','#90caf9','#e3f2fd','#fff','#fce4ec','#ef9a9a','#e53935','#b71c1c'] },
    { id: 'teal_warm',    label: 'Бирюза → Тёплый',    colors: ['#004d40','#00897b','#4db6ac','#b2dfdb','#e0f2f1','#fff','#fff8e1','#ffca28','#fb8c00','#e65100','#bf360c'] },
    { id: 'purple_green', label: 'Пурпурный → Зелёный', colors: ['#4a148c','#7b1fa2','#ba68c8','#e1bee7','#f9f0ff','#fff','#f1f8e9','#aed581','#43a047','#2e7d32','#1b5e20'] },
    { id: 'coolwarm',     label: 'Холодный → Тёплый',  colors: ['#283593','#3949ab','#7986cb','#c5cae9','#e8eaf6','#fff','#fff3e0','#ffb74d','#e64a19','#c62828','#b71c1c'] },
    { id: 'mono',         label: 'Монохром',             colors: ['#111827','#374151','#6b7280','#9ca3af','#d1d5db','#f9fafb','#fff','#f9fafb','#d1d5db','#9ca3af','#374151'] },
] as const

const CATEGORICAL_PALETTE = ['#3b82f6', '#ef4444', '#22c55e', '#f59e0b', '#8b5cf6', '#06b6d4', '#ec4899', '#84cc16']
type PaletteId = typeof CORR_PALETTES[number]['id']

function paletteColor(colors: readonly string[], val: number | null, minVal: number): string {
    if (val == null || isNaN(val)) return '#f5f5f5'
    const normalized = Math.max(0, Math.min(1, (val - minVal) / (1 - minVal)))
    const idx = Math.round(normalized * (colors.length - 1))
    return colors[idx]
}

// Функция vifColor

function vifColor(v: number | null): 'success' | 'warning' | 'error' | 'default' {
    if (v == null) return 'default'
    if (v < 5) return 'success'
    if (v < 10) return 'warning'
    return 'error'
}



// Функция OverviewTab



function OverviewTab({ overview }: { overview: DatasetOverview }) {
    const q = overview.quality
    const summaryCards = [
        { label: 'Строк', value: q.totalRows.toLocaleString() },
        { label: 'Столбцев', value: q.totalCols.toLocaleString() },
        { label: 'Дубликаты', value: `${q.duplicateRows} (${pct(q.duplicateRowsPct)})` },
        { label: 'Пропущено ячеек', value: `${q.missingCells} (${pct(q.missingCellsPct)})` },
    ]
    return (
        <Box>
            <Grid container spacing={2} mb={3}>
                {summaryCards.map((c) => (
                    <Grid item xs={6} sm={3} key={c.label}>
                        <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, textAlign: 'center' }}>
                            <Typography variant="h5" fontWeight={700}>{c.value}</Typography>
                            <Typography variant="caption" color="text.secondary">{c.label}</Typography>
                        </Paper>
                    </Grid>
                ))}
            </Grid>

            <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 2 }}>
                <Table size="small">
                    <TableHead>
                        <TableRow sx={{ bgcolor: 'grey.50' }}>
                            {['Колонка', 'Тип', 'N', 'Пропуски', 'Уникальных'].map((h) => (
                                <TableCell key={h} sx={{ fontWeight: 600, fontSize: '0.78rem' }}>{h}</TableCell>
                            ))}
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {overview.columns.map((col) => (
                            <TableRow key={col.field} hover>
                                <TableCell sx={{ fontWeight: 500, maxWidth: 220 }}>
                                    <TruncatedText value={col.field} maxWidth={210} fontWeight={500} />
                                </TableCell>
                                <TableCell>
                                    <Chip
                                        label={col.colType}
                                        size="small"
                                        color={col.colType === 'number' ? 'primary' : 'default'}
                                        variant="outlined"
                                        sx={{ fontSize: '0.7rem' }}
                                    />
                                </TableCell>
                                <TableCell>{col.n}</TableCell>
                                <TableCell>
                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                        {pct(col.missingPct)}
                                        <LinearProgress
                                            variant="determinate"
                                            value={col.missingPct * 100}
                                            sx={{
                                                width: 50, height: 4, borderRadius: 2,
                                                '& .MuiLinearProgress-bar': {
                                                    bgcolor: col.missingPct > 0.5 ? 'error.main' : col.missingPct > 0.1 ? 'warning.main' : 'success.main'
                                                }
                                            }}
                                        />
                                    </Box>
                                </TableCell>
                                <TableCell>
                                    {col.kind === 'categorical' ? col.unique : '—'}
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </TableContainer>
        </Box>
    )
}



// Функция DataQualityTab



function DataQualityTab({ overview }: { overview: DatasetOverview }) {
    const q = overview.quality
    const missingData = useMemo(
        () => Object.entries(q.missingByCol)
            .map(([field, count]) => ({ field, count, pctVal: count / q.totalRows }))
            .sort((a, b) => b.count - a.count),
        [q.missingByCol, q.totalRows],
    )

    return (
        <Box>
            {q.duplicateRows > 0 && (
                <Alert severity="warning" sx={{ mb: 2, borderRadius: 2 }}>
                    Найдено <strong>{q.duplicateRows}</strong> дублирующих строк ({pct(q.duplicateRowsPct)} от общего числа).
                </Alert>
            )}
            {q.highMissingCols.length > 0 && (
                <Alert severity="error" sx={{ mb: 2, borderRadius: 2 }}>
                    Колонки с &gt; 50% пропусков: {q.highMissingCols.map((f) => <Chip key={f} label={f} size="small" color="error" sx={{ mx: 0.3 }} />)}
                </Alert>
            )}
            {q.constantOrIdCols.length > 0 && (
                <Alert severity="info" sx={{ mb: 2, borderRadius: 2 }}>
                    Подозрительные колонки (константа или уникальный ID): {q.constantOrIdCols.map((f) => <Chip key={f} label={f} size="small" sx={{ mx: 0.3 }} />)}
                </Alert>
            )}

            <Typography variant="subtitle1" fontWeight={600} mb={1}>Пропущенные значения по колонкам</Typography>
            <Box sx={{ height: Math.max(200, missingData.length * 32 + 60) }}>
                <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={missingData} layout="vertical" margin={{ left: 20, right: 40 }}>
                        <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                        <XAxis type="number" tickFormatter={(v) => pct(v)} domain={[0, 1]} />
                        <YAxis type="category" dataKey="field" width={140} tick={{ fontSize: 12 }} />
                        <RTooltip formatter={(v: number | undefined) => [pct(v ?? NaN), 'Пропуски']} />
                        <Bar dataKey="pctVal" radius={[0, 4, 4, 0]}>
                            {missingData.map((d) => (
                                <Cell
                                    key={d.field}
                                    fill={d.pctVal > 0.5 ? '#ef4444' : d.pctVal > 0.1 ? '#f97316' : '#22c55e'}
                                />
                            ))}
                        </Bar>
                    </BarChart>
                </ResponsiveContainer>
            </Box>
        </Box>
    )
}



// Функция NumericDistCard



function NumericDistCard({ col }: { col: NumericColStats }) {
    const stats = [
        ['n', col.n], ['missing', `${col.missing} (${pct(col.missingPct)})`],
        ['mean', fmt(col.mean)], ['median', fmt(col.median)],
        ['std', fmt(col.std)], ['IQR', fmt(col.iqr)],
        ['min', fmt(col.min)], ['max', fmt(col.max)],
        ['p5', fmt(col.p5)], ['p25', fmt(col.p25)],
        ['p75', fmt(col.p75)], ['p95', fmt(col.p95)],
        ['skewness', fmt(col.skewness)], ['kurtosis', fmt(col.kurtosis)],
    ]
    return (
        <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, mb: 2 }}>
            <Typography variant="subtitle2" fontWeight={700} mb={1}>
                <TruncatedText value={col.field} maxWidth={320} fontWeight={700} />
            </Typography>
            <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mb: 1.5 }}>
                {stats.map(([k, v]) => (
                    <Box key={k as string} sx={{ minWidth: 80 }}>
                        <Typography variant="caption" color="text.secondary" display="block">{k}</Typography>
                        <Typography variant="body2" fontWeight={500}>{v}</Typography>
                    </Box>
                ))}
            </Box>
            {col.histogram.length > 0 && (
                <Box sx={{ height: 140 }}>
                    <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={col.histogram} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} />
                            <XAxis dataKey="range" tick={false} />
                            <YAxis tick={{ fontSize: 10 }} width={30} />
                            <RTooltip
                                formatter={(v: number | undefined) => [v ?? 0, 'Частота']}
                                labelFormatter={(label) => `Диапазон: ${label}`}
                            />
                            <Bar dataKey="count" fill="#3b82f6" radius={[2, 2, 0, 0]} />
                        </BarChart>
                    </ResponsiveContainer>
                </Box>
            )}
        </Paper>
    )
}

// Функция CategoricalDistCard

function CategoricalDistCard({ col }: { col: CategoricalColStats }) {
    return (
        <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, mb: 2 }}>
            <Typography variant="subtitle2" fontWeight={700} mb={0.5}>
                <TruncatedText value={col.field} maxWidth={320} fontWeight={700} />
            </Typography>
            <Box sx={{ display: 'flex', gap: 3, flexWrap: 'wrap', mb: 1.5 }}>
                {[
                    ['n', col.n], ['missing', `${col.missing} (${pct(col.missingPct)})`],
                    ['unique', col.unique], ['mode', `"${col.mode}" (${pct(col.modePct)})`],
                    ['rare (<1%)', col.rareCount],
                ].map(([k, v]) => (
                    <Box key={k as string}>
                        <Typography variant="caption" color="text.secondary" display="block">{k}</Typography>
                        <Typography variant="body2" fontWeight={500}>{v}</Typography>
                    </Box>
                ))}
            </Box>
            {col.histogram.length > 0 && (
                <Box sx={{ height: 200 }}>
                    <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={col.histogram} margin={{ top: 0, right: 8, bottom: 60, left: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} />
                            <XAxis
                                dataKey="value"
                                tick={{ fontSize: 10 }}
                                angle={-40}
                                textAnchor="end"
                                interval={0}
                                tickFormatter={(v: string) => v != null && String(v).length > 18 ? String(v).slice(0, 16) + '…' : String(v)}
                            />
                            <YAxis tick={{ fontSize: 10 }} width={30} />
                            <RTooltip formatter={(v: number | undefined, _: string | undefined, p: any) => [`${v ?? 0} (${pct(p?.payload?.pct ?? 0)})`, 'Частота']} />
                            <Bar dataKey="count" fill="#8b5cf6" radius={[2, 2, 0, 0]} />
                        </BarChart>
                    </ResponsiveContainer>
                </Box>
            )}
        </Paper>
    )
}

// Функция DistributionsTab

function DistributionsTab({ stats }: { stats: DatasetStats }) {
    // Функция numCols
    const numCols = stats.columns.filter((c): c is NumericColStats => c.kind === 'numeric')
    // Функция catCols
    const catCols = stats.columns.filter((c): c is CategoricalColStats => c.kind === 'categorical')
    return (
        <Box>
            {numCols.length > 0 && (
                <>
                    <Typography variant="subtitle1" fontWeight={600} mb={1}>Числовые колонки</Typography>
                    <Grid container spacing={2}>
                        {numCols.map((col) => (
                            <Grid item xs={12} md={6} key={col.field}>
                                <NumericDistCard col={col} />
                            </Grid>
                        ))}
                    </Grid>
                </>
            )}
            {catCols.length > 0 && (
                <>
                    <Typography variant="subtitle1" fontWeight={600} mt={2} mb={1}>Категориальные колонки</Typography>
                    <Grid container spacing={2}>
                        {catCols.map((col) => (
                            <Grid item xs={12} md={6} key={col.field}>
                                <CategoricalDistCard col={col} />
                            </Grid>
                        ))}
                    </Grid>
                </>
            )}
            {numCols.length === 0 && catCols.length === 0 && (
                <Alert severity="info">Нет колонок для визуализации.</Alert>
            )}
        </Box>
    )
}



// Функция fmtPV



function fmtPV(p: number): string {
    if (isNaN(p)) return '—'
    if (p < 0.0001) return '< .0001'
    return p.toFixed(4)
}
// Функция pvStars
function pvStars(p: number): string {
    if (isNaN(p) || p >= 0.05) return 'н.з.'
    return p < 0.001 ? '***' : p < 0.01 ? '**' : '*'
}
// Функция pvChipColor
function pvChipColor(p: number): 'success' | 'warning' | 'error' | 'default' {
    if (isNaN(p) || p >= 0.05) return 'default'
    if (p < 0.001) return 'error'
    if (p < 0.01) return 'warning'
    return 'success'
}
// Функция pvInline
function pvInline(p: number) {
    if (isNaN(p) || p >= 0.05) return null
    const s = p < 0.001 ? '***' : p < 0.01 ? '**' : '*'
    const c = p < 0.001 ? '#b71c1c' : p < 0.01 ? '#e65100' : '#2e7d32'
    return <span style={{ color: c, fontWeight: 700, fontSize: '0.65rem', marginLeft: 2 }}>{s}</span>
}


// Функция pHeatColor


function pHeatColor(p: number): string {
    if (isNaN(p) || p >= 1) return '#f5f5f5'
    const logp = -Math.log10(Math.max(p, 1e-10))
    const t = Math.min(1, logp / 3)
    if (t < 0.43) {
        const s = t / 0.43
        return `rgb(255,255,${Math.round(255 * (1 - s))})`
    }
    if (t < 0.67) {
        // Функция s
        const s = (t - 0.43) / 0.24
        return `rgb(255,${Math.round(255 - 100 * s)},0)`
    }
    // Функция s
    const s = (t - 0.67) / 0.33
    return `rgb(${Math.round(255 - 72 * s)},${Math.round(155 - 130 * s)},0)`
}

// Функция HeatmapMatrix

function HeatmapMatrix({
    fields, matrix, title, tooltip, paletteColors, accentColor, minVal = -1, onCellClick,
}: {
    fields: string[]
    matrix: number[][]
    title: string
    tooltip?: string
    paletteColors: readonly string[]
    accentColor: string
    minVal?: number
    onCellClick?: (f1: string, f2: string, value: number) => void
}) {
    const n = fields.length
    const cellSize = Math.min(64, Math.max(32, Math.floor(600 / n)))
    const longestField = fields.length ? Math.max(...fields.map(f => f.length)) : 0
    const labelW = Math.min(190, Math.max(92, longestField * 7))
    const effectiveColors = minVal === 0 ? paletteColors.slice(Math.floor((paletteColors.length - 1) / 2)) : paletteColors

    function cellTextColor(v: number | null, isDiag: boolean): string {
        if (isDiag) return '#fff'
        if (v == null || isNaN(v)) return '#999'
        const threshold = minVal === 0 ? 0.55 : 0.42
        const normalized = Math.abs((v - minVal) / (1 - minVal) - (minVal === 0 ? 0 : 0.5))
        return normalized > threshold ? '#fff' : '#1a1a1a'
    }

    return (
        <Box mb={2}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
                <Box sx={{ width: 4, height: 22, borderRadius: 2, bgcolor: accentColor, flexShrink: 0 }} />
                <Typography variant="subtitle1" fontWeight={700}>{title}</Typography>
                {tooltip && (
                    <Tooltip title={tooltip} arrow>
                        <Typography component="span" sx={{ cursor: 'help', color: 'text.secondary', fontSize: '0.8rem' }}>ⓘ</Typography>
                    </Tooltip>
                )}
                <Chip
                    label={`${n} × ${n}`}
                    size="small"
                    variant="outlined"
                    sx={{ ml: 'auto', opacity: 0.55, height: 20, fontSize: '0.68rem' }}
                />
            </Box>
            <Box sx={{ overflowX: 'auto', pb: 0.5 }}>
                <Box sx={{
                    display: 'grid',
                    gridTemplateColumns: `${labelW}px repeat(${n}, ${cellSize}px)`,
                    width: 'fit-content',
                }}>
                    <Box />
                    {fields.map((f) => (
                        <Tooltip key={f} title={f} arrow>
                            <Box sx={{
                                height: cellSize + 4,
                                display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
                                fontSize: '0.62rem', fontWeight: 600, overflow: 'hidden',
                                writingMode: 'vertical-rl', transform: 'rotate(180deg)',
                                pb: 0.5, cursor: 'default', color: 'text.secondary',
                            }}>
                                {f.length > 12 ? f.slice(0, 11) + '…' : f}
                            </Box>
                        </Tooltip>
                    ))}
                    {fields.map((rowField, i) => (
                        <React.Fragment key={rowField}>
                            <Tooltip title={rowField} arrow>
                                <Box sx={{
                                    height: cellSize,
                                    display: 'flex', alignItems: 'center',
                                    fontSize: '0.68rem', fontWeight: 600,
                                    overflow: 'hidden', pr: 1,
                                    justifyContent: 'flex-end',
                                    cursor: 'default', color: 'text.secondary',
                                }}>
                                    {rowField.length > 14 ? rowField.slice(0, 13) + '…' : rowField}
                                </Box>
                            </Tooltip>
                            {fields.map((_, j) => {
                                const v = matrix[i]?.[j] as number | null
                                const isDiag = i === j
                                const display = isDiag ? '1.00' : (v == null || isNaN(v)) ? '—' : fmt(v, 2)
                                const bg = isDiag ? accentColor : paletteColor(effectiveColors, v, minVal === 0 ? 0 : -1)
                                return (
                                    <Tooltip key={j} title={`${rowField} × ${fields[j]}: ${v == null || isNaN(v) ? '—' : fmt(v, 4)}`} arrow>
                                        <Box
                                            onClick={!isDiag && onCellClick && v != null && !isNaN(v) ? () => onCellClick(rowField, fields[j], v) : undefined}
                                            sx={{
                                                height: cellSize, width: cellSize,
                                                bgcolor: bg,
                                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                fontSize: cellSize > 44 ? '0.72rem' : '0.62rem',
                                                fontWeight: isDiag ? 700 : 500,
                                                color: cellTextColor(v, isDiag),
                                                border: '1px solid rgba(255,255,255,0.2)',
                                                cursor: !isDiag && onCellClick ? 'pointer' : 'default',
                                                '&:hover': {
                                                    outline: `2px solid ${accentColor}`,
                                                    outlineOffset: '-2px',
                                                    zIndex: 1,
                                                    position: 'relative',
                                                },
                                            }}
                                        >
                                            {display}
                                        </Box>
                                    </Tooltip>
                                )
                            })}
                        </React.Fragment>
                    ))}
                </Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 1.5 }}>
                    <Typography variant="caption" color="text.secondary">{minVal === 0 ? '0' : '−1'}</Typography>
                    <Box sx={{
                        width: 180, height: 10, borderRadius: 5,
                        background: `linear-gradient(to right, ${effectiveColors.join(',')})`,
                        border: '1px solid rgba(0,0,0,0.08)',
                    }} />
                    <Typography variant="caption" color="text.secondary">+1</Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ ml: 1, opacity: 0.45 }}>
                        {minVal === 0 ? 'нет связи → полная связь' : 'отриц. → нейтр. → положит.'}
                    </Typography>
                </Box>
            </Box>
        </Box>
    )
}



// Функция PairwiseHeatmap



function PairwiseHeatmap({ data }: { data: PairwisePValue }) {
    const { fields, pMatrix, testMatrix, nMatrix } = data
    const cs = Math.min(52, Math.max(26, Math.floor(560 / fields.length)))
    const longestField = fields.length ? Math.max(...fields.map(f => f.length)) : 0
    const labelW = Math.min(180, Math.max(92, longestField * 7))
    return (
        <Box>
            <Typography variant="caption" color="text.secondary" display="block" mb={1}>
                Белый&nbsp;—&nbsp;н.з. (p&nbsp;&gt;&nbsp;0.05)&nbsp; &nbsp;•&nbsp;  Жёлтый&nbsp;—&nbsp;* (p&nbsp;&lt;&nbsp;0.05)&nbsp; &nbsp;•&nbsp;  Оранжевый&nbsp;—&nbsp;** (&lt;&nbsp;0.01)&nbsp; &nbsp;•&nbsp;  Красный&nbsp;—&nbsp;*** (&lt;&nbsp;0.001)
            </Typography>
            <Box sx={{ overflowX: 'auto' }}>
                <Box sx={{ display: 'grid', gridTemplateColumns: `${labelW}px repeat(${fields.length}, ${cs}px)`, width: 'fit-content' }}>
                    <Box />
                    {fields.map((f) => (
                        <Tooltip key={f} title={f} arrow>
                            <Box sx={{
                                height: cs, fontSize: '0.62rem', fontWeight: 600, overflow: 'hidden',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                writingMode: 'vertical-rl', transform: 'rotate(180deg)', p: '2px',
                            }}>
                                {f.length > 10 ? f.slice(0, 9) + '…' : f}
                            </Box>
                        </Tooltip>
                    ))}
                    {fields.map((rowF, i) => (
                        <>
                            <Tooltip key={`lbl-${rowF}`} title={rowF} arrow>
                                <Box sx={{
                                    height: cs, fontSize: '0.62rem', fontWeight: 600, overflow: 'hidden',
                                    pr: 0.5, display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
                                    whiteSpace: 'nowrap', textOverflow: 'ellipsis',
                                }}>
                                    {rowF.length > 12 ? rowF.slice(0, 11) + '…' : rowF}
                                </Box>
                            </Tooltip>
                            {fields.map((colF, j) => {
                                const p = pMatrix[i]?.[j]
                                const test = testMatrix[i]?.[j] ?? ''
                                const np = nMatrix[i]?.[j] ?? 0
                                const isDiag = i === j
                                const display = isDiag ? '—' : isNaN(p) ? '—' : (p < 0.0001 ? '<.0001' : p.toFixed(3))
                                const tipText = isDiag ? rowF : `${rowF} × ${colF}  |  ${test}  |  p = ${fmtPV(p)}  |  n = ${np}`
                                return (
                                    <Tooltip key={`${i}-${j}`} title={tipText} arrow>
                                        <Box sx={{
                                            height: cs, width: cs,
                                            bgcolor: isDiag ? '#f5f5f5' : pHeatColor(p),
                                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                                            fontSize: '0.58rem', fontWeight: 500,
                                            color: !isDiag && !isNaN(p) && p < 0.01 ? '#fff' : 'text.secondary',
                                            border: '1px solid rgba(0,0,0,0.06)',
                                            cursor: 'default',
                                        }}>
                                            {display}
                                        </Box>
                                    </Tooltip>
                                )
                            })}
                        </>
                    ))}
                </Box>
            </Box>
        </Box>
    )
}



const UNIV_GROUPS = [
    { key: 'corr',  label: 'Корреляция',         color: '#1565c0', bg: '#e3f2fd', desc: 'Число ↔ Число' },
    { key: 'ttest', label: 'Сравнение 2 групп',  color: '#2e7d32', bg: '#e8f5e9', desc: 'Кат ↔ Число' },
    { key: 'anova', label: 'Сравнение ≥3 групп', color: '#e65100', bg: '#fff3e0', desc: 'Кат ↔ Число' },
    { key: 'cat',   label: 'Ассоциация кат.',    color: '#6a1b9a', bg: '#f3e5f5', desc: 'Категория ↔ Категория' },
] as const

function getTestGroupKey(testName: string): string {
    if (testName === 'Spearman ρ' || testName === 'Pearson r') return 'corr'
    if (testName === "Mann-Whitney U" || testName === "Welch's t") return 'ttest'
    if (testName.startsWith('Kruskal-Wallis') || testName.startsWith('ANOVA')) return 'anova'
    if (testName === 'χ²-тест' || testName === "Fisher's exact") return 'cat'
    return 'other'
}

function UnivariateBars({ results, color, testNames }: { results: UnivariateResult[], color: string, testNames: string }) {
    const sorted = useMemo(() => {
        const valid = results.filter(r => isFinite(r.pAdj) && !isNaN(r.pAdj))
        const invalid = results.filter(r => !isFinite(r.pAdj) || isNaN(r.pAdj))
        return [...valid.sort((a, b) => a.pAdj - b.pAdj), ...invalid]
    }, [results])

    const chartData = sorted.map(r => ({
        name: r.field.length > 18 ? r.field.slice(0, 17) + '…' : r.field,
        fullName: r.field,
        logP: (isFinite(r.pAdj) && !isNaN(r.pAdj)) ? +(-Math.log10(Math.max(r.pAdj, 1e-10))).toFixed(3) : 0,
        p: r.pValue, padj: r.pAdj, stat: r.stat, n: r.n, testName: r.testName,
    }))

    const maxLogP = Math.max(3.2, ...chartData.map(d => d.logP))
    const chartH = Math.max(80, chartData.length * 28 + 44)
    const sigCount = results.filter(r => isFinite(r.pAdj) && !isNaN(r.pAdj) && r.pAdj < 0.05).length

    const barFill = (padj: number) => {
        if (!isFinite(padj) || isNaN(padj) || padj >= 0.05) return '#e0e0e0'
        if (padj < 0.001) return '#ef5350'
        if (padj < 0.01) return '#ffa726'
        return '#66bb6a'
    }

    return (
        <Box>
            <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5, display: 'block' }}>
                Тест: <strong>{testNames}</strong>
                &nbsp;•&nbsp; <strong style={{ color }}>{sigCount}</strong> из {results.length} значимы (p-adj &lt; 0.05)
            </Typography>
            <ResponsiveContainer width="100%" height={chartH}>
                <BarChart data={chartData} layout="vertical" margin={{ left: 4, right: 40, top: 4, bottom: 24 }}>
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f0f0f0" />
                    <XAxis type="number" domain={[0, maxLogP]}
                        tickFormatter={(v: number) => v.toFixed(1)}
                        tick={{ fontSize: 10 }}
                        label={{ value: '−log₁₀(p-adj)', position: 'insideBottom', offset: -16, fontSize: 10, fill: '#888' }}
                    />
                    <YAxis type="category" dataKey="name" width={140} tick={{ fontSize: 11 }} />
                    <RTooltip content={({ payload }: any) => {
                        if (!payload?.length) return null
                        const d = payload[0].payload
                        return (
                            <Paper sx={{ p: 1, fontSize: '0.75rem', maxWidth: 260 }}>
                                <Typography variant="caption" fontWeight={700} display="block">{d.fullName}</Typography>
                                <Typography variant="caption" display="block" color="text.secondary">{d.testName} • n = {d.n}</Typography>
                                <Typography variant="caption" display="block">p = {fmtPV(d.p)} &nbsp;•&nbsp; p-adj = {fmtPV(d.padj)}</Typography>
                                <Typography variant="caption" display="block">стат. = {fmt(d.stat)}</Typography>
                            </Paper>
                        )
                    }} />
                    <ReferenceLine x={-Math.log10(0.05)} stroke="#ff9800" strokeDasharray="4 2"
                        label={{ value: '.05', position: 'insideTopRight', fontSize: 9, fill: '#ff9800' }} />
                    <ReferenceLine x={-Math.log10(0.01)} stroke="#f44336" strokeDasharray="4 2"
                        label={{ value: '.01', position: 'insideTopRight', fontSize: 9, fill: '#f44336' }} />
                    <Bar dataKey="logP" maxBarSize={20} radius={[0, 3, 3, 0]}>
                        {chartData.map((d, i) => <Cell key={i} fill={barFill(d.padj)} />)}
                    </Bar>
                </BarChart>
            </ResponsiveContainer>
        </Box>
    )
}

function PairwiseByType({ data, colDefs }: { data: PairwisePValue, colDefs: { field: string; type: string }[] }) {
    const typeMap = new Map(colDefs.map(c => [c.field, c.type]))
    const { fields, pMatrix, testMatrix, nMatrix } = data

    const numIdx = fields.map((field, index) => typeMap.get(field) === 'number' ? index : -1).filter(index => index >= 0)
    const catIdx = fields.map((field, index) => typeMap.get(field) !== 'number' ? index : -1).filter(index => index >= 0)

    const numFields = numIdx.map(i => fields[i])
    const catFields = catIdx.map(i => fields[i])

    const numData: PairwisePValue | null = numIdx.length >= 2 ? {
        fields: numFields,
        pMatrix: numIdx.map(ri => numIdx.map(ci => pMatrix[ri][ci])),
        testMatrix: numIdx.map(ri => numIdx.map(ci => testMatrix[ri][ci])),
        nMatrix: numIdx.map(ri => numIdx.map(ci => nMatrix[ri][ci])),
    } : null

    const catData: PairwisePValue | null = catIdx.length >= 2 ? {
        fields: catFields,
        pMatrix: catIdx.map(ri => catIdx.map(ci => pMatrix[ri][ci])),
        testMatrix: catIdx.map(ri => catIdx.map(ci => testMatrix[ri][ci])),
        nMatrix: catIdx.map(ri => catIdx.map(ci => nMatrix[ri][ci])),
    } : null

    const numCatPairs = (() => {
        const pairs: { numF: string; catF: string; p: number; test: string; n: number }[] = []
        for (const ni of numIdx) {
            for (const ci of catIdx) {
                const p = pMatrix[ni][ci], t = testMatrix[ni][ci], n = nMatrix[ni][ci]
                if (!isNaN(p) && t && t !== '—') pairs.push({ numF: fields[ni], catF: fields[ci], p, test: t, n })
            }
        }
        return pairs.sort((a, b) => a.p - b.p)
    })()

    return (
        <>
            {numData && (
                <Box mb={3}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                        <Box sx={{ width: 4, height: 18, borderRadius: 2, bgcolor: '#1565c0', flexShrink: 0 }} />
                        <Typography variant="subtitle2" fontWeight={700}>Число ↔ Число</Typography>
                        <Chip size="small" variant="outlined" label={`${numFields.length} колонок`} sx={{ fontSize: '0.65rem', height: 18, ml: 'auto' }} />
                    </Box>
                    <PairwiseHeatmap data={numData} />
                </Box>
            )}
            {catData && (
                <Box mb={3}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                        <Box sx={{ width: 4, height: 18, borderRadius: 2, bgcolor: '#6a1b9a', flexShrink: 0 }} />
                        <Typography variant="subtitle2" fontWeight={700}>Категория ↔ Категория (χ² / Fisher)</Typography>
                        <Chip size="small" variant="outlined" label={`${catFields.length} колонок`} sx={{ fontSize: '0.65rem', height: 18, ml: 'auto' }} />
                    </Box>
                    <PairwiseHeatmap data={catData} />
                </Box>
            )}
            {numCatPairs.length > 0 && (
                <Box mb={3}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                        <Box sx={{ width: 4, height: 18, borderRadius: 2, bgcolor: '#e65100', flexShrink: 0 }} />
                        <Typography variant="subtitle2" fontWeight={700}>Число ↔ Категория (Kruskal-Wallis)</Typography>
                        <Chip size="small" variant="outlined" label={`${numCatPairs.length} пар`} sx={{ fontSize: '0.65rem', height: 18, ml: 'auto' }} />
                    </Box>
                    <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 2 }}>
                        <Table size="small">
                            <TableHead>
                                <TableRow sx={{ bgcolor: 'grey.50' }}>
                                    {['Числовой признак', 'Категория', 'Тест', 'n', 'p-value', 'Знач.'].map(h => (
                                        <TableCell key={h} sx={{ fontWeight: 600, fontSize: '0.74rem' }}>{h}</TableCell>
                                    ))}
                                </TableRow>
                            </TableHead>
                            <TableBody>
                                {numCatPairs.map((pair, idx) => (
                                    <TableRow key={idx} hover sx={{ bgcolor: pair.p < 0.05 ? 'rgba(0,200,83,0.04)' : undefined }}>
                                        <TableCell sx={{ fontSize: '0.74rem', fontWeight: 500, maxWidth: 190 }}>
                                            <TruncatedText value={pair.numF} maxWidth={180} fontWeight={500} fontSize="0.74rem" />
                                        </TableCell>
                                        <TableCell sx={{ fontSize: '0.74rem', maxWidth: 190 }}>
                                            <TruncatedText value={pair.catF} maxWidth={180} fontSize="0.74rem" />
                                        </TableCell>
                                        <TableCell sx={{ fontSize: '0.72rem' }}>{pair.test}</TableCell>
                                        <TableCell sx={{ fontSize: '0.72rem' }}>{pair.n}</TableCell>
                                        <TableCell sx={{ fontSize: '0.72rem' }}>
                                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.3 }}>{fmtPV(pair.p)}{pvInline(pair.p)}</Box>
                                        </TableCell>
                                        <TableCell>
                                            <Chip size="small" label={pvStars(pair.p)} color={pvChipColor(pair.p)} sx={{ fontSize: '0.65rem', height: 18, minWidth: 34 }} />
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </TableContainer>
                </Box>
            )}
            {!numData && !catData && numCatPairs.length === 0 && (
                <Alert severity="info">Нет данных для отображения по типам пар.</Alert>
            )}
        </>
    )
}


// Функция PValueSection

function PValueSection({ standalone, uploadId }: { standalone?: boolean; uploadId?: string }) {
    const activeState = useTableStore((s) => s.getActiveState())
    const rows = useTableStore((s) => s.rows)
    const columns = useMemo(() => activeState?.columns.filter((c) => c.visible) ?? [], [activeState])
    const colDefs = useMemo(() => columns.map((c) => ({ field: c.field, type: c.type })), [columns])

    const [mode, setMode] = useState<'univariate' | 'pairwise' | 'normality'>('univariate')
    const [target, setTarget] = useState('')
    const [parametric, setParametric] = useState(false)
    const [pairwiseMethod, setPairwiseMethod] = useState<'spearman' | 'kendall'>('spearman')

    // Univariate via Web Worker
    const [univResults, setUnivResults] = useState<ReturnType<typeof computeUnivariateTests>>([])
    const [univLoading, setUnivLoading] = useState(false)
    const [univError, setUnivError] = useState<string | null>(null)

    useEffect(() => {
        if (mode !== 'univariate' || !target || !rows.length) { setUnivResults([]); setUnivError(null); return }
        setUnivLoading(true)
        setUnivError(null)
        const controller = new AbortController()
        const worker = new Worker(new URL('../../../features/file-upload/lib/statsWorker.ts', import.meta.url), { type: 'module' })
        worker.onmessage = (e) => {
            worker.terminate()
            if (e.data.ok) { setUnivResults(e.data.result) } else { setUnivError(e.data.error ?? 'Ошибка вычисления') }
            setUnivLoading(false)
        }
        worker.onerror = () => { worker.terminate(); setUnivError('Ошибка в воркере'); setUnivLoading(false) }
        const fieldSet = new Set(colDefs.map(c => c.field))
        projectRows(rows, fieldSet, controller.signal)
            .then((slimRows) => worker.postMessage({ type: 'univariate', rows: slimRows, columns: colDefs, target, parametric }))
            .catch((err) => {
                worker.terminate()
                if (!(err instanceof DOMException && err.name === 'AbortError')) {
                    setUnivError('Ошибка подготовки данных')
                    setUnivLoading(false)
                }
            })
        return () => { controller.abort(); worker.terminate() }
    }, [rows, colDefs, target, mode, parametric])

    // Pairwise: fetched from Python artifact (pre-computed on upload)
    const [pairwiseData, setPairwiseData] = useState<PairwisePValue | null>(null)
    const [serverLoading, setServerLoading] = useState(false)
    const [serverPending, setServerPending] = useState(false)
    const [serverError, setServerError] = useState<string | null>(null)
    const [kendallData, setKendallData] = useState<PairwisePValue | null>(null)
    const [kendallLoading, setKendallLoading] = useState(false)
    const [kendallError, setKendallError] = useState<string | null>(null)

    useEffect(() => {
        if (mode !== 'pairwise' || !uploadId || pairwiseData) return
        if (activeState?.profileStatus === 'failed') {
            setServerError(activeState.profileError ?? 'Анализ профиля завершился с ошибкой — матрица p-value недоступна')
            return
        }
        let cancelled = false, timer: ReturnType<typeof setTimeout> | null = null, attempts = 0
        const MAX_ATTEMPTS = 24 // 24 × 5 с = 2 мин
        const attempt = (isFirst: boolean) => {
            if (isFirst) { setServerLoading(true); setServerPending(false); setServerError(null) }
            getPvalueMatrixArtifact(uploadId)
                .then((data) => { if (!cancelled) { setPairwiseData(data as PairwisePValue); setServerLoading(false); setServerPending(false) } })
                .catch(() => {
                    if (!cancelled) {
                        attempts++
                        setServerLoading(false)
                        if (attempts >= MAX_ATTEMPTS) {
                            setServerError('Не удалось получить матрицу p-value — превышено время ожидания')
                            setServerPending(false)
                        } else {
                            setServerPending(true)
                            timer = setTimeout(() => attempt(false), 5000)
                        }
                    }
                })
        }
        attempt(true)
        return () => { cancelled = true; if (timer) clearTimeout(timer) }
    }, [mode, uploadId, pairwiseData, activeState?.profileStatus, activeState?.profileError])

    useEffect(() => {
        if (mode !== 'pairwise' || pairwiseMethod !== 'kendall' || !rows.length || kendallData) return
        setKendallLoading(true)
        setKendallError(null)
        const controller = new AbortController()
        const worker = new Worker(new URL('../../../features/file-upload/lib/statsWorker.ts', import.meta.url), { type: 'module' })
        worker.onmessage = (e) => {
            worker.terminate()
            if (e.data.ok) { setKendallData(e.data.result) } else { setKendallError(e.data.error ?? 'Ошибка вычисления') }
            setKendallLoading(false)
        }
        worker.onerror = () => { worker.terminate(); setKendallError('Ошибка в воркере'); setKendallLoading(false) }
        const fieldSet = new Set(colDefs.map(c => c.field))
        projectRows(rows, fieldSet, controller.signal)
            .then((slimRows) => worker.postMessage({ type: 'pairwise', rows: slimRows, columns: colDefs, pairwiseMethod: 'kendall' }))
            .catch((err) => {
                worker.terminate()
                if (!(err instanceof DOMException && err.name === 'AbortError')) {
                    setKendallError('Ошибка подготовки данных')
                    setKendallLoading(false)
                }
            })
        return () => { controller.abort(); worker.terminate() }
    }, [mode, pairwiseMethod, rows, colDefs, kendallData])

    useEffect(() => { setKendallData(null); setKendallError(null) }, [rows])

    // Normality via Web Worker
    const [normResults, setNormResults] = useState<NormalityResult[]>([])
    const [normLoading, setNormLoading] = useState(false)
    const [normError, setNormError] = useState<string | null>(null)

    useEffect(() => {
        if (mode !== 'normality' || !rows.length) return
        setNormLoading(true)
        setNormError(null)
        const controller = new AbortController()
        const worker = new Worker(new URL('../../../features/file-upload/lib/statsWorker.ts', import.meta.url), { type: 'module' })
        worker.onmessage = (e) => {
            worker.terminate()
            if (e.data.ok) { setNormResults(e.data.result) } else { setNormError(e.data.error ?? 'Ошибка вычисления') }
            setNormLoading(false)
        }
        worker.onerror = () => { worker.terminate(); setNormError('Ошибка в воркере'); setNormLoading(false) }
        const fieldSet = new Set(colDefs.map(c => c.field))
        projectRows(rows, fieldSet, controller.signal)
            .then((slimRows) => worker.postMessage({ type: 'normality', rows: slimRows, columns: colDefs }))
            .catch((err) => {
                worker.terminate()
                if (!(err instanceof DOMException && err.name === 'AbortError')) {
                    setNormError('Ошибка подготовки данных')
                    setNormLoading(false)
                }
            })
        return () => { controller.abort(); worker.terminate() }
    }, [mode, rows, colDefs])

    return (
        <Accordion
            sx={{ mt: standalone ? 0 : 2, border: '1px solid', borderColor: 'divider', borderRadius: '8px !important', '&:before': { display: 'none' } }}
            disableGutters
            defaultExpanded={standalone}
        >
            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                <Typography variant="subtitle2" fontWeight={600}>P-value анализ связей</Typography>
                <Tooltip title="Признак↔Цель: унивариатный скрининг. Попарный: матрица p-value. Нормальность: Jarque-Bera тест. Поправка: BH-FDR." arrow>
                    <Typography component="span" sx={{ ml: 0.75, cursor: 'help', color: 'text.secondary', fontSize: '0.8rem', alignSelf: 'center' }}>ⓘ</Typography>
                </Tooltip>
            </AccordionSummary>
            <AccordionDetails>
                <ToggleButtonGroup value={mode} exclusive onChange={(_, v) => { if (v) setMode(v) }} size="small" sx={{ mb: 2 }}>
                    <Tooltip title="Каждый признак X тестируется против целевой переменной y." arrow>
                        <ToggleButton value="univariate">Признак ↔ Цель</ToggleButton>
                    </Tooltip>
                    <Tooltip title="Матрица p-value для всех пар колонок. Тест выбирается по типу пары." arrow>
                        <ToggleButton value="pairwise">Попарный анализ</ToggleButton>
                    </Tooltip>
                    <Tooltip title="Jarque-Bera тест нормальности для каждой числовой колонки." arrow>
                        <ToggleButton value="normality">Нормальность</ToggleButton>
                    </Tooltip>
                </ToggleButtonGroup>

                {/* ── Признак ↔ Цель ── */}
                {mode === 'univariate' && (
                    <>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2, flexWrap: 'wrap' }}>
                            <FormControl size="small" sx={{ minWidth: 240 }}>
                                <InputLabel>Целевая переменная (y)</InputLabel>
                                <Select value={target} label="Целевая переменная (y)" onChange={(e) => setTarget(e.target.value)}>
                                    {columns.map((c) => <MenuItem key={c.field} value={c.field}>{c.headerName}</MenuItem>)}
                                </Select>
                            </FormControl>
                            <Tooltip title="Непараметрические тесты не требуют нормальности. Параметрические мощнее, но предполагают нормальность." arrow>
                                <ToggleButtonGroup value={parametric ? 'param' : 'nonparam'} exclusive size="small"
                                    onChange={(_, v) => { if (v) setParametric(v === 'param') }}>
                                    <ToggleButton value="nonparam">Непараметрический</ToggleButton>
                                    <ToggleButton value="param">Параметрический</ToggleButton>
                                </ToggleButtonGroup>
                            </Tooltip>
                        </Box>
                        {!target && <Alert severity="info" sx={{ borderRadius: 2 }}>Выберите целевую переменную, чтобы увидеть p-value каждого признака.</Alert>}
                        {target && univLoading && <LinearProgress sx={{ mb: 2, borderRadius: 1 }} />}
                        {target && univError && <Alert severity="error" sx={{ mb: 2, borderRadius: 2 }}>{univError}</Alert>}
                        {target && !univLoading && !univError && univResults.length > 0 && (
                            <Box>
                                <Alert severity="info" sx={{ mb: 2, borderRadius: 2, py: 0.5 }}>
                                    <Typography variant="caption">
                                        Признаки разбиты по типу теста. Длина столбца = −log₁₀(p-adj, BH-FDR).
                                        Серый — незначимо, <span style={{ color: '#66bb6a', fontWeight: 700 }}>зелёный</span> — p&lt;0.05,
                                        <span style={{ color: '#ffa726', fontWeight: 700 }}> оранжевый</span> — p&lt;0.01,
                                        <span style={{ color: '#ef5350', fontWeight: 700 }}> красный</span> — p&lt;0.001. Наведите на столбец для точных значений.
                                    </Typography>
                                </Alert>
                                {UNIV_GROUPS.map(g => {
                                    const grouped = univResults.filter(r => getTestGroupKey(r.testName) === g.key)
                                    if (grouped.length === 0) return null
                                    const testNamesInGroup = [...new Set(grouped.map(r => r.testName))].join(' / ')
                                    return (
                                        <Paper key={g.key} variant="outlined" sx={{ p: 2, mb: 2, borderRadius: 2, borderLeft: `4px solid ${g.color}` }}>
                                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                                                <Typography variant="subtitle2" fontWeight={700} sx={{ color: g.color }}>{g.label}</Typography>
                                                <Chip size="small" label={g.desc} sx={{ fontSize: '0.62rem', height: 18, bgcolor: g.bg, color: g.color, fontWeight: 600 }} />
                                                <Chip size="small" variant="outlined" label={`${grouped.length} призн.`} sx={{ fontSize: '0.62rem', height: 18, ml: 'auto' }} />
                                            </Box>
                                            <UnivariateBars results={grouped} color={g.color} testNames={testNamesInGroup} />
                                        </Paper>
                                    )
                                })}
                            </Box>
                        )}
                    </>
                )}

                {/* ── Попарный анализ ── */}
                {mode === 'pairwise' && (
                    <>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2, flexWrap: 'wrap' }}>
                            <Box>
                                <Typography variant="caption" color="text.secondary" display="block" mb={0.5}>Тест для числовых пар:</Typography>
                                <ToggleButtonGroup value={pairwiseMethod} exclusive size="small" onChange={(_, v) => { if (v) setPairwiseMethod(v) }}>
                                    <Tooltip title="Spearman ρ — предвычислен на сервере при загрузке файла." arrow>
                                        <ToggleButton value="spearman">Spearman ρ</ToggleButton>
                                    </Tooltip>
                                    <Tooltip title="Kendall τ-b с поправкой на совпадения. Лучше для малых выборок. Считается в браузере." arrow>
                                        <ToggleButton value="kendall">Kendall τ</ToggleButton>
                                    </Tooltip>
                                </ToggleButtonGroup>
                            </Box>
                            <Alert severity="info" sx={{ py: 0, borderRadius: 2, flex: 1 }}>
                                <Typography variant="caption">
                                    Результаты разбиты по типу пары. Белый — н.з. (p&gt;0.05) → жёлтый → оранжевый → красный (p&lt;0.001).
                                </Typography>
                            </Alert>
                        </Box>
                        {pairwiseMethod === 'spearman' && (
                            <>
                                {!uploadId && <Alert severity="info">Spearman попарный — нет привязки к файлу. Переключитесь на Kendall для вычисления в браузере.</Alert>}
                                {uploadId && serverError && <Alert severity="error" sx={{ borderRadius: 2 }}>{serverError}</Alert>}
                                {uploadId && serverLoading && <LinearProgress sx={{ borderRadius: 1 }} />}
                                {uploadId && serverPending && !serverError && <Alert severity="info" sx={{ borderRadius: 2 }}>Матрица вычисляется на сервере — повтор через 5 с...</Alert>}
                                {uploadId && !serverLoading && !serverPending && !serverError && pairwiseData && <PairwiseByType data={pairwiseData} colDefs={colDefs} />}
                            </>
                        )}
                        {pairwiseMethod === 'kendall' && (
                            <>
                                {kendallLoading && <LinearProgress sx={{ borderRadius: 1, mb: 1 }} />}
                                {kendallError && <Alert severity="error" sx={{ borderRadius: 2 }}>{kendallError}</Alert>}
                                {!kendallLoading && !kendallError && kendallData && <PairwiseByType data={kendallData} colDefs={colDefs} />}
                                {!kendallLoading && !kendallError && !kendallData && !rows.length && <Alert severity="info">Нет данных для вычисления.</Alert>}
                            </>
                        )}
                    </>
                )}

                {/* ── Нормальность ── */}
                {mode === 'normality' && (
                    <>
                        <Paper variant="outlined" sx={{ p: 1.5, mb: 2, borderRadius: 2, bgcolor: 'grey.50' }}>
                            <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.7, display: 'block' }}>
                                <strong>Jarque-Bera тест</strong> проверяет соответствие асимметрии (Skew) и эксцесса (Kurt) нормальному распределению.
                                Статистика JB ~ χ²(2). <strong>p &lt; 0.05</strong> → распределение значимо отличается от нормального.
                                При n &lt; 30 тест менее надёжен; для очень больших выборок практически любое отклонение будет значимым.
                            </Typography>
                        </Paper>
                        {normLoading && <LinearProgress sx={{ borderRadius: 1, mb: 1 }} />}
                        {normError && <Alert severity="error" sx={{ borderRadius: 2, mb: 1 }}>{normError}</Alert>}
                        {!normLoading && !normError && normResults.length === 0 && <Alert severity="info">Нет числовых колонок для теста нормальности.</Alert>}
                        {!normLoading && !normError && normResults.length > 0 && (
                            <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 2 }}>
                                <Table size="small">
                                    <TableHead>
                                        <TableRow sx={{ bgcolor: 'grey.50' }}>
                                            {['Колонка', 'n', 'Асимметрия', 'Эксцесс', 'JB-статистика', 'p-value', 'Нормальность', 'Примечание'].map(h => (
                                                <TableCell key={h} sx={{ fontWeight: 600, fontSize: '0.74rem' }}>{h}</TableCell>
                                            ))}
                                        </TableRow>
                                    </TableHead>
                                    <TableBody>
                                        {normResults.map((r) => (
                                            <TableRow key={r.field} hover
                                                sx={{ bgcolor: r.isNormal ? 'rgba(0,200,83,0.04)' : isNaN(r.pValue) ? undefined : 'rgba(211,47,47,0.04)' }}>
                                                <TableCell sx={{ fontSize: '0.74rem', fontWeight: 500, maxWidth: 210 }}>
                                                    <TruncatedText value={r.field} maxWidth={200} fontWeight={500} fontSize="0.74rem" />
                                                </TableCell>
                                                <TableCell sx={{ fontSize: '0.72rem' }}>{r.n}</TableCell>
                                                <TableCell sx={{ fontSize: '0.72rem' }}>{isNaN(r.skewness) ? '—' : fmt(r.skewness, 3)}</TableCell>
                                                <TableCell sx={{ fontSize: '0.72rem' }}>{isNaN(r.kurtosis) ? '—' : fmt(r.kurtosis, 3)}</TableCell>
                                                <TableCell sx={{ fontSize: '0.72rem' }}>{isNaN(r.stat) ? '—' : fmt(r.stat, 3)}</TableCell>
                                                <TableCell sx={{ fontSize: '0.72rem' }}>
                                                    {isNaN(r.pValue) ? '—' : <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.3 }}>{fmtPV(r.pValue)}{pvInline(r.pValue)}</Box>}
                                                </TableCell>
                                                <TableCell>
                                                    <Chip size="small"
                                                        label={isNaN(r.pValue) ? '—' : r.isNormal ? 'Да ✓' : 'Нет ✗'}
                                                        color={isNaN(r.pValue) ? 'default' : r.isNormal ? 'success' : 'error'}
                                                        sx={{ fontSize: '0.65rem', height: 18, minWidth: 40 }}
                                                    />
                                                </TableCell>
                                                <TableCell sx={{ fontSize: '0.68rem', color: 'text.secondary' }}>{r.note ?? ''}</TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </TableContainer>
                        )}
                    </>
                )}
            </AccordionDetails>
        </Accordion>
    )
}

// Функция CorrelationsTab

function CorrelationsTab({ stats }: { stats: DatasetStats }) {
    const [paletteId, setPaletteId] = useState<PaletteId>('blue_red')
    const [activeIdx, setActiveIdx] = useState(0)
    const scrollRef = useRef<HTMLDivElement>(null)
    const workerRef = useRef<Worker | null>(null)
    const lastRowsRef = useRef<typeof rows | null>(null)

    const rows = useTableStore(s => s.rows)
    const tableStates = useTableStore(s => s.tableStates)
    const activeTableId = useTableStore(s => s.activeTableId)
    const activeState = tableStates.find(s => s.id === activeTableId)
    const [liveCorr, setLiveCorr] = useState<CorrWorkerOutput | null>(null)
    const [corrLoading, setCorrLoading] = useState(false)

    const [scatter, setScatter] = useState<{
        f1: string; f2: string; pearsonR: number; spearmanRho: number
    } | null>(null)

    // Recompute from live rows whenever they change
    useEffect(() => {
        if (!rows.length || !activeState) return
        // Skip if rows haven't changed since last computation (e.g. tab remount without Work changes)
        if (rows === lastRowsRef.current) return
        lastRowsRef.current = rows
        const columns = activeState.columns
        const numericFields = columns.filter(c => c.type === 'number').map(c => c.field)
        const catFields = columns.filter(c => c.type !== 'number').map(c => c.field)
        if (numericFields.length < 2 && catFields.length < 2) return

        workerRef.current?.terminate()
        setCorrLoading(true)

        // Extract numeric columns as Float64Array — transferred zero-copy, no OOM
        const controller = new AbortController()
        const worker = new Worker(
            new URL('../../../shared/lib/correlationWorker.ts', import.meta.url),
            { type: 'module' }
        )
        workerRef.current = worker
        worker.onmessage = (e: MessageEvent<CorrWorkerOutput>) => {
            setLiveCorr(e.data)
            setCorrLoading(false)
        }
        worker.onerror = () => { worker.terminate(); setCorrLoading(false) }

        // Transfer Float64Array buffers — zero-copy, prevents memory duplication
        const corrColumns = columns
            .filter((c) => numericFields.includes(c.field) || catFields.includes(c.field))
            .map((c) => ({ field: c.field, type: c.type }))
        projectRows(rows, corrColumns.map((c) => c.field), controller.signal)
            .then((slimRows) => worker.postMessage({ rows: slimRows, columns: corrColumns }))
            .catch((err) => {
                if (!(err instanceof DOMException && err.name === 'AbortError')) {
                    worker.terminate()
                    setCorrLoading(false)
                }
            })

        return () => { controller.abort(); worker.terminate() }
    }, [rows, activeState])

    const currentPalette = CORR_PALETTES.find(p => p.id === paletteId) ?? CORR_PALETTES[0]

    const corrData = {
        correlation: liveCorr?.correlation ?? stats.correlation ?? null,
        cramersV: liveCorr?.cramersV ?? stats.cramersV ?? null,
        vif: (liveCorr?.vif?.length ? liveCorr.vif : stats.vif) ?? [],
        multicollinearity: liveCorr?.multicollinearity ?? null,
    }

    const hasPearson = !!corrData.correlation
    const hasCramers = !!corrData.cramersV

    type HeatmapPanel = {
        kind: 'heatmap'; id: string; label: string
        accent: string; gradient: string
        fields: string[]; matrix: number[][]
        title: string; tooltip: string; minVal: number
        supportsScatter: boolean
    }
    type VifPanel = {
        kind: 'vif'; id: string; label: string
        accent: string; gradient: string
        items: CorrWorkerOutput['vif']
        multicollinearity: CorrWorkerOutput['multicollinearity']
    }
    type Panel = HeatmapPanel | VifPanel

    const panels: Panel[] = []
    if (hasPearson) {
        panels.push({
            kind: 'heatmap', id: 'pearson', label: 'Pearson',
            accent: '#1565c0', gradient: 'linear-gradient(135deg, #1565c0 0%, #42a5f5 100%)',
            fields: corrData.correlation!.fields, matrix: corrData.correlation!.pearson,
            title: 'Корреляция Пирсона',
            tooltip: 'Линейная зависимость между числовыми переменными. Чувствителен к выбросам. Предполагает нормальность.',
            minVal: -1, supportsScatter: true,
        })
        panels.push({
            kind: 'heatmap', id: 'spearman', label: 'Spearman',
            accent: '#2e7d32', gradient: 'linear-gradient(135deg, #2e7d32 0%, #66bb6a 100%)',
            fields: corrData.correlation!.fields, matrix: corrData.correlation!.spearman,
            title: 'Ранговая корреляция Спирмена',
            tooltip: 'Монотонная зависимость между числовыми переменными. Устойчив к выбросам и ненормальным распределениям.',
            minVal: -1, supportsScatter: true,
        })
    }
    if (hasCramers) {
        panels.push({
            kind: 'heatmap', id: 'cramers', label: "Cramér's V",
            accent: '#6a1b9a', gradient: 'linear-gradient(135deg, #6a1b9a 0%, #ab47bc 100%)',
            fields: corrData.cramersV!.fields, matrix: corrData.cramersV!.matrix,
            title: "Cramér's V",
            tooltip: 'Сила ассоциации между категориальными переменными на основе χ². 0 = нет связи, 1 = полная связь.',
            minVal: 0, supportsScatter: false,
        })
    }
    if (corrData.vif.length >= 2) {
        panels.push({
            kind: 'vif', id: 'vif', label: 'Мультиколлинеарность',
            accent: '#e65100', gradient: 'linear-gradient(135deg, #e65100 0%, #ff8f00 100%)',
            items: corrData.vif,
            multicollinearity: corrData.multicollinearity,
        })
    }

    useEffect(() => {
        const el = scrollRef.current
        if (!el) return
        const onScroll = () => {
            const idx = Math.round(el.scrollLeft / Math.max(1, el.clientWidth))
            setActiveIdx(Math.max(0, Math.min(panels.length - 1, idx)))
        }
        el.addEventListener('scroll', onScroll, { passive: true })
        return () => el.removeEventListener('scroll', onScroll)
    }, [panels.length])

    function goTo(idx: number) {
        const el = scrollRef.current
        if (!el) return
        el.scrollTo({ left: idx * el.clientWidth, behavior: 'instant' })
        setActiveIdx(idx)
    }

    function handleCellClick(f1: string, f2: string) {
        const fields = corrData.correlation?.fields ?? []
        const i1 = fields.indexOf(f1), i2 = fields.indexOf(f2)
        const pearsonR = i1 >= 0 && i2 >= 0 ? (corrData.correlation?.pearson[i1]?.[i2] ?? NaN) : NaN
        const spearmanRho = i1 >= 0 && i2 >= 0 ? (corrData.correlation?.spearman[i1]?.[i2] ?? NaN) : NaN
        setScatter({ f1, f2, pearsonR, spearmanRho })
    }

    const scatterPoints = useMemo(() => {
        if (!scatter) return []
        const { f1, f2 } = scatter
        const step = Math.max(1, Math.ceil(rows.length / 1500))
        const pts: { x: number; y: number }[] = []
        for (let i = 0; i < rows.length; i += step) {
            const row = rows[i]
            if (!row) continue
            const x = Number(row[f1]), y = Number(row[f2])
            if (!isNaN(x) && !isNaN(y) && row[f1] != null && row[f1] !== '' && row[f2] != null && row[f2] !== '')
                pts.push({ x, y })
        }
        return pts
    }, [scatter, rows])

    if (!hasPearson && !hasCramers && corrData.vif.length === 0 && !corrLoading) {
        return (
            <Alert severity="info">
                Недостаточно колонок для анализа зависимостей (нужно ≥ 2 числовых или ≥ 2 категориальных).
            </Alert>
        )
    }

    const activePanel = panels[activeIdx]

    function rChipColor(r: number): 'success' | 'error' | 'warning' | 'default' {
        if (!isFinite(r)) return 'default'
        const a = Math.abs(r)
        if (a >= 0.7) return r > 0 ? 'success' : 'error'
        if (a >= 0.4) return 'warning'
        return 'default'
    }

    return (
        <Box>
            {corrLoading && (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1.5 }}>
                    <LinearProgress sx={{ flex: 1, borderRadius: 1, height: 3 }} />
                    <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: 'nowrap' }}>
                        Пересчёт корреляции...
                    </Typography>
                </Box>
            )}

            {panels.length > 0 && (
                <>
                    <Box
                        ref={scrollRef}
                        sx={{
                            display: 'flex',
                            overflowX: 'auto',
                            scrollSnapType: 'x mandatory',
                            '&::-webkit-scrollbar': { display: 'none' },
                            scrollbarWidth: 'none',
                            msOverflowStyle: 'none',
                        }}
                    >
                        {panels.map((panel) => (
                            <Box key={panel.id} sx={{ flex: '0 0 100%', scrollSnapAlign: 'start', minWidth: 0 }}>
                                {panel.kind === 'heatmap' ? (
                                    <HeatmapMatrix
                                        fields={panel.fields}
                                        matrix={panel.matrix}
                                        title={panel.title}
                                        tooltip={panel.tooltip}
                                        paletteColors={currentPalette.colors}
                                        accentColor={panel.accent}
                                        minVal={panel.minVal}
                                        onCellClick={panel.supportsScatter ? handleCellClick : undefined}
                                    />
                                ) : (
                                    <Box sx={{ pt: 1.5, pb: 2 }}>
                                        {/* Global condition number */}
                                        {panel.multicollinearity?.conditionNumber != null && (() => {
                                            const cn = panel.multicollinearity!.conditionNumber!
                                            const cnColor = cn < 10 ? 'success' : cn < 30 ? 'warning' : 'error'
                                            const cnLabel = cn < 10 ? 'нет проблем' : cn < 30 ? 'умеренная' : 'высокая'
                                            return (
                                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2, flexWrap: 'wrap' }}>
                                                    <Tooltip title="Condition Number = √(λmax/λmin) матрицы корреляций. < 10 — нет проблем, 10–30 — умеренная, > 30 — высокая мультиколлинеарность." arrow>
                                                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, cursor: 'help' }}>
                                                            <Typography variant="caption" color="text.secondary">Condition Number</Typography>
                                                            <Chip label={`κ = ${fmt(cn, 2)} — ${cnLabel}`} size="small" color={cnColor} />
                                                        </Box>
                                                    </Tooltip>
                                                </Box>
                                            )
                                        })()}

                                        {/* VIF + Tolerance per column */}
                                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 1.5 }}>
                                            <Typography variant="subtitle2" fontWeight={700}>VIF и Толерантность по переменным</Typography>
                                            <Tooltip title="VIF (Variance Inflation Factor) — насколько дисперсия коэффициента раздута из-за мультиколлинеарности. Толерантность = 1/VIF. VIF < 5 — нет проблем, 5–10 — умеренная, > 10 — высокая." arrow>
                                                <Typography component="span" sx={{ cursor: 'help', color: 'text.secondary', fontSize: '0.8rem' }}>ⓘ</Typography>
                                            </Tooltip>
                                        </Box>
                                        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5, mb: 2.5 }}>
                                            {panel.items.map((r) => (
                                                <Paper key={r.field} variant="outlined" sx={{ p: 1.5, borderRadius: 2, minWidth: 130, textAlign: 'center' }}>
                                                    <Typography variant="caption" color="text.secondary" display="block" noWrap sx={{ maxWidth: 160, mx: 'auto' }}>{r.field}</Typography>
                                                    <Box sx={{ display: 'flex', gap: 0.5, mt: 0.75, justifyContent: 'center', flexWrap: 'wrap' }}>
                                                        <Chip label={`VIF ${fmt(r.vif ?? NaN, 2)}`} size="small" color={vifColor(r.vif)} />
                                                        {r.tolerance != null && (
                                                            <Chip label={`T ${fmt(r.tolerance, 3)}`} size="small" variant="outlined"
                                                                sx={{ borderColor: vifColor(r.vif) === 'success' ? 'success.main' : vifColor(r.vif) === 'warning' ? 'warning.main' : 'error.main' }} />
                                                        )}
                                                    </Box>
                                                </Paper>
                                            ))}
                                        </Box>

                                        {/* Eigenvalue bar chart */}
                                        {panel.multicollinearity?.eigenvalues && panel.multicollinearity.eigenvalues.length >= 2 && (
                                            <Box>
                                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 1 }}>
                                                    <Typography variant="subtitle2" fontWeight={700}>Собственные значения матрицы корреляций</Typography>
                                                    <Tooltip title="Малые собственные значения указывают на линейно зависимые переменные. Condition Index (CI) = √(λmax/λk) — чем больше, тем сильнее соответствующая размерность коллинеарна." arrow>
                                                        <Typography component="span" sx={{ cursor: 'help', color: 'text.secondary', fontSize: '0.8rem' }}>ⓘ</Typography>
                                                    </Tooltip>
                                                </Box>
                                                <ResponsiveContainer width="100%" height={160}>
                                                    <BarChart
                                                        data={panel.multicollinearity.eigenvalues.map((ev, i) => ({
                                                            name: `λ${i + 1}`,
                                                            value: ev,
                                                            ci: panel.multicollinearity!.conditionIndices[i] ?? null,
                                                        }))}
                                                        margin={{ top: 4, right: 16, bottom: 4, left: 0 }}
                                                    >
                                                        <CartesianGrid strokeDasharray="3 3" vertical={false} />
                                                        <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                                                        <YAxis tick={{ fontSize: 11 }} />
                                                        <RTooltip
                                                            formatter={(value, _name, entry) => {
                                                                const ci = (entry as { payload?: { ci?: number | null } }).payload?.ci
                                                                return [`λ = ${fmt(Number(value), 4)}${ci != null ? `  CI = ${fmt(ci, 2)}` : ''}`, 'Собств. значение']
                                                            }}
                                                        />
                                                        <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                                                            {panel.multicollinearity.eigenvalues.map((ev, i) => (
                                                                <Cell key={i} fill={ev < 0.1 ? '#e53935' : ev < 0.5 ? '#fb8c00' : '#1976d2'} />
                                                            ))}
                                                            <LabelList dataKey="ci" position="top" formatter={(v: unknown) => v != null ? `CI=${fmt(Number(v), 1)}` : ''} style={{ fontSize: 9, fill: '#666' }} />
                                                        </Bar>
                                                    </BarChart>
                                                </ResponsiveContainer>
                                            </Box>
                                        )}
                                    </Box>
                                )}
                            </Box>
                        ))}
                    </Box>

                    <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 1.5, mt: 1.5 }}>
                        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                            {panels.map((panel, idx) => {
                                const isActive = activeIdx === idx
                                return (
                                    <Box
                                        key={panel.id}
                                        component="button"
                                        type="button"
                                        onMouseDown={(e: React.MouseEvent) => e.preventDefault()}
                                        onClick={() => goTo(idx)}
                                        sx={{
                                            display: 'inline-flex', alignItems: 'center', gap: 0.75,
                                            px: 1.75, py: 0.6, borderRadius: 99,
                                            cursor: 'pointer', userSelect: 'none',
                                            border: '2px solid', background: 'none', outline: 'none',
                                            borderColor: isActive ? panel.accent : 'divider',
                                            backgroundImage: isActive ? panel.gradient : 'none',
                                            transition: 'background-image 0.2s, border-color 0.2s, box-shadow 0.2s',
                                            boxShadow: isActive ? `0 2px 8px ${panel.accent}44` : 'none',
                                            '&:hover': !isActive ? { borderColor: panel.accent, bgcolor: `${panel.accent}11` } : {},
                                        }}
                                    >
                                        <Typography variant="caption" fontWeight={700} sx={{ whiteSpace: 'nowrap', color: isActive ? '#fff' : 'text.primary', fontSize: '0.8rem' }}>
                                            {panel.label}
                                        </Typography>
                                    </Box>
                                )
                            })}
                        </Box>
                        {activePanel?.kind === 'heatmap' && <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'center', gap: 1 }}>
                            <Typography variant="caption" color="text.secondary">Палитра:</Typography>
                            {CORR_PALETTES.map(p => {
                                const mid = Math.floor(p.colors.length / 2)
                                const isSelected = paletteId === p.id
                                return (
                                    <Tooltip key={p.id} title={p.label} arrow>
                                        <Box
                                            onClick={() => setPaletteId(p.id)}
                                            sx={{
                                                width: 34, height: 16, borderRadius: 1.5,
                                                background: `linear-gradient(to right, ${p.colors[0]}, ${p.colors[mid]}, ${p.colors[p.colors.length - 1]})`,
                                                cursor: 'pointer',
                                                border: isSelected ? '2px solid' : '1.5px solid',
                                                borderColor: isSelected ? (activePanel?.accent ?? 'primary.main') : 'divider',
                                                boxShadow: isSelected ? `0 0 0 1.5px ${activePanel?.accent ?? '#1976d2'}` : 'none',
                                                transition: 'all 0.15s',
                                                '&:hover': { transform: 'scaleY(1.3)' },
                                            }}
                                        />
                                    </Tooltip>
                                )
                            })}
                        </Box>}
                    </Box>
                </>
            )}

            {/* Scatter dialog */}
            {scatter && (
                <Dialog open onClose={() => setScatter(null)} maxWidth="sm" fullWidth PaperProps={{ sx: { borderRadius: 3 } }}>
                    <DialogTitle sx={{ pb: 0.5, pr: 1 }}>
                        <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
                            <Box sx={{ flex: 1 }}>
                                <Typography variant="subtitle1" fontWeight={700}>
                                    {scatter.f1} × {scatter.f2}
                                </Typography>
                                <Box sx={{ display: 'flex', gap: 1, mt: 0.5, flexWrap: 'wrap' }}>
                                    <Chip size="small" label={`Pearson r = ${fmt(scatter.pearsonR, 3)}`} color={rChipColor(scatter.pearsonR)} />
                                    <Chip size="small" label={`Spearman ρ = ${fmt(scatter.spearmanRho, 3)}`} variant="outlined" />
                                </Box>
                            </Box>
                            <IconButton onClick={() => setScatter(null)} size="small" sx={{ mt: -0.5 }}>
                                <CloseIcon fontSize="small" />
                            </IconButton>
                        </Box>
                    </DialogTitle>
                    <DialogContent sx={{ pt: 1, pb: 2 }}>
                        <ResponsiveContainer width="100%" height={280}>
                            <ScatterChart margin={{ top: 8, right: 16, bottom: 24, left: 8 }}>
                                <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.08)" />
                                <XAxis
                                    dataKey="x" type="number" name={scatter.f1}
                                    domain={['auto', 'auto']} tick={{ fontSize: 10 }}
                                    tickFormatter={(v: number) => fmt(v, 2)}
                                    label={{ value: scatter.f1, position: 'insideBottom', offset: -12, fontSize: 11 }}
                                />
                                <YAxis
                                    dataKey="y" type="number" name={scatter.f2}
                                    domain={['auto', 'auto']} tick={{ fontSize: 10 }}
                                    tickFormatter={(v: number) => fmt(v, 2)}
                                    label={{ value: scatter.f2, angle: -90, position: 'insideLeft', offset: 12, fontSize: 11 }}
                                />
                                <RTooltip
                                    cursor={{ strokeDasharray: '3 3' }}
                                    content={({ payload }: any) => {
                                        if (!payload?.length) return null
                                        const { x, y } = payload[0].payload as { x: number; y: number }
                                        return (
                                            <Paper sx={{ p: 1, fontSize: '0.72rem', lineHeight: 1.7 }}>
                                                <div><b>{scatter.f1}</b>: {fmt(x, 4)}</div>
                                                <div><b>{scatter.f2}</b>: {fmt(y, 4)}</div>
                                            </Paper>
                                        )
                                    }}
                                />
                                <Scatter
                                    data={scatterPoints}
                                    fill={activePanel?.accent ?? '#1976d2'}
                                    fillOpacity={Math.max(0.12, Math.min(0.7, 400 / Math.max(scatterPoints.length, 1)))}
                                />
                            </ScatterChart>
                        </ResponsiveContainer>
                        <Typography variant="caption" color="text.secondary">
                            {scatterPoints.length.toLocaleString()} точек
                            {rows.length > 1500 ? ` (выборка из ${rows.length.toLocaleString()})` : ''}
                        </Typography>
                    </DialogContent>
                </Dialog>
            )}
        </Box>
    )
}



// Функция PValueTab



function PValueTab({ uploadId }: { uploadId?: string }) {
    return <PValueSection standalone uploadId={uploadId} />
}



// ─── Boxplot ──────────────────────────────────────────────────────────────

function BoxplotCard({ col }: { col: NumericColStats }) {
    const bp = col.boxplot
    const SVG_H = 220
    const SVG_W = 92
    const PAD_V = 20
    const cx = SVG_W / 2
    const bw = 38

    const outliersSample = useMemo(() => bp.outliers.slice(0, 80), [bp.outliers])
    const allVals = [bp.wLow, bp.wHigh, ...outliersSample]
    const vMin = Math.min(...allVals)
    const vMax = Math.max(...allVals)
    const range = vMax === vMin ? 1 : vMax - vMin

    const yScale = (v: number) => PAD_V + (1 - (v - vMin) / range) * (SVG_H - 2 * PAD_V)

    const yQ3 = yScale(bp.q3)
    const yQ1 = yScale(bp.q1)
    const yMed = yScale(bp.median)
    const yWHigh = yScale(bp.wHigh)
    const yWLow = yScale(bp.wLow)
    const yMean = yScale(col.mean)

    // Детерминированный jitter без Math.random
    const jitter = (v: number, i: number) =>
        ((Math.abs(v * 127.1 + i * 31.3) % 1000) / 1000 - 0.5) * bw * 0.55

    return (
        <Paper
            variant="outlined"
            sx={{ p: 1.5, display: 'flex', flexDirection: 'column', alignItems: 'center', height: '100%' }}
        >
            <Tooltip title={col.field} placement="top">
                <Typography
                    variant="caption" fontWeight={700} noWrap
                    sx={{ maxWidth: SVG_W + 20, overflow: 'hidden', textOverflow: 'ellipsis', mb: 0.5 }}
                >
                    {col.field}
                </Typography>
            </Tooltip>

            <svg width={SVG_W} height={SVG_H} style={{ overflow: 'visible' }}>
                {/* Пунктирные ориентиры */}
                {[0.25, 0.5, 0.75].map((t) => (
                    <line key={t}
                        x1={cx - bw} y1={PAD_V + t * (SVG_H - 2 * PAD_V)}
                        x2={cx + bw} y2={PAD_V + t * (SVG_H - 2 * PAD_V)}
                        stroke="#eeeeee" strokeWidth={1}
                    />
                ))}

                {/* Ось уса */}
                <line x1={cx} y1={yWHigh} x2={cx} y2={yWLow} stroke="#607d8b" strokeWidth={1.5} />

                {/* Концы усов */}
                <line x1={cx - bw * 0.28} y1={yWHigh} x2={cx + bw * 0.28} y2={yWHigh} stroke="#607d8b" strokeWidth={2} />
                <line x1={cx - bw * 0.28} y1={yWLow} x2={cx + bw * 0.28} y2={yWLow} stroke="#607d8b" strokeWidth={2} />

                {/* Коробка Q1–Q3 */}
                <rect
                    x={cx - bw / 2} y={yQ3}
                    width={bw} height={Math.max(1, yQ1 - yQ3)}
                    fill="#bbdefb" stroke="#1565c0" strokeWidth={1.5} rx={2}
                />

                {/* Медиана */}
                <line x1={cx - bw / 2} y1={yMed} x2={cx + bw / 2} y2={yMed}
                    stroke="#1565c0" strokeWidth={2.5}
                />

                {/* Среднее (x) */}
                {isFinite(yMean) && (
                    <>
                        <line x1={cx - 5} y1={yMean - 5} x2={cx + 5} y2={yMean + 5} stroke="#e53935" strokeWidth={1.8} />
                        <line x1={cx + 5} y1={yMean - 5} x2={cx - 5} y2={yMean + 5} stroke="#e53935" strokeWidth={1.8} />
                    </>
                )}

                {/* Выбросы */}
                {outliersSample.map((v, i) => (
                    <circle key={i}
                        cx={cx + jitter(v, i)}
                        cy={yScale(v)}
                        r={3}
                        fill="#ef5350"
                        fillOpacity={0.7}
                        stroke="white"
                        strokeWidth={0.6}
                    />
                ))}

                {/* Масштаб сбоку */}
                <text x={2} y={PAD_V + 3} fontSize={7.5} fill="#9e9e9e">{fmt(vMax, 2)}</text>
                <text x={2} y={SVG_H - PAD_V + 3} fontSize={7.5} fill="#9e9e9e">{fmt(vMin, 2)}</text>
            </svg>

            {/* Таблица статистики */}
            <Box sx={{
                display: 'grid', gridTemplateColumns: '1fr 1fr',
                gap: '1px 6px', width: '100%', mt: 0.75,
                '& span': { fontSize: '0.65rem', color: 'text.secondary', lineHeight: 1.4 },
            }}>
                <span>Min: {fmt(bp.min, 2)}</span>
                <span>Max: {fmt(bp.max, 2)}</span>
                <span>Q1: {fmt(bp.q1, 2)}</span>
                <span>Q3: {fmt(bp.q3, 2)}</span>
                <span style={{ fontWeight: 600 }}>Med: {fmt(bp.median, 2)}</span>
                <span style={{ color: '#e53935' }}>×: {fmt(col.mean, 2)}</span>
                <span>IQR: {fmt(col.iqr, 2)}</span>
                <span>σ: {fmt(col.std, 2)}</span>
            </Box>

            {col.outliersCount > 0 ? (
                <Chip
                    label={`${col.outliersCount} выброс${col.outliersCount === 1 ? '' : col.outliersCount < 5 ? 'а' : 'ов'}`}
                    size="small" color="error" variant="outlined"
                    sx={{ mt: 0.75, height: 20, fontSize: '0.65rem', '& .MuiChip-label': { px: 0.75 } }}
                />
            ) : (
                <Chip
                    label="Нет выбросов"
                    size="small" color="success" variant="outlined"
                    sx={{ mt: 0.75, height: 20, fontSize: '0.65rem', '& .MuiChip-label': { px: 0.75 } }}
                />
            )}
        </Paper>
    )
}

// Функция OutliersTab

function OutliersTab({ stats }: { stats: DatasetStats }) {
    const numCols = stats.columns.filter((c): c is NumericColStats => c.kind === 'numeric')
    const withOutliers = numCols.filter((c) => c.outliersCount > 0)
    const totalOutliers = withOutliers.reduce((s, c) => s + c.outliersCount, 0)

    if (numCols.length === 0) {
        return <Alert severity="info">Числовых колонок не найдено.</Alert>
    }

    return (
        <Box>
            {/* Сводка */}
            <Box sx={{ display: 'flex', gap: 1.5, mb: 2.5, flexWrap: 'wrap', alignItems: 'center' }}>
                <Chip
                    label={`${withOutliers.length} из ${numCols.length} колонок с выбросами`}
                    color={withOutliers.length > 0 ? 'error' : 'success'}
                    size="small"
                />
                {totalOutliers > 0 && (
                    <Chip
                        label={`${totalOutliers.toLocaleString()} выбросов всего (IQR × 1.5)`}
                        color="warning" variant="outlined" size="small"
                    />
                )}
                <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center', flexWrap: 'wrap' }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                        <Box sx={{ width: 20, height: 3, bgcolor: '#1565c0', borderRadius: 1 }} />
                        <Typography variant="caption" color="text.secondary">медиана</Typography>
                    </Box>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                        <Box component="span" sx={{ fontSize: '0.75rem', color: '#e53935', fontWeight: 700, lineHeight: 1 }}>×</Box>
                        <Typography variant="caption" color="text.secondary">среднее</Typography>
                    </Box>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                        <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: '#ef5350', opacity: 0.7 }} />
                        <Typography variant="caption" color="text.secondary">выброс</Typography>
                    </Box>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                        <Box sx={{ width: 16, height: 10, bgcolor: '#bbdefb', border: '1.5px solid #1565c0', borderRadius: '2px' }} />
                        <Typography variant="caption" color="text.secondary">Q1–Q3</Typography>
                    </Box>
                </Box>
            </Box>

            <Grid container spacing={1.5}>
                {numCols.map((col) => (
                    <Grid item xs={6} sm={4} md={3} lg={2} key={col.field}>
                        <BoxplotCard col={col} />
                    </Grid>
                ))}
            </Grid>
        </Box>
    )
}


// ─── KDE / PCA helpers ───────────────────────────────────────────────────────

function gaussianKDE(values: number[], h: number, pts: number[]): number[] {
    const n = values.length
    if (n === 0 || h <= 0) return pts.map(() => 0)
    return pts.map(x => values.reduce((s, v) => s + Math.exp(-0.5 * ((x - v) / h) ** 2), 0) / (n * h * Math.sqrt(2 * Math.PI)))
}

function silvermanBW(sorted: number[]): number {
    const n = sorted.length
    if (n < 2) return 1
    const mean = sorted.reduce((a, b) => a + b, 0) / n
    const std = Math.sqrt(sorted.reduce((s, v) => s + (v - mean) ** 2, 0) / n) || 1
    const iqrVal = (sorted[Math.floor(n * 0.75)] ?? sorted[n - 1]) - (sorted[Math.floor(n * 0.25)] ?? sorted[0])
    const s = Math.min(std, (iqrVal || std) / 1.34)
    return Math.max(0.01, 0.9 * s * Math.pow(n, -0.2))
}


// ─── Violin Card ─────────────────────────────────────────────────────────────

function ViolinCard({ col, values }: { col: NumericColStats; values: number[] }) {
    const SVG_H = 240, SVG_W = 90, PAD_V = 16, cx = SVG_W / 2, maxW = 32
    const densityData = useMemo(() => {
        if (values.length < 3) return null
        const sorted = [...values].sort((a, b) => a - b)
        const vMin = sorted[0], vMax = sorted[sorted.length - 1]
        const range = vMax - vMin
        if (range === 0) return null
        const bw = silvermanBW(sorted)
        const pts = Array.from({ length: 60 }, (_, i) => vMin + (range * i) / 59)
        const density = gaussianKDE(values, bw, pts)
        const maxD = Math.max(...density) || 1
        return { pts, density, maxD, vMin, vMax }
    }, [values])

    if (!densityData) {
        return (
            <Paper variant="outlined" sx={{ p: 1.5, textAlign: 'center', minHeight: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column' }}>
                <Typography variant="caption" fontWeight={700}>{col.field}</Typography>
                <Typography variant="caption" color="text.disabled">Недостаточно данных</Typography>
            </Paper>
        )
    }

    const { pts, density, maxD, vMin, vMax } = densityData
    const range = vMax - vMin
    const yScale = (v: number) => PAD_V + (1 - (v - vMin) / range) * (SVG_H - 2 * PAD_V)
    const xScale = (d: number) => (d / maxD) * maxW
    const rightPts = pts.map((p, i) => `${cx + xScale(density[i])},${yScale(p)}`)
    const leftPts = [...pts].reverse().map((p, i) => `${cx - xScale(density[pts.length - 1 - i])},${yScale(p)}`)
    const pathD = `M ${rightPts[0]} L ${rightPts.join(' L ')} L ${leftPts.join(' L ')} Z`
    const bp = col.boxplot

    return (
        <Paper variant="outlined" sx={{ p: 1.5, display: 'flex', flexDirection: 'column', alignItems: 'center', height: '100%' }}>
            <Tooltip title={col.field} placement="top">
                <Typography variant="caption" fontWeight={700} noWrap sx={{ maxWidth: SVG_W + 10, overflow: 'hidden', textOverflow: 'ellipsis', mb: 0.5 }}>
                    {col.field}
                </Typography>
            </Tooltip>
            <svg width={SVG_W} height={SVG_H} style={{ overflow: 'visible' }}>
                <path d={pathD} fill="#bbdefb" stroke="#1565c0" strokeWidth={1} opacity={0.85} />
                <line x1={cx - 8} y1={yScale(bp.q3)} x2={cx + 8} y2={yScale(bp.q3)} stroke="#1565c0" strokeWidth={1.5} />
                <line x1={cx} y1={yScale(bp.q3)} x2={cx} y2={yScale(bp.q1)} stroke="#1565c0" strokeWidth={3} strokeLinecap="round" />
                <line x1={cx - 8} y1={yScale(bp.q1)} x2={cx + 8} y2={yScale(bp.q1)} stroke="#1565c0" strokeWidth={1.5} />
                <circle cx={cx} cy={yScale(bp.median)} r={4} fill="#fff" stroke="#1565c0" strokeWidth={2} />
                {isFinite(col.mean) && (
                    <>
                        <line x1={cx - 5} y1={yScale(col.mean) - 5} x2={cx + 5} y2={yScale(col.mean) + 5} stroke="#e53935" strokeWidth={1.8} />
                        <line x1={cx + 5} y1={yScale(col.mean) - 5} x2={cx - 5} y2={yScale(col.mean) + 5} stroke="#e53935" strokeWidth={1.8} />
                    </>
                )}
                <text x={2} y={PAD_V + 3} fontSize={7} fill="#9e9e9e">{fmt(vMax, 2)}</text>
                <text x={2} y={SVG_H - PAD_V + 3} fontSize={7} fill="#9e9e9e">{fmt(vMin, 2)}</text>
            </svg>
            <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1px 6px', width: '100%', mt: 0.5, '& span': { fontSize: '0.65rem', color: 'text.secondary', lineHeight: 1.4 } }}>
                <span>Med: {fmt(bp.median, 2)}</span>
                <span style={{ color: '#e53935' }}>×: {fmt(col.mean, 2)}</span>
                <span>IQR: {fmt(col.iqr, 2)}</span>
                <span>σ: {fmt(col.std, 2)}</span>
            </Box>
        </Paper>
    )
}

const VIOLIN_SAMPLE = 3000

function ViolinTab({ stats }: { stats: DatasetStats }) {
    const rows = useTableStore(s => s.rows)
    const numCols = stats.columns.filter((c): c is NumericColStats => c.kind === 'numeric')
    const isSampled = rows.length > VIOLIN_SAMPLE

    const sample = useMemo(() => {
        if (!isSampled) return rows
        const step = Math.ceil(rows.length / VIOLIN_SAMPLE)
        return rows.filter((_, i) => i % step === 0).slice(0, VIOLIN_SAMPLE)
    }, [rows, isSampled])

    const valuesByField = useMemo(() => {
        const result = new Map<string, number[]>()
        numCols.forEach(col => {
            result.set(col.field, sample.map(r => Number(r[col.field])).filter(isFinite))
        })
        return result
    }, [sample, numCols])

    if (numCols.length === 0) return <Alert severity="info">Нет числовых колонок.</Alert>
    return (
        <Box>
            {isSampled && (
                <Alert severity="info" sx={{ mb: 2, py: 0.5 }}>
                    <Typography variant="caption">
                        Выборка {VIOLIN_SAMPLE.toLocaleString()} из {rows.length.toLocaleString()} строк
                    </Typography>
                </Alert>
            )}
            <Grid container spacing={1.5}>
                {numCols.map(col => (
                    <Grid item xs={6} sm={4} md={3} lg={2} key={col.field}>
                        <ViolinCard col={col} values={valuesByField.get(col.field) ?? []} />
                    </Grid>
                ))}
            </Grid>
        </Box>
    )
}

// ─── Scatter Plot ─────────────────────────────────────────────────────────────

function ScatterViz({ stats }: { stats: DatasetStats }) {
    const rows = useTableStore(s => s.rows)
    const numCols = stats.columns.filter(c => c.kind === 'numeric')
    const catCols = stats.columns.filter(c => c.kind === 'categorical')
    const [xCol, setXCol] = useState(numCols[0]?.field ?? '')
    const [yCol, setYCol] = useState(numCols[1]?.field ?? numCols[0]?.field ?? '')
    const [colorCol, setColorCol] = useState('')

    const scatterData = useMemo(() => {
        if (!xCol || !yCol || !rows.length) return []
        return rows
            .filter(r => r[xCol] != null && r[yCol] != null)
            .map(r => ({ x: Number(r[xCol]), y: Number(r[yCol]), color: colorCol ? String(r[colorCol] ?? '') : '' }))
            .filter(r => isFinite(r.x) && isFinite(r.y))
            .slice(0, 2000)
    }, [rows, xCol, yCol, colorCol])

    const colorGroups = useMemo(() => {
        if (!colorCol) return [{ name: '', data: scatterData, color: '#3b82f6' }]
        const groups = new Map<string, typeof scatterData>()
        scatterData.forEach(d => {
            if (!groups.has(d.color)) groups.set(d.color, [])
            groups.get(d.color)!.push(d)
        })
        return Array.from(groups.entries()).map(([name, data], i) => ({ name, data, color: CATEGORICAL_PALETTE[i % CATEGORICAL_PALETTE.length] }))
    }, [scatterData, colorCol])

    if (numCols.length < 2) return <Alert severity="info">Нужно минимум 2 числовые колонки для диаграммы рассеяния.</Alert>

    return (
        <Box>
            <Box sx={{ display: 'flex', gap: 2, mb: 3, flexWrap: 'wrap' }}>
                <FormControl size="small" sx={{ minWidth: 160 }}>
                    <InputLabel>Ось X</InputLabel>
                    <Select value={xCol} label="Ось X" onChange={e => setXCol(e.target.value)}>
                        {numCols.map(c => <MenuItem key={c.field} value={c.field}>{c.field}</MenuItem>)}
                    </Select>
                </FormControl>
                <FormControl size="small" sx={{ minWidth: 160 }}>
                    <InputLabel>Ось Y</InputLabel>
                    <Select value={yCol} label="Ось Y" onChange={e => setYCol(e.target.value)}>
                        {numCols.map(c => <MenuItem key={c.field} value={c.field}>{c.field}</MenuItem>)}
                    </Select>
                </FormControl>
                {catCols.length > 0 && (
                    <FormControl size="small" sx={{ minWidth: 160 }}>
                        <InputLabel>Цвет (группа)</InputLabel>
                        <Select value={colorCol} label="Цвет (группа)" onChange={e => setColorCol(e.target.value)}>
                            <MenuItem value="">— нет —</MenuItem>
                            {catCols.map(c => <MenuItem key={c.field} value={c.field}>{c.field}</MenuItem>)}
                        </Select>
                    </FormControl>
                )}
            </Box>
            {scatterData.length === 0
                ? <Alert severity="info">Нет данных для построения диаграммы.</Alert>
                : (
                    <>
                        {scatterData.length === 2000 && <Alert severity="warning" sx={{ mb: 1, py: 0.3, borderRadius: 2 }}><Typography variant="caption">Показаны первые 2000 точек.</Typography></Alert>}
                        <Box sx={{ height: 420 }}>
                            <ResponsiveContainer width="100%" height="100%">
                                <ScatterChart margin={{ top: 10, right: 30, bottom: 40, left: 20 }}>
                                    <CartesianGrid strokeDasharray="3 3" />
                                    <XAxis type="number" dataKey="x" name={xCol} label={{ value: xCol, position: 'insideBottom', offset: -10, fontSize: 12 }} tick={{ fontSize: 11 }} />
                                    <YAxis type="number" dataKey="y" name={yCol} label={{ value: yCol, angle: -90, position: 'insideLeft', offset: 10, fontSize: 12 }} tick={{ fontSize: 11 }} />
                                    <RTooltip cursor={{ strokeDasharray: '3 3' }} formatter={(v) => [typeof v === 'number' ? fmt(v) : String(v)]} />
                                    {colorGroups.length > 1 && <Legend />}
                                    {colorGroups.map(g => (
                                        <Scatter key={g.name || 'data'} name={g.name || yCol} data={g.data} fill={g.color} fillOpacity={0.6} />
                                    ))}
                                </ScatterChart>
                            </ResponsiveContainer>
                        </Box>
                    </>
                )
            }
        </Box>
    )
}

// ─── Тултип со скроллом для многосегментных графиков ─────────────────────────

function ScrollableTooltip({ active, payload, label }: any) {
    if (!active || !payload?.length) return null
    return (
        <Paper
            elevation={4}
            sx={{
                p: 1.5,
                maxHeight: '42vh',
                overflowY: 'auto',
                minWidth: 150,
                maxWidth: 260,
                fontSize: 12,
                zIndex: 1400,
            }}
        >
            <Typography
                variant="caption"
                fontWeight={700}
                display="block"
                sx={{ mb: 0.5, pb: 0.5, borderBottom: '1px solid', borderColor: 'divider' }}
            >
                {label}
            </Typography>
            {[...payload].reverse().map((entry: any) => (
                <Box key={entry.name} sx={{ display: 'flex', alignItems: 'center', gap: 0.75, py: 0.15 }}>
                    <Box sx={{ width: 10, height: 10, borderRadius: '2px', flexShrink: 0, bgcolor: entry.fill }} />
                    <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.4 }}>
                        {entry.name}: <strong>{entry.value}</strong>
                    </Typography>
                </Box>
            ))}
        </Paper>
    )
}

// ─── Stacked Bar Chart ────────────────────────────────────────────────────────

function StackedBarViz({ stats }: { stats: DatasetStats }) {
    const rows = useTableStore(s => s.rows)
    const catCols = stats.columns.filter(c => c.kind === 'categorical')
    const numCols = stats.columns.filter(c => c.kind === 'numeric')
    const [xCol, setXCol] = useState(catCols[0]?.field ?? '')
    const [stackCol, setStackCol] = useState(catCols[1]?.field ?? catCols[0]?.field ?? '')
    const [metric, setMetric] = useState<'count' | 'sum'>('count')
    const [yCol, setYCol] = useState(numCols[0]?.field ?? '')
    const PALETTE = ['#3b82f6', '#ef4444', '#22c55e', '#f59e0b', '#8b5cf6', '#06b6d4', '#ec4899', '#84cc16', '#f97316', '#14b8a6']

    const { data: chartData, stackKeys } = useMemo(() => {
        if (!xCol || !stackCol || !rows.length) return { data: [], stackKeys: [] }
        const grouped = new Map<string, Map<string, number>>()
        const keysSet = new Set<string>()
        rows.forEach(r => {
            const xVal = String(r[xCol] ?? '(пусто)')
            const sVal = String(r[stackCol] ?? '(пусто)')
            keysSet.add(sVal)
            if (!grouped.has(xVal)) grouped.set(xVal, new Map())
            const numVal = metric === 'count' ? 1 : (yCol ? Number(r[yCol] ?? 0) : 1)
            const inner = grouped.get(xVal)!
            inner.set(sVal, (inner.get(sVal) ?? 0) + (isFinite(numVal) ? numVal : 0))
        })
        const sortedKeys = Array.from(keysSet).slice(0, 15)
        const data = Array.from(grouped.entries())
            .map(([xVal, inner]) => {
                const obj: Record<string, string | number> = { x: xVal }
                sortedKeys.forEach(k => { obj[k] = inner.get(k) ?? 0 })
                return obj
            })
            .slice(0, 30)
        return { data, stackKeys: sortedKeys }
    }, [rows, xCol, stackCol, metric, yCol])

    if (catCols.length < 1) return <Alert severity="info">Нужна хотя бы 1 категориальная колонка.</Alert>

    return (
        <Box>
            <Box sx={{ display: 'flex', gap: 2, mb: 3, flexWrap: 'wrap', alignItems: 'center' }}>
                <FormControl size="small" sx={{ minWidth: 160 }}>
                    <InputLabel>Ось X</InputLabel>
                    <Select value={xCol} label="Ось X" onChange={e => setXCol(e.target.value)}>
                        {catCols.map(c => <MenuItem key={c.field} value={c.field}>{c.field}</MenuItem>)}
                    </Select>
                </FormControl>
                <FormControl size="small" sx={{ minWidth: 180 }}>
                    <InputLabel>Стек (группировка)</InputLabel>
                    <Select value={stackCol} label="Стек (группировка)" onChange={e => setStackCol(e.target.value)}>
                        {catCols.map(c => <MenuItem key={c.field} value={c.field}>{c.field}</MenuItem>)}
                    </Select>
                </FormControl>
                <ToggleButtonGroup value={metric} exclusive onChange={(_, v) => { if (v) setMetric(v) }} size="small">
                    <ToggleButton value="count">Количество</ToggleButton>
                    <ToggleButton value="sum" disabled={numCols.length === 0}>Сумма</ToggleButton>
                </ToggleButtonGroup>
                {metric === 'sum' && numCols.length > 0 && (
                    <FormControl size="small" sx={{ minWidth: 140 }}>
                        <InputLabel>Числовое поле</InputLabel>
                        <Select value={yCol} label="Числовое поле" onChange={e => setYCol(e.target.value)}>
                            {numCols.map(c => <MenuItem key={c.field} value={c.field}>{c.field}</MenuItem>)}
                        </Select>
                    </FormControl>
                )}
            </Box>
            {chartData.length === 0
                ? <Alert severity="info">Нет данных.</Alert>
                : (
                    <Box sx={{ height: Math.max(480, 400 + stackKeys.length * 8) }}>
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={chartData} margin={{ top: 8, right: 30, bottom: 24, left: 20 }}>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                                <XAxis
                                    dataKey="x"
                                    interval={0}
                                    height={32}
                                    tick={(props: any) => {
                                        const { x, y, payload } = props
                                        const text = String(payload?.value ?? '')
                                        const maxChars = Math.max(3, Math.floor(90 / Math.max(1, chartData.length)))
                                        const display = text.length > maxChars ? `${text.slice(0, maxChars - 1)}…` : text
                                        return (
                                            <g transform={`translate(${x},${y})`}>
                                                <text
                                                    dy={16}
                                                    textAnchor="middle"
                                                    fill="#555"
                                                    style={{ fontSize: 11 }}
                                                >
                                                    {display}
                                                </text>
                                            </g>
                                        )
                                    }}
                                />
                                <YAxis tick={{ fontSize: 11 }} />
                                <RTooltip
                                    content={<ScrollableTooltip />}
                                    allowEscapeViewBox={{ x: false, y: false }}
                                />
                                <Legend
                                    verticalAlign="top"
                                    wrapperStyle={{ fontSize: 11, paddingBottom: 12 }}
                                />
                                {stackKeys.map((k, i) => (
                                    <Bar key={k} dataKey={k} stackId="a" fill={PALETTE[i % PALETTE.length]} />
                                ))}
                            </BarChart>
                        </ResponsiveContainer>
                    </Box>
                )
            }
        </Box>
    )
}

// ─── Line Plot ────────────────────────────────────────────────────────────────

function LinePlotViz({ stats }: { stats: DatasetStats }) {
    const rows = useTableStore(s => s.rows)
    const numCols = stats.columns.filter(c => c.kind === 'numeric')
    const [xCol, setXCol] = useState<string>('index')
    const [yCols, setYCols] = useState<string[]>(numCols.slice(0, 3).map(c => c.field))
    const PALETTE = ['#3b82f6', '#ef4444', '#22c55e', '#f59e0b', '#8b5cf6', '#06b6d4', '#ec4899']

    const lineData = useMemo(() => {
        if (!rows.length || yCols.length === 0) return []
        const sorted = xCol === 'index' ? rows : [...rows].sort((a, b) => Number(a[xCol]) - Number(b[xCol]))
        return sorted.slice(0, 500).map((r, i) => {
            const obj: Record<string, number | string> = { x: xCol === 'index' ? i : Number(r[xCol]) }
            yCols.forEach(y => { const v = Number(r[y]); obj[y] = isFinite(v) ? v : NaN })
            return obj
        })
    }, [rows, xCol, yCols])

    if (numCols.length === 0) return <Alert severity="info">Нет числовых колонок.</Alert>

    return (
        <Box>
            <Box sx={{ display: 'flex', gap: 2, mb: 3, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                <FormControl size="small" sx={{ minWidth: 160 }}>
                    <InputLabel>Ось X</InputLabel>
                    <Select value={xCol} label="Ось X" onChange={e => setXCol(e.target.value)}>
                        <MenuItem value="index">Индекс строки</MenuItem>
                        {numCols.map(c => <MenuItem key={c.field} value={c.field}>{c.field}</MenuItem>)}
                    </Select>
                </FormControl>
                <FormControl size="small" sx={{ minWidth: 220 }}>
                    <InputLabel>Линии (Y)</InputLabel>
                    <Select
                        multiple
                        value={yCols}
                        label="Линии (Y)"
                        onChange={e => setYCols(typeof e.target.value === 'string' ? [e.target.value] : e.target.value as string[])}
                        renderValue={sel => (sel as string[]).join(', ')}
                    >
                        {numCols.map(c => (
                            <MenuItem key={c.field} value={c.field}>
                                <Chip size="small" label={c.field} sx={{ mr: 0.5 }} />
                            </MenuItem>
                        ))}
                    </Select>
                </FormControl>
            </Box>
            {lineData.length === 0
                ? <Alert severity="info">Нет данных.</Alert>
                : (
                    <>
                        {rows.length > 500 && <Alert severity="warning" sx={{ mb: 1, py: 0.3, borderRadius: 2 }}><Typography variant="caption">Показаны первые 500 строк.</Typography></Alert>}
                        <Box sx={{ height: 420 }}>
                            <ResponsiveContainer width="100%" height="100%">
                                <LineChart data={lineData} margin={{ top: 10, right: 30, bottom: 20, left: 20 }}>
                                    <CartesianGrid strokeDasharray="3 3" />
                                    <XAxis dataKey="x" tick={{ fontSize: 11 }} label={{ value: xCol === 'index' ? 'Индекс' : xCol, position: 'insideBottom', offset: -5, fontSize: 12 }} />
                                    <YAxis tick={{ fontSize: 11 }} />
                                    <RTooltip formatter={(v) => [typeof v === 'number' && isFinite(v) ? fmt(v) : '—']} />
                                    <Legend />
                                    {yCols.map((y, i) => (
                                        <Line key={y} type="monotone" dataKey={y} stroke={PALETTE[i % PALETTE.length]} dot={false} strokeWidth={1.5} connectNulls={false} />
                                    ))}
                                </LineChart>
                            </ResponsiveContainer>
                        </Box>
                    </>
                )
            }
        </Box>
    )
}

// ─── Pairplot ─────────────────────────────────────────────────────────────────

const PAD = 4

const PairCell = React.memo(function PairCell({
    sample, colField, rowField,
}: {
    sample: ParsedRow[]
    colField: string
    rowField: string
}) {
    const data = useMemo(() => {
        const pts: { x: number; y: number }[] = []
        for (const r of sample) {
            const x = Number(r[colField])
            const y = Number(r[rowField])
            if (isFinite(x) && isFinite(y)) pts.push({ x, y })
        }
        return pts
    }, [sample, colField, rowField])

    const { xMin, xRange, yMin, yRange } = useMemo(() => {
        if (!data.length) return { xMin: 0, xRange: 1, yMin: 0, yRange: 1 }
        let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity
        for (const d of data) {
            if (d.x < xMin) xMin = d.x
            if (d.x > xMax) xMax = d.x
            if (d.y < yMin) yMin = d.y
            if (d.y > yMax) yMax = d.y
        }
        return { xMin, xRange: (xMax - xMin) || 1, yMin, yRange: (yMax - yMin) || 1 }
    }, [data])

    return (
        <Box sx={{ height: 100, border: '1px solid', borderColor: 'divider', borderRadius: 0.5, overflow: 'hidden' }}>
            <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none">
                {data.map((d, idx) => (
                    <circle
                        key={idx}
                        cx={PAD + ((d.x - xMin) / xRange) * (100 - 2 * PAD)}
                        cy={(100 - PAD) - ((d.y - yMin) / yRange) * (100 - 2 * PAD)}
                        r={1.8}
                        fill="#3b82f6"
                        fillOpacity={0.45}
                    />
                ))}
            </svg>
        </Box>
    )
})

function PairplotViz({ stats }: { stats: DatasetStats }) {
    const rows = useTableStore(s => s.rows)
    const allNumCols = stats.columns.filter(c => c.kind === 'numeric')
    const SAMPLE_SIZE = 300

    const [pending, setPending] = useState<string[]>(() => allNumCols.slice(0, 5).map(c => c.field))
    const [activeCols, setActiveCols] = useState<string[]>([])

    const sample = useMemo(() => {
        if (!rows.length || activeCols.length < 2) return []
        const step = Math.max(1, Math.ceil(rows.length / SAMPLE_SIZE))
        return rows.filter((_, i) => i % step === 0).slice(0, SAMPLE_SIZE)
    }, [rows, activeCols])

    if (allNumCols.length < 2) return <Alert severity="info">Нужно минимум 2 числовые колонки для pairplot.</Alert>

    const n = activeCols.length

    return (
        <Box>
            {/* Панель выбора */}
            <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, mb: 3 }}>
                <Typography variant="subtitle2" fontWeight={600} mb={1.5}>
                    Выберите колонки для Pairplot
                </Typography>
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 2 }}>
                    {allNumCols.map(col => {
                        const checked = pending.includes(col.field)
                        return (
                            <Chip
                                key={col.field}
                                label={col.field}
                                clickable
                                color={checked ? 'primary' : 'default'}
                                variant={checked ? 'filled' : 'outlined'}
                                size="small"
                                onClick={() =>
                                    setPending(prev =>
                                        prev.includes(col.field)
                                            ? prev.filter(f => f !== col.field)
                                            : [...prev, col.field]
                                    )
                                }
                            />
                        )
                    })}
                </Box>
                <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center', flexWrap: 'wrap' }}>
                    <Button
                        variant="contained"
                        size="small"
                        disabled={pending.length < 2}
                        onClick={() => setActiveCols([...pending])}
                        sx={{ textTransform: 'none', fontWeight: 600 }}
                    >
                        Построить график
                    </Button>
                    <Button
                        variant="outlined"
                        size="small"
                        onClick={() => setPending(allNumCols.slice(0, 5).map(c => c.field))}
                        sx={{ textTransform: 'none' }}
                    >
                        Сбросить
                    </Button>
                    {pending.length < 2 && (
                        <Typography variant="caption" color="error">
                            Выберите минимум 2 колонки
                        </Typography>
                    )}
                    {pending.length > 7 && (
                        <Typography variant="caption" color="warning.main">
                            Много колонок ({pending.length}) — график может быть мелким
                        </Typography>
                    )}
                    <Typography variant="caption" color="text.disabled">
                        выборка до {SAMPLE_SIZE} строк
                    </Typography>
                </Box>
            </Paper>

            {/* График */}
            {activeCols.length < 2 && (
                <Box sx={{ p: 4, textAlign: 'center', border: '2px dashed', borderColor: 'divider', borderRadius: 2, color: 'text.disabled' }}>
                    <Typography variant="body2">Выберите колонки и нажмите «Построить график»</Typography>
                </Box>
            )}

            {activeCols.length >= 2 && (
                <>
                    <Typography variant="caption" color="text.secondary" display="block" mb={1}>
                        Попарные диаграммы рассеяния · {n} колонок · выборка {sample.length} строк
                    </Typography>
                    <Box sx={{ display: 'grid', gridTemplateColumns: `repeat(${n}, 1fr)`, gap: 0.5 }}>
                        {activeCols.map((rowField, i) =>
                            activeCols.map((colField, j) => {
                                if (i === j) {
                                    return (
                                        <Paper key={`${i}-${j}`} variant="outlined" sx={{ p: 0.5, display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 100, bgcolor: 'grey.50' }}>
                                            <Tooltip title={rowField}>
                                                <Typography variant="caption" fontWeight={700} sx={{ textAlign: 'center', wordBreak: 'break-word', fontSize: '0.68rem' }}>
                                                    {rowField.length > 12 ? rowField.slice(0, 11) + '…' : rowField}
                                                </Typography>
                                            </Tooltip>
                                        </Paper>
                                    )
                                }
                                return (
                                    <PairCell key={`${i}-${j}`} sample={sample} colField={colField} rowField={rowField} />
                                )
                            })
                        )}
                    </Box>
                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mt: 1.5 }}>
                        {activeCols.map((f, i) => (
                            <Typography key={f} variant="caption" color="text.secondary">
                                <strong>{i + 1}</strong>: {f}
                            </Typography>
                        ))}
                    </Box>
                </>
            )}
        </Box>
    )
}

// ─── PCA Visualization ────────────────────────────────────────────────────────

function PCAViz({ stats }: { stats: DatasetStats }) {
    const rows = useTableStore(s => s.rows)
    const numCols = stats.columns.filter(c => c.kind === 'numeric')
    const catCols = stats.columns.filter(c => c.kind === 'categorical')
    const [selectedCols, setSelectedCols] = useState<string[]>(() => numCols.slice(0, 8).map(c => c.field))
    const [colorCol, setColorCol] = useState('')

    type PCAResult = { points: { pc1: number; pc2: number; rowIdx: number }[]; varExplained: [number, number] }
    const [pcaResult, setPcaResult] = useState<PCAResult>({ points: [], varExplained: [0, 0] })
    const [pcaComputing, setPcaComputing] = useState(false)

    useEffect(() => {
        if (selectedCols.length < 2 || !rows.length) {
            setPcaResult({ points: [], varExplained: [0, 0] })
            return
        }
        setPcaComputing(true)
        const n = rows.length
        const sample = n > 1000 ? rows.filter((_, i) => i % Math.ceil(n / 1000) === 0) : rows
        const worker = new Worker(
            new URL('../../../features/file-upload/lib/pcaWorker.ts', import.meta.url),
            { type: 'module' },
        )
        worker.onmessage = (e) => {
            worker.terminate()
            if (e.data.ok) setPcaResult(e.data.result)
            setPcaComputing(false)
        }
        worker.onerror = () => { worker.terminate(); setPcaComputing(false) }
        worker.postMessage({ rows: sample, fields: selectedCols })
        return () => worker.terminate()
    }, [rows, selectedCols])

    const { points, varExplained } = pcaResult

    const colorGroups = useMemo(() => {
        if (!colorCol || !points.length) return [{ name: '', data: points, color: '#3b82f6' }]
        const n = rows.length
        const sample = n > 1000 ? rows.filter((_, i) => i % Math.ceil(n / 1000) === 0) : rows
        const groups = new Map<string, typeof points>()
        points.forEach(p => {
            const k = String(sample[p.rowIdx]?.[colorCol] ?? '')
            if (!groups.has(k)) groups.set(k, [])
            groups.get(k)!.push(p)
        })
        return Array.from(groups.entries()).map(([name, data], i) => ({ name, data, color: CATEGORICAL_PALETTE[i % CATEGORICAL_PALETTE.length] }))
    }, [points, colorCol, rows])

    if (numCols.length < 2) return <Alert severity="info">Нужно минимум 2 числовые колонки для PCA.</Alert>

    return (
        <Box>
            {pcaComputing && <LinearProgress sx={{ mb: 2, borderRadius: 1 }} />}
            <Box sx={{ display: 'flex', gap: 2, mb: 2, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                <FormControl size="small" sx={{ minWidth: 220 }}>
                    <InputLabel>Признаки для PCA</InputLabel>
                    <Select
                        multiple
                        value={selectedCols}
                        label="Признаки для PCA"
                        onChange={e => setSelectedCols(typeof e.target.value === 'string' ? [e.target.value] : e.target.value as string[])}
                        renderValue={sel => `${(sel as string[]).length} выбрано`}
                    >
                        {numCols.map(c => (
                            <MenuItem key={c.field} value={c.field}>
                                <Chip size="small" label={c.field} sx={{ mr: 0.5 }} />
                            </MenuItem>
                        ))}
                    </Select>
                </FormControl>
                {catCols.length > 0 && (
                    <FormControl size="small" sx={{ minWidth: 160 }}>
                        <InputLabel>Цвет (группа)</InputLabel>
                        <Select value={colorCol} label="Цвет (группа)" onChange={e => setColorCol(e.target.value)}>
                            <MenuItem value="">— нет —</MenuItem>
                            {catCols.map(c => <MenuItem key={c.field} value={c.field}>{c.field}</MenuItem>)}
                        </Select>
                    </FormControl>
                )}
            </Box>
            {points.length === 0
                ? <Alert severity="info">Выберите минимум 2 числовые колонки. Данные должны быть загружены.</Alert>
                : (
                    <>
                        <Box sx={{ display: 'flex', gap: 1.5, mb: 2, flexWrap: 'wrap', alignItems: 'center' }}>
                            <Chip label={`PC1: ${pct(varExplained[0])} дисперсии`} color="primary" size="small" variant="outlined" />
                            <Chip label={`PC2: ${pct(varExplained[1])} дисперсии`} color="secondary" size="small" variant="outlined" />
                            <Chip label={`Итого: ${pct(varExplained[0] + varExplained[1])}`} size="small" />
                            {rows.length > 1000 && <Chip label={`Выборка 1000 / ${rows.length.toLocaleString()} строк`} size="small" color="warning" variant="outlined" />}
                        </Box>
                        <Box sx={{ height: 420 }}>
                            <ResponsiveContainer width="100%" height="100%">
                                <ScatterChart margin={{ top: 10, right: 30, bottom: 40, left: 20 }}>
                                    <CartesianGrid strokeDasharray="3 3" />
                                    <XAxis type="number" dataKey="pc1" name="PC1" label={{ value: `PC1 (${pct(varExplained[0])})`, position: 'insideBottom', offset: -10, fontSize: 12 }} tick={{ fontSize: 11 }} />
                                    <YAxis type="number" dataKey="pc2" name="PC2" label={{ value: `PC2 (${pct(varExplained[1])})`, angle: -90, position: 'insideLeft', offset: 10, fontSize: 12 }} tick={{ fontSize: 11 }} />
                                    <RTooltip cursor={{ strokeDasharray: '3 3' }} formatter={(v) => [typeof v === 'number' ? fmt(v) : String(v)]} />
                                    {colorGroups.length > 1 && <Legend />}
                                    {colorGroups.map(g => (
                                        <Scatter key={g.name || 'pca'} name={g.name || 'PC'} data={g.data} fill={g.color} fillOpacity={0.65} />
                                    ))}
                                </ScatterChart>
                            </ResponsiveContainer>
                        </Box>
                    </>
                )
            }
        </Box>
    )
}

// ─── Time Series Tab ─────────────────────────────────────────────────────────

// ── helpers ──────────────────────────────────────────────────────────────────

function parseDate(v: unknown): number | null {
    if (v == null || v === '') return null
    const n = typeof v === 'number' ? v : Number(v)
    if (!isNaN(n) && isFinite(n)) return n
    const d = new Date(String(v))
    return isNaN(d.getTime()) ? null : d.getTime()
}

function rollingMean(values: number[], w: number): (number | null)[] {
    return values.map((_, i) => {
        if (i < w - 1) return null
        const slice = values.slice(i - w + 1, i + 1)
        return slice.reduce((a, b) => a + b, 0) / w
    })
}

function rollingStd(values: number[], w: number): (number | null)[] {
    return values.map((_, i) => {
        if (i < w - 1) return null
        const slice = values.slice(i - w + 1, i + 1)
        const mean = slice.reduce((a, b) => a + b, 0) / w
        return Math.sqrt(slice.reduce((s, v) => s + (v - mean) ** 2, 0) / w)
    })
}

function acfValues(values: number[], maxLag: number): number[] {
    const n = values.length
    const mean = values.reduce((a, b) => a + b, 0) / n
    const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / n
    if (variance === 0) return Array(maxLag + 1).fill(0)
    return Array.from({ length: maxLag + 1 }, (_, lag) => {
        if (lag === 0) return 1
        let cov = 0
        for (let i = lag; i < n; i++) cov += (values[i] - mean) * (values[i - lag] - mean)
        return (cov / n) / variance
    })
}

function pacfValues(values: number[], maxLag: number): number[] {
    const acf = acfValues(values, maxLag)
    const pacf: number[] = [1]
    const phi: number[][] = [[]]
    for (let k = 1; k <= maxLag; k++) {
        const prevPhi = phi[k - 1] ?? []
        let num = acf[k]
        for (let j = 1; j < k; j++) num -= (prevPhi[j - 1] ?? 0) * acf[k - j]
        let den = 1
        for (let j = 1; j < k; j++) den -= (prevPhi[j - 1] ?? 0) * acf[j]
        const phiKK = den === 0 ? 0 : num / den
        pacf.push(phiKK)
        const newPhi: number[] = Array(k).fill(0)
        for (let j = 0; j < k - 1; j++) newPhi[j] = (prevPhi[j] ?? 0) - phiKK * (prevPhi[k - 2 - j] ?? 0)
        newPhi[k - 1] = phiKK
        phi.push(newPhi)
    }
    return pacf
}

function movingAvgTrend(values: number[], w: number): (number | null)[] {
    const half = Math.floor(w / 2)
    return values.map((_, i) => {
        if (i < half || i >= values.length - half) return null
        const slice = values.slice(i - half, i + half + 1)
        return slice.reduce((a, b) => a + b, 0) / slice.length
    })
}

function corrMatrix(seriesList: number[][]): number[][] {
    return seriesList.map((a) =>
        seriesList.map((b) => {
            const len = Math.min(a.length, b.length)
            if (len === 0) return 0
            const as = a.slice(0, len), bs = b.slice(0, len)
            const ma = as.reduce((s, v) => s + v, 0) / len
            const mb = bs.reduce((s, v) => s + v, 0) / len
            const cov = as.reduce((s, v, k) => s + (v - ma) * (bs[k] - mb), 0) / len
            const sa = Math.sqrt(as.reduce((s, v) => s + (v - ma) ** 2, 0) / len)
            const sb = Math.sqrt(bs.reduce((s, v) => s + (v - mb) ** 2, 0) / len)
            return sa === 0 || sb === 0 ? 0 : cov / (sa * sb)
        })
    )
}

// ── Chart sub-components ──────────────────────────────────────────────────────

function TSLinearChart({ data }: { data: { x: number | string; y: number }[] }) {
    return (
        <Box sx={{ height: 320 }}>
            <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data} margin={{ top: 8, right: 24, bottom: 20, left: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="x" tick={{ fontSize: 10 }} tickFormatter={(v) => typeof v === 'number' ? fmt(v) : String(v).slice(0, 10)} />
                    <YAxis tick={{ fontSize: 10 }} />
                    <RTooltip formatter={(v: number | undefined) => [fmt(v ?? 0), 'Значение']} />
                    <Line type="monotone" dataKey="y" stroke="#3b82f6" dot={false} strokeWidth={1.5} connectNulls={false} />
                </LineChart>
            </ResponsiveContainer>
        </Box>
    )
}

function TSRollingChart({ data }: { data: { x: number | string; y: number; rm: number | null; upper: number | null; lower: number | null }[] }) {
    return (
        <Box sx={{ height: 320 }}>
            <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data} margin={{ top: 8, right: 24, bottom: 20, left: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="x" tick={{ fontSize: 10 }} tickFormatter={(v) => String(v).slice(0, 10)} />
                    <YAxis tick={{ fontSize: 10 }} />
                    <RTooltip formatter={(v, name: string | undefined) => [typeof v === 'number' ? fmt(v) : '—', name ?? '']} />
                    <Legend />
                    <Line type="monotone" dataKey="y" stroke="#94a3b8" dot={false} strokeWidth={1} name="Исходный" />
                    <Line type="monotone" dataKey="rm" stroke="#3b82f6" dot={false} strokeWidth={2} name="Rolling Mean" connectNulls />
                    <Line type="monotone" dataKey="upper" stroke="#22c55e" dot={false} strokeWidth={1} strokeDasharray="4 2" name="Mean+Std" connectNulls />
                    <Line type="monotone" dataKey="lower" stroke="#f59e0b" dot={false} strokeWidth={1} strokeDasharray="4 2" name="Mean−Std" connectNulls />
                </LineChart>
            </ResponsiveContainer>
        </Box>
    )
}

function TSSeasonalChart({ data }: { data: { period: string | number; values: number[] }[] }) {
    if (data.length === 0) return <Alert severity="info">Нет данных для сезонного графика.</Alert>
    const labels = Array.from({ length: Math.max(...data.map(d => d.values.length)) }, (_, i) => i)
    const chartData = labels.map(i => {
        const obj: Record<string, number | string> = { idx: i }
        data.forEach(d => { if (d.values[i] != null) obj[String(d.period)] = d.values[i] })
        return obj
    })
    const PALETTE = ['#3b82f6', '#ef4444', '#22c55e', '#f59e0b', '#8b5cf6', '#06b6d4', '#ec4899', '#84cc16', '#f97316', '#14b8a6', '#a855f7', '#f43f5e']
    return (
        <Box sx={{ height: 320 }}>
            <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 8, right: 24, bottom: 20, left: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="idx" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} />
                    <RTooltip content={<ScrollableTooltip />} allowEscapeViewBox={{ x: false, y: false }} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    {data.map((d, i) => (
                        <Line key={String(d.period)} type="monotone" dataKey={String(d.period)} stroke={PALETTE[i % PALETTE.length]} dot={false} strokeWidth={1.5} />
                    ))}
                </LineChart>
            </ResponsiveContainer>
        </Box>
    )
}

function TSBoxByGroupChart({ data }: { data: { group: string; q1: number; q3: number; median: number; min: number; max: number; mean: number }[] }) {
    if (data.length === 0) return <Alert severity="info">Нет данных для boxplot по группам.</Alert>
    return (
        <Box sx={{ height: 320 }}>
            <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data} margin={{ top: 8, right: 24, bottom: 60, left: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="group" tick={{ fontSize: 10 }} angle={-40} textAnchor="end" tickFormatter={(v: string) => v != null && String(v).length > 18 ? String(v).slice(0, 16) + '…' : String(v)} />
                    <YAxis tick={{ fontSize: 10 }} />
                    <RTooltip formatter={(v: number | undefined, name: string | undefined) => [fmt(v ?? 0), name ?? '']} />
                    <Bar dataKey="q1" fill="#bbdefb" name="Q1" stackId="box" />
                    <Bar dataKey="median" fill="#1565c0" name="Медиана" />
                    <Bar dataKey="q3" fill="#42a5f5" name="Q3" />
                </BarChart>
            </ResponsiveContainer>
        </Box>
    )
}

function TSDecompChart({ data }: { data: { x: number | string; observed: number; trend: number | null; seasonal: number | null; residual: number | null }[] }) {
    return (
        <Box>
            {(['observed', 'trend', 'seasonal', 'residual'] as const).map((key, idx) => {
                const colors = ['#3b82f6', '#ef4444', '#22c55e', '#f59e0b']
                const labels = ['Исходный', 'Тренд', 'Сезонность', 'Остаток']
                return (
                    <Box key={key} sx={{ height: 140, mb: 1 }}>
                        <Typography variant="caption" color="text.secondary" display="block" mb={0.25}>{labels[idx]}</Typography>
                        <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={data} margin={{ top: 2, right: 16, bottom: 4, left: 8 }}>
                                <CartesianGrid strokeDasharray="3 3" />
                                <XAxis dataKey="x" tick={{ fontSize: 9 }} tickFormatter={(v) => String(v).slice(0, 10)} />
                                <YAxis tick={{ fontSize: 9 }} width={40} />
                                <RTooltip formatter={(v) => [typeof v === 'number' ? fmt(v) : '—', labels[idx]]} />
                                <Line type="monotone" dataKey={key} stroke={colors[idx]} dot={false} strokeWidth={1.5} connectNulls />
                            </LineChart>
                        </ResponsiveContainer>
                    </Box>
                )
            })}
        </Box>
    )
}

function TSLagChart({ data }: { data: { x: number; y: number }[] }) {
    return (
        <Box sx={{ height: 320 }}>
            <ResponsiveContainer width="100%" height="100%">
                <ScatterChart margin={{ top: 8, right: 24, bottom: 20, left: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis type="number" dataKey="x" name="y(t−k)" tick={{ fontSize: 10 }} label={{ value: 'y(t−k)', position: 'insideBottom', offset: -8, fontSize: 11 }} />
                    <YAxis type="number" dataKey="y" name="y(t)" tick={{ fontSize: 10 }} label={{ value: 'y(t)', angle: -90, position: 'insideLeft', fontSize: 11 }} />
                    <RTooltip cursor={{ strokeDasharray: '3 3' }} formatter={(v: number | undefined) => [fmt(v ?? 0)]} />
                    <Scatter data={data} fill="#3b82f6" fillOpacity={0.5} />
                </ScatterChart>
            </ResponsiveContainer>
        </Box>
    )
}

function TSCalendarHeatmap({ data }: { data: { date: string; value: number }[] }) {
    if (data.length === 0) return <Alert severity="info">Нет данных для календарной тепловой карты.</Alert>
    const byYear = new Map<number, Map<number, { date: string; value: number }[]>>()
    data.forEach(d => {
        const dt = new Date(d.date)
        if (isNaN(dt.getTime())) return
        const y = dt.getFullYear()
        const m = dt.getMonth()
        if (!byYear.has(y)) byYear.set(y, new Map())
        const yMap = byYear.get(y)!
        if (!yMap.has(m)) yMap.set(m, [])
        yMap.get(m)!.push(d)
    })
    const years = Array.from(byYear.keys()).sort()
    const months = ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек']
    const allVals = data.map(d => d.value)
    const minV = Math.min(...allVals), maxV = Math.max(...allVals)
    const colorScale = (v: number) => {
        const t = maxV === minV ? 0.5 : (v - minV) / (maxV - minV)
        const r = Math.round(255 * (1 - t))
        const g = Math.round(100 + 155 * t)
        const b = Math.round(255 * (1 - t))
        return `rgb(${r},${g},${b})`
    }
    return (
        <Box sx={{ overflowX: 'auto' }}>
            {years.map(year => (
                <Box key={year} mb={2}>
                    <Typography variant="caption" fontWeight={600} display="block" mb={0.5}>{year}</Typography>
                    <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                        {Array.from({ length: 12 }, (_, m) => {
                            const monthData = byYear.get(year)?.get(m) ?? []
                            const avg = monthData.length > 0 ? monthData.reduce((s, d) => s + d.value, 0) / monthData.length : null
                            return (
                                <Tooltip key={m} title={avg != null ? `${months[m]} ${year}: ${fmt(avg)}` : `${months[m]} ${year}: нет данных`} arrow>
                                    <Box sx={{
                                        width: 40, height: 40, display: 'flex', alignItems: 'center', justifyContent: 'center',
                                        bgcolor: avg != null ? colorScale(avg) : '#f5f5f5',
                                        borderRadius: 1, border: '1px solid rgba(0,0,0,0.08)',
                                        fontSize: '0.65rem', fontWeight: 500, cursor: 'default',
                                        color: avg != null ? '#333' : '#ccc',
                                    }}>
                                        {months[m]}
                                    </Box>
                                </Tooltip>
                            )
                        })}
                    </Box>
                </Box>
            ))}
        </Box>
    )
}

function TSDayHourHeatmap({ data }: { data: { hour: number; day: number; value: number }[] }) {
    if (data.length === 0) return <Alert severity="info">Нет данных для heatmap день×час.</Alert>
    const DAYS = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб']
    const grid = Array.from({ length: 7 }, (_, d) =>
        Array.from({ length: 24 }, (_, h) => {
            const pts = data.filter(r => r.day === d && r.hour === h)
            return pts.length > 0 ? pts.reduce((s, r) => s + r.value, 0) / pts.length : null
        })
    )
    const allVals = grid.flat().filter((v): v is number => v != null)
    const minV = allVals.length > 0 ? Math.min(...allVals) : 0
    const maxV = allVals.length > 0 ? Math.max(...allVals) : 1
    const colorScale = (v: number | null) => {
        if (v == null) return '#f5f5f5'
        const t = maxV === minV ? 0.5 : (v - minV) / (maxV - minV)
        return `hsl(${Math.round(240 - 240 * t)}, 80%, ${Math.round(30 + 40 * (1 - t))}%)`
    }
    return (
        <Box sx={{ overflowX: 'auto' }}>
            <Box sx={{ display: 'grid', gridTemplateColumns: `36px repeat(24, 28px)`, gap: '2px', width: 'fit-content' }}>
                <Box />
                {Array.from({ length: 24 }, (_, h) => (
                    <Box key={h} sx={{ fontSize: '0.6rem', textAlign: 'center', color: 'text.secondary', fontWeight: 600 }}>{h}</Box>
                ))}
                {grid.map((row, d) => (
                    <>
                        <Box key={`lbl-${d}`} sx={{ fontSize: '0.68rem', fontWeight: 600, display: 'flex', alignItems: 'center', color: 'text.secondary' }}>{DAYS[d]}</Box>
                        {row.map((v, h) => (
                            <Tooltip key={`${d}-${h}`} title={`${DAYS[d]} ${h}:00 — ${v != null ? fmt(v) : 'нет данных'}`} arrow>
                                <Box sx={{
                                    height: 28, width: 28, bgcolor: colorScale(v),
                                    borderRadius: '3px', border: '1px solid rgba(255,255,255,0.3)',
                                    fontSize: '0.55rem', display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    cursor: 'default', color: v != null ? '#fff' : '#ccc',
                                }} />
                            </Tooltip>
                        ))}
                    </>
                ))}
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.75 }}>
                <Typography variant="caption" color="text.secondary">мин</Typography>
                <Box sx={{ width: 120, height: 8, borderRadius: 4, background: 'linear-gradient(to right, hsl(240,80%,70%), hsl(0,80%,30%))' }} />
                <Typography variant="caption" color="text.secondary">макс</Typography>
            </Box>
        </Box>
    )
}

// ── New chart components ──────────────────────────────────────────────────────

function TSMultiLineChart({ data, yKeys, palette }: { data: Record<string, number | string>[]; yKeys: string[]; palette: string[] }) {
    if (yKeys.length === 0) return <Alert severity="info">Выберите хотя бы одну колонку Y.</Alert>
    return (
        <Box sx={{ height: 340 }}>
            <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data} margin={{ top: 8, right: 24, bottom: 20, left: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="x" tick={{ fontSize: 10 }} tickFormatter={(v) => String(v).slice(0, 10)} />
                    <YAxis tick={{ fontSize: 10 }} />
                    <RTooltip formatter={(v: number | undefined, name: string | undefined) => [fmt(v ?? 0), name ?? '']} />
                    <Legend />
                    {yKeys.map((k, i) => (
                        <Line key={k} type="monotone" dataKey={k} stroke={palette[i % palette.length]} dot={false} strokeWidth={1.8} name={k} />
                    ))}
                </LineChart>
            </ResponsiveContainer>
        </Box>
    )
}

function TSHistogramChart({ values }: { values: number[] }) {
    const bins = 30
    const min = Math.min(...values)
    const max = Math.max(...values)
    const step = max === min ? 1 : (max - min) / bins
    const counts = Array(bins).fill(0)
    values.forEach(v => {
        const i = Math.min(Math.floor((v - min) / step), bins - 1)
        counts[i]++
    })
    const data = counts.map((count, i) => ({ bin: fmt(min + i * step, 2), count }))
    return (
        <Box sx={{ height: 320 }}>
            <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data} margin={{ top: 8, right: 24, bottom: 45, left: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="bin" tick={{ fontSize: 9 }} interval={4} angle={-40} textAnchor="end" />
                    <YAxis tick={{ fontSize: 10 }} />
                    <RTooltip formatter={(v: number | undefined) => [v ?? 0, 'Кол-во']} />
                    <Bar dataKey="count" fill="#3b82f6" name="Кол-во" />
                </BarChart>
            </ResponsiveContainer>
        </Box>
    )
}

function TSScatterChart({ data, xLabel, yLabel }: { data: { x: number; y: number }[]; xLabel: string; yLabel: string }) {
    if (data.length === 0) return <Alert severity="info">Выберите вторую числовую колонку.</Alert>
    return (
        <Box sx={{ height: 340 }}>
            <ResponsiveContainer width="100%" height="100%">
                <ScatterChart margin={{ top: 8, right: 24, bottom: 24, left: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis type="number" dataKey="x" name={xLabel} tick={{ fontSize: 10 }} label={{ value: xLabel, position: 'insideBottom', offset: -8, fontSize: 11 }} />
                    <YAxis type="number" dataKey="y" name={yLabel} tick={{ fontSize: 10 }} label={{ value: yLabel, angle: -90, position: 'insideLeft', fontSize: 11 }} />
                    <RTooltip cursor={{ strokeDasharray: '3 3' }} formatter={(v: number | undefined, name: string | undefined) => [fmt(v ?? 0), name ?? '']} />
                    <Scatter data={data} fill="#8b5cf6" fillOpacity={0.55} />
                </ScatterChart>
            </ResponsiveContainer>
        </Box>
    )
}

function TSAcfChart({ data, confBand, mode }: { data: { lag: number; acf: number; pacf: number }[]; confBand: number; mode: 'acf' | 'pacf' }) {
    const key = mode
    const color = mode === 'acf' ? '#3b82f6' : '#ef4444'
    const label = mode === 'acf' ? 'ACF' : 'PACF'
    return (
        <Box sx={{ height: 320 }}>
            <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data} margin={{ top: 8, right: 24, bottom: 20, left: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="lag" tick={{ fontSize: 10 }} label={{ value: 'Лаг', position: 'insideBottom', offset: -8, fontSize: 11 }} />
                    <YAxis domain={[-1, 1]} tick={{ fontSize: 10 }} />
                    <RTooltip formatter={(v: number | undefined) => [fmt(v ?? 0, 3), label]} />
                    <Bar dataKey={key} fill={color} name={label} />
                </BarChart>
            </ResponsiveContainer>
            <Typography variant="caption" color="text.secondary" display="block" mt={0.5}>
                Доверительная полоса ±{fmt(confBand, 3)}
            </Typography>
        </Box>
    )
}

function TSPeriodogramChart({ values }: { values: number[] }) {
    const n = values.length
    const data = useMemo(() => {
        const m = values.reduce((a, b) => a + b, 0) / n
        const centered = values.map(v => v - m)
        const maxFreq = Math.floor(n / 2)
        const result: { freq: string; power: number; period: string }[] = []
        for (let k = 1; k <= maxFreq; k++) {
            let re = 0; let im = 0
            for (let t = 0; t < n; t++) {
                re += centered[t] * Math.cos(2 * Math.PI * k * t / n)
                im -= centered[t] * Math.sin(2 * Math.PI * k * t / n)
            }
            const power = (re * re + im * im) / n
            result.push({ freq: fmt(k / n, 3), power, period: k === 0 ? '∞' : fmt(n / k, 1) })
        }
        result.sort((a, b) => Number(a.freq) - Number(b.freq))
        return result
    }, [values, n])
    const top = [...data].sort((a, b) => b.power - a.power).slice(0, 3)
    return (
        <Box>
            <Box sx={{ height: 300 }}>
                <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data} margin={{ top: 8, right: 24, bottom: 28, left: 8 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} />
                        <XAxis dataKey="freq" tick={{ fontSize: 9 }} label={{ value: 'Частота (цикл/точку)', position: 'insideBottom', offset: -12, fontSize: 11 }} interval={Math.floor(data.length / 10)} />
                        <YAxis tick={{ fontSize: 10 }} />
                        <RTooltip formatter={(v: number | undefined, _: string | undefined, p: { payload?: { period?: string } }) => [fmt(v ?? 0), `Мощность (период ≈ ${p.payload?.period ?? '?'})`]} />
                        <Bar dataKey="power" fill="#f59e0b" name="Мощность" />
                    </BarChart>
                </ResponsiveContainer>
            </Box>
            {top.length > 0 && (
                <Box sx={{ display: 'flex', gap: 1, mt: 1, flexWrap: 'wrap' }}>
                    <Typography variant="caption" color="text.secondary">Доминирующие периоды:</Typography>
                    {top.map((t, i) => (
                        <Chip key={i} size="small" label={`≈ ${t.period} точек`} variant="outlined" color="warning" />
                    ))}
                </Box>
            )}
        </Box>
    )
}

function TSCorrHeatmap({ matrix, labels }: { matrix: number[][]; labels: string[] }) {
    const getColor = (v: number): string => {
        const a = Math.abs(v)
        if (v >= 0) {
            const r = Math.round(210 * a + 45)
            const g = Math.round(45 + (1 - a) * 130)
            const b = Math.round(45 + (1 - a) * 80)
            return `rgb(${r},${g},${b})`
        } else {
            const bv = Math.round(210 * a + 45)
            const g = Math.round(45 + (1 - a) * 130)
            const r = Math.round(45 + (1 - a) * 80)
            return `rgb(${r},${g},${bv})`
        }
    }
    return (
        <Box sx={{ overflowX: 'auto' }}>
            <Box component="table" sx={{ borderCollapse: 'collapse', fontSize: 11 }}>
                <Box component="thead">
                    <Box component="tr">
                        <Box component="th" sx={{ p: '4px 8px' }} />
                        {labels.map(l => (
                            <Box component="th" key={l} sx={{ p: '4px 6px', textAlign: 'center', fontSize: 11, maxWidth: 80, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                <TruncatedText value={l} maxWidth={80} fontSize="11px" />
                            </Box>
                        ))}
                    </Box>
                </Box>
                <Box component="tbody">
                    {matrix.map((row, i) => (
                        <Box component="tr" key={i}>
                            <Box component="td" sx={{ p: '4px 8px', fontWeight: 600, fontSize: 11, whiteSpace: 'nowrap', maxWidth: 100, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                <TruncatedText value={labels[i]} maxWidth={100} fontWeight={600} fontSize="11px" />
                            </Box>
                            {row.map((v, j) => (
                                <Box component="td" key={j} sx={{
                                    background: getColor(v),
                                    color: Math.abs(v) > 0.4 ? 'white' : 'rgba(0,0,0,0.75)',
                                    p: '8px 6px',
                                    textAlign: 'center',
                                    minWidth: 52,
                                    fontSize: 11,
                                    fontFamily: 'monospace',
                                    border: '1px solid rgba(255,255,255,0.2)',
                                }}>
                                    {v.toFixed(2)}
                                </Box>
                            ))}
                        </Box>
                    ))}
                </Box>
            </Box>
            <Box sx={{ display: 'flex', gap: 1, mt: 1.5, alignItems: 'center' }}>
                <Box sx={{ width: 140, height: 10, background: 'linear-gradient(to right, rgb(45,125,210), rgb(125,125,125), rgb(210,125,45))', borderRadius: 1 }} />
                <Typography variant="caption" color="text.secondary">−1 ← Pearson r → +1</Typography>
            </Box>
        </Box>
    )
}

function TSStationarityChart({ data, baseData, window_, maxLag }: {
    data: number[]
    baseData: { x: string | number; y: number }[]
    window_: number
    maxLag: number
}) {
    const n = data.length
    const rm = rollingMean(data, window_)
    const rstd = rollingStd(data, window_)
    const acf = acfValues(data, Math.min(maxLag, Math.floor(n / 2)))
    const confBand = 1.96 / Math.sqrt(n)
    const lineData = baseData.map((d, i) => ({ x: d.x, y: d.y, rm: rm[i], rstd: rstd[i] }))
    const acfData = acf.map((a, i) => ({ lag: i, acf: a }))
    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <Box>
                <Typography variant="caption" fontWeight={600} color="text.secondary" display="block" mb={0.5}>Ряд + скользящее среднее (окно {window_})</Typography>
                <Box sx={{ height: 160 }}>
                    <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={lineData} margin={{ top: 4, right: 16, bottom: 4, left: 8 }}>
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis dataKey="x" tick={{ fontSize: 9 }} hide />
                            <YAxis tick={{ fontSize: 10 }} width={50} />
                            <RTooltip />
                            <Line type="monotone" dataKey="y" dot={false} stroke="#3b82f6" strokeWidth={1} name="Ряд" />
                            <Line type="monotone" dataKey="rm" dot={false} stroke="#ef4444" strokeWidth={2} name={`M (w=${window_})`} strokeDasharray="4 2" />
                            <Legend />
                        </LineChart>
                    </ResponsiveContainer>
                </Box>
            </Box>
            <Box>
                <Typography variant="caption" fontWeight={600} color="text.secondary" display="block" mb={0.5}>Скользящее стандартное отклонение (окно {window_})</Typography>
                <Box sx={{ height: 120 }}>
                    <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={lineData} margin={{ top: 4, right: 16, bottom: 4, left: 8 }}>
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis dataKey="x" tick={{ fontSize: 9 }} hide />
                            <YAxis tick={{ fontSize: 10 }} width={50} />
                            <RTooltip />
                            <Line type="monotone" dataKey="rstd" dot={false} stroke="#f59e0b" strokeWidth={2} name={`σ (w=${window_})`} />
                        </LineChart>
                    </ResponsiveContainer>
                </Box>
                <Typography variant="caption" color="text.secondary">
                    Если скользящее среднее и σ постоянны — ряд стационарен.
                </Typography>
            </Box>
            <Box>
                <Typography variant="caption" fontWeight={600} color="text.secondary" display="block" mb={0.5}>Автокорреляционная функция (ACF)</Typography>
                <Box sx={{ height: 160 }}>
                    <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={acfData} margin={{ top: 4, right: 16, bottom: 16, left: 8 }}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} />
                            <XAxis dataKey="lag" tick={{ fontSize: 10 }} label={{ value: 'Лаг', position: 'insideBottom', offset: -8, fontSize: 11 }} />
                            <YAxis domain={[-1, 1]} tick={{ fontSize: 10 }} width={40} />
                            <ReferenceLine y={confBand} stroke="#ef4444" strokeDasharray="4 4" />
                            <ReferenceLine y={-confBand} stroke="#ef4444" strokeDasharray="4 4" />
                            <RTooltip formatter={(v: number | undefined) => [(v ?? 0).toFixed(3), 'ACF']} />
                            <Bar dataKey="acf" fill="#3b82f6" name="ACF" />
                        </BarChart>
                    </ResponsiveContainer>
                </Box>
                <Typography variant="caption" color="text.secondary">
                    Красные линии — 95% доверительная полоса ±{fmt(confBand, 3)}. Медленное затухание ACF → нестационарность.
                </Typography>
            </Box>
        </Box>
    )
}

// ── Main Tab ──────────────────────────────────────────────────────────────────

type TsChartType = 'linear' | 'multi' | 'histogram' | 'boxplot' | 'seasonal' | 'decomp' | 'calheatmap' | 'rolling' | 'lag' | 'scatter' | 'acf' | 'pacf' | 'dayhour' | 'periodogram' | 'corrmatrix' | 'stationarity'

const TS_CHART_GROUPS: { label: string; charts: { value: TsChartType; label: string }[] }[] = [
    {
        label: 'Для первичного просмотра',
        charts: [
            { value: 'linear', label: 'Линейный' },
            { value: 'multi', label: 'Несколько рядов' },
            { value: 'histogram', label: 'Гистограмма' },
            { value: 'boxplot', label: 'Boxplot' },
        ],
    },
    {
        label: 'Для поиска структуры ряда',
        charts: [
            { value: 'seasonal', label: 'Сезонный' },
            { value: 'decomp', label: 'Декомпозиция' },
            { value: 'calheatmap', label: 'Heatmap' },
            { value: 'rolling', label: 'Скользящие статистики' },
        ],
    },
    {
        label: 'Для анализа зависимостей',
        charts: [
            { value: 'lag', label: 'Lag Plot' },
            { value: 'scatter', label: 'Scatter Plot' },
            { value: 'acf', label: 'ACF' },
            { value: 'pacf', label: 'PACF' },
            { value: 'corrmatrix', label: 'Корреляция рядов' },
        ],
    },
    {
        label: 'Для анализа периодичности',
        charts: [
            { value: 'dayhour', label: 'Heatmap (день/час)' },
            { value: 'periodogram', label: 'Periodogram' },
        ],
    },
    {
        label: 'Анализ стационарности',
        charts: [
            { value: 'stationarity', label: 'Признаки стационарности' },
        ],
    },
]

const TS_CHART_PALETTE = ['#3b82f6', '#ef4444', '#22c55e', '#f59e0b', '#8b5cf6', '#06b6d4', '#ec4899', '#84cc16', '#f97316', '#14b8a6']

function TimeSeriesTab({ stats }: { stats: DatasetStats }) {
    const rows = useTableStore(s => s.rows)
    const activeState = useTableStore(s => s.getActiveState())

    const allCols = useMemo(() => activeState?.columns.filter(c => c.visible) ?? [], [activeState])
    const numCols = useMemo(() => stats.columns.filter(c => c.kind === 'numeric'), [stats.columns])
    const temporalCols = allCols.filter(c => c.type === 'date' || c.type === 'datetime' || c.type === 'time')

    const [chartType, setChartType] = useState<TsChartType>('linear')
    const [xCol, setXCol] = useState<string>(() => temporalCols[0]?.field ?? '')
    const [yCol, setYCol] = useState<string>(() => numCols[0]?.field ?? (temporalCols.length > 0 ? '__count__' : ''))
    const [yCols, setYCols] = useState<string[]>(() => numCols.slice(0, 3).map(c => c.field))
    const [yCol2, setYCol2] = useState<string>(() => numCols[1]?.field ?? '')
    const [window_, setWindow_] = useState(7)
    const [lagK, setLagK] = useState(1)
    const [maxLag, setMaxLag] = useState(20)
    const [seasonPeriod, setSeasonPeriod] = useState<'month' | 'weekday'>('month')
    const [boxGroupBy, setBoxGroupBy] = useState<'month' | 'weekday'>('month')
    const [corrCols, setCorrCols] = useState<string[]>(() => numCols.slice(0, 4).map(c => c.field))

    const sortedRows = useMemo(() => {
        if (!rows.length || !yCol) return []
        if (!xCol) return rows.slice(0, 1000)
        const sorted = [...rows].sort((a, b) => {
            const av = parseDate(a[xCol]) ?? 0
            const bv = parseDate(b[xCol]) ?? 0
            return av - bv
        })
        return sorted.slice(0, 1000)
    }, [rows, xCol, yCol])

    const xLabels = useMemo(() => {
        if (!xCol) return sortedRows.map((_, i) => i)
        return sortedRows.map(r => {
            const v = r[xCol]
            if (typeof v === 'string') return v.slice(0, 16)
            const n = parseDate(v)
            return n != null ? new Date(n).toLocaleDateString('ru-RU') : String(v)
        })
    }, [sortedRows, xCol])

    const baseData = useMemo(() => {
        if (yCol === '__count__') {
            if (!xCol) return []
            const counts = new Map<string | number, number>()
            sortedRows.forEach((_, i) => {
                const l = xLabels[i]
                counts.set(l, (counts.get(l) ?? 0) + 1)
            })
            return Array.from(counts.entries()).map(([x, y]) => ({ x, y }))
        }
        return sortedRows
            .map((_, i) => ({ x: xLabels[i], y: Number(sortedRows[i][yCol]) }))
            .filter(d => isFinite(d.y))
    }, [sortedRows, xLabels, yCol, xCol])

    const yValues = useMemo(() => baseData.map(d => d.y), [baseData])

    const hasEnoughData = yValues.length >= 4

    const chartContent = useMemo(() => {
        if (!hasEnoughData) return null
        const n = yValues.length

        // ── Первичный просмотр ──────────────────────────────

        if (chartType === 'linear') return <TSLinearChart data={baseData} />

        if (chartType === 'multi') {
            const keys = yCols.filter(k => k)
            const data = sortedRows.map((r, i) => {
                const obj: Record<string, number | string> = { x: xLabels[i] }
                keys.forEach(k => { const v = Number(r[k]); if (isFinite(v)) obj[k] = v })
                return obj
            })
            return <TSMultiLineChart data={data} yKeys={keys} palette={TS_CHART_PALETTE} />
        }

        if (chartType === 'histogram') return <TSHistogramChart values={yValues} />

        if (chartType === 'boxplot') {
            const groupMap = new Map<string, number[]>()
            const months = ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек']
            const days = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб']
            sortedRows.forEach((r, i) => {
                const y = yValues[i]
                if (!isFinite(y)) return
                let key = String(i)
                const raw = r[xCol]
                if (raw != null) {
                    const d = new Date(String(raw))
                    if (!isNaN(d.getTime())) key = boxGroupBy === 'month' ? months[d.getMonth()] : days[d.getDay()]
                }
                if (!groupMap.has(key)) groupMap.set(key, [])
                groupMap.get(key)!.push(y)
            })
            const data = Array.from(groupMap.entries()).map(([group, vals]) => {
                const sorted = [...vals].sort((a, b) => a - b)
                const q1 = sorted[Math.floor(sorted.length * 0.25)]
                const median = sorted[Math.floor(sorted.length * 0.5)]
                const q3 = sorted[Math.floor(sorted.length * 0.75)]
                return { group, q1, median, q3, min: sorted[0], max: sorted[sorted.length - 1], mean: vals.reduce((a, b) => a + b, 0) / vals.length }
            })
            return <TSBoxByGroupChart data={data} />
        }

        // ── Структура ряда ──────────────────────────────────

        if (chartType === 'seasonal') {
            const groupMap = new Map<string | number, number[]>()
            sortedRows.forEach((r, i) => {
                const y = yValues[i]
                if (!isFinite(y)) return
                let key: string | number = i
                const raw = r[xCol]
                if (raw != null) {
                    const d = new Date(String(raw))
                    if (!isNaN(d.getTime())) key = seasonPeriod === 'month' ? d.getFullYear() : ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'][d.getDay()]
                }
                if (!groupMap.has(key)) groupMap.set(key, [])
                groupMap.get(key)!.push(y)
            })
            return <TSSeasonalChart data={Array.from(groupMap.entries()).slice(0, 12).map(([period, values]) => ({ period, values }))} />
        }

        if (chartType === 'decomp') {
            const period = Math.max(2, window_)
            const trend = movingAvgTrend(yValues, period)
            // Правильная декомпозиция: сезонность = усреднённое по фазе (позиция % period)
            const detrended = yValues.map((v, i) => trend[i] != null ? v - trend[i]! : null)
            const phaseSum: number[] = Array(period).fill(0)
            const phaseCnt: number[] = Array(period).fill(0)
            detrended.forEach((v, i) => { if (v != null) { phaseSum[i % period] += v; phaseCnt[i % period]++ } })
            const avgByPhase = phaseSum.map((s, k) => phaseCnt[k] > 0 ? s / phaseCnt[k] : 0)
            const seasonal = yValues.map((_, i) => trend[i] != null ? avgByPhase[i % period] : null)
            const residual = yValues.map((v, i) => trend[i] != null && seasonal[i] != null ? v - trend[i]! - seasonal[i]! : null)
            return <TSDecompChart data={baseData.map((d, i) => ({ ...d, observed: d.y, trend: trend[i], seasonal: seasonal[i], residual: residual[i] }))} />
        }

        if (chartType === 'calheatmap') {
            const data = sortedRows.map((r, i) => {
                const raw = r[xCol]; if (!raw) return null
                const d = new Date(String(raw)); if (isNaN(d.getTime())) return null
                return { date: d.toISOString().slice(0, 10), value: yValues[i] }
            }).filter((d): d is { date: string; value: number } => d != null && isFinite(d.value))
            return <TSCalendarHeatmap data={data} />
        }

        if (chartType === 'rolling') {
            const w = Math.min(window_, n)
            const rm = rollingMean(yValues, w)
            const rstd = rollingStd(yValues, w)
            return <TSRollingChart data={baseData.map((d, i) => ({
                ...d,
                rm: rm[i],
                upper: rm[i] != null && rstd[i] != null ? rm[i]! + rstd[i]! : null,
                lower: rm[i] != null && rstd[i] != null ? rm[i]! - rstd[i]! : null,
            }))} />
        }

        // ── Зависимости ─────────────────────────────────────

        if (chartType === 'lag') {
            const k = Math.min(lagK, n - 1)
            return <TSLagChart data={yValues.slice(k).map((y, i) => ({ x: yValues[i], y }))} />
        }

        if (chartType === 'scatter') {
            if (!yCol2) return <Alert severity="info">Выберите вторую колонку (Y2) для scatter plot.</Alert>
            const data = sortedRows.map(r => ({ x: Number(r[yCol]), y: Number(r[yCol2]) })).filter(d => isFinite(d.x) && isFinite(d.y))
            return <TSScatterChart data={data} xLabel={yCol} yLabel={yCol2} />
        }

        if (chartType === 'acf') {
            const lags = Math.min(maxLag, Math.floor(n / 2))
            const acf = acfValues(yValues, lags)
            const pacf = pacfValues(yValues, lags)
            return <TSAcfChart data={acf.map((a, i) => ({ lag: i, acf: a, pacf: pacf[i] }))} confBand={1.96 / Math.sqrt(n)} mode="acf" />
        }

        if (chartType === 'pacf') {
            const lags = Math.min(maxLag, Math.floor(n / 2))
            const acf = acfValues(yValues, lags)
            const pacf = pacfValues(yValues, lags)
            return <TSAcfChart data={acf.map((a, i) => ({ lag: i, acf: a, pacf: pacf[i] }))} confBand={1.96 / Math.sqrt(n)} mode="pacf" />
        }

        // ── Периодичность ────────────────────────────────────

        if (chartType === 'dayhour') {
            const data = sortedRows.map((r, i) => {
                const raw = r[xCol]; if (!raw) return null
                const d = new Date(String(raw)); if (isNaN(d.getTime())) return null
                return { hour: d.getHours(), day: d.getDay(), value: yValues[i] }
            }).filter((d): d is { hour: number; day: number; value: number } => d != null && isFinite(d.value))
            return <TSDayHourHeatmap data={data} />
        }

        if (chartType === 'periodogram') return <TSPeriodogramChart values={yValues} />

        if (chartType === 'corrmatrix') {
            const keys = corrCols.filter(k => k && numCols.some(c => c.field === k))
            if (keys.length < 2) return <Alert severity="info">Выберите минимум 2 колонки для матрицы корреляций.</Alert>
            const seriesList = keys.map(k => sortedRows.map(r => Number(r[k])).filter(v => isFinite(v)))
            const matrix = corrMatrix(seriesList)
            return <TSCorrHeatmap matrix={matrix} labels={keys} />
        }

        if (chartType === 'stationarity') {
            return <TSStationarityChart data={yValues} baseData={baseData} window_={window_} maxLag={maxLag} />
        }

        return null
    }, [chartType, baseData, yValues, sortedRows, xCol, yCol, yCol2, yCols, xLabels, window_, lagK, maxLag, seasonPeriod, boxGroupBy, corrCols, hasEnoughData, numCols])

    if (numCols.length === 0 && temporalCols.length === 0) return <Alert severity="info">Нет числовых или временных колонок для анализа временных рядов.</Alert>

    return (
        <Box>
            {/* Параметры */}
            <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, mb: 3 }}>
                <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                    <FormControl size="small" sx={{ minWidth: 180 }}>
                        <InputLabel>Временная ось (X)</InputLabel>
                        <Select value={xCol} label="Временная ось (X)" onChange={e => setXCol(e.target.value)}>
                            <MenuItem value="">— индекс строки —</MenuItem>
                            {allCols.map(c => <MenuItem key={c.field} value={c.field}>{c.field}</MenuItem>)}
                        </Select>
                    </FormControl>
                    <FormControl size="small" sx={{ minWidth: 220 }}>
                        <InputLabel>Значение (Y)</InputLabel>
                        <Select value={yCol} label="Значение (Y)" onChange={e => setYCol(e.target.value)}>
                            <MenuItem value="__count__">Кол-во записей за период</MenuItem>
                            {numCols.map(c => <MenuItem key={c.field} value={c.field}>{c.field}</MenuItem>)}
                        </Select>
                    </FormControl>

                    {(chartType === 'rolling' || chartType === 'decomp') && (
                        <Box sx={{ minWidth: 160 }}>
                            <Typography variant="caption" color="text.secondary">Окно: {window_}</Typography>
                            <input type="range" min={2} max={50} value={window_} onChange={e => setWindow_(Number(e.target.value))} style={{ width: '100%' }} />
                        </Box>
                    )}
                    {(chartType === 'rolling' || chartType === 'decomp') && (
                        <Box sx={{ minWidth: 160 }}>
                            <Typography variant="caption" color="text.secondary">Окно: {window_}</Typography>
                            <input type="range" min={2} max={50} value={window_} onChange={e => setWindow_(Number(e.target.value))} style={{ width: '100%' }} />
                        </Box>
                    )}
                    {chartType === 'lag' && (
                        <Box sx={{ minWidth: 140 }}>
                            <Typography variant="caption" color="text.secondary">Лаг k: {lagK}</Typography>
                            <input type="range" min={1} max={30} value={lagK} onChange={e => setLagK(Number(e.target.value))} style={{ width: '100%' }} />
                        </Box>
                    )}
                    {(chartType === 'acf' || chartType === 'pacf') && (
                        <Box sx={{ minWidth: 140 }}>
                            <Typography variant="caption" color="text.secondary">Макс. лаг: {maxLag}</Typography>
                            <input type="range" min={5} max={50} value={maxLag} onChange={e => setMaxLag(Number(e.target.value))} style={{ width: '100%' }} />
                        </Box>
                    )}
                    {chartType === 'seasonal' && (
                        <ToggleButtonGroup value={seasonPeriod} exclusive size="small" onChange={(_, v) => { if (v) setSeasonPeriod(v) }}>
                            <ToggleButton value="month">По годам</ToggleButton>
                            <ToggleButton value="weekday">По дням нед.</ToggleButton>
                        </ToggleButtonGroup>
                    )}
                    {chartType === 'boxplot' && (
                        <ToggleButtonGroup value={boxGroupBy} exclusive size="small" onChange={(_, v) => { if (v) setBoxGroupBy(v) }}>
                            <ToggleButton value="month">По месяцам</ToggleButton>
                            <ToggleButton value="weekday">По дням нед.</ToggleButton>
                        </ToggleButtonGroup>
                    )}
                    {chartType === 'multi' && (
                        <FormControl size="small" sx={{ minWidth: 220 }}>
                            <InputLabel>Колонки Y (мульти)</InputLabel>
                            <Select
                                multiple value={yCols}
                                onChange={e => setYCols(typeof e.target.value === 'string' ? e.target.value.split(',') : e.target.value as string[])}
                                label="Колонки Y (мульти)"
                                renderValue={(sel) => (sel as string[]).join(', ')}
                            >
                                {numCols.map(c => <MenuItem key={c.field} value={c.field}>{c.field}</MenuItem>)}
                            </Select>
                        </FormControl>
                    )}
                    {chartType === 'scatter' && (
                        <FormControl size="small" sx={{ minWidth: 180 }}>
                            <InputLabel>Ось Y2 (scatter)</InputLabel>
                            <Select value={yCol2} label="Ось Y2 (scatter)" onChange={e => setYCol2(e.target.value)}>
                                {numCols.map(c => <MenuItem key={c.field} value={c.field}>{c.field}</MenuItem>)}
                            </Select>
                        </FormControl>
                    )}
                    {chartType === 'corrmatrix' && (
                        <FormControl size="small" sx={{ minWidth: 240 }}>
                            <InputLabel>Колонки для корреляции</InputLabel>
                            <Select
                                multiple value={corrCols}
                                onChange={e => setCorrCols(typeof e.target.value === 'string' ? e.target.value.split(',') : e.target.value as string[])}
                                label="Колонки для корреляции"
                                renderValue={(sel) => (sel as string[]).join(', ')}
                            >
                                {numCols.map(c => <MenuItem key={c.field} value={c.field}>{c.field}</MenuItem>)}
                            </Select>
                        </FormControl>
                    )}
                    {chartType === 'stationarity' && (
                        <Box sx={{ minWidth: 140 }}>
                            <Typography variant="caption" color="text.secondary">Макс. лаг ACF: {maxLag}</Typography>
                            <input type="range" min={5} max={50} value={maxLag} onChange={e => setMaxLag(Number(e.target.value))} style={{ width: '100%' }} />
                        </Box>
                    )}
                </Box>
            </Paper>

            {/* Тип графика — сгруппированные категории */}
            <Box sx={{ mb: 2.5, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                {TS_CHART_GROUPS.map(group => (
                    <Box key={group.label}>
                        <Typography variant="caption" color="text.secondary" fontWeight={600} sx={{ display: 'block', mb: 0.5, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                            {group.label}
                        </Typography>
                        <ToggleButtonGroup
                            value={chartType}
                            exclusive
                            onChange={(_, v) => { if (v) setChartType(v) }}
                            size="small"
                            sx={{ flexWrap: 'wrap', gap: 0.5 }}
                        >
                            {group.charts.map(t => (
                                <ToggleButton key={`${group.label}-${t.value}`} value={t.value} sx={{ textTransform: 'none', fontSize: '0.78rem' }}>
                                    {t.label}
                                </ToggleButton>
                            ))}
                        </ToggleButtonGroup>
                    </Box>
                ))}
            </Box>

            {/* Контент */}
            {!yCol && <Alert severity="info">Выберите числовую колонку для оси Y.</Alert>}
            {yCol === '__count__' && !xCol && (
                <Alert severity="info" sx={{ borderRadius: 2 }}>
                    Выберите <strong>временну́ю ось (X)</strong>, чтобы построить частотный ряд (кол-во записей за период).
                </Alert>
            )}
            {yCol && (yCol !== '__count__' || xCol) && !hasEnoughData && <Alert severity="warning">Недостаточно данных (нужно ≥ 4 значений).</Alert>}
            {yCol && (yCol !== '__count__' || xCol) && hasEnoughData && (
                <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
                    <Typography variant="subtitle2" fontWeight={600} mb={1.5}>
                        {TS_CHART_GROUPS.flatMap(g => (g.charts as unknown as { value: string; label: string }[])).find(t => t.value === chartType)?.label} — {yCol === '__count__' ? 'Кол-во записей за период' : yCol}
                        {xCol && <Typography component="span" variant="caption" color="text.secondary" ml={1}>ось X: {xCol}</Typography>}
                        {sortedRows.length < rows.length && (
                            <Chip size="small" label={`выборка ${sortedRows.length} / ${rows.length.toLocaleString()} строк`} color="warning" variant="outlined" sx={{ ml: 1, height: 20, fontSize: '0.65rem' }} />
                        )}
                    </Typography>
                    {chartContent}
                </Paper>
            )}
        </Box>
    )
}

// ─── Visualizations Tab ───────────────────────────────────────────────────────

const VIZ_TYPES = [
    { value: 'violin', label: 'Violin Plot' },
    { value: 'scatter', label: 'Scatter Plot' },
    { value: 'stacked-bar', label: 'Stacked Bar' },
    { value: 'line', label: 'Line Plot' },
    { value: 'pairplot', label: 'Pairplot' },
    { value: 'pca', label: 'PCA' },
] as const
type VizType = typeof VIZ_TYPES[number]['value']

function VisualizationsTab({ stats }: { stats: DatasetStats }) {
    const [vizType, setVizType] = useState<VizType>('violin')
    return (
        <Box>
            <Box sx={{ mb: 3 }}>
                <ToggleButtonGroup
                    value={vizType}
                    exclusive
                    onChange={(_, v) => { if (v) setVizType(v) }}
                    size="small"
                    sx={{ flexWrap: 'wrap', gap: 0.5 }}
                >
                    {VIZ_TYPES.map(vt => (
                        <ToggleButton key={vt.value} value={vt.value} sx={{ textTransform: 'none', fontSize: '0.8rem' }}>
                            {vt.label}
                        </ToggleButton>
                    ))}
                </ToggleButtonGroup>
            </Box>
            {vizType === 'violin' && <ViolinTab stats={stats} />}
            {vizType === 'scatter' && <ScatterViz stats={stats} />}
            {vizType === 'stacked-bar' && <StackedBarViz stats={stats} />}
            {vizType === 'line' && <LinePlotViz stats={stats} />}
            {vizType === 'pairplot' && <PairplotViz stats={stats} />}
            {vizType === 'pca' && <PCAViz stats={stats} />}
        </Box>
    )
}

// ─── Normality Tests ──────────────────────────────────────────────────────────

function normalityLabel(skew: number, kurt: number, jbP: number): { label: string; color: 'success' | 'warning' | 'error' } {
    if (jbP > 0.05) return { label: 'Нормальное', color: 'success' }
    if (Math.abs(skew) > 1) return { label: 'Сильно скошенное', color: 'error' }
    if (Math.abs(kurt) > 3) return { label: 'Тяжёлые хвосты', color: 'warning' }
    if (Math.abs(skew) > 0.5) return { label: 'Умеренно скошенное', color: 'warning' }
    return { label: 'Не нормальное', color: 'warning' }
}

function transformRec(skew: number): string {
    if (skew > 1.5) return 'log(x)'
    if (skew > 0.5) return '√x'
    if (skew < -1.5) return 'Отражение + log'
    if (skew < -0.5) return '−√(max−x)'
    return '—'
}

function NormalityTab({ stats }: { stats: DatasetStats }) {
    const numCols = stats.columns.filter((c): c is NumericColStats => c.kind === 'numeric')

    const rows = useMemo(() => numCols.map(c => {
        const jb = isFinite(c.skewness) && isFinite(c.kurtosis)
            ? (c.n / 6) * (c.skewness ** 2 + (c.kurtosis ** 2) / 4)
            : NaN
        const jbP = isFinite(jb) ? Math.exp(-jb / 2) : NaN
        const norm = isFinite(jbP) ? normalityLabel(c.skewness, c.kurtosis, jbP) : { label: '—', color: 'default' as const }
        return { ...c, jb, jbP, norm }
    }), [numCols])

    if (numCols.length === 0) return <Alert severity="info">Нет числовых колонок.</Alert>

    const normalCount = rows.filter(r => r.norm.color === 'success').length
    const warnCount = rows.filter(r => r.norm.color === 'warning').length
    const errorCount = rows.filter(r => r.norm.color === 'error').length

    return (
        <Box>
            <Grid container spacing={2} mb={3}>
                {[
                    { label: 'Нормальных', value: normalCount, color: 'success.main' },
                    { label: 'Умеренно ненорм.', value: warnCount, color: 'warning.main' },
                    { label: 'Сильно скошенных', value: errorCount, color: 'error.main' },
                ].map(c => (
                    <Grid item xs={6} sm={4} key={c.label}>
                        <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, textAlign: 'center' }}>
                            <Typography variant="h5" fontWeight={700} color={c.color}>{c.value}</Typography>
                            <Typography variant="caption" color="text.secondary">{c.label}</Typography>
                        </Paper>
                    </Grid>
                ))}
            </Grid>

            <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 2 }}>
                <Table size="small">
                    <TableHead>
                        <TableRow sx={{ bgcolor: 'grey.50' }}>
                            {['Колонка', 'N', 'Скос', 'Экс. курт.', 'JB', 'p-value', 'Вывод', 'Преобразование'].map(h => (
                                <TableCell key={h} sx={{ fontWeight: 600, fontSize: '0.78rem' }}>{h}</TableCell>
                            ))}
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {rows.map(r => (
                            <TableRow key={r.field} hover>
                                <TableCell sx={{ fontWeight: 500, maxWidth: 220 }}>
                                    <TruncatedText value={r.field} maxWidth={210} fontWeight={500} />
                                </TableCell>
                                <TableCell>{r.n.toLocaleString()}</TableCell>
                                <TableCell sx={{ color: Math.abs(r.skewness) > 1 ? 'error.main' : Math.abs(r.skewness) > 0.5 ? 'warning.main' : 'text.primary' }}>
                                    {fmt(r.skewness)}
                                </TableCell>
                                <TableCell sx={{ color: Math.abs(r.kurtosis) > 3 ? 'warning.main' : 'text.primary' }}>
                                    {fmt(r.kurtosis)}
                                </TableCell>
                                <TableCell>{isFinite(r.jb) ? fmt(r.jb, 2) : '—'}</TableCell>
                                <TableCell sx={{ color: isFinite(r.jbP) ? (r.jbP < 0.05 ? 'error.main' : 'success.main') : 'text.disabled' }}>
                                    {isFinite(r.jbP) ? (r.jbP < 0.001 ? '< 0.001' : fmt(r.jbP, 3)) : '—'}
                                </TableCell>
                                <TableCell>
                                    <Chip label={r.norm.label} size="small" color={r.norm.color === 'default' ? 'default' : r.norm.color} variant="outlined" sx={{ fontSize: '0.7rem' }} />
                                </TableCell>
                                <TableCell sx={{ fontSize: '0.78rem', color: 'text.secondary' }}>
                                    {transformRec(r.skewness)}
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </TableContainer>

            <Typography variant="caption" color="text.secondary" display="block" mt={2}>
                JB = (n/6)·(S² + K²/4), где S — скошенность, K — эксцесс (excess kurtosis). p-value = e^(−JB/2) по распределению χ²(2). При p {'>'} 0.05 гипотеза о нормальности не отвергается.
            </Typography>
        </Box>
    )
}

// ─── Target Analysis ──────────────────────────────────────────────────────────

function TargetAnalysisTab({ stats }: { stats: DatasetStats }) {
    const [targetCol, setTargetCol] = useState('')
    const PALETTE = ['#3b82f6', '#ef4444', '#22c55e', '#f59e0b', '#8b5cf6', '#06b6d4', '#ec4899', '#84cc16', '#f97316', '#14b8a6']

    const targetStats = useMemo(
        () => stats.columns.find(c => c.field === targetCol) ?? null,
        [stats, targetCol],
    )

    const classData = useMemo(() => {
        if (!targetStats || targetStats.kind !== 'categorical') return []
        return targetStats.topValues.map(v => ({ name: v.value, count: v.count, pct: v.pct }))
    }, [targetStats])

    const imbalanceRatio = useMemo(() => {
        if (!classData.length) return null
        const max = Math.max(...classData.map(d => d.count))
        const min = Math.min(...classData.map(d => d.count))
        return min === 0 ? Infinity : max / min
    }, [classData])

    const featureCorrs = useMemo(() => {
        if (!targetCol || !stats.correlation) return []
        const { fields, pearson } = stats.correlation
        const tIdx = fields.indexOf(targetCol)
        if (tIdx === -1) return []
        return fields
            .map((f, i) => ({ field: f, r: pearson[tIdx][i] }))
            .filter(d => d.field !== targetCol && isFinite(d.r))
            .sort((a, b) => Math.abs(b.r) - Math.abs(a.r))
    }, [targetCol, stats.correlation])

    const targetHistogram = useMemo(() => {
        if (!targetStats || targetStats.kind !== 'numeric') return []
        return targetStats.histogram
    }, [targetStats])

    return (
        <Box>
            <Box sx={{ mb: 3 }}>
                <FormControl size="small" sx={{ minWidth: 260 }}>
                    <InputLabel>Целевая переменная (Target)</InputLabel>
                    <Select value={targetCol} label="Целевая переменная (Target)" onChange={e => setTargetCol(e.target.value)}>
                        {stats.columns.map(c => (
                            <MenuItem key={c.field} value={c.field}>
                                <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                                    {c.field}
                                    <Chip
                                        label={c.kind === 'numeric' ? 'число' : 'катег.'}
                                        size="small"
                                        color={c.kind === 'numeric' ? 'primary' : 'default'}
                                        variant="outlined"
                                        sx={{ fontSize: '0.65rem', height: 18 }}
                                    />
                                </Box>
                            </MenuItem>
                        ))}
                    </Select>
                </FormControl>
            </Box>

            {!targetCol && (
                <Box sx={{ p: 5, textAlign: 'center', border: '2px dashed', borderColor: 'divider', borderRadius: 2, color: 'text.disabled' }}>
                    <GpsFixedIcon sx={{ fontSize: 40, mb: 1, opacity: 0.3 }} />
                    <Typography variant="body2">Выберите целевую переменную для анализа</Typography>
                </Box>
            )}

            {/* ── Categorical target ── */}
            {targetStats && targetStats.kind === 'categorical' && (
                <Box>
                    {imbalanceRatio !== null && imbalanceRatio > 3 && (
                        <Alert severity={imbalanceRatio > 10 ? 'error' : 'warning'} sx={{ mb: 2, borderRadius: 2 }}>
                            <strong>Дисбаланс классов:</strong> отношение {imbalanceRatio === Infinity ? '∞' : fmt(imbalanceRatio, 1)}x.{' '}
                            {imbalanceRatio > 10
                                ? 'Сильный дисбаланс — рекомендуется SMOTE или class_weight.'
                                : 'Умеренный дисбаланс — рекомендуется class_weight или oversampling.'}
                        </Alert>
                    )}
                    {imbalanceRatio !== null && imbalanceRatio <= 3 && (
                        <Alert severity="success" sx={{ mb: 2, borderRadius: 2 }}>
                            Классы сбалансированы (отношение {fmt(imbalanceRatio, 1)}x).
                        </Alert>
                    )}

                    <Grid container spacing={3}>
                        <Grid item xs={12} md={7}>
                            <Typography variant="subtitle2" fontWeight={600} mb={1}>Распределение классов</Typography>
                            <Box sx={{ height: Math.max(200, classData.length * 38 + 60) }}>
                                <ResponsiveContainer width="100%" height="100%">
                                    <BarChart data={classData} layout="vertical" margin={{ left: 16, right: 70 }}>
                                        <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                                        <XAxis type="number" tick={{ fontSize: 11 }} />
                                        <YAxis type="category" dataKey="name" width={130} tick={{ fontSize: 12 }} />
                                        <RTooltip formatter={(v: number | undefined) => [(v ?? 0).toLocaleString(), 'Кол-во']} />
                                        <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                                            <LabelList dataKey="count" position="right" style={{ fontSize: 11 }} />
                                            {classData.map((_, i) => (
                                                <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
                                            ))}
                                        </Bar>
                                    </BarChart>
                                </ResponsiveContainer>
                            </Box>
                        </Grid>
                        <Grid item xs={12} md={5}>
                            <Typography variant="subtitle2" fontWeight={600} mb={1}>Сводка по классам</Typography>
                            <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 2 }}>
                                <Table size="small">
                                    <TableHead>
                                        <TableRow sx={{ bgcolor: 'grey.50' }}>
                                            {['Класс', 'Кол-во', '%'].map(h => (
                                                <TableCell key={h} sx={{ fontWeight: 600, fontSize: '0.78rem' }}>{h}</TableCell>
                                            ))}
                                        </TableRow>
                                    </TableHead>
                                    <TableBody>
                                        {classData.map((d, i) => (
                                            <TableRow key={d.name} hover>
                                                <TableCell>
                                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                                        <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: PALETTE[i % PALETTE.length], flexShrink: 0 }} />
                                                        <Typography variant="caption" sx={{ wordBreak: 'break-all' }}>{d.name}</Typography>
                                                    </Box>
                                                </TableCell>
                                                <TableCell>{d.count.toLocaleString()}</TableCell>
                                                <TableCell>
                                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                                        {pct(d.pct)}
                                                        <LinearProgress variant="determinate" value={d.pct * 100} sx={{ width: 40, height: 4, borderRadius: 2 }} />
                                                    </Box>
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </TableContainer>
                        </Grid>
                    </Grid>
                </Box>
            )}

            {/* ── Numeric target ── */}
            {targetStats && targetStats.kind === 'numeric' && (
                <Box>
                    <Grid container spacing={2} mb={3}>
                        {[
                            { label: 'Среднее', value: fmt(targetStats.mean) },
                            { label: 'Медиана', value: fmt(targetStats.median) },
                            { label: 'Стд. откл.', value: fmt(targetStats.std) },
                            { label: 'Скошенность', value: fmt(targetStats.skewness) },
                        ].map(c => (
                            <Grid item xs={6} sm={3} key={c.label}>
                                <Paper variant="outlined" sx={{ p: 2, textAlign: 'center', borderRadius: 2 }}>
                                    <Typography variant="h6" fontWeight={700}>{c.value}</Typography>
                                    <Typography variant="caption" color="text.secondary">{c.label}</Typography>
                                </Paper>
                            </Grid>
                        ))}
                    </Grid>
                    <Typography variant="subtitle2" fontWeight={600} mb={1}>Распределение целевой переменной</Typography>
                    <Box sx={{ height: 280 }}>
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={targetHistogram} margin={{ top: 4, right: 24, bottom: 20, left: 8 }}>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                                <XAxis dataKey="range" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                                <YAxis tick={{ fontSize: 10 }} />
                                <RTooltip formatter={(v: number | undefined) => [v ?? 0, 'Кол-во']} />
                                <Bar dataKey="count" fill="#3b82f6" radius={[2, 2, 0, 0]} />
                            </BarChart>
                        </ResponsiveContainer>
                    </Box>
                </Box>
            )}

            {/* ── Feature correlations with numeric target ── */}
            {featureCorrs.length > 0 && (
                <Box mt={3}>
                    <Typography variant="subtitle2" fontWeight={600} mb={1}>
                        Корреляция признаков с целевой переменной — Pearson r
                    </Typography>
                    <Box sx={{ height: Math.max(200, Math.min(featureCorrs.length, 20) * 34 + 60) }}>
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={featureCorrs.slice(0, 20)} layout="vertical" margin={{ left: 16, right: 70 }}>
                                <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                                <XAxis type="number" domain={[-1, 1]} tickFormatter={v => fmt(v as number, 2)} tick={{ fontSize: 11 }} />
                                <YAxis type="category" dataKey="field" width={140} tick={{ fontSize: 12 }} />
                                <RTooltip formatter={(v: number | undefined) => [fmt(v ?? NaN, 3), 'Pearson r']} />
                                <ReferenceLine x={0} stroke="#666" />
                                <Bar dataKey="r" radius={[0, 4, 4, 0]}>
                                    <LabelList dataKey="r" position="right" formatter={(v: unknown) => fmt(v as number, 3)} style={{ fontSize: 10 }} />
                                    {featureCorrs.slice(0, 20).map((d, i) => (
                                        <Cell key={i} fill={d.r >= 0 ? '#3b82f6' : '#ef4444'} fillOpacity={Math.min(1, Math.abs(d.r) * 0.7 + 0.3)} />
                                    ))}
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                    </Box>
                    <Typography variant="caption" color="text.secondary" display="block" mt={1}>
                        Показаны числовые признаки. Синий — положительная корреляция, красный — отрицательная.
                    </Typography>
                </Box>
            )}

            {targetStats && featureCorrs.length === 0 && targetStats.kind === 'numeric' && (
                <Alert severity="info" sx={{ mt: 2, borderRadius: 2 }}>
                    Для отображения корреляций признаков необходимо вычислить полную статистику (вкладка Корреляции).
                </Alert>
            )}
        </Box>
    )
}

const TABS = [
    {
        label: 'Обзор',
        icon: <TableChartIcon fontSize="small" />,
        runLabel: 'Провести обзор',
        runDesc: 'Сводка по датасету: строки, колонки, типы данных и базовые метрики',
        runIcon: <TableChartIcon sx={{ fontSize: 48, opacity: 0.25 }} />,
    },
    {
        label: 'Качество данных',
        icon: <HealthAndSafetyIcon fontSize="small" />,
        runLabel: 'Проверить качество данных',
        runDesc: 'Пропуски, дубликаты, константные и уникальные колонки',
        runIcon: <HealthAndSafetyIcon sx={{ fontSize: 48, opacity: 0.25 }} />,
    },
    {
        label: 'Распределения',
        icon: <BarChartIcon fontSize="small" />,
        runLabel: 'Построить распределения',
        runDesc: 'Гистограммы и частотные таблицы для каждой колонки',
        runIcon: <BarChartIcon sx={{ fontSize: 48, opacity: 0.25 }} />,
    },
    {
        label: 'Выбросы',
        icon: <CandlestickChartIcon fontSize="small" />,
        runLabel: 'Найти выбросы',
        runDesc: 'Box-plot и IQR-анализ для числовых переменных',
        runIcon: <CandlestickChartIcon sx={{ fontSize: 48, opacity: 0.25 }} />,
    },
    {
        label: 'Корреляции',
        icon: <BubbleChartIcon fontSize="small" />,
        runLabel: 'Вычислить корреляции',
        runDesc: 'Pearson, Spearman и Cramér\'s V для всех пар переменных',
        runIcon: <BubbleChartIcon sx={{ fontSize: 48, opacity: 0.25 }} />,
    },
    {
        label: 'P-value',
        icon: <FunctionsIcon fontSize="small" />,
        runLabel: '',
        runDesc: '',
        runIcon: <FunctionsIcon sx={{ fontSize: 48, opacity: 0.25 }} />,
    },
    {
        label: 'Визуализации',
        icon: <AutoGraphIcon fontSize="small" />,
        runLabel: 'Построить визуализации',
        runDesc: 'Violin, Scatter, Stacked Bar, Line, Pairplot, PCA',
        runIcon: <AutoGraphIcon sx={{ fontSize: 48, opacity: 0.25 }} />,
    },
    {
        label: 'Временные ряды',
        icon: <TimelineIcon fontSize="small" />,
        runLabel: 'Провести анализ временных рядов',
        runDesc: 'ACF, PACF, декомпозиция, сезонность и ещё 20+ графиков',
        runIcon: <TimelineIcon sx={{ fontSize: 48, opacity: 0.25 }} />,
    },
    {
        label: 'Нормальность',
        icon: <ShowChartIcon fontSize="small" />,
        runLabel: 'Проверить нормальность',
        runDesc: 'Скошенность, эксцесс и тест Жарка–Бера для числовых признаков',
        runIcon: <ShowChartIcon sx={{ fontSize: 48, opacity: 0.25 }} />,
    },
    {
        label: 'Цель (Target)',
        icon: <GpsFixedIcon fontSize="small" />,
        runLabel: 'Анализировать целевую переменную',
        runDesc: 'Распределение классов, дисбаланс и корреляция признаков с целевой переменной',
        runIcon: <GpsFixedIcon sx={{ fontSize: 48, opacity: 0.25 }} />,
    },
]


function TabRunButton({
    label, description, icon, loading, progress, stage, onClick, disabled,
}: {
    label: string
    description?: string
    icon?: React.ReactNode
    loading: boolean
    progress: number
    stage: string
    onClick: () => void
    disabled?: boolean
}) {
    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, py: 6 }}>
            {icon ?? <FunctionsIcon sx={{ fontSize: 48, opacity: 0.25 }} />}
            {description && (
                <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 380, textAlign: 'center' }}>
                    {description}
                </Typography>
            )}
            {loading ? (
                <Box sx={{ width: 340, mt: 1 }}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                        <Typography variant="caption" color="text.secondary">{stage}</Typography>
                        <Typography variant="caption" color="text.secondary">{progress}%</Typography>
                    </Box>
                    <LinearProgress variant="determinate" value={progress} sx={{ height: 6, borderRadius: 1 }} />
                </Box>
            ) : (
                <Button
                    variant="contained"
                    size="large"
                    disabled={disabled}
                    onClick={onClick}
                    sx={{ textTransform: 'none', fontWeight: 600, px: 4, mt: 1 }}
                >
                    {label}
                </Button>
            )}
        </Box>
    )
}

// Module-level caches: persist across StatsPage mounts for the duration of the app session
const overviewCache = new Map<string, DatasetOverview>()
const statsCache = new Map<string, DatasetStats>()

export function StatsPage() {
    const [tab, setTab] = useState(0)
    const { tableStates, activeTableId } = useTableStore()
    const [searchParams] = useSearchParams()

    const [selectedId, setSelectedId] = useState<string>(() => {
        const fromUrl = searchParams.get('tableId')
        return fromUrl ?? activeTableId ?? ''
    })

    const getUploadId = useCallback(
        (id: string) => tableStates.find((state) => state.id === id)?.uploadId,
        [tableStates],
    )

    const [overview, setOverview] = useState<DatasetOverview | null>(() => {
        const uid = getUploadId(searchParams.get('tableId') ?? activeTableId ?? '')
        return uid ? (overviewCache.get(uid) ?? null) : null
    })
    const [overviewLoading, setOverviewLoading] = useState(false)
    const [overviewProgress, setOverviewProgress] = useState(0)
    const [overviewError, setOverviewError] = useState<string | null>(null)

    const [basicStats, setBasicStats] = useState<DatasetStats | null>(() => {
        const uid = getUploadId(searchParams.get('tableId') ?? activeTableId ?? '')
        return uid ? (statsCache.get(uid) ?? null) : null
    })
    const [basicLoading, setBasicLoading] = useState(false)
    const [basicProgress, setBasicProgress] = useState(0)
    const [basicStage, setBasicStage] = useState('')
    const [statsError, setStatsError] = useState<string | null>(null)

    // Restore cached data when user switches dataset selector
    useEffect(() => {
        const uid = getUploadId(selectedId)
        setOverview(uid ? overviewCache.get(uid) ?? null : null)
        setOverviewError(null)
        setBasicStats(uid ? statsCache.get(uid) ?? null : null)
        setStatsError(null)
    }, [selectedId, getUploadId])

    const resetAll = () => {
        setOverview(null)
        setOverviewLoading(false)
        setOverviewError(null)
        setBasicStats(null)
        setBasicLoading(false)
        setStatsError(null)
    }

    const handleRunOverview = async () => {
        if (!selectedId || overviewLoading) return
        const uploadId = getUploadId(selectedId)
        if (!uploadId) return
        setOverviewLoading(true)
        setOverviewProgress(0)
        setOverviewError(null)
        try {
            const result = await getDatasetOverviewArtifact(uploadId, setOverviewProgress)
            const ov = result as DatasetOverview
            overviewCache.set(uploadId, ov)
            setOverviewProgress(100)
            setOverview(ov)
        } catch (err: any) {
            setOverviewError(err?.response?.data?.message ?? err?.message ?? 'Не удалось загрузить обзор датасета')
        } finally {
            setOverviewLoading(false)
        }
    }

    const handleRunStats = async () => {
        if (!selectedId || basicLoading) return
        const uploadId = getUploadId(selectedId)
        if (!uploadId) return
        setBasicLoading(true)
        setBasicProgress(0)
        setBasicStage('Загрузка статистик...')
        setStatsError(null)
        try {
            const result = await getDatasetStatsArtifact(uploadId, setBasicProgress)
            const stats = result as DatasetStats
            statsCache.set(uploadId, stats)
            setBasicProgress(100)
            setBasicStats(stats)
        } catch (err: any) {
            setStatsError(err?.response?.data?.message ?? err?.message ?? 'Не удалось загрузить статистики')
        } finally {
            setBasicLoading(false)
        }
    }



    const noDataset = tableStates.length === 0

    return (
        <Box sx={{ p: 3 }}>
            <Box mb={3} sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 2 }}>
                <Box>
                    <Typography variant="h5" fontWeight={700} mb={0.5}>Статистика</Typography>
                    <Typography variant="body2" color="text.secondary">
                        Выберите датасет, затем откройте нужный раздел и нажмите кнопку анализа.
                    </Typography>
                </Box>
                <ReportProblemButton sectionName="Статистика" datasetId={selectedId || undefined} />
            </Box>

            {noDataset ? (
                <Alert severity="info" sx={{ borderRadius: 2 }}>
                    Загрузите датасет на странице <strong>Рабочее место</strong>, чтобы начать анализ.
                </Alert>
            ) : (
                <>
                    <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, mb: 3, display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
                        <FormControl size="small" sx={{ minWidth: 280 }}>
                            <InputLabel>Датасет</InputLabel>
                            <Select
                                value={selectedId}
                                label="Датасет"
                                onChange={(e) => { setSelectedId(e.target.value); resetAll() }}
                            >
                                {tableStates.map((s) => (
                                    <MenuItem key={s.id} value={s.id}>{s.fileName}</MenuItem>
                                ))}
                            </Select>
                        </FormControl>
                        {overview && (
                            <Typography variant="body2" color="text.secondary">
                                <b>{overview.quality.totalRows.toLocaleString()}</b> строк · {overview.quality.totalCols} колонок
                            </Typography>
                        )}
                    </Paper>

                    <Paper variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden' }}>
                        <Tabs
                            value={tab}
                            onChange={(_, v) => setTab(v)}
                            sx={{ borderBottom: '1px solid', borderColor: 'divider', px: 1, bgcolor: 'grey.50' }}
                            variant="scrollable"
                            scrollButtons="auto"
                        >
                            {TABS.map((t, i) => (
                                <Tab
                                    key={i}
                                    label={t.label}
                                    icon={t.icon}
                                    iconPosition="start"
                                    sx={{ minHeight: 48, textTransform: 'none', fontWeight: 500, fontSize: '0.875rem' }}
                                />
                            ))}
                        </Tabs>

                        <Box sx={{ p: 3 }}>
                            {/* Tabs 0-1: lightweight dataset_overview artifact */}
                            {[0, 1].includes(tab) && !overview && (
                                <>
                                    <TabRunButton
                                        label={TABS[tab].runLabel}
                                        description={TABS[tab].runDesc}
                                        icon={TABS[tab].runIcon}
                                        loading={overviewLoading}
                                        progress={overviewProgress}
                                        stage=""
                                        onClick={handleRunOverview}
                                        disabled={!selectedId}
                                    />
                                    {overviewError && <Alert severity="error" sx={{ mt: 1.5, borderRadius: 2 }}>{overviewError}</Alert>}
                                </>
                            )}
                            {/* Tabs 2-4, 6-9: full dataset_stats artifact */}
                            {[2, 3, 4, 6, 7, 8, 9].includes(tab) && !basicStats && (
                                <>
                                    <TabRunButton
                                        label={TABS[tab].runLabel}
                                        description={TABS[tab].runDesc}
                                        icon={TABS[tab].runIcon}
                                        loading={basicLoading}
                                        progress={basicProgress}
                                        stage={basicStage}
                                        onClick={handleRunStats}
                                        disabled={!selectedId}
                                    />
                                    {statsError && <Alert severity="error" sx={{ mt: 1.5, borderRadius: 2 }}>{statsError}</Alert>}
                                </>
                            )}
                            {tab === 0 && overview && <OverviewTab overview={overview} />}
                            {tab === 1 && overview && <DataQualityTab overview={overview} />}
                            {tab === 2 && basicStats && <DistributionsTab stats={basicStats} />}
                            {tab === 3 && basicStats && <OutliersTab stats={basicStats} />}
                            {tab === 4 && basicStats && <CorrelationsTab stats={basicStats} />}

                            {/* Tab 5: P-value — univariate is interactive; pairwise fetched from Python */}
                            {tab === 5 && <PValueTab uploadId={tableStates.find((s) => s.id === selectedId)?.uploadId} />}

                            {tab === 6 && basicStats && <VisualizationsTab stats={basicStats} />}
                            {tab === 7 && basicStats && <TimeSeriesTab stats={basicStats} />}
                            {tab === 8 && basicStats && <NormalityTab stats={basicStats} />}
                            {tab === 9 && basicStats && <TargetAnalysisTab stats={basicStats} />}
                        </Box>
                    </Paper>
                </>
            )}
        </Box>
    )
}
