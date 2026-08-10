import { TOKENS } from '../tokens';
import { useIsMobile } from '../lib/useIsMobile';
import { TodayCard } from '../components/programs/TodayCard';
import { TodayWorkoutMobile } from '../components/programs/TodayWorkoutMobile';
import MobileWeightChip from '../components/MobileWeightChip';
import DesktopDashboard from '../components/dashboard/DesktopDashboard';
import { RecoveryFlagBanner } from '../components/dashboard/RecoveryFlagBanner';
import { Page, PageHeader, SectionHeader } from '../components/ui';

export default function TodayPage() {
  const isMobile = useIsMobile();

  if (isMobile) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, color: TOKENS.text }}>
        <section aria-labelledby="today-next-heading">
          <h2 id="today-next-heading" style={mobileSectionHeading}>
            Next workout
          </h2>
          <TodayWorkoutMobile />
        </section>
        <section style={{ padding: '0 16px' }} aria-labelledby="today-recovery-heading">
          <h2 id="today-recovery-heading" style={{ ...mobileSectionHeading, padding: 0 }}>
            Recovery
          </h2>
          <RecoveryFlagBanner />
        </section>
        <section style={{ padding: '0 16px 20px' }} aria-labelledby="today-progress-heading">
          <h2 id="today-progress-heading" style={{ ...mobileSectionHeading, padding: 0 }}>
            Progress
          </h2>
          <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
            <MobileWeightChip />
          </div>
        </section>
      </div>
    );
  }

  return (
    <Page width="data">
      <PageHeader
        eyebrow="Training"
        title="Today"
        description="Your next training action first, with recovery context and progress close by."
      />
      <div className="today-overview-grid">
        <section aria-labelledby="desktop-next-heading">
          <SectionHeader id="desktop-next-heading" title="Next workout" />
          <TodayCard />
        </section>
        <section aria-labelledby="desktop-recovery-heading">
          <SectionHeader id="desktop-recovery-heading" title="Recovery" />
          <RecoveryFlagBanner />
        </section>
      </div>
      <section aria-labelledby="desktop-progress-heading" style={{ marginTop: 28 }}>
        <SectionHeader
          id="desktop-progress-heading"
          title="Progress"
          description="Bodyweight measurements and rolling trends."
        />
        <DesktopDashboard />
      </section>
    </Page>
  );
}

const mobileSectionHeading: React.CSSProperties = {
  margin: '0 0 10px',
  padding: '0 16px',
  color: TOKENS.textMute,
  fontFamily: 'JetBrains Mono',
  fontSize: 10,
  letterSpacing: 1.2,
  textTransform: 'uppercase',
};
