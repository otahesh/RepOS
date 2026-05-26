import { TOKENS, FONTS } from '../../tokens'

interface Props {
  title: string
  wave: 'W4' | 'W5' | 'W7'
  blurb: string
}

export function ComingSoonPlaceholder({ title, wave, blurb }: Props): JSX.Element {
  return (
    <div style={{ padding: '24px 32px', maxWidth: 720 }}>
      <div style={{ fontFamily: FONTS.mono, fontSize: 10, color: TOKENS.textMute, letterSpacing: 1.2, marginBottom: 4 }}>SETTINGS</div>
      <h2 style={{ fontSize: 22, fontWeight: 700, letterSpacing: -0.5, color: TOKENS.text }}>{title}</h2>
      <p style={{ fontSize: 13, color: TOKENS.textDim, marginTop: 16 }}>
        Coming in {wave}. {blurb}
      </p>
    </div>
  )
}
