import { useCallback, useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import AppShell from './components/layout/AppShell';
import SettingsIntegrations from './components/settings/SettingsIntegrations';
import SettingsAccount from './components/settings/SettingsAccount';
import SettingsStorage from './components/settings/SettingsStorage';
import { AuthProvider, AuthGate } from './auth';
import { EquipmentWizard } from './components/onboarding/EquipmentWizard';
import { EquipmentEditor } from './components/settings/EquipmentEditor';
import { getEquipmentProfile, isProfileEmpty, type EquipmentProfile } from './lib/api/equipment';
import { ExercisePickerDemo } from './components/library/ExercisePickerDemo';
import TodayPage from './pages/TodayPage';
import ProgramsPage from './pages/ProgramsPage';
import ProgramDetailPage from './pages/ProgramDetailPage';
import DraftProgramPage from './pages/DraftProgramPage';
import MyProgramPage from './pages/MyProgramPage';
import WorkoutHistoryPage from './components/history/WorkoutHistoryPage';
import SettingsInjuriesPage from './pages/SettingsInjuriesPage';
import SettingsHealthPage from './pages/SettingsHealthPage';
import SettingsProgramPrefsPage from './pages/SettingsProgramPrefsPage';
import SettingsBackupsPage from './pages/SettingsBackupsPage';
import SettingsFeedbackPage from './pages/SettingsFeedbackPage';
import SettingsUsersPage from './pages/SettingsUsersPage';
import AdminFeedbackPage from './pages/AdminFeedbackPage';
import TodayLoggerMobile from './components/programs/TodayLoggerMobile';
import SettingsOverviewPage from './pages/SettingsOverviewPage';
import { Button, DataState } from './components/ui';

function AppInner() {
  const [profile, setProfile] = useState<EquipmentProfile | null>(null);
  const [profileError, setProfileError] = useState(false);
  const loadProfile = useCallback(() => {
    setProfileError(false);
    getEquipmentProfile()
      .then(setProfile)
      .catch(() => setProfileError(true));
  }, []);
  useEffect(() => {
    loadProfile();
  }, [loadProfile]);
  const showWizard = profile && isProfileEmpty(profile);
  return (
    <>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<AppShell />}>
            <Route index element={<TodayPage />} />
            <Route path="programs" element={<ProgramsPage />} />
            <Route path="programs/:slug" element={<ProgramDetailPage />} />
            <Route path="programs/draft/:userProgramId" element={<DraftProgramPage />} />
            <Route path="my-programs/:id" element={<MyProgramPage />} />
            <Route path="history" element={<WorkoutHistoryPage />} />
            <Route path="today/:mesocycleRunId/log" element={<TodayLoggerMobile />} />
            <Route path="today/:mesocycleRunId/log/:blockIdx" element={<TodayLoggerMobile />} />
            <Route path="settings" element={<SettingsOverviewPage />} />
            <Route path="settings/integrations" element={<SettingsIntegrations />} />
            <Route path="settings/equipment" element={<EquipmentEditor />} />
            <Route path="settings/account" element={<SettingsAccount />} />
            <Route path="settings/health" element={<SettingsHealthPage />} />
            <Route path="settings/storage" element={<SettingsStorage />} />
            <Route path="settings/injuries" element={<SettingsInjuriesPage />} />
            <Route path="settings/program-prefs" element={<SettingsProgramPrefsPage />} />
            <Route path="settings/backups" element={<SettingsBackupsPage />} />
            <Route path="settings/feedback" element={<SettingsFeedbackPage />} />
            <Route path="settings/users" element={<SettingsUsersPage />} />
            <Route path="admin/feedback" element={<AdminFeedbackPage />} />
            {import.meta.env.DEV && <Route path="dev/picker" element={<ExercisePickerDemo />} />}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
      {profileError ? (
        <div style={{ position: 'fixed', inset: 'auto 16px 16px', zIndex: 3000 }}>
          <DataState
            compact
            kind="warning"
            title="Equipment setup could not be checked"
            body="RepOS will not ask you to overwrite it. Retry when your connection is stable."
            action={
              <Button variant="warning" onClick={loadProfile}>
                Retry
              </Button>
            }
          />
        </div>
      ) : null}
      {showWizard && <EquipmentWizard onComplete={setProfile} />}
    </>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AuthGate>
        <AppInner />
      </AuthGate>
    </AuthProvider>
  );
}
