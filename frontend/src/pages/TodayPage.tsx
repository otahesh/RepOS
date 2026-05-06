import { TOKENS } from '../tokens'
import { useIsMobile } from '../lib/useIsMobile'
import { TodayCard } from '../components/programs/TodayCard'
import { TodayWorkoutMobile } from '../components/programs/TodayWorkoutMobile'
import MobileWeightChip from '../components/MobileWeightChip'
import DesktopDashboard from '../components/dashboard/DesktopDashboard'

// Placeholder until workout-run UI is built in a follow-up PR.
function handleStart(_runId: string, _dayId: string) {
  alert('Workout execution flow not yet wired — coming in next PR.')
}

export default function TodayPage() {
  const isMobile = useIsMobile()

  if (isMobile) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, color: TOKENS.text }}>
        <TodayWorkoutMobile onStart={handleStart} />
        <div style={{ padding: '0 16px 16px', display: 'flex', justifyContent: 'flex-start' }}>
          <MobileWeightChip />
        </div>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24, color: TOKENS.text }}>
      <TodayCard onStart={handleStart} />
      <DesktopDashboard />
    </div>
  )
}
