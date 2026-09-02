import { useMemo } from 'react'
import { Alert, Box, Typography } from '@mui/material'
import {
    CartesianGrid,
    ReferenceLine,
    ResponsiveContainer,
    Scatter,
    ScatterChart,
    Tooltip as ChartTooltip,
    XAxis,
    YAxis,
    ZAxis,
} from 'recharts'
import type { OrganizationBreakdown } from '@shared/lib/reporting-api'
import { formatNumber, monthName } from '../lib/reporting-helpers'

/**
 * Дополнительные диаграммы дашборда динамики — «визуализация связей / корреляции»
 * из ТЗ от 24.08.2026, постановка уточнена с Ильёй 26.08.
 *
 * **Связь ищется между медорганизациями, а не между месяцами.** Помесячная
 * роспись терпрограммы почти постоянна — размах за 2026 год 0,028 %, — и облако
 * точек «месяц против месяца» встало бы вертикальной полосой. Между
 * медорганизациями разброс настоящий.
 *
 * Первая диаграмма отвечает на вопрос «кто отстаёт», вторая — «когда».
 */

const SCATTER_COLOR = '#2F5597'
const DIAGONAL_COLOR = '#94a3b8'

interface ScatterPoint {
    organizationName: string
    caseFact: number
    semdInSlice: number
    percentOfFact: number | null
}

