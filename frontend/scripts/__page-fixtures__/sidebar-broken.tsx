import { NavLink } from 'react-router-dom'

export function SidebarBroken() {
  return (
    <>
      <NavLink to="/">Today</NavLink>
      <NavLink to="#">Account</NavLink>
      <NavLink to="">Settings</NavLink>
    </>
  )
}
