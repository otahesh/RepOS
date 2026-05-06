import { NavLink } from 'react-router-dom'

export function SidebarGood() {
  return (
    <>
      <NavLink to="/">Today</NavLink>
      <NavLink to="/settings/integrations">Settings</NavLink>
      <NavLink to="/programs">Programs</NavLink>
    </>
  )
}