export function CasesVsSemdScatter({
    breakdown,
}: {
    breakdown: OrganizationBreakdown
}) {
    // МО без реестров ОМС на диаграмме нет вовсе. Поставить её в ноль
    // по горизонтали значило бы сказать «фонд не оплатил ни одного случая»,
    // хотя фонд про неё просто не прислал данных.
    const points = useMemo<ScatterPoint[]>(
        () => breakdown.rows
            .filter((row) => row.caseFact !== null && row.semdInSlice !== null)
            .map((row) => ({
                organizationName: row.organizationName,
                caseFact: row.caseFact!,
                semdInSlice: row.semdInSlice!,
                percentOfFact: row.percentOfFact,
            })),
        [breakdown],
    )

    const missingCount = breakdown.rows.length - points.length
    const limit = useMemo(
        () => Math.max(
            1,
            ...points.map((point) => Math.max(point.caseFact, point.semdInSlice)),
        ),
        [points],
    )

    if (points.length === 0) {
        return (
            <Alert severity="info">
                Точечная диаграмма появится после загрузки исполнения ТПГГ
                по реестрам ОМС.
            </Alert>
        )
    }

    return (
        <>
            <Box sx={{ width: '100%', height: 340 }}>
                <ResponsiveContainer>
                    <ScatterChart margin={{ top: 8, right: 24, bottom: 24, left: 8 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#eef2f6" />
                        {/* Оси здесь оставлены в отличие от столбиковой диаграммы:
                            у точки нет иного способа сказать, о каких величинах
                            речь, — без шкал облако читается как абстрактный узор. */}
                        <XAxis
                            type="number"
                            dataKey="caseFact"
                            name="случаев по ТПГГ (факт)"
                            domain={[0, limit]}
                            tickFormatter={(value: number) => formatNumber(value)}
                            tick={{ fontSize: 11, fill: '#475569' }}
                            label={{
                                value: 'случаев по ТПГГ (факт)',
                                position: 'insideBottom',
                                offset: -12,
                                style: { fontSize: 12, fill: '#475569' },
                            }}
                        />
                        <YAxis
                            type="number"
                            dataKey="semdInSlice"
                            name="зарегистрировано СЭМД"
                            domain={[0, limit]}
                            width={78}
                            tickFormatter={(value: number) => formatNumber(value)}
                            tick={{ fontSize: 11, fill: '#475569' }}
                        />
                        <ZAxis range={[70, 70]} />
                        {/* Диагональ «на каждый случай оформлен документ».
                            Всё, что под ней, — недостающие документы, и вертикальное
                            расстояние до неё это их количество. */}
                        <ReferenceLine
                            segment={[{ x: 0, y: 0 }, { x: limit, y: limit }]}
                            stroke={DIAGONAL_COLOR}
                            strokeDasharray="6 4"
                            ifOverflow="extendDomain"
                        />
                        <ChartTooltip
                            cursor={{ strokeDasharray: '3 3' }}
                            content={({ payload }) => {
                                const point = payload?.[0]?.payload as ScatterPoint | undefined
                                if (!point) return null
                                return (
                                    <Box sx={{
                                        bgcolor: 'background.paper',
                                        border: '1px solid',
                                        borderColor: 'divider',
                                        borderRadius: 1,
                                        px: 1.25,
                                        py: 1,
                                        fontSize: 12,
                                    }}>
                                        <Box sx={{ fontWeight: 600, mb: 0.5 }}>
                                            {point.organizationName}
                                        </Box>
                                        <div>
                                            случаев: {formatNumber(point.caseFact)}
                                        </div>
                                        <div>
                                            СЭМД: {formatNumber(point.semdInSlice)}
                                        </div>
                                        <div>
                                            доля: {point.percentOfFact === null
                                                ? '—'
                                                : `${formatNumber(point.percentOfFact)} %`}
                                        </div>
                                    </Box>
                                )
                            }}
                        />
                        <Scatter
                            data={points}
                            name="медорганизации"
                            fill={SCATTER_COLOR}
                            fillOpacity={0.75}
                        />
                    </ScatterChart>
                </ResponsiveContainer>
            </Box>
            <Typography variant="caption" color="text.secondary">
                Пунктир — «на каждый случай оформлен документ». Точка ниже
                пунктира: документов меньше, чем оплаченных случаев; расстояние
                по вертикали и есть недостающие документы. Точка выше —
                документов больше, чем случаев, и это тоже повод спросить.
                {missingCount > 0 && (
                    <>
                        {' '}Ещё {missingCount}{' '}
                        {missingCount === 1 ? 'медорганизация' : 'медорганизаций'}
                        {' '}на диаграмме нет: реестров ОМС по ним фонд не прислал.
                        Это не ноль случаев.
                    </>
                )}
            </Typography>
        </>
    )
}

/**
 * Тепловая карта «медорганизация × месяц».
 *
 * Шкала намеренно одноцветная, от бледного к насыщенному, без «зелёный —
 * хорошо, красный — плохо». Порог приемлемой доли методолог ещё не назвала
 * (тот же вопрос, что висит по градации «краснее красного»), и раскрасить
 * клетки в оценку значило бы придумать её за неё.
 *
 * Зато видно то, ради чего график и заводился: строка, бледная десять месяцев
 * и тёмная в декабре, — это документы, оформленные авралом.
 */
export function MonthlyRatioHeatmap({
    breakdown,
}: {
    breakdown: OrganizationBreakdown
}) {
    const rows = useMemo(() => {
        const withMean = breakdown.rows
            // Строки без единого месяца выброшены целиком. Это медорганизации,
            // у которых нет планового объёма по листам знаменателя, — диспансеры,
            // бюро СМЭ, аптечное предприятие. Пустая строка в карте читается
            // как «ничего не оформляют», хотя оформлять им нечего.
            .filter((row) => row.monthlyRatios.some((value) => value !== null))
            .map((row) => {
                const values = row.monthlyRatios.filter(
                    (value): value is number => value !== null,
                )
                return {
                    ...row,
                    mean: values.reduce((sum, value) => sum + value, 0) / values.length,
                }
            })
        // Худшие сверху: дашборд открывают, чтобы понять, с кем разговаривать.
        return withMean.sort((left, right) => left.mean - right.mean)
    }, [breakdown])

    const hiddenCount = breakdown.rows.length - rows.length

    const lastMonth = useMemo(() => {
        let last = 0
        breakdown.rows.forEach((row) => {
            row.monthlyRatios.forEach((value, index) => {
                if (value !== null && index > last) last = index
            })
        })
        return last
    }, [breakdown])

    const months = Array.from({ length: lastMonth + 1 }, (_unused, index) => index + 1)

    if (rows.length === 0) return null

    return (
        <Box sx={{ overflowX: 'auto' }}>
            <Box
                sx={{
                    display: 'grid',
                    gridTemplateColumns: `minmax(190px, 1fr) repeat(${months.length}, 46px)`,
                    gap: '2px',
                    alignItems: 'center',
                    minWidth: 190 + months.length * 48,
                }}
            >
                <Box />
                {months.map((month) => (
                    <Box
                        key={month}
                        sx={{ fontSize: 11, color: 'text.secondary', textAlign: 'center' }}
                    >
                        {monthName(month).slice(0, 3)}
                    </Box>
                ))}
                {rows.map((row) => (
                    <HeatmapRow
                        key={row.organizationOid}
                        name={row.organizationName}
                        values={row.monthlyRatios.slice(0, months.length)}
                    />
                ))}
            </Box>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
                Медорганизации отсортированы по средней доле, отстающие сверху.
                Пунктирная клетка — выгрузки за месяц нет.
                {hiddenCount > 0 && (
                    <>
                        {' '}Ещё {hiddenCount}{' '}
                        {hiddenCount === 1 ? 'медорганизация скрыта' : 'медорганизаций скрыто'}:
                        {' '}у них нет планового объёма по этому показателю.
                    </>
                )}
            </Typography>
        </Box>
    )
}

function HeatmapRow({
    name,
    values,
}: {
    name: string
    values: Array<number | null>
}) {
    return (
        <>
            <Box
                title={name}
                sx={{
                    fontSize: 12,
                    pr: 1,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                }}
            >
                {name}
            </Box>
            {values.map((value, index) => (
                <Box
                    key={index}
                    title={value === null
                        ? `${name} · ${monthName(index + 1)}: данных нет`
                        : `${name} · ${monthName(index + 1)}: ${formatNumber(value)} %`}
                    sx={{
                        height: 22,
                        borderRadius: '2px',
                        bgcolor: heatColor(value),
                        border: value === null ? '1px dashed' : 'none',
                        borderColor: 'divider',
                    }}
                />
            ))}
        </>
    )
}

/**
 * Насыщенность по доле: 0 % — почти белый, 100 % и выше — насыщенный синий.
 *
 * Выше ста не различаем: 120 % и 300 % одинаково означают «документов больше,
 * чем оплаченных случаев», и растягивать шкалу под редкий выброс значило бы
 * сплющить в бледное всё остальное.
 */
function heatColor(value: number | null): string {
    if (value === null) return 'transparent'
    const share = Math.min(Math.max(value, 0), 100) / 100
    return `rgba(47, 85, 151, ${0.08 + share * 0.82})`
}
