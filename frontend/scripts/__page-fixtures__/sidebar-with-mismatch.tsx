import { NavLink } from 'react-router-dom'

// `/library` is not registered in app-routes.tsx — should mismatch.
export function SidebarWithMismatch() {
  return (
    <>
      <NavLink to="/">Today</NavLink>
      <NavLink to="/settings/integrations">Settings</NavLink>
      <NavLink to="/library">Library</NavLink>
    </>
  )
}
