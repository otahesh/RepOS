import { useEffect, useState } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import AppShell from './components/layout/AppShell'
import SettingsIntegrations from './components/settings/SettingsIntegrations'
import SettingsAccount from './components/settings/SettingsAccount'
import SettingsStorage from './components/settings/SettingsStorage'
import { AuthProvider, AuthGate } from './auth'
import { EquipmentWizard } from './components/onboarding/EquipmentWizard'
import { EquipmentEditor } from './components/settings/EquipmentEditor'
import { getEquipmentProfile, isProfileEmpty, type EquipmentProfile } from './lib/api/equipment'
import { ExercisePickerDemo } from './components/library/ExercisePickerDemo'
import TodayPage from './pages/TodayPage'
import ProgramsPage from './pages/ProgramsPage'
import ProgramDetailPage from './pages/ProgramDetailPage'
import MyProgramPage from './pages/MyProgramPage'
import SettingsInjuriesPage from './pages/SettingsInjuriesPage'
import SettingsHealthPage from './pages/SettingsHealthPage'
import SettingsProgramPrefsPage from './pages/SettingsProgramPrefsPage'
import SettingsBackupsPage from './pages/SettingsBackupsPage'
import SettingsFeedbackPage from './pages/SettingsFeedbackPage'
import TodayLoggerMobile from './components/programs/TodayLoggerMobile'
import { useIsMobile } from './lib/useIsMobile'

// TodayLoggerMobile is intentionally mobile-only (per project memory
// project_device_split.md: desktop = data management, mobile = live workout).
// A desktop user landing on /today/:run/log would otherwise get the mobile-
// styled logger compressed into a 480px column on a 1440px display. Until the
// desktop logger exists, redirect to /today which routes to the appropriate
// device-aware surface.
function TodayLoggerMobileGate() {
  const isMobile = useIsMobile()
  if (!isMobile) return <Navigate to="/today" replace />
  return <TodayLoggerMobile />
}

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
            <Route path="today/:mesocycleRunId/log" element={<TodayLoggerMobileGate />} />
            <Route path="settings/integrations" element={<SettingsIntegrations />} />
            <Route path="settings/equipment" element={<EquipmentEditor />} />
            <Route path="settings/account" element={<SettingsAccount />} />
            <Route path="settings/health" element={<SettingsHealthPage />} />
            <Route path="settings/storage" element={<SettingsStorage />} />
            <Route path="settings/injuries" element={<SettingsInjuriesPage />} />
            <Route path="settings/program-prefs" element={<SettingsProgramPrefsPage />} />
            <Route path="settings/backups" element={<SettingsBackupsPage />} />
            <Route path="settings/feedback" element={<SettingsFeedbackPage />} />
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
