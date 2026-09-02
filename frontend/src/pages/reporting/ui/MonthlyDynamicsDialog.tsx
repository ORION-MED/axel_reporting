import { useEffect, useMemo, useState, type ReactNode } from 'react'
import {
    Alert,
    Box,
    Button,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    Divider,
    LinearProgress,
    MenuItem,
    TextField,
    Typography,
} from '@mui/material'
import {
    Bar,
    ComposedChart,
    LabelList,
    Legend,
    Line,
    ResponsiveContainer,
    Tooltip as ChartTooltip,
    XAxis,
    YAxis,
} from 'recharts'
import {
    fetchMonthlySeries,
    type ExecutionSummary,
    type MonthlySeriesResult,
    type ReportingOrganizationIndicatorValue,
} from '@shared/lib/reporting-api'
import { formatNumber, monthName } from '../lib/reporting-helpers'
import {
    buildMonthlyConclusion,
    type MonthlyConclusion,
} from '../lib/monthly-conclusion'
import {
    CasesVsSemdScatter,
    MonthlyRatioHeatmap,
} from './DynamicsCorrelationCharts'
import {
    DYNAMICS_COLORS,
    barDomain,
    lineDomain,
} from '../lib/monthly-dynamics-axes'

interface MonthlyDynamicsDialogProps {
    open: boolean
    periodId: string | null
    indicatorId: string | null
    indicatorTitle: string
    organizations: readonly ReportingOrganizationIndicatorValue[]
    onClose: () => void
}

const REGION_OPTION = '__region__'

/**
 * Плитка блока «от факта». Цвет цифры повторяет цвет своей категории
 * на диаграмме — прямое требование ТЗ: «индикатор План ТПГГ и столбик
 * план ТПГГ — зелёные и тд».
 */
function SummaryTile({
    title,
    value,
    color,
}: {
    title: string
    value: string
    color: string
}) {
    return (
        <Box
            sx={{
                flex: '1 1 180px',
                minWidth: 180,
                px: 1.5,
                py: 1.25,
                border: '1px solid',
                borderColor: 'divider',
                borderRadius: 1,
                bgcolor: 'background.paper',
            }}
        >
            <Typography variant="caption" color="text.secondary">
                {title}
            </Typography>
            <Typography sx={{ color, fontSize: 22, fontWeight: 700, lineHeight: 1.25 }}>
                {value}
            </Typography>
        </Box>
    )
}

/**
 * Рамка с выводами под диаграммой (Д-32, требование ВКС 28.08.2026).
 *
 * Николай: «Внизу пусть будет три строки с жирным текстом. И всё… Мы не делаем
 * график ради графика. Мы делаем так, чтобы график читался с экрана, было понятно,
 * что на нём, внизу по комментарию чёткому, понятному».
 *
 * Четвёртая строка — управленческий вывод — намеренно пустая: формулировку даёт
 * методолог, а место под неё должно быть видно уже сейчас.
 */
function ConclusionPanel({ conclusion }: { conclusion: MonthlyConclusion }) {
    return (
        <Box
            sx={{
                mt: 1.5,
                p: 1.5,
                border: '1px solid',
                borderColor: 'divider',
                borderRadius: 1,
                bgcolor: 'action.hover',
            }}
        >
            {conclusion.lines.map((line) => (
                <Box key={line.label} sx={{ display: 'flex', gap: 1, mb: 0.5 }}>
                    <Typography
                        sx={{
                            fontSize: 13,
                            color: 'text.secondary',
                            minWidth: 172,
                            flexShrink: 0,
                        }}
                    >
                        {line.label}
                    </Typography>
                    <Typography
                        sx={{
                            fontSize: 13,
                            fontWeight: 700,
                            color: line.alarming ? 'error.main' : 'text.primary',
                        }}
                    >
                        {/* Пустая строка управленческого вывода не схлопывается:
                            прочерк показывает, что место оставлено намеренно. */}
                        {line.text || '—'}
                        {line.draft && (
                            <Typography
                                component="span"
                                sx={{ fontSize: 12, fontWeight: 400, color: 'text.secondary' }}
                            >
                                {' '}· черновик, ждёт методолога
                            </Typography>
                        )}
                    </Typography>
                </Box>
            ))}
        </Box>
    )
}

