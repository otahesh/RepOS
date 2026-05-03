import {
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
  Area,
  AreaChart,
} from 'recharts'
import { TOKENS, FONTS } from '../../tokens'

export interface WeightSample {
  date: string
  weight_lbs: number
  source: string
}

interface Props {
  samples: WeightSample[]
  current: { weight_lbs: number; date: string; time: string } | null
  stats: {
    trend_7d_lbs: number | null
    trend_30d_lbs: number | null
    trend_90d_lbs: number | null
    adherence_pct: number | null
    missed_days: string[]
  } | null
}

// 7-day moving average
function computeSmoothed(samples: WeightSample[]): { date: string; avg: number }[] {
  return samples.map((_, i) => {
    const start = Math.max(0, i - 6)
    const slice = samples.slice(start, i + 1)
    const avg = slice.reduce((acc, s) => acc + s.weight_lbs, 0) / slice.length
    return { date: samples[i].date, avg: +avg.toFixed(2) }
  })
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

interface DeltaStatProps {
  label: string
  value: number | null
  lossIsGood?: boolean
}

function DeltaStat({ label, value, lossIsGood = true }: DeltaStatProps) {
  const color = value === null
    ? TOKENS.textMute
    : lossIsGood
    ? (value < 0 ? TOKENS.good : TOKENS.warn)
    : (value > 0 ? TOKENS.good : TOKENS.warn)

  const sign = value !== null && value > 0 ? '+' : ''

  return (
    <div style={{ textAlign: 'right' }}>
      <div style={{
        fontFamily: FONTS.mono,
        fontSize: 10,
        color: TOKENS.textMute,
        letterSpacing: 1.2,
        marginBottom: 2,
      }}>{label}</div>
      <div style={{
        fontFamily: FONTS.mono,
        fontSize: 16,
        fontWeight: 700,
        color,
        fontVariantNumeric: 'tabular-nums',
        whiteSpace: 'nowrap',
      }}>
        {value !== null ? `${sign}${value.toFixed(1)}` : '—'}
        {' '}
        <span style={{ fontSize: 10, color: TOKENS.textMute, fontWeight: 500 }}>lb</span>
      </div>
    </div>
  )
}

interface CustomTooltipProps {
  active?: boolean
  payload?: Array<{ value: number; dataKey: string; payload: { date: string } }>
  label?: string
}

function CustomTooltip({ active, payload }: CustomTooltipProps) {
  if (!active || !payload || payload.length === 0) return null
  const raw = payload.find(p => p.dataKey === 'weight_lbs')
  const avg = payload.find(p => p.dataKey === 'avg')
  const date = payload[0]?.payload?.date ?? ''
  return (
    <div style={{
      background: TOKENS.surface2,
      border: `1px solid ${TOKENS.lineStrong}`,
      borderRadius: 8,
      padding: '8px 12px',
      fontFamily: FONTS.mono,
      fontSize: 11,
    }}>
      <div style={{ color: TOKENS.textMute, marginBottom: 4 }}>{formatDate(date)}</div>
      {raw && (
        <div style={{ color: TOKENS.textDim }}>
          Daily: <span style={{ color: TOKENS.text }}>{raw.value.toFixed(1)} lb</span>
        </div>
      )}
      {avg && (
        <div style={{ color: TOKENS.textDim }}>
          7d avg: <span style={{ color: TOKENS.accent }}>{avg.value.toFixed(1)} lb</span>
        </div>
      )}
    </div>
  )
}

export default function BodyweightChart({ samples, current, stats }: Props) {
  if (samples.length === 0) return null

  const smoothed = computeSmoothed(samples)
  const chartData = samples.map((s, i) => ({
    date: s.date,
    weight_lbs: s.weight_lbs,
    avg: smoothed[i].avg,
  }))

  const weights = samples.map(s => s.weight_lbs)
  const minW = Math.min(...weights) - 2
  const maxW = Math.max(...weights) + 2
  const GOAL = 180

  // Determine tick indices for x-axis (show ~5 labels)
  const tickIndices = samples.length <= 10
    ? samples.map((_, i) => i)
    : [0, Math.floor(samples.length * 0.25), Math.floor(samples.length * 0.5), Math.floor(samples.length * 0.75), samples.length - 1]

  const tickDates = tickIndices.map(i => samples[i].date)

  const adherence = stats?.adherence_pct ?? null
  const missed = stats?.missed_days?.length ?? 0

  return (
    <div style={{
      background: TOKENS.surface,
      borderRadius: 12,
      border: `1px solid ${TOKENS.line}`,
      padding: '18px 20px 14px',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        marginBottom: 14,
        gap: 16,
      }}>
        <div>
          <div style={{
            fontFamily: FONTS.mono,
            fontSize: 10,
            color: TOKENS.textMute,
            letterSpacing: 1.2,
            marginBottom: 4,
          }}>BODYWEIGHT · 90D · APPLE HEALTH</div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, whiteSpace: 'nowrap' }}>
            <span style={{
              fontSize: 30,
              fontWeight: 700,
              fontFamily: FONTS.mono,
              letterSpacing: -0.9,
              fontVariantNumeric: 'tabular-nums',
            }}>{current?.weight_lbs.toFixed(1) ?? '—'}</span>
            <span style={{ fontSize: 12, color: TOKENS.textMute, fontFamily: FONTS.mono }}>lb</span>
            {stats?.trend_90d_lbs !== null && stats?.trend_90d_lbs !== undefined && (
              <span style={{
                fontFamily: FONTS.mono,
                fontSize: 11,
                color: stats.trend_90d_lbs < 0 ? TOKENS.good : TOKENS.warn,
                marginLeft: 6,
                whiteSpace: 'nowrap',
              }}>
                {stats.trend_90d_lbs < 0 ? '↓' : '↑'} {Math.abs(stats.trend_90d_lbs).toFixed(1)} lb · 90d
              </span>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 18, alignItems: 'flex-start' }}>
          <DeltaStat label="7D" value={stats?.trend_7d_lbs ?? null} />
          <DeltaStat label="30D" value={stats?.trend_30d_lbs ?? null} />
          <DeltaStat label="90D" value={stats?.trend_90d_lbs ?? null} />
        </div>
      </div>

      {/* Chart */}
      <ResponsiveContainer width="100%" height={220}>
        <AreaChart data={chartData} margin={{ top: 8, right: 50, bottom: 4, left: 40 }}>
          <defs>
            <linearGradient id="bwGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={TOKENS.accent} stopOpacity={0.28} />
              <stop offset="100%" stopColor={TOKENS.accent} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid
            strokeDasharray="2 3"
            stroke={TOKENS.line}
            vertical={false}
          />
          <XAxis
            dataKey="date"
            ticks={tickDates}
            tickFormatter={formatDate}
            tick={{ fill: TOKENS.textMute, fontFamily: FONTS.mono, fontSize: 9 }}
            axisLine={{ stroke: TOKENS.line }}
            tickLine={false}
          />
          <YAxis
            domain={[minW, maxW]}
            tickFormatter={(v: number) => v.toFixed(0)}
            tick={{ fill: TOKENS.textMute, fontFamily: FONTS.mono, fontSize: 9 }}
            axisLine={false}
            tickLine={false}
            width={38}
          />
          <Tooltip content={<CustomTooltip />} />
          {/* Goal reference line */}
          {GOAL >= minW && GOAL <= maxW && (
            <ReferenceLine
              y={GOAL}
              stroke={TOKENS.good}
              strokeDasharray="4 4"
              strokeOpacity={0.7}
              label={{
                value: 'GOAL 180',
                position: 'insideTopRight',
                fill: TOKENS.good,
                fontFamily: FONTS.mono,
                fontSize: 9,
                offset: 4,
              }}
            />
          )}
          {/* Raw daily dots area (faint fill) */}
          <Area
            type="monotone"
            dataKey="weight_lbs"
            stroke={TOKENS.textMute}
            strokeWidth={0}
            fill="transparent"
            dot={{ r: 1.5, fill: TOKENS.textMute, opacity: 0.5 }}
            activeDot={false}
            isAnimationActive={false}
          />
          {/* 7-day smoothed line */}
          <Area
            type="monotone"
            dataKey="avg"
            stroke={TOKENS.accent}
            strokeWidth={2}
            fill="url(#bwGrad)"
            dot={false}
            activeDot={{ r: 4, fill: '#fff', stroke: TOKENS.accent, strokeWidth: 2 }}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>

      {/* Legend */}
      <div style={{
        display: 'flex',
        gap: 16,
        alignItems: 'center',
        marginTop: 6,
        paddingTop: 10,
        borderTop: `1px solid ${TOKENS.line}`,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{ width: 6, height: 6, borderRadius: 100, background: TOKENS.textMute }} />
          <span style={{ fontFamily: FONTS.mono, fontSize: 10, color: TOKENS.textDim, letterSpacing: 0.6 }}>DAILY · SHORTCUT</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{ width: 14, height: 2, background: TOKENS.accent, borderRadius: 100 }} />
          <span style={{ fontFamily: FONTS.mono, fontSize: 10, color: TOKENS.textDim, letterSpacing: 0.6 }}>7-DAY AVG</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{ width: 14, height: 0, borderTop: `1.5px dashed ${TOKENS.good}` }} />
          <span style={{ fontFamily: FONTS.mono, fontSize: 10, color: TOKENS.textDim, letterSpacing: 0.6 }}>GOAL 180 lb</span>
        </div>
        <div style={{ flex: 1 }} />
        {adherence !== null && (
          <span style={{
            fontFamily: FONTS.mono,
            fontSize: 10,
            color: TOKENS.textMute,
            whiteSpace: 'nowrap',
          }}>
            {samples.length - missed} / {samples.length} DAYS LOGGED · {adherence.toFixed(1)}% ADHERENCE
          </span>
        )}
      </div>
    </div>
  )
}
