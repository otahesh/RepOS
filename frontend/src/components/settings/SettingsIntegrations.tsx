import { useEffect, useState, useCallback } from 'react'
import { TOKENS, FONTS } from '../../tokens'
import { apiFetch, useCurrentUser } from '../../auth'
import { useIsMobile } from '../../lib/useIsMobile'
import Icon from '../Icon'
import TokenTable, { TokenRow } from './TokenTable'
import GenerateTokenModal from './GenerateTokenModal'

interface SyncStatus {
  source: string
  last_success_at: string | null
  state: 'fresh' | 'stale' | 'broken'
}

const INTEGRATIONS = [
  { name: 'Apple Health', sub: 'Bodyweight · daily', status: 'connected' as const, primary: true },
  { name: 'Strava', sub: 'Cardio sessions', status: 'available' as const },
  { name: 'WHOOP', sub: 'Recovery & strain', status: 'available' as const },
  { name: 'Garmin Connect', sub: 'Heart-rate · GPS', status: 'available' as const },
  { name: 'Oura', sub: 'Sleep · HRV', status: 'available' as const },
]

function formatDateTime(isoString: string | null): string {
  if (!isoString) return '—'
  const d = new Date(isoString)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) +
    ' · ' +
    d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export default function SettingsIntegrations() {
  const isMobile = useIsMobile()
  const { user } = useCurrentUser()
  // Transition mode: when CF Access feature flag is off, the API is in admin-key
  // mode and requires `?user_id=` / body `user_id`. We detect by the placeholder
  // sentinel email. Once CF Access is fully on, this branch goes dead.
  const isLegacyAdminMode = user?.email === 'placeholder@local'

  const [sync, setSync] = useState<SyncStatus | null>(null)
  const [syncLoading, setSyncLoading] = useState(true)
  const [tokens, setTokens] = useState<TokenRow[]>([])
  const [tokensLoading, setTokensLoading] = useState(true)
  const [tokensError, setTokensError] = useState<string | null>(null)
  const [generating, setGenerating] = useState(false)
  const [generateLabel, setGenerateLabel] = useState('iOS Shortcut')
  const [generatedToken, setGeneratedToken] = useState<string | null>(null)
  const [revoking, setRevoking] = useState<string | null>(null)

  const fetchSync = useCallback(async () => {
    try {
      const res = await apiFetch('/api/health/sync/status')
      if (res.ok) {
        const data: SyncStatus = await res.json()
        setSync(data)
      }
    } catch {
      /* ignore */
    } finally {
      setSyncLoading(false)
    }
  }, [])

  const fetchTokens = useCallback(async () => {
    if (!user) return
    try {
      setTokensLoading(true)
      const path = isLegacyAdminMode
        ? `/api/tokens?user_id=${encodeURIComponent(user.id)}`
        : '/api/tokens'
      const res = await apiFetch(path)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data: TokenRow[] = await res.json()
      setTokens(data)
      setTokensError(null)
    } catch (err) {
      setTokensError(err instanceof Error ? err.message : 'Failed to load tokens')
    } finally {
      setTokensLoading(false)
    }
  }, [user, isLegacyAdminMode])

  useEffect(() => {
    void fetchSync()
    void fetchTokens()
  }, [fetchSync, fetchTokens])

  const handleGenerate = async () => {
    if (generating || !user) return
    setGenerating(true)
    try {
      const body = isLegacyAdminMode
        ? { user_id: user.id, label: generateLabel.trim() || 'iOS Shortcut' }
        : { label: generateLabel.trim() || 'iOS Shortcut' }
      const res = await apiFetch('/api/tokens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json() as { token: string; id: string }
      setGeneratedToken(data.token)
      await fetchTokens()
    } catch (err) {
      alert(`Failed to generate token: ${err instanceof Error ? err.message : 'Unknown error'}`)
    } finally {
      setGenerating(false)
    }
  }

  const handleRevoke = async (id: string) => {
    if (revoking || !user) return
    setRevoking(id)
    try {
      const path = isLegacyAdminMode
        ? `/api/tokens/${id}?user_id=${encodeURIComponent(user.id)}`
        : `/api/tokens/${id}`
      const res = await apiFetch(path, { method: 'DELETE' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setTokens(prev => prev.filter(t => t.id !== id))
    } catch (err) {
      alert(`Failed to revoke token: ${err instanceof Error ? err.message : 'Unknown error'}`)
    } finally {
      setRevoking(null)
    }
  }

  const stateColor = sync
    ? sync.state === 'fresh' ? TOKENS.good
    : sync.state === 'stale' ? TOKENS.warn
    : TOKENS.danger
    : TOKENS.textMute

  const stateLabel = sync
    ? sync.state === 'fresh' ? 'Healthy'
    : sync.state === 'stale' ? 'Stale'
    : 'Broken'
    : '—'

  return (
    <div style={{
      padding: isMobile ? '16px' : '24px 32px',
      display: 'grid',
      gridTemplateColumns: isMobile ? '1fr' : '320px minmax(0, 1fr)',
      gap: isMobile ? 16 : 24,
      minHeight: '100%',
    }}>
      {/* Generated token modal */}
      {generatedToken && (
        <GenerateTokenModal
          token={generatedToken}
          onClose={() => setGeneratedToken(null)}
        />
      )}

      {/* Left: integrations list */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{
          fontFamily: FONTS.mono,
          fontSize: 10,
          color: TOKENS.textMute,
          letterSpacing: 1.2,
          marginBottom: 4,
          padding: '0 4px',
        }}>SOURCES</div>

        {INTEGRATIONS.map(intg => (
          <div key={intg.name} style={{
            padding: '12px 14px',
            borderRadius: 10,
            background: intg.primary ? TOKENS.surface : 'transparent',
            border: `1px solid ${intg.primary ? TOKENS.lineStrong : TOKENS.line}`,
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            position: 'relative',
          }}>
            {intg.primary && (
              <div style={{
                position: 'absolute',
                left: 0,
                top: 10,
                bottom: 10,
                width: 2,
                background: TOKENS.accent,
                borderRadius: 100,
              }} />
            )}
            {/* Icon */}
            <div style={{
              width: 36,
              height: 36,
              borderRadius: 8,
              background: intg.status === 'connected'
                ? `linear-gradient(135deg, ${TOKENS.accent} 0%, ${TOKENS.heat3} 100%)`
                : TOKENS.surface2,
              border: `1px solid ${TOKENS.line}`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontFamily: FONTS.mono,
              fontSize: 14,
              fontWeight: 700,
              color: intg.status === 'connected' ? '#fff' : TOKENS.textMute,
              flexShrink: 0,
            }}>
              {intg.name[0]}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: TOKENS.text }}>{intg.name}</div>
              <div style={{
                fontFamily: FONTS.mono,
                fontSize: 10,
                color: TOKENS.textMute,
                letterSpacing: 0.4,
                marginTop: 1,
              }}>{intg.sub}</div>
            </div>
            {intg.status === 'connected' ? (
              <span style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '3px 8px',
                borderRadius: 4,
                fontFamily: FONTS.mono,
                fontSize: 10,
                letterSpacing: 0.6,
                textTransform: 'uppercase' as const,
                color: TOKENS.good,
                background: 'rgba(107,226,139,0.12)',
                fontWeight: 500,
                whiteSpace: 'nowrap' as const,
              }}>ON</span>
            ) : (
              <span style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '3px 8px',
                borderRadius: 4,
                fontFamily: FONTS.mono,
                fontSize: 10,
                letterSpacing: 0.6,
                textTransform: 'uppercase' as const,
                color: TOKENS.textDim,
                background: TOKENS.surface2,
                fontWeight: 500,
                whiteSpace: 'nowrap' as const,
              }}>ADD</span>
            )}
          </div>
        ))}
      </div>

      {/* Right: Apple Health detail + token management */}
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
        minHeight: 0,
        overflow: 'hidden',
      }}>
        {/* Apple Health integration card */}
        <div style={{
          background: TOKENS.surface,
          borderRadius: 12,
          border: `1px solid ${TOKENS.line}`,
          padding: '20px 22px',
        }}>
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            marginBottom: 14,
            flexWrap: 'wrap',
            gap: 12,
          }}>
            <div>
              <div style={{
                fontFamily: FONTS.mono,
                fontSize: 10,
                color: TOKENS.textMute,
                letterSpacing: 1.2,
                marginBottom: 4,
              }}>INTEGRATION</div>
              <h2 style={{
                fontSize: 22,
                fontWeight: 700,
                letterSpacing: -0.5,
                color: TOKENS.text,
              }}>Apple Health</h2>
              <p style={{
                fontSize: 13,
                color: TOKENS.textDim,
                marginTop: 4,
                maxWidth: 520,
                lineHeight: 1.5,
              }}>
                Once-daily bodyweight push from an iOS Shortcut. Reads your morning weight from Health and posts it to RepOS. No reverse-write.
              </p>
            </div>
            <button style={{
              height: 34,
              padding: '0 14px',
              borderRadius: 8,
              border: `1px solid ${TOKENS.lineStrong}`,
              background: TOKENS.surface2,
              color: TOKENS.text,
              fontFamily: FONTS.ui,
              fontSize: 12,
              fontWeight: 600,
              letterSpacing: 0.3,
              textTransform: 'uppercase',
              whiteSpace: 'nowrap',
            }}>DISCONNECT</button>
          </div>

          {/* Status grid */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
            borderTop: `1px solid ${TOKENS.line}`,
          }}>
            {[
              { k: 'STATUS', v: syncLoading ? '...' : stateLabel, c: stateColor },
              { k: 'LAST FIRED', v: syncLoading ? '...' : formatDateTime(sync?.last_success_at ?? null) },
              { k: 'CADENCE', v: 'Daily · 7:30' },
              { k: 'STALE AFTER', v: '36 h' },
            ].map((s, i) => (
              <div key={s.k} style={{
                padding: '14px 16px',
                borderRight: !isMobile && i < 3 ? `1px solid ${TOKENS.line}` : 'none',
                borderBottom: isMobile && i < 3 ? `1px solid ${TOKENS.line}` : 'none',
              }}>
                <div style={{
                  fontFamily: FONTS.mono,
                  fontSize: 9,
                  color: TOKENS.textMute,
                  letterSpacing: 1.2,
                  marginBottom: 6,
                }}>{s.k}</div>
                <div style={{
                  fontFamily: FONTS.mono,
                  fontSize: 14,
                  fontWeight: 600,
                  color: s.c ?? TOKENS.text,
                  whiteSpace: 'nowrap',
                }}>{s.v}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Sync spec reference card */}
        <div style={{
          background: TOKENS.surface,
          borderRadius: 12,
          border: `1px solid ${TOKENS.line}`,
          padding: '16px 18px',
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
        }}>
          <div style={{
            fontFamily: FONTS.mono,
            fontSize: 10,
            color: TOKENS.textMute,
            letterSpacing: 1.2,
            marginBottom: 2,
          }}>SYNC SOURCE</div>
          <div style={{ fontSize: 14, fontWeight: 600, color: TOKENS.text }}>iOS Shortcut → Apple Health</div>

          {/* Code snippet */}
          <div style={{
            background: TOKENS.bg,
            borderRadius: 8,
            border: `1px solid ${TOKENS.line}`,
            padding: '10px 12px',
            fontFamily: FONTS.mono,
            fontSize: 11,
            color: TOKENS.textDim,
            lineHeight: 1.6,
          }}>
            <div style={{ color: TOKENS.accent, fontSize: 10, letterSpacing: 1, marginBottom: 6 }}>
              POST /api/health/weight
            </div>
            <div>{'{'}</div>
            <div style={{ paddingLeft: 14 }}>
              <span style={{ color: TOKENS.textMute }}>"weight_lbs":</span>{' '}
              <span style={{ color: TOKENS.text }}>185.4</span>,
            </div>
            <div style={{ paddingLeft: 14 }}>
              <span style={{ color: TOKENS.textMute }}>"date":</span>{' '}
              <span style={{ color: TOKENS.good }}>"2026-04-26"</span>,
            </div>
            <div style={{ paddingLeft: 14 }}>
              <span style={{ color: TOKENS.textMute }}>"time":</span>{' '}
              <span style={{ color: TOKENS.good }}>"07:32:00"</span>,
            </div>
            <div style={{ paddingLeft: 14 }}>
              <span style={{ color: TOKENS.textMute }}>"source":</span>{' '}
              <span style={{ color: TOKENS.good }}>"Apple Health"</span>
            </div>
            <div>{'}'}</div>
          </div>

          {/* Spec rows */}
          {[
            { k: 'STALE AFTER', v: '36 h · absorbs drift' },
            { k: 'DEDUPE KEY', v: '(date, source)' },
            { k: 'WEIGHT RANGE', v: '50.0 – 600.0 lb' },
          ].map(row => (
            <div key={row.k} style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '6px 0',
              borderTop: `1px solid ${TOKENS.line}`,
            }}>
              <span style={{
                fontFamily: FONTS.mono,
                fontSize: 10,
                color: TOKENS.textMute,
                letterSpacing: 1.2,
                whiteSpace: 'nowrap',
              }}>{row.k}</span>
              <span style={{
                fontFamily: FONTS.mono,
                fontSize: 11,
                color: TOKENS.text,
                whiteSpace: 'nowrap',
              }}>{row.v}</span>
            </div>
          ))}
        </div>

        {/* Device tokens card */}
        <div style={{
          background: TOKENS.surface,
          borderRadius: 12,
          border: `1px solid ${TOKENS.line}`,
          padding: '20px 22px',
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
        }}>
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}>
            <div>
              <div style={{
                fontFamily: FONTS.mono,
                fontSize: 10,
                color: TOKENS.textMute,
                letterSpacing: 1.2,
                marginBottom: 4,
              }}>DEVICE TOKENS</div>
              <h3 style={{
                fontSize: 16,
                fontWeight: 600,
                color: TOKENS.text,
                letterSpacing: -0.3,
              }}>Active API tokens</h3>
            </div>

            {/* Generate token form */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                value={generateLabel}
                onChange={e => setGenerateLabel(e.target.value)}
                placeholder="Token label"
                style={{
                  height: 34,
                  padding: '0 12px',
                  borderRadius: 8,
                  border: `1px solid ${TOKENS.lineStrong}`,
                  background: TOKENS.bg,
                  color: TOKENS.text,
                  fontFamily: FONTS.ui,
                  fontSize: 13,
                  outline: 'none',
                  width: 160,
                }}
              />
              <button
                onClick={() => void handleGenerate()}
                disabled={generating}
                style={{
                  height: 34,
                  padding: '0 14px',
                  borderRadius: 8,
                  border: 'none',
                  background: generating ? TOKENS.surface3 : TOKENS.accent,
                  color: '#fff',
                  fontFamily: FONTS.ui,
                  fontSize: 13,
                  fontWeight: 700,
                  letterSpacing: 0.3,
                  textTransform: 'uppercase',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 7,
                  cursor: generating ? 'not-allowed' : 'pointer',
                  whiteSpace: 'nowrap',
                }}
              >
                <Icon name="plus" size={13} color="#fff" strokeWidth={2} />
                {generating ? 'GENERATING...' : 'GENERATE TOKEN'}
              </button>
            </div>
          </div>

          {/* Token table */}
          {tokensLoading ? (
            <div style={{
              fontFamily: FONTS.mono,
              fontSize: 11,
              color: TOKENS.textMute,
              letterSpacing: 0.6,
              padding: '12px 0',
            }}>LOADING TOKENS...</div>
          ) : tokensError ? (
            <div style={{
              fontFamily: FONTS.mono,
              fontSize: 11,
              color: TOKENS.danger,
              letterSpacing: 0.4,
            }}>
              Error: {tokensError}
              <button
                onClick={() => void fetchTokens()}
                style={{
                  marginLeft: 12,
                  background: 'transparent',
                  border: 'none',
                  color: TOKENS.accent,
                  fontFamily: FONTS.mono,
                  fontSize: 11,
                  cursor: 'pointer',
                }}
              >RETRY</button>
            </div>
          ) : (
            <TokenTable
              tokens={tokens}
              onRevoke={(id) => void handleRevoke(id)}
              revoking={revoking}
            />
          )}
        </div>
      </div>
    </div>
  )
}
