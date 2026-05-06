import { TOKENS, FONTS } from '../../tokens'
import Icon from '../Icon'

interface Props {
  stats: {
    trend_7d_lbs: number | null
    trend_30d_lbs: number | null
    trend_90d_lbs: number | null
    adherence_pct: number | null
    missed_days: string[]
  }
  current: { weight_lbs: number; date: string; time: string } | null
}

interface StatCardProps {
  label: string
  value: string
  subtext: string
  color: string
  showArrow?: boolean
}

function StatCard({ label, value, subtext, color, showArrow = false }: StatCardProps) {
  return (
    <div style={{
      background: TOKENS.surface,
      borderRadius: 12,
      border: `1px solid ${TOKENS.line}`,
      padding: '16px 18px',
      display: 'flex',
      flexDirection: 'column',
      gap: 6,
      flex: 1,
    }}>
      <div style={{
        fontFamily: FONTS.mono,
        fontSize: 10,
        color: TOKENS.textMute,
        letterSpacing: 1.2,
      }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
        {showArrow && (
          <Icon
            name="arrowUp"
            size={12}
            color={color}
            strokeWidth={2}
          />
        )}
        <span style={{
          fontFamily: FONTS.mono,
          fontSize: 24,
          fontWeight: 700,
          color,
          letterSpacing: -0.8,
          fontVariantNumeric: 'tabular-nums',
        }}>{value}</span>
      </div>
      <div style={{
        fontFamily: FONTS.mono,
        fontSize: 10,
        color: TOKENS.textMute,
        letterSpacing: 0.4,
      }}>{subtext}</div>
    </div>
  )
}

export default function TrendStats({ stats, current }: Props) {
  const fmt = (v: number | null, suffix = 'lb') => {
    if (v === null) return '—'
    const sign = v > 0 ? '+' : ''
    return `${sign}${v.toFixed(1)} ${suffix}`
  }

  const deltaColor = (v: number | null) => {
    if (v === null) return TOKENS.textMute
    return v < 0 ? TOKENS.good : TOKENS.warn
  }

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
      gap: 14,
    }}>
      {/* Current weight */}
      <div style={{
        background: TOKENS.surface,
        borderRadius: 12,
        border: `1px solid ${TOKENS.line}`,
        padding: '16px 18px',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}>
        <div style={{
          fontFamily: FONTS.mono,
          fontSize: 10,
          color: TOKENS.textMute,
          letterSpacing: 1.2,
        }}>CURRENT WEIGHT</div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
          <span style={{
            fontFamily: FONTS.mono,
            fontSize: 32,
            fontWeight: 700,
            color: TOKENS.text,
            letterSpacing: -1,
            fontVariantNumeric: 'tabular-nums',
          }}>
            {current?.weight_lbs.toFixed(1) ?? '—'}
          </span>
          <span style={{
            fontFamily: FONTS.mono,
            fontSize: 12,
            color: TOKENS.textMute,
          }}>lb</span>
        </div>
        <div style={{
          fontFamily: FONTS.mono,
          fontSize: 10,
          color: TOKENS.textMute,
        }}>
          {current ? `${current.date} · ${current.time.slice(0, 5)}` : 'No data'}
        </div>
      </div>

      <StatCard
        label="7-DAY TREND"
        value={fmt(stats.trend_7d_lbs)}
        subtext="vs 7 days prior"
        color={deltaColor(stats.trend_7d_lbs)}
        showArrow={stats.trend_7d_lbs !== null && stats.trend_7d_lbs > 0}
      />
      <StatCard
        label="30-DAY TREND"
        value={fmt(stats.trend_30d_lbs)}
        subtext="vs 30 days prior"
        color={deltaColor(stats.trend_30d_lbs)}
        showArrow={stats.trend_30d_lbs !== null && stats.trend_30d_lbs > 0}
      />

      {/* Adherence */}
      <div style={{
        background: TOKENS.surface,
        borderRadius: 12,
        border: `1px solid ${TOKENS.line}`,
        padding: '16px 18px',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}>
        <div style={{
          fontFamily: FONTS.mono,
          fontSize: 10,
          color: TOKENS.textMute,
          letterSpacing: 1.2,
        }}>ADHERENCE · 90D</div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
          <span style={{
            fontFamily: FONTS.mono,
            fontSize: 24,
            fontWeight: 700,
            color: stats.adherence_pct !== null && stats.adherence_pct >= 90
              ? TOKENS.good
              : stats.adherence_pct !== null && stats.adherence_pct >= 75
              ? TOKENS.warn
              : TOKENS.danger,
            letterSpacing: -0.8,
            fontVariantNumeric: 'tabular-nums',
          }}>
            {stats.adherence_pct !== null ? `${stats.adherence_pct.toFixed(1)}` : '—'}
          </span>
          <span style={{
            fontFamily: FONTS.mono,
            fontSize: 12,
            color: TOKENS.textMute,
          }}>%</span>
        </div>
        <div style={{
          fontFamily: FONTS.mono,
          fontSize: 10,
          color: TOKENS.textMute,
        }}>
          {stats.missed_days.length > 0
            ? `${stats.missed_days.length} missed day${stats.missed_days.length > 1 ? 's' : ''}`
            : 'No missed days'}
        </div>
      </div>
    </div>
  )
}
