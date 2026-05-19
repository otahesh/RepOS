import { TOKENS } from '../tokens'
import { useIsMobile } from '../lib/useIsMobile'
import { TodayCard } from '../components/programs/TodayCard'
import { TodayWorkoutMobile } from '../components/programs/TodayWorkoutMobile'
import MobileWeightChip from '../components/MobileWeightChip'
import DesktopDashboard from '../components/dashboard/DesktopDashboard'

// Desktop TodayCard's onStart still routes through this placeholder until the
// desktop logger ships (W2.x); mobile path now navigates via TodayWorkoutMobile's
// internal useNavigate to /today/:runId/log.
function handleDesktopStart(_runId: string, _dayId: string) {
  alert('Desktop workout execution flow not yet wired — coming in a follow-up PR.')
}

export default function TodayPage() {
  const isMobile = useIsMobile()

  if (isMobile) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, color: TOKENS.text }}>
        <TodayWorkoutMobile />
        <div style={{ padding: '0 16px 16px', display: 'flex', justifyContent: 'flex-start' }}>
          <MobileWeightChip />
        </div>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24, color: TOKENS.text }}>
      <TodayCard onStart={handleDesktopStart} />
      <DesktopDashboard />
    </div>
  )
}
