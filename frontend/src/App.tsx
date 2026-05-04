import { useEffect, useState } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import AppShell from './components/layout/AppShell'
import DesktopDashboard from './components/dashboard/DesktopDashboard'
import SettingsIntegrations from './components/settings/SettingsIntegrations'
import { AuthProvider, AuthGate } from './auth'
import { EquipmentWizard } from './components/onboarding/EquipmentWizard'
import { EquipmentEditor } from './components/settings/EquipmentEditor'
import { getEquipmentProfile, isProfileEmpty, type EquipmentProfile } from './lib/api/equipment'

function AppInner() {
  const [profile, setProfile] = useState<EquipmentProfile | null>(null)
  useEffect(() => {
    getEquipmentProfile().then(setProfile).catch(() => setProfile({ _v: 1 }))
  }, [])
  const showWizard = profile && isProfileEmpty(profile)
  return (
    <>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<AppShell />}>
            <Route index element={<DesktopDashboard />} />
            <Route path="settings/integrations" element={<SettingsIntegrations />} />
            <Route path="settings/equipment" element={<EquipmentEditor />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
      {showWizard && <EquipmentWizard onComplete={setProfile} />}
    </>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <AuthGate>
        <AppInner />
      </AuthGate>
    </AuthProvider>
  )
}
