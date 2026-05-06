import { useEffect, useState } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import AppShell from './components/layout/AppShell'
import SettingsIntegrations from './components/settings/SettingsIntegrations'
import SettingsAccount from './components/settings/SettingsAccount'
import { AuthProvider, AuthGate } from './auth'
import { EquipmentWizard } from './components/onboarding/EquipmentWizard'
import { EquipmentEditor } from './components/settings/EquipmentEditor'
import { getEquipmentProfile, isProfileEmpty, type EquipmentProfile } from './lib/api/equipment'
import { ExercisePickerDemo } from './components/library/ExercisePickerDemo'
import TodayPage from './pages/TodayPage'
import ProgramsPage from './pages/ProgramsPage'
import ProgramDetailPage from './pages/ProgramDetailPage'
import MyProgramPage from './pages/MyProgramPage'

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
            <Route index element={<TodayPage />} />
            <Route path="programs" element={<ProgramsPage />} />
            <Route path="programs/:slug" element={<ProgramDetailPage />} />
            <Route path="my-programs/:id" element={<MyProgramPage />} />
            <Route path="settings/integrations" element={<SettingsIntegrations />} />
            <Route path="settings/equipment" element={<EquipmentEditor />} />
            <Route path="settings/account" element={<SettingsAccount />} />
            {import.meta.env.DEV && <Route path="dev/picker" element={<ExercisePickerDemo />} />}
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
