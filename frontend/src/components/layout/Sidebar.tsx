import { NavLink, useLocation } from 'react-router-dom'
import { TOKENS, FONTS } from '../../tokens'
import { useCurrentUser } from '../../auth'
import Icon from '../Icon'

function monogram(displayName: string | null | undefined, email: string): string {
  const trimmedName = displayName?.trim() ?? ''
  if (trimmedName) {
    const parts = trimmedName.split(/\s+/)
    if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
    return parts[0].slice(0, 2).toUpperCase()
  }
  const trimmedEmail = email.trim()
  if (trimmedEmail) return trimmedEmail[0].toUpperCase()
  return 'U'
}

type NavItem = {
  name: string
  icon: 'flame' | 'dumbbell' | 'settings'
  to: string
  exact?: boolean
  matchPrefixes?: string[]
}

const NAV_ITEMS: NavItem[] = [
  { name: 'Today', icon: 'flame', to: '/', exact: true },
  { name: 'Programs', icon: 'dumbbell', to: '/programs', matchPrefixes: ['/programs', '/my-programs'] },
  { name: 'Settings', icon: 'settings', to: '/settings/integrations', matchPrefixes: ['/settings'] },
]

const SETTINGS_SUB = [
  { label: 'Integrations', to: '/settings/integrations' },
  { label: 'Units & equipment', to: '/settings/equipment' },
  { label: 'Account', to: '/settings/account' },
]

export default function Sidebar() {
  const location = useLocation()
  const isSettings = location.pathname.startsWith('/settings')
  const { user, status } = useCurrentUser()

  // AuthGate blocks render until status leaves 'loading', so user is non-null
  // here in both 'authenticated' and 'disabled' (placeholder) modes.
  const isPlaceholder = status === 'disabled'
  const trimmedName = user?.display_name?.trim() ?? ''
  const emailLocal = user?.email.split('@')[0]?.trim() ?? ''
  const primary = isPlaceholder
    ? 'GUEST'
    : (trimmedName || emailLocal || 'USER').toUpperCase()
  const secondary = isPlaceholder ? 'placeholder mode' : (user?.email ?? '')
  const initials = isPlaceholder ? 'G' : monogram(user?.display_name, user?.email ?? '')

  return (
    <aside style={{
      background: TOKENS.surface,
      borderRight: `1px solid ${TOKENS.line}`,
      padding: '20px 14px',
      display: 'flex',
      flexDirection: 'column',
      width: 232,
      flexShrink: 0,
    }}>
      {/* Logo */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '0 10px 24px',
      }}>
        <div style={{
          width: 28,
          height: 28,
          borderRadius: 7,
          background: `linear-gradient(135deg, ${TOKENS.accent} 0%, ${TOKENS.heat3} 100%)`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: `0 4px 12px ${TOKENS.accentGlow}`,
          flexShrink: 0,
        }}>
          <span style={{
            fontFamily: FONTS.mono,
            fontSize: 13,
            fontWeight: 700,
            color: '#fff',
            letterSpacing: -0.5,
          }}>R</span>
        </div>
        <span style={{
          fontFamily: FONTS.mono,
          fontSize: 14,
          fontWeight: 600,
          letterSpacing: 1,
          color: TOKENS.text,
        }}>REPOS</span>
      </div>

      {/* Nav */}
      <nav style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1 }}>
        {NAV_ITEMS.map(item => {
          const active = item.exact
            ? location.pathname === item.to
            : (item.matchPrefixes ?? [item.to]).some(p => location.pathname.startsWith(p))
          return (
            <div key={item.name}>
              <NavLink
                to={item.to}
                style={{ textDecoration: 'none' }}
              >
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '9px 12px',
                  borderRadius: 7,
                  fontSize: 13,
                  fontWeight: active ? 600 : 500,
                  color: active ? TOKENS.text : TOKENS.textDim,
                  background: active ? TOKENS.surface2 : 'transparent',
                  border: active ? `1px solid ${TOKENS.line}` : '1px solid transparent',
                  position: 'relative',
                  cursor: 'pointer',
                }}>
                  {active && (
                    <div style={{
                      position: 'absolute',
                      left: 0,
                      top: 8,
                      bottom: 8,
                      width: 2,
                      background: TOKENS.accent,
                      borderRadius: 100,
                    }} />
                  )}
                  <Icon
                    name={item.icon}
                    size={16}
                    color={active ? TOKENS.accent : TOKENS.textDim}
                  />
                  <span style={{ flex: 1 }}>{item.name}</span>
                </div>
              </NavLink>

              {/* Settings sub-nav */}
              {item.name === 'Settings' && isSettings && (
                <div style={{
                  paddingLeft: 38,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 2,
                  marginBottom: 4,
                  marginTop: 2,
                }}>
                  {SETTINGS_SUB.map(sub => {
                    const subActive = location.pathname === sub.to
                    return (
                      <NavLink key={sub.label} to={sub.to} style={{ textDecoration: 'none' }}>
                        <div style={{
                          fontSize: 12,
                          padding: '5px 10px',
                          borderRadius: 6,
                          color: subActive ? TOKENS.accent : TOKENS.textMute,
                          fontWeight: subActive ? 600 : 500,
                          background: subActive ? TOKENS.accentGlow : 'transparent',
                          cursor: 'pointer',
                        }}>{sub.label}</div>
                      </NavLink>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </nav>

      {/* User avatar */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '10px',
        borderRadius: 8,
        border: `1px solid ${TOKENS.line}`,
        marginTop: 16,
      }}>
        <div style={{
          width: 30,
          height: 30,
          borderRadius: 8,
          background: `linear-gradient(135deg, ${TOKENS.heat3} 0%, ${TOKENS.accent} 100%)`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: FONTS.mono,
          fontSize: 12,
          fontWeight: 700,
          color: '#fff',
          flexShrink: 0,
        }}>{initials}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 12,
            fontWeight: 600,
            color: TOKENS.text,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>{primary}</div>
          <div style={{
            fontSize: 10,
            color: TOKENS.textMute,
            fontFamily: FONTS.mono,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>{secondary}</div>
        </div>
        <Icon name="settings" size={14} color={TOKENS.textMute} />
      </div>
    </aside>
  )
}