/** Заголовок диаграммы — по образцу в ТЗ: одинаковый шрифт у обеих. */
function ChartHeading({ children }: { children: ReactNode }) {
    return (
        <Typography
            align="center"
            sx={{ fontSize: 14, color: 'text.secondary', px: 4, mb: 0.5 }}
        >
            {children}
        </Typography>
    )
}

/**
 * Помесячная динамика: план по терпрограмме против зарегистрированных СЭМД (Д-9).
 *
 * Зачем это управленцу — дословно с ВКС 24.08.2026. Николай Ермаков: «количество
 * зарегистрированных СЭМДов должно следовать строго за графиком количества
 * зарегистрированных случаев — вот идеальное состояние»; и обратное: «а если
 * у нас график законченных случаев кривую, а график СЭМДов имеет сначала прямую,
 * а потом пару всплесков — это не цифровая трансформация, это рукоблудие».
 *
 * Поэтому график читается по форме, а не по уровню: ровные кривые означают, что
 * оформление документов встроено в работу, всплеск в конце года — что их делают
 * авралом, когда «в декабре зарегистрировать документы практически невозможно,
 * там такая очередь и просто пробка».
 *
 * Разрез — регион целиком или одна МО: «хоть суммарно, хоть на восемь графиков
 * разложить — это вообще не вопрос».
 */
