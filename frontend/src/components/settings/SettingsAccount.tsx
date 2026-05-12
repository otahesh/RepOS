import { TOKENS, FONTS } from '../../tokens'
import { useCurrentUser } from '../../auth'

export default function SettingsAccount() {
  const { user } = useCurrentUser()

  return (
    <div style={{
      padding: '24px 32px',
      display: 'flex',
      flexDirection: 'column',
      gap: 16,
      maxWidth: 640,
    }}>
      <div>
        <div style={{
          fontFamily: FONTS.mono,
          fontSize: 10,
          color: TOKENS.textMute,
          letterSpacing: 1.2,
          marginBottom: 4,
        }}>SETTINGS</div>
        <h2 style={{
          fontSize: 22,
          fontWeight: 700,
          letterSpacing: -0.5,
          color: TOKENS.text,
        }}>Account</h2>
      </div>

      <div style={{
        background: TOKENS.surface,
        borderRadius: 12,
        border: `1px solid ${TOKENS.line}`,
        padding: '20px 22px',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
      }}>
        {[
          { k: 'EMAIL', v: user?.email ?? '—' },
          { k: 'DISPLAY NAME', v: user?.display_name?.trim() || '—' },
          { k: 'AUTH MODE', v: 'Cloudflare Access' },
        ].map((row, i) => (
          <div key={row.k} style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '8px 0',
            borderTop: i === 0 ? 'none' : `1px solid ${TOKENS.line}`,
          }}>
            <span style={{
              fontFamily: FONTS.mono,
              fontSize: 10,
              color: TOKENS.textMute,
              letterSpacing: 1.2,
            }}>{row.k}</span>
            <span style={{
              fontFamily: FONTS.mono,
              fontSize: 12,
              color: TOKENS.text,
            }}>{row.v}</span>
          </div>
        ))}
      </div>

      <div style={{
        fontSize: 13,
        color: TOKENS.textDim,
        lineHeight: 1.5,
      }}>
        Profile editing and session management land in upcoming Beta waves. Account state is sourced from Cloudflare Access.
      </div>
    </div>
  )
}
