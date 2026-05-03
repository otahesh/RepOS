import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import AppShell from './components/layout/AppShell'
import DesktopDashboard from './components/dashboard/DesktopDashboard'
import SettingsIntegrations from './components/settings/SettingsIntegrations'
import { AuthProvider, AuthGate } from './auth'

export default function App() {
  return (
    <AuthProvider>
      <AuthGate>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<AppShell />}>
              <Route index element={<DesktopDashboard />} />
              <Route path="settings/integrations" element={<SettingsIntegrations />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </AuthGate>
    </AuthProvider>
  )
}
