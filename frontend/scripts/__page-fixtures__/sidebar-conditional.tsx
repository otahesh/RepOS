import { NavLink } from 'react-router-dom'

// Mirrors the real Sidebar pattern that hid the bug from a StringLiteral-only
// parser: `to={cond ? '/path' : '#'}` — the broken branch must be flagged.
export function SidebarConditional() {
  const items = ['Integrations', 'Units & equipment', 'Account']
  return (
    <>
      {items.map((sub, i) => (
        <NavLink key={sub} to={i === 0 ? '/settings/integrations' : '#'}>
          {sub}
        </NavLink>
      ))}
    </>
  )
}
