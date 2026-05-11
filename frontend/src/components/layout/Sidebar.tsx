import FocusTrap from 'focus-trap-react'
import { NavLink, useLocation } from 'react-router-dom'
import * as Popover from '@radix-ui/react-popover'
import { TOKENS, FONTS } from '../../tokens'
import { useCurrentUser } from '../../auth'
import { useIsMobile } from '../../lib/useIsMobile'
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

interface SidebarProps {
  mobileOpen?: boolean
  onClose?: () => void
}

export default function Sidebar({ mobileOpen = false, onClose }: SidebarProps) {
  const location = useLocation()
  const isMobile = useIsMobile()
  const isSettings = location.pathname.startsWith('/settings')
  const { user } = useCurrentUser()

  // AuthGate blocks render until status === 'authenticated', so user is
  // non-null here.
  const trimmedName = user?.display_name?.trim() ?? ''
  const emailLocal = user?.email.split('@')[0]?.trim() ?? ''
  const primary = (trimmedName || emailLocal || 'USER').toUpperCase()
  const secondary = user?.email ?? ''
  const initials = monogram(user?.display_name, user?.email ?? '')

  // Close drawer on any nav click (mobile only). No-op on desktop.
  const handleNavClick = () => {
    if (isMobile && onClose) onClose()
  }

  const mobileStyles: React.CSSProperties = isMobile
    ? {
        position: 'fixed',
        top: 0,
        left: 0,
        bottom: 0,
        width: 280,
        zIndex: 50,
        transform: mobileOpen ? 'translateX(0)' : 'translateX(-100%)',
        transition: 'transform 220ms cubic-bezier(0.22, 0.61, 0.36, 1)',
        boxShadow: mobileOpen ? '8px 0 32px rgba(0,0,0,0.42)' : 'none',
        // On mobile, the drawer is hidden when closed — don't trap focus inside it.
        visibility: mobileOpen ? 'visible' : 'hidden',
      }
    : {
        width: 232,
        flexShrink: 0,
      }

  const aside = (
    <aside
      {...(isMobile && {
        role: 'dialog' as const,
        'aria-modal': true,
        'aria-label': 'Main navigation',
        'aria-hidden': !mobileOpen,
      })}
      style={{
        background: TOKENS.surface,
        borderRight: `1px solid ${TOKENS.line}`,
        padding: '20px 14px',
        display: 'flex',
        flexDirection: 'column',
        ...mobileStyles,
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
                onClick={handleNavClick}
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
                      <NavLink
                        key={sub.label}
                        to={sub.to}
                        onClick={handleNavClick}
                        style={{ textDecoration: 'none' }}
                      >
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

      {/* Account menu — Beta W0.4 */}
      <Popover.Root>
        <Popover.Trigger asChild>
          <button
            aria-label="Account menu"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '10px',
              borderRadius: 8,
              border: `1px solid ${TOKENS.line}`,
              marginTop: 16,
              background: 'transparent',
              cursor: 'pointer',
              width: '100%',
              textAlign: 'left',
              fontFamily: 'inherit',
              color: 'inherit',
            }}
          >
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
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            align="start"
            side="top"
            sideOffset={8}
            style={{
              minWidth: 220,
              background: TOKENS.surface,
              border: `1px solid ${TOKENS.line}`,
              borderRadius: 10,
              padding: 8,
              boxShadow: '0 12px 32px rgba(0,0,0,0.45)',
              zIndex: 60,
            }}
          >
            <div style={{ padding: '8px 10px', borderBottom: `1px solid ${TOKENS.line}` }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: TOKENS.text }}>
                {user?.display_name?.trim() || user?.email || 'User'}
              </div>
              <div style={{
                fontSize: 11,
                color: TOKENS.textMute,
                fontFamily: FONTS.mono,
                marginTop: 2,
              }}>{user?.email}</div>
            </div>
            <NavLink
              to="/settings/account"
              role="menuitem"
              style={{
                display: 'block',
                padding: '8px 10px',
                fontSize: 12,
                color: TOKENS.text,
                textDecoration: 'none',
                borderRadius: 6,
                marginTop: 4,
              }}
            >Account settings</NavLink>
            <button
              role="menuitem"
              onClick={() => { window.location.assign('/cdn-cgi/access/logout') }}
              style={{
                display: 'block',
                padding: '8px 10px',
                fontSize: 12,
                color: TOKENS.danger,
                background: 'transparent',
                border: 'none',
                borderRadius: 6,
                width: '100%',
                textAlign: 'left',
                cursor: 'pointer',
                marginTop: 2,
                fontFamily: 'inherit',
              }}
            >Sign out</button>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </aside>
  )

  if (isMobile) {
    return (
      <FocusTrap
        active={mobileOpen}
        focusTrapOptions={{
          returnFocusOnDeactivate: true,
          escapeDeactivates: true,
          clickOutsideDeactivates: true,
          allowOutsideClick: true,
          onDeactivate: onClose,
          // When the drawer is closed (visibility:hidden) there are no tabbable
          // elements visible. Fall back gracefully rather than throwing.
          fallbackFocus: () => document.body,
        }}
      >
        {aside}
      </FocusTrap>
    )
  }

  return aside
}
