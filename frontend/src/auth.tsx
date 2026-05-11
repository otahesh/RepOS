// frontend-only — never import from non-browser code (e.g., service workers, tests, scripts).
// Uses `window` directly for the CF Access redirect path.
//
// CF Access whole-host auth glue:
//   - apiFetch(): same-origin (cookie-bearing) JSON fetch with a 401 redirect to the
//     Cloudflare Access login URL surfaced in `WWW-Authenticate: CFAccess url=<url>`.
//   - AuthProvider: bootstraps `/api/me` once, exposes the resolved user / status.
//   - useCurrentUser(): hook accessor for the same.
//   - AuthGate: render-blocker until status leaves 'loading' (or shows error).

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'
import { TOKENS, FONTS, API_BASE } from './tokens'

export interface User {
  id: string
  email: string
  display_name: string | null
  timezone: string
}

export type AuthStatus = 'loading' | 'authenticated' | 'error'

export interface AuthState {
  status: AuthStatus
  user: User | null
  error: string | null
}

/**
 * Same-origin JSON fetch with cookie credentials. Prepends API_BASE for dev
 * cross-origin (`http://localhost:3001`); empty in prod for same-origin.
 *
 * On 401 with `WWW-Authenticate: CFAccess url=<url>`, redirects the window to
 * the CF Access login URL. Other non-2xx responses are returned as-is for the
 * caller to handle.
 *
 * Does NOT add Authorization headers — the browser sends `CF_Authorization`
 * automatically as a cookie when same-origin.
 */
export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const url = `${API_BASE}${path}`
  const res = await fetch(url, {
    credentials: 'include',
    ...init,
  })

  if (res.status === 401) {
    const wwwAuth = res.headers.get('WWW-Authenticate') ?? ''
    // Match: CFAccess url=<url>   (url may be quoted or bare)
    const match = wwwAuth.match(/CFAccess\s+url=("?)([^"\s]+)\1/i)
    if (match && match[2]) {
      window.location.assign(match[2])
      // Return a never-resolving promise so callers don't proceed during nav.
      return new Promise<Response>(() => {})
    }
  }

  return res
}

const AuthContext = createContext<AuthState>({
  status: 'loading',
  user: null,
  error: null,
})

export function useCurrentUser(): AuthState {
  return useContext(AuthContext)
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    status: 'loading',
    user: null,
    error: null,
  })

  useEffect(() => {
    let cancelled = false

    async function bootstrap() {
      try {
        const res = await apiFetch('/api/me')

        if (cancelled) return

        if (res.status === 200) {
          const user = (await res.json()) as User
          setState({ status: 'authenticated', user, error: null })
          return
        }

        // 401 was already handled by apiFetch (redirect). Anything else
        // (including 503 — post-flag-flip, a 503 means something is genuinely
        // broken, not a transitional state) is an unexpected error.
        setState({
          status: 'error',
          user: null,
          error: `Auth check failed: HTTP ${res.status}`,
        })
      } catch (err) {
        if (cancelled) return
        setState({
          status: 'error',
          user: null,
          error: err instanceof Error ? err.message : 'Auth check failed',
        })
      }
    }

    void bootstrap()
    return () => {
      cancelled = true
    }
  }, [])

  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>
}

export function AuthGate({ children }: { children: ReactNode }) {
  const { status, error } = useCurrentUser()

  if (status === 'loading') {
    return null
  }

  if (status === 'error') {
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: TOKENS.bg,
          color: TOKENS.danger,
          fontFamily: FONTS.mono,
          fontSize: 13,
          letterSpacing: 0.4,
          padding: 24,
          textAlign: 'center',
        }}
      >
        AUTH ERROR: {error ?? 'unknown'}
      </div>
    )
  }

  return <>{children}</>
}
