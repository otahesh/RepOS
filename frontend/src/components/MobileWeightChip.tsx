import { useEffect, useState, useCallback } from 'react'
import { TOKENS, FONTS } from '../tokens'
import { apiFetch } from '../auth'
import Icon from './Icon'
import type { SyncStatusResponse, WeightRangeResponse } from '../lib/api/health'

// Local aliases for readability
type SyncStatus = SyncStatusResponse
type WeightData = Pick<WeightRangeResponse, 'current' | 'stats'>

export default function MobileWeightChip() {
  const [sync, setSync] = useState<SyncStatus | null>(null)
  const [weight, setWeight] = useState<WeightData | null>(null)

  const fetchData = useCallback(async () => {
    try {
      const [syncRes, weightRes] = await Promise.all([
        apiFetch('/api/health/sync/status'),
        apiFetch('/api/health/weight?range=7d'),
      ])
      if (syncRes.ok) {
        const s: SyncStatus = await syncRes.json()
        setSync(s)
      }
      if (weightRes.ok) {
        const w: WeightData = await weightRes.json()
        setWeight(w)
      }
    } catch {
      // silently fail — chip is non-critical
    }
  }, [])

  useEffect(() => {
    void fetchData()
  }, [fetchData])

  const stateColor = sync
    ? sync.state === 'fresh'
      ? TOKENS.good
      : sync.state === 'stale'
      ? TOKENS.warn
      : TOKENS.danger
    : TOKENS.textMute

  const formatTime = (isoString: string | null) => {
    if (!isoString) return ''
    const d = new Date(isoString)
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }

  const trend = weight?.stats?.trend_7d_lbs ?? null

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 6,
      padding: '7px 10px',
      borderRadius: 6,
      background: TOKENS.surface2,
      border: `1px solid ${TOKENS.line}`,
      flexShrink: 0,
    }}>
      <Icon name="heart" size={12} color={TOKENS.accent} />

      <span style={{
        fontFamily: FONTS.mono,
        fontSize: 10,
        color: TOKENS.textMute,
        letterSpacing: 1.2,
      }}>BW</span>

      <span style={{
        fontFamily: FONTS.mono,
        fontSize: 14,
        fontWeight: 700,
        color: TOKENS.text,
        fontVariantNumeric: 'tabular-nums',
        whiteSpace: 'nowrap',
      }}>
        {weight?.current?.weight_lbs.toFixed(1) ?? '—'}
      </span>

      <span style={{
        fontFamily: FONTS.mono,
        fontSize: 10,
        color: TOKENS.textMute,
        letterSpacing: 0.4,
      }}>lb</span>

      {trend !== null && (
        <span style={{
          fontFamily: FONTS.mono,
          fontSize: 10,
          color: trend < 0 ? TOKENS.good : TOKENS.warn,
          letterSpacing: 0.4,
          marginLeft: 2,
          whiteSpace: 'nowrap',
        }}>
          {trend < 0 ? '↓' : '↑'} {Math.abs(trend).toFixed(1)} · 7D
        </span>
      )}

      {sync?.last_success_at && (
        <span style={{
          fontFamily: FONTS.mono,
          fontSize: 9,
          color: TOKENS.textMute,
          letterSpacing: 0.6,
        }}>
          · {formatTime(sync.last_success_at)}
        </span>
      )}

      {/* Sync state dot */}
      <div style={{
        width: 6,
        height: 6,
        borderRadius: 10,
        background: stateColor,
        boxShadow: `0 0 6px ${stateColor}`,
        marginLeft: 2,
      }} />
    </div>
  )
}
