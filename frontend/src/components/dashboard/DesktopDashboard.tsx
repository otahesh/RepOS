import { useEffect, useState, useCallback } from 'react'
import { TOKENS, FONTS } from '../../tokens'
import { apiFetch } from '../../auth'
import BodyweightChart from './BodyweightChart'
import TrendStats from './TrendStats'
import type { WeightRangeResponse } from '../../lib/api/health'

type WeightData = WeightRangeResponse

export default function DesktopDashboard() {
  const [data, setData] = useState<WeightData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    try {
      setLoading(true)
      const res = await apiFetch('/api/health/weight?range=90d')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json: WeightData = await res.json()
      setData(json)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load data')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void fetchData()
  }, [fetchData])

  if (loading) {
    return (
      <div style={{
        padding: '40px 32px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
      }}>
        <div style={{
          fontFamily: FONTS.mono,
          fontSize: 12,
          color: TOKENS.textMute,
          letterSpacing: 1.2,
        }}>LOADING...</div>
      </div>
    )
  }

  const hasData = data && data.samples && data.samples.length > 0

  return (
    <div style={{
      padding: '24px 32px 28px',
      display: 'flex',
      flexDirection: 'column',
      gap: 20,
      minHeight: '100%',
    }}>
      {/* Page header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        <div>
          <div style={{
            fontFamily: FONTS.mono,
            fontSize: 10,
            color: TOKENS.textMute,
            letterSpacing: 1.4,
            marginBottom: 4,
          }}>HEALTH · BODYWEIGHT</div>
          <h1 style={{
            fontSize: 22,
            fontWeight: 700,
            letterSpacing: -0.4,
            color: TOKENS.text,
          }}>Weight Tracking</h1>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {(['7d', '30d', '90d', '1y', 'all'] as const).map(range => (
            <button
              key={range}
              onClick={() => {/* range switching could be added */}}
              style={{
                height: 32,
                padding: '0 12px',
                borderRadius: 6,
                border: `1px solid ${range === '90d' ? TOKENS.accent : TOKENS.line}`,
                background: range === '90d' ? TOKENS.accentGlow : 'transparent',
                color: range === '90d' ? TOKENS.accent : TOKENS.textDim,
                fontFamily: FONTS.mono,
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: 0.4,
                cursor: 'pointer',
              }}
            >
              {range.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      {/* Error state */}
      {error && (
        <div style={{
          background: `rgba(255, 106, 106, 0.1)`,
          border: `1px solid ${TOKENS.danger}`,
          borderRadius: 10,
          padding: '12px 16px',
          fontFamily: FONTS.mono,
          fontSize: 12,
          color: TOKENS.danger,
          letterSpacing: 0.4,
        }}>
          API ERROR: {error}
        </div>
      )}

      {/* Empty state */}
      {!hasData && !error && (
        <div style={{
          background: TOKENS.surface,
          borderRadius: 12,
          border: `1px solid ${TOKENS.line}`,
          padding: '48px 32px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 12,
          textAlign: 'center',
        }}>
          <div style={{
            fontFamily: FONTS.mono,
            fontSize: 10,
            color: TOKENS.textMute,
            letterSpacing: 1.4,
          }}>NO DATA YET</div>
          <div style={{
            fontSize: 18,
            fontWeight: 600,
            color: TOKENS.textDim,
            letterSpacing: -0.3,
          }}>No weight data yet. Set up Apple Health sync in Settings.</div>
          <a
            href="/settings/integrations"
            style={{
              marginTop: 8,
              height: 36,
              padding: '0 16px',
              borderRadius: 8,
              border: 'none',
              background: TOKENS.accent,
              color: '#fff',
              display: 'inline-flex',
              alignItems: 'center',
              fontFamily: FONTS.ui,
              fontSize: 13,
              fontWeight: 700,
              letterSpacing: 0.3,
              textTransform: 'uppercase',
              textDecoration: 'none',
            }}
          >
            SET UP APPLE HEALTH
          </a>
        </div>
      )}

      {/* Data views */}
      {hasData && data && (
        <>
          <TrendStats
            stats={data.stats ?? {
              trend_7d_lbs: null,
              trend_30d_lbs: null,
              trend_90d_lbs: null,
              adherence_pct: null,
              missed_days: [],
            }}
            current={data.current}
          />
          <BodyweightChart
            samples={data.samples}
            current={data.current}
            stats={data.stats ?? null}
          />
        </>
      )}
    </div>
  )
}
