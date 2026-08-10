import { useNavigate, useSearchParams } from 'react-router-dom';
import { ProgramCatalog } from '../components/programs/ProgramCatalog';
import { MyLibrary } from '../components/programs/MyLibrary';
import { TOKENS } from '../tokens';
import { PROGRAM_TRACKS, type ProgramTrack } from '../lib/programTracks';
import { Page, PageHeader, SectionHeader } from '../components/ui';

// Programs page: My Programs library (top) + template catalog (bottom).
// Restart from Past tab sends user back to the fork-wizard detail page so
// they can rename / customize before restarting.
export default function ProgramsPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const trackParam = searchParams.get('track');
  const initialTrack = PROGRAM_TRACKS.includes(trackParam as ProgramTrack)
    ? (trackParam as ProgramTrack)
    : undefined;
  return (
    <Page
      width="data"
      style={{ color: TOKENS.text, display: 'flex', flexDirection: 'column', gap: 32 }}
    >
      <PageHeader
        eyebrow="Training"
        title="Programs"
        description="Run your current plan, revisit past blocks, or compare a new template."
      />
      <div>
        <MyLibrary onRestartProgram={(slug) => navigate(`/programs/${slug}`)} />
      </div>

      <section>
        <SectionHeader
          title="Browse templates"
          description="Compare schedule, experience level, and equipment before customizing."
        />
        <ProgramCatalog
          onPick={(slug) => navigate(`/programs/${slug}`)}
          initialTrack={initialTrack}
        />
      </section>
    </Page>
  );
}
