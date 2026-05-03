import { Outlet } from 'react-router-dom'
import Sidebar from './Sidebar'
import Topbar from './Topbar'

export default function AppShell() {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '232px 1fr',
      height: '100vh',
      overflow: 'hidden',
      background: 'var(--color-bg)',
    }}>
      <Sidebar />
      <div style={{
        display: 'grid',
        gridTemplateRows: '72px 1fr',
        minHeight: 0,
        overflow: 'hidden',
      }}>
        <Topbar />
        <main style={{
          overflow: 'auto',
          minHeight: 0,
        }}>
          <Outlet />
        </main>
      </div>
    </div>
  )
}
