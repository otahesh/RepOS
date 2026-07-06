import { useNavigate, useParams } from 'react-router-dom';
import { ForkWizard } from '../components/programs/ForkWizard';
import { TOKENS } from '../tokens';

// Customize-and-start surface for an already-forked draft program. Forking
// from the catalog lands here (a real URL, so the wizard survives refresh),
// and My Programs' "View" on a run-less draft reopens it here.
export default function DraftProgramPage() {
  const { userProgramId = '' } = useParams<{ userProgramId: string }>();
  const navigate = useNavigate();
  return (
    <div style={{ color: TOKENS.text }}>
      <ForkWizard
        userProgramId={userProgramId}
        onStarted={(mesocycleRunId) => navigate(`/my-programs/${mesocycleRunId}`)}
      />
    </div>
  );
}
