import { TOKENS, FONTS } from '../../tokens'
import Icon from '../Icon'

export interface TokenRow {
  id: string
  label: string
  created_at: string
  last_used_at: string | null
}

interface Props {
  tokens: TokenRow[]
  onRevoke: (id: string) => void
  revoking: string | null
}

function formatDate(isoString: string | null): string {
  if (!isoString) return 'Never'
  const d = new Date(isoString)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function TokenTable({ tokens, onRevoke, revoking }: Props) {
  if (tokens.length === 0) {
    return (
      <div style={{
        padding: '24px 20px',
        textAlign: 'center',
        fontFamily: FONTS.mono,
        fontSize: 12,
        color: TOKENS.textMute,
        letterSpacing: 0.6,
        background: TOKENS.bg,
        borderRadius: 8,
        border: `1px solid ${TOKENS.line}`,
      }}>
        NO TOKENS. GENERATE ONE TO CONNECT YOUR SHORTCUT.
      </div>
    )
  }

  return (
    <div style={{
      background: TOKENS.bg,
      borderRadius: 8,
      border: `1px solid ${TOKENS.line}`,
      overflowX: 'auto',
    }}>
      {/* Table header */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 140px 140px 80px',
        padding: '8px 16px',
        borderBottom: `1px solid ${TOKENS.line}`,
        minWidth: 480,
      }}>
        {['LABEL', 'CREATED', 'LAST USED', ''].map(col => (
          <div key={col} style={{
            fontFamily: FONTS.mono,
            fontSize: 9,
            color: TOKENS.textMute,
            letterSpacing: 1.2,
          }}>{col}</div>
        ))}
      </div>

      {/* Rows */}
      {tokens.map((token, i) => (
        <div
          key={token.id}
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 140px 140px 80px',
            padding: '12px 16px',
            alignItems: 'center',
            borderTop: i > 0 ? `1px solid ${TOKENS.line}` : 'none',
            background: 'transparent',
            minWidth: 480,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Icon name="key" size={13} color={TOKENS.textMute} />
            <div>
              <div style={{
                fontSize: 13,
                fontWeight: 600,
                color: TOKENS.text,
              }}>{token.label}</div>
              <div style={{
                fontFamily: FONTS.mono,
                fontSize: 10,
                color: TOKENS.textMute,
                marginTop: 1,
              }}>••••••••••••••••</div>
            </div>
          </div>

          <div style={{
            fontFamily: FONTS.mono,
            fontSize: 11,
            color: TOKENS.textDim,
          }}>{formatDate(token.created_at)}</div>

          <div style={{
            fontFamily: FONTS.mono,
            fontSize: 11,
            color: token.last_used_at ? TOKENS.textDim : TOKENS.textMute,
          }}>{formatDate(token.last_used_at)}</div>

          <div>
            <button
              onClick={() => onRevoke(token.id)}
              disabled={revoking === token.id}
              style={{
                height: 28,
                padding: '0 10px',
                borderRadius: 6,
                border: `1px solid rgba(255,106,106,0.3)`,
                background: 'rgba(255,106,106,0.08)',
                color: TOKENS.danger,
                display: 'flex',
                alignItems: 'center',
                gap: 5,
                fontFamily: FONTS.mono,
                fontSize: 10,
                fontWeight: 600,
                letterSpacing: 0.4,
                cursor: revoking === token.id ? 'not-allowed' : 'pointer',
                opacity: revoking === token.id ? 0.5 : 1,
              }}
            >
              <Icon name="trash" size={10} color={TOKENS.danger} />
              {revoking === token.id ? '...' : 'REVOKE'}
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}
