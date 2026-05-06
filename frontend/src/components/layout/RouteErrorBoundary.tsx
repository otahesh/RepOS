import { Component, type ErrorInfo, type ReactNode } from 'react'
import { TOKENS, FONTS } from '../../tokens'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

// Catches render-time throws below this point so a contract drift between
// API and client (e.g. missing field on a response) shows a recoverable
// error UI instead of unmounting the whole React tree to a black tab.
//
// Reset by remounting via a `key` tied to the current pathname (callers
// pass that). React re-creates the boundary on key change, so navigating
// away clears the error state without explicit reset logic.
export class RouteErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Surfaced to the user via the fallback UI; logged for the dev console.
    if (typeof console !== 'undefined') {
      console.error('Route error caught by boundary:', error, info.componentStack)
    }
  }

  render() {
    if (!this.state.error) return this.props.children

    return (
      <div style={{
        padding: '32px 24px',
        maxWidth: 560,
        color: TOKENS.text,
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
      }}>
        <div style={{
          fontFamily: FONTS.mono,
          fontSize: 10,
          color: TOKENS.danger,
          letterSpacing: 1.4,
        }}>RENDER ERROR</div>
        <h2 style={{
          fontSize: 22,
          fontWeight: 700,
          letterSpacing: -0.4,
          margin: 0,
        }}>Something went wrong on this page.</h2>
        <p style={{
          fontSize: 13,
          color: TOKENS.textDim,
          lineHeight: 1.5,
          margin: 0,
        }}>
          The page failed to render. This is a bug — most often a contract
          drift between the API and the client. The error details below help
          locate it.
        </p>
        <pre style={{
          background: TOKENS.bg,
          border: `1px solid ${TOKENS.line}`,
          borderRadius: 8,
          padding: '10px 12px',
          fontFamily: FONTS.mono,
          fontSize: 11,
          color: TOKENS.textDim,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          margin: 0,
        }}>{this.state.error.message}</pre>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={() => { window.location.reload() }}
            style={{
              padding: '10px 16px',
              borderRadius: 8,
              border: 'none',
              background: TOKENS.accent,
              color: '#fff',
              fontFamily: FONTS.ui,
              fontSize: 13,
              fontWeight: 600,
              letterSpacing: 0.4,
              textTransform: 'uppercase',
              cursor: 'pointer',
            }}>Reload page</button>
          <a
            href="/"
            style={{
              padding: '10px 16px',
              borderRadius: 8,
              border: `1px solid ${TOKENS.line}`,
              background: TOKENS.surface,
              color: TOKENS.text,
              fontFamily: FONTS.ui,
              fontSize: 13,
              fontWeight: 600,
              letterSpacing: 0.4,
              textTransform: 'uppercase',
              textDecoration: 'none',
            }}>Go home</a>
        </div>
      </div>
    )
  }
}
