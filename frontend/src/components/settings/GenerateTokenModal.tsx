import { useState } from 'react'
import { TOKENS, FONTS } from '../../tokens'
import Icon from '../Icon'

interface Props {
  token: string
  onClose: () => void
}

export default function GenerateTokenModal({ token, onClose }: Props) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(token)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // fallback — select text
    }
  }

  return (
    // Backdrop
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.6)',
        backdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
    >
      {/* Modal */}
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: TOKENS.surface,
          border: `1px solid ${TOKENS.lineStrong}`,
          borderRadius: 16,
          padding: '28px 28px',
          width: 480,
          display: 'flex',
          flexDirection: 'column',
          gap: 20,
          boxShadow: '0 40px 80px rgba(0,0,0,0.4)',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{
              fontFamily: FONTS.mono,
              fontSize: 10,
              color: TOKENS.good,
              letterSpacing: 1.4,
              marginBottom: 6,
            }}>TOKEN GENERATED</div>
            <h2 style={{
              fontSize: 20,
              fontWeight: 700,
              letterSpacing: -0.4,
              color: TOKENS.text,
            }}>Copy your token</h2>
            <p style={{
              fontSize: 13,
              color: TOKENS.textDim,
              marginTop: 6,
              lineHeight: 1.5,
            }}>
              This token will only be shown <strong style={{ color: TOKENS.text }}>once</strong>.
              Store it securely. It cannot be recovered.
            </p>
          </div>
          <button
            onClick={onClose}
            style={{
              width: 30,
              height: 30,
              borderRadius: 6,
              border: `1px solid ${TOKENS.line}`,
              background: 'transparent',
              color: TOKENS.textMute,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <Icon name="minus" size={12} color={TOKENS.textMute} />
          </button>
        </div>

        {/* Token display */}
        <div style={{
          background: TOKENS.bg,
          borderRadius: 10,
          border: `1px solid ${TOKENS.line}`,
          padding: '14px 16px',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
        }}>
          <span style={{
            fontFamily: FONTS.mono,
            fontSize: 13,
            color: TOKENS.text,
            wordBreak: 'break-all',
            flex: 1,
            lineHeight: 1.5,
          }}>{token}</span>
          <button
            onClick={() => void handleCopy()}
            style={{
              height: 32,
              padding: '0 12px',
              borderRadius: 6,
              border: `1px solid ${copied ? TOKENS.good : TOKENS.lineStrong}`,
              background: copied ? 'rgba(107,226,139,0.12)' : TOKENS.surface2,
              color: copied ? TOKENS.good : TOKENS.textDim,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              fontFamily: FONTS.mono,
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: 0.4,
              whiteSpace: 'nowrap',
              flexShrink: 0,
            }}
          >
            <Icon name={copied ? 'check' : 'copy'} size={12} color={copied ? TOKENS.good : TOKENS.textDim} />
            {copied ? 'COPIED' : 'COPY'}
          </button>
        </div>

        {/* Warning */}
        <div style={{
          background: 'rgba(245,181,68,0.08)',
          border: `1px solid rgba(245,181,68,0.3)`,
          borderRadius: 8,
          padding: '10px 14px',
          display: 'flex',
          alignItems: 'flex-start',
          gap: 10,
        }}>
          <Icon name="info" size={14} color={TOKENS.warn} />
          <span style={{
            fontFamily: FONTS.mono,
            fontSize: 11,
            color: TOKENS.warn,
            letterSpacing: 0.3,
            lineHeight: 1.5,
          }}>
            Paste this into your iOS Shortcut. Once dismissed, the plaintext is gone.
          </span>
        </div>

        {/* Done button */}
        <button
          onClick={onClose}
          style={{
            height: 40,
            borderRadius: 8,
            border: 'none',
            background: TOKENS.accent,
            color: '#fff',
            fontFamily: FONTS.ui,
            fontSize: 14,
            fontWeight: 700,
            letterSpacing: 0.3,
            textTransform: 'uppercase',
          }}
        >
          DONE — I SAVED THE TOKEN
        </button>
      </div>
    </div>
  )
}
