import { TOKENS } from '../tokens';
import { useIsMobile } from '../lib/useIsMobile';
import { TodayCard } from '../components/programs/TodayCard';
import { TodayWorkoutMobile } from '../components/programs/TodayWorkoutMobile';
import MobileWeightChip from '../components/MobileWeightChip';
import DesktopDashboard from '../components/dashboard/DesktopDashboard';
import { RecoveryFlagBanner } from '../components/dashboard/RecoveryFlagBanner';
import { pushToast } from '../components/common/ToastHost';

// Desktop TodayCard's onStart still routes through this placeholder until the
// desktop logger ships (W2.x); mobile path now navigates via TodayWorkoutMobile's
// internal useNavigate to /today/:runId/log.
function handleDesktopStart(_runId: string, _dayId: string) {
  pushToast({
    severity: 'info',
    body: 'Desktop workout execution lands later in Beta. Use the mobile logger.',
  });
}

export default function TodayPage() {
  const isMobile = useIsMobile();

  if (isMobile) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, color: TOKENS.text }}>
        <div style={{ padding: '0 16px' }}>
          <RecoveryFlagBanner />
        </div>
        <TodayWorkoutMobile />
        <div style={{ padding: '0 16px 16px', display: 'flex', justifyContent: 'flex-start' }}>
          <MobileWeightChip />
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24, color: TOKENS.text }}>
      <RecoveryFlagBanner />
      <TodayCard onStart={handleDesktopStart} />
      <DesktopDashboard />
    </div>
  );
}