export function MonthlyDynamicsDialog({
    open,
    periodId,
    indicatorId,
    indicatorTitle,
    organizations,
    onClose,
}: MonthlyDynamicsDialogProps) {
    const [scope, setScope] = useState<string>(REGION_OPTION)
    const [series, setSeries] = useState<MonthlySeriesResult | null>(null)
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)

    // Возврат к региону при каждом открытии: окно вызывают с карты, где выбор МО
    // уже сделан рядом, и «залипший» с прошлого раза разрез читался бы как общий.
    useEffect(() => {
        if (open) setScope(REGION_OPTION)
    }, [open])

    useEffect(() => {
        if (!open || !periodId || !indicatorId) return
        let cancelled = false
        setLoading(true)
        setError(null)
        fetchMonthlySeries(
            periodId,
            indicatorId,
            scope === REGION_OPTION ? undefined : scope,
        )
            .then((result) => {
                if (!cancelled) setSeries(result)
            })
            .catch((err: unknown) => {
                if (cancelled) return
                setError(
                    err instanceof Error
                        ? err.message
                        : 'Не удалось загрузить помесячную динамику',
                )
            })
            .finally(() => {
                if (!cancelled) setLoading(false)
            })
        return () => {
            cancelled = true
        }
    }, [open, periodId, indicatorId, scope])

    const hasPlan = useMemo(
        () => (series?.points ?? []).some((point) => point.plan !== null),
        [series],
    )
    const typeCountByMonth = useMemo(
        () => new Map(
            (series?.typeCountPoints ?? []).map((point) => [
                point.month,
                point.uniqueTypeCount,
            ]),
        ),
        [series],
    )
    const hasTypeCounts = typeCountByMonth.size > 0

    const chartData = useMemo(
        () => (series?.points ?? []).map((point) => ({
            month: point.month,
            label: monthName(point.month).slice(0, 3),
            plan: point.plan,
            fact: point.fact,
            ratio: point.ratio,
            uniqueTypeCount: typeCountByMonth.get(point.month) ?? null,
        })),
        [series, typeCountByMonth],
    )

    // Хвост года без единой цифры на диаграмме не нужен: по ТЗ нижняя диаграмма
    // строится «за имеющийся период», а двенадцать делений с пустотой справа
    // сжимают столбики вдвое. Ось X всё равно календарная — просто обрезанная
    // по последнему месяцу, где есть хоть план, хоть факт.
    const visibleData = useMemo(() => {
        let last = 0
        chartData.forEach((point, index) => {
            if (point.plan !== null || point.fact !== null) last = index
        })
        return chartData.slice(0, last + 1)
    }, [chartData])

    const hasRatio = useMemo(
        () => visibleData.some((point) => point.ratio !== null),
        [visibleData],
    )

    const execution: ExecutionSummary | null = series?.executionSummary ?? null
    const breakdown = series?.organizationBreakdown ?? null

    /**
     * Есть ли что рисовать на тепловой карте. От неё зависит весь блок связей:
     * помесячные доли — то немногое, что считается всегда, когда выгрузки
     * загружены. Нет их — нет ни карты, ни рассеяния, ни заголовков к ним.
     */
    const hasHeatmap = useMemo(
        () => (breakdown?.rows ?? []).some(
            (row) => row.monthlyRatios.some((value) => value !== null),
        ),
        [breakdown],
    )
    /**
     * Последний месяц, за который есть факт. Подпись диаграммы называет именно его,
     * а не последний нарисованный столбик: план ТПГГ расписан на все двенадцать
     * месяцев, и заголовок «за январь–декабрь» обещал бы данные за сентябрь–декабрь,
     * которых ещё нет. Сами плановые столбики хвоста года остаются — пустое место
     * рядом с ними и есть тот дефицит, который Николай 28.08.2026 увидел глазами:
     * «я визуально уже вижу дефицит… физически не сможет выйти».
     */
    const lastFactMonth = useMemo(() => {
        let last = 0
        for (const point of visibleData) {
            if (point.fact !== null) last = point.month
        }
        return last || (visibleData[visibleData.length - 1]?.month ?? 1)
    }, [visibleData])

    /**
     * Текст под диаграммой: факт, ровность, прогноз, управленческий вывод.
     *
     * Считается по всем двенадцати месяцам, а не по `visibleData`: прогноз
     * сравнивает с **годовым** планом, и обрезанный ряд занизил бы его ровно
     * на хвост года — тот самый, из-за которого план и не выполняется.
     */
    const conclusion = useMemo(
        () => buildMonthlyConclusion(chartData, breakdown),
        [breakdown, chartData],
    )

    /** Домены осей — линия доли и столбики делят поле по высоте, см. barDomain. */
    const barAxisDomain = useMemo(
        () => barDomain(visibleData.flatMap((point) => [point.plan, point.fact])),
        [visibleData],
    )
    const ratioAxisDomain = useMemo(
        () => lineDomain(visibleData.map((point) => point.ratio)),
        [visibleData],
    )
    const typeAxisDomain = useMemo(
        () => lineDomain(visibleData.map((point) => point.uniqueTypeCount)),
        [visibleData],
    )

    /**
     * Кого именно описывает диаграмма. В образце ТЗ стоит «Курганская область»,
     * но окно открывают и по одной МО — тогда честнее назвать её, иначе
     * заголовок утверждает про регион то, что посчитано по одной больнице.
     *
     * Имя приходит с сервера только при разрезе по МО. До 28.08.2026 оно
     * приходило всегда — и в региональном заголовке стояла первая организация
     * списка, «АО "Курганфармация"».
     */
    const scopeTitle = series?.level === 'organization' && series.organizationName
        ? series.organizationName
        : 'Курганская область'

    /**
     * Подпись точки доли — «январь; 101», как на образце в ТЗ.
     *
     * Своя отрисовка, а не штатный `formatter`: тому доступен только сам
     * процент, а месяц нужно взять из данных по номеру точки. Плашка под
     * текстом нужна там, где линия проходит по столбику: без неё цифра
     * теряется на заливке.
     */
    const renderRatioLabel = (raw: unknown) => {
        const props = raw as {
            x?: number | string
            y?: number | string
            value?: unknown
            index?: number
        }
        const value = typeof props.value === 'number' ? props.value : null
        if (value === null) return null
        const point = visibleData[props.index ?? -1]
        if (!point) return null

        const text = `${monthName(point.month)}; ${Math.round(value)}`
        const x = Number(props.x ?? 0)
        const y = Number(props.y ?? 0)
        // Ширина оценивается по числу знаков: измерить текст до отрисовки
        // в SVG нечем, а плашка по фактической ширине важнее точности.
        const width = text.length * 6.2 + 10
        return (
            <g>
                <rect
                    x={x - width / 2}
                    y={y + 8}
                    width={width}
                    height={18}
                    rx={3}
                    fill="#ffffff"
                    stroke="#cbd5e1"
                />
                <text
                    x={x}
                    y={y + 20}
                    textAnchor="middle"
                    fontSize={11}
                    fill={DYNAMICS_COLORS.ratio}
                >
                    {text}
                </text>
            </g>
        )
    }

    const loadedMonths = series?.loadedMonths ?? []

    return (
        <Dialog open={open} onClose={onClose} maxWidth="lg" fullWidth>
            <DialogTitle sx={{ pb: 1 }}>
                Динамика по месяцам — {indicatorTitle}
            </DialogTitle>
            <DialogContent dividers sx={{ minHeight: 460 }}>
                <TextField
                    select
                    size="small"
                    label="Разрез"
                    value={scope}
                    onChange={(event) => setScope(event.target.value)}
                    sx={{ minWidth: 320, mb: 1.5 }}
                >
                    <MenuItem value={REGION_OPTION}>Регион целиком</MenuItem>
                    {organizations.map((organization) => (
                        <MenuItem
                            key={organization.organizationOid}
                            value={organization.organizationOid}
                        >
                            {organization.organizationName}
                        </MenuItem>
                    ))}
                </TextField>

                {loading && <LinearProgress sx={{ mb: 1 }} />}
                {error && <Alert severity="error" sx={{ mb: 1 }}>{error}</Alert>}

                {!loading && !error && loadedMonths.length === 0 && (
                    <Alert severity="info">
                        Помесячные выгрузки РЭМД за этот период не загружены.
                        Кривая появится после загрузки: «Загрузка данных» →
                        «Выгрузки РЭМД по месяцам».
                    </Alert>
                )}

                {/* Верхний блок — «от факта». По ТЗ он идёт первым: это
                    объективная величина, случаи поданы на оплату и приняты.
                    Нижняя диаграмма считает от плана, то есть от намерения. */}
                {execution && (
                    <Box sx={{ mb: 2 }}>
                        <ChartHeading>
                            {scopeTitle}: доля зарегистрированных СЭМД
                            от фактического количества случаев по ТПГГ ОМС
                            за {monthName(execution.fromMonth)}–
                            {monthName(execution.toMonth)} {' '}
                            по сведениям ТФОМС Курганской области — нарастающим итогом
                        </ChartHeading>
                        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                            <SummaryTile
                                title="случаев по ТПГГ (план)"
                                value={formatNumber(execution.planValue)}
                                color={DYNAMICS_COLORS.plan}
                            />
                            <SummaryTile
                                title="случаев по ТПГГ (факт)"
                                value={formatNumber(execution.factValue)}
                                color={DYNAMICS_COLORS.execution}
                            />
                            <SummaryTile
                                title="зарегистрировано СЭМД"
                                value={formatNumber(execution.semdValue)}
                                color={DYNAMICS_COLORS.semd}
                            />
                            <SummaryTile
                                title="доля СЭМД (от факта)"
                                value={execution.percentOfFact === null
                                    ? '—'
                                    : `${formatNumber(execution.percentOfFact)} %`}
                                color={DYNAMICS_COLORS.ratio}
                            />
                        </Box>
                        {execution.missingMonths.length > 0 && (
                            // Молча показать заниженную долю нельзя: пользователь
                            // решит, что документы не оформляют, хотя выгрузки просто нет.
                            <Alert severity="warning" sx={{ mt: 1 }}>
                                Выгрузки РЭМД нет за {execution.missingMonths
                                    .map((month) => monthName(month))
                                    .join(', ')}
                                {' '}— «зарегистрировано СЭМД» и доля занижены.
                            </Alert>
                        )}
                        <Divider sx={{ mt: 2 }} />
                    </Box>
                )}

                {loadedMonths.length > 0 && (
                    <>
                        {/* У показателя 27 доли нет: его знаменатель — перечень
                            видов, а не объём терпрограммы. Подпись писалась под
                            доли и утверждала неправду; правка методолога
                            от 28.08.2026, там же просьба не писать период —
                            «диаграмма даёт визуальное понимание». */}
                        <ChartHeading>
                            {hasRatio
                                ? `${scopeTitle}: доля зарегистрированных СЭМД
                                    от планового количества случаев по ТПГГ ОМС
                                    за ${monthName(1)}–${monthName(lastFactMonth)}
                                    — помесячно`.replace(/\s+/gu, ' ')
                                : `${scopeTitle}: количество зарегистрированных СЭМД
                                    и их уникальных видов`.replace(/\s+/gu, ' ')}
                        </ChartHeading>
                        <Box sx={{ width: '100%', height: 380 }}>
                            <ResponsiveContainer>
                                <ComposedChart
                                    data={visibleData}
                                    margin={{ top: 28, right: 16, left: 8, bottom: 0 }}
                                >
                                    {/* «Линии и подписи осей убираем» (ТЗ 24.08.2026).
                                        Названия месяцев на образце остались — убраны
                                        засечки и числовая шкала слева, а не подписи
                                        категорий. Оси при этом не удалены, а скрыты:
                                        recharts продолжает по ним масштабировать. */}
                                    <XAxis
                                        dataKey="label"
                                        tickLine={false}
                                        axisLine={{ stroke: '#e2e8f0' }}
                                        tick={{ fontSize: 12, fill: '#475569' }}
                                    />
                                    {/* Домены заданы вручную, а не подобраны recharts:
                                        столбики держатся в нижней части поля, линии —
                                        в верхней, и они больше не накладываются
                                        (правка методолога от 28.08.2026, см. BAR_BAND). */}
                                    <YAxis hide domain={barAxisDomain} />
                                    {hasRatio && (
                                        <YAxis yAxisId="ratio" hide domain={ratioAxisDomain} />
                                    )}
                                    {hasTypeCounts && (
                                        <YAxis yAxisId="types" hide domain={typeAxisDomain} />
                                    )}
                                    <ChartTooltip
                                        formatter={(value, name) => [
                                            typeof value !== 'number'
                                                ? 'нет данных'
                                                : String(name).startsWith('доля')
                                                    ? `${formatNumber(value)} %`
                                                    : formatNumber(value),
                                            String(name),
                                        ]}
                                        labelFormatter={(_label, payload) => {
                                            const point = payload?.[0]?.payload as
                                                { month?: number } | undefined
                                            return typeof point?.month === 'number'
                                                ? monthName(point.month)
                                                : ''
                                        }}
                                    />
                                    <Legend
                                        iconType="square"
                                        wrapperStyle={{ fontSize: 12, paddingTop: 8 }}
                                    />
                                    {/* План ТПГГ идёт первым — просьба Николая
                                        от 28.08.2026: «это ключевая цифра, с которой
                                        всё дальше сравнивается… хотелось бы, чтобы этот
                                        зелёный столбик был бы первым. Ключевая цифра,
                                        она идёт первая». Порядок объявления задаёт
                                        и порядок в группе, и порядок в легенде. */}
                                    {hasPlan && (
                                        <Bar
                                            dataKey="plan"
                                            name="случаев по ТПГГ (план)"
                                            fill={DYNAMICS_COLORS.plan}
                                            maxBarSize={54}
                                        >
                                            <LabelList
                                                dataKey="plan"
                                                position="top"
                                                fontSize={11}
                                                fill="#334155"
                                                formatter={(value: unknown) => (
                                                    typeof value === 'number' ? formatNumber(value) : ''
                                                )}
                                            />
                                        </Bar>
                                    )}
                                    <Bar
                                        dataKey="fact"
                                        name="зарегистрировано СЭМД"
                                        fill={DYNAMICS_COLORS.semd}
                                        maxBarSize={54}
                                    >
                                        <LabelList
                                            dataKey="fact"
                                            position="top"
                                            fontSize={11}
                                            fill="#334155"
                                            formatter={(value: unknown) => (
                                                typeof value === 'number' ? formatNumber(value) : ''
                                            )}
                                        />
                                    </Bar>
                                    {hasRatio && (
                                        // Разрыв на пропущенном месяце сохраняется
                                        // намеренно: `connectNulls` соединил бы прямой
                                        // через месяц без выгрузки, и провал выглядел бы
                                        // как ровная работа.
                                        <Line
                                            yAxisId="ratio"
                                            type="monotone"
                                            dataKey="ratio"
                                            name="доля СЭМД (от плана)"
                                            stroke={DYNAMICS_COLORS.ratio}
                                            strokeWidth={2}
                                            dot={{ r: 3 }}
                                        >
                                            <LabelList
                                                dataKey="ratio"
                                                position="bottom"
                                                fontSize={11}
                                                fill={DYNAMICS_COLORS.ratio}
                                                content={renderRatioLabel}
                                            />
                                        </Line>
                                    )}
                                    {hasTypeCounts && (
                                        <Line
                                            yAxisId="types"
                                            type="monotone"
                                            dataKey="uniqueTypeCount"
                                            name="видов СЭМД нарастающим итогом"
                                            stroke={DYNAMICS_COLORS.typeCount}
                                            strokeWidth={2}
                                            dot={{ r: 3 }}
                                            connectNulls
                                        />
                                    )}
                                </ComposedChart>
                            </ResponsiveContainer>
                        </Box>
                        {/* Вывод идёт сразу под своей диаграммой, а не в конце окна:
                            «прямо мы видим график, внизу пусть будет три строки». */}
                        <ConclusionPanel conclusion={conclusion} />
                    </>
                )}

                {/* Связи между медорганизациями — только в разрезе «регион».
                    При выбранной МО сравнивать её не с кем, а тепловая карта
                    из одной строки это та же кривая, нарисованная хуже. */}
                {/* Заголовок рисуется только вместе со своей диаграммой.
                    Иначе на периоде без выгрузок получалась подпись, под которой
                    пусто, — она обещает картинку, которой не будет. */}
                {breakdown && hasHeatmap && (
                    <>
                        {/* Тепловая карта идёт первой с 28.08.2026. Марина: «задачу
                            со звёздочкой опустить вниз, а тепловую карту поднять —
                            она всё-таки попроще для восприятия». Николай согласился
                            и объяснил порядок: «кто поверхностно с темой знаком —
                            он всё сразу увидит на тепловой карте, кто уже понимает
                            статистику — тому график интереснее». Простое сверху,
                            задача со звёздочкой ниже. */}
                        <Divider sx={{ my: 2 }} />
                        <ChartHeading>
                            Когда оформляют: доля СЭМД от плана по месяцам,
                            строка — медорганизация. Чем насыщеннее клетка,
                            тем выше доля
                        </ChartHeading>
                        <MonthlyRatioHeatmap breakdown={breakdown} />

                        <Divider sx={{ my: 2 }} />
                        <ChartHeading>
                            Кто отстаёт: зарегистрированные СЭМД против случаев,
                            поданных на оплату в ТФОМС, за{' '}
                            {breakdown.fromMonth !== null && breakdown.toMonth !== null
                                ? `${monthName(breakdown.fromMonth)}–${monthName(breakdown.toMonth)}`
                                : 'период среза'}
                            {' '}— точка это медорганизация
                        </ChartHeading>
                        {/* Тут подсказка уместна: помесячные выгрузки есть,
                            не хватает только исполнения — и это поправимо. */}
                        <CasesVsSemdScatter breakdown={breakdown} />
                    </>
                )}
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose}>Закрыть</Button>
            </DialogActions>
        </Dialog>
    )
}
