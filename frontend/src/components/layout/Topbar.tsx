import { useEffect, useState, useCallback } from 'react'
import { TOKENS, FONTS } from '../../tokens'
import { apiFetch } from '../../auth'
import Icon from '../Icon'

interface SyncStatus {
  source: string
  last_success_at: string | null
  state: 'fresh' | 'stale' | 'broken'
}

function formatRelativeTime(isoString: string | null): string {
  if (!isoString) return 'never'
  const date = new Date(isoString)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffH = Math.floor(diffMs / (1000 * 60 * 60))
  const diffM = Math.floor(diffMs / (1000 * 60))
  if (diffM < 60) return `${diffM}m ago`
  if (diffH < 24) return `${diffH}h ago`
  const diffD = Math.floor(diffH / 24)
  return `${diffD}d ago`
}

function formatTime(isoString: string | null): string {
  if (!isoString) return '--:--'
  const date = new Date(isoString)
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export default function Topbar() {
  const [sync, setSync] = useState<SyncStatus | null>(null)
  const [error, setError] = useState(false)

  const fetchSync = useCallback(async () => {
    try {
      const res = await apiFetch('/api/health/sync/status')
      if (!res.ok) throw new Error('non-ok')
      const data: SyncStatus = await res.json()
      setSync(data)
      setError(false)
    } catch {
      setError(true)
    }
  }, [])

  useEffect(() => {
    void fetchSync()
    // Poll every 60 seconds — sync pill is cacheable 60s per spec
    const id = setInterval(() => void fetchSync(), 60_000)
    return () => clearInterval(id)
  }, [fetchSync])

  const stateColor = sync
    ? sync.state === 'fresh'
      ? TOKENS.good
      : sync.state === 'stale'
      ? TOKENS.warn
      : TOKENS.danger
    : TOKENS.textMute

  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).toUpperCase()

  return (
    <header style={{
      borderBottom: `1px solid ${TOKENS.line}`,
      padding: '0 32px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      height: 72,
      flexShrink: 0,
    }}>
      <div>
        <div style={{
          fontFamily: FONTS.mono,
          fontSize: 10,
          color: TOKENS.textMute,
          letterSpacing: 1.4,
          marginBottom: 2,
        }}>{today}</div>
        <div style={{
          fontSize: 22,
          fontWeight: 700,
          letterSpacing: -0.4,
          whiteSpace: 'nowrap',
        }}>
          Let's move.
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        {/* Sync status pill */}
        <div style={{
          height: 36,
          padding: '0 12px',
          borderRadius: 8,
          border: `1px solid ${TOKENS.line}`,
          background: TOKENS.surface,
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          fontFamily: FONTS.mono,
          fontSize: 11,
          whiteSpace: 'nowrap',
        }}>
          <div style={{
            width: 7,
            height: 7,
            borderRadius: 10,
            background: stateColor,
            boxShadow: `0 0 8px ${stateColor}`,
          }} />
          {error || !sync ? (
            <span style={{ color: TOKENS.textMute, letterSpacing: 0.6 }}>
              {error ? 'SYNC ERROR' : 'LOADING...'}
            </span>
          ) : (
            <>
              <span style={{ color: TOKENS.textMute, letterSpacing: 0.6 }}>
                {sync.state.toUpperCase()}
              </span>
              <span style={{ color: TOKENS.text, fontVariantNumeric: 'tabular-nums' }}>
                {formatTime(sync.last_success_at)}
              </span>
              <span style={{ color: TOKENS.textMute }}>·</span>
              <span style={{ color: TOKENS.textDim }}>
                {formatRelativeTime(sync.last_success_at).toUpperCase()}
              </span>
            </>
          )}
        </div>

        {/* Week button */}
        <button style={{
          height: 36,
          padding: '0 14px',
          borderRadius: 8,
          border: `1px solid ${TOKENS.lineStrong}`,
          background: TOKENS.surface2,
          color: TOKENS.textDim,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          fontFamily: FONTS.ui,
          fontSize: 13,
          fontWeight: 500,
          whiteSpace: 'nowrap',
        }}>
          <Icon name="calendar" size={14} color={TOKENS.textDim} />
          WEEK 3 · APR 06 – 12
        </button>

        {/* CTA */}
        <button style={{
          height: 36,
          padding: '0 16px',
          borderRadius: 8,
          border: 'none',
          background: TOKENS.accent,
          color: '#fff',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          fontFamily: FONTS.ui,
          fontSize: 13,
          fontWeight: 700,
          letterSpacing: 0.3,
          textTransform: 'uppercase',
          boxShadow: `0 4px 14px -4px ${TOKENS.accentDim}`,
        }}>
          <Icon name="flame" size={14} color="#fff" />
          START SESSION
        </button>
      </div>
    </header>
  )
}
