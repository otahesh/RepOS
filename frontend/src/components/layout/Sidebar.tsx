import { NavLink, useLocation } from 'react-router-dom'
import { TOKENS, FONTS } from '../../tokens'
import Icon from '../Icon'

const NAV_ITEMS = [
  { name: 'Today', icon: 'flame' as const, to: '/', exact: true },
  { name: 'Program', icon: 'calendar' as const, to: '/program' },
  { name: 'Library', icon: 'dumbbell' as const, to: '/library' },
  { name: 'Progress', icon: 'trend' as const, to: '/progress' },
  { name: 'Cardio', icon: 'heart' as const, to: '/cardio' },
  { name: 'Settings', icon: 'settings' as const, to: '/settings/integrations' },
]

export default function Sidebar() {
  const location = useLocation()
  const isSettings = location.pathname.startsWith('/settings')

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

      {/* Mesocycle meta */}
      <div style={{
        padding: '10px 12px',
        marginBottom: 20,
        background: TOKENS.surface2,
        borderRadius: 8,
        border: `1px solid ${TOKENS.line}`,
      }}>
        <div style={{
          fontFamily: FONTS.mono,
          fontSize: 9,
          color: TOKENS.textMute,
          letterSpacing: 1.2,
          marginBottom: 4,
        }}>MESOCYCLE</div>
        <div style={{
          fontSize: 13,
          fontWeight: 600,
          color: TOKENS.text,
          marginBottom: 6,
        }}>Hypertrophy · Block 2</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{
            flex: 1,
            height: 4,
            background: TOKENS.surface3,
            borderRadius: 100,
            overflow: 'hidden',
          }}>
            <div style={{
              height: '100%',
              width: '60%',
              background: TOKENS.accent,
            }} />
          </div>
          <span style={{
            fontFamily: FONTS.mono,
            fontSize: 10,
            color: TOKENS.textDim,
          }}>W3/5</span>
        </div>
      </div>

      {/* Nav */}
      <nav style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1 }}>
        {NAV_ITEMS.map(item => {
          const active = item.exact
            ? location.pathname === item.to
            : location.pathname.startsWith(item.to)
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
                  {['Integrations', 'Units & equipment', 'Account'].map((sub, i) => (
                    <NavLink key={sub} to={i === 0 ? '/settings/integrations' : '#'} style={{ textDecoration: 'none' }}>
                      <div style={{
                        fontSize: 12,
                        padding: '5px 10px',
                        borderRadius: 6,
                        color: i === 0 ? TOKENS.accent : TOKENS.textMute,
                        fontWeight: i === 0 ? 600 : 500,
                        background: i === 0 ? TOKENS.accentGlow : 'transparent',
                        cursor: 'pointer',
                      }}>{sub}</div>
                    </NavLink>
                  ))}
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
        }}>KH</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: TOKENS.text }}>K. HARRIS</div>
          <div style={{
            fontSize: 10,
            color: TOKENS.textMute,
            fontFamily: FONTS.mono,
          }}>6mo · INT</div>
        </div>
        <Icon name="settings" size={14} color={TOKENS.textMute} />
      </div>
    </aside>
  )
}
