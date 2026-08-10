import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ProgramTemplateDetail } from '../components/programs/ProgramTemplateDetail';
import { forkProgramTemplate, type ProgramTemplate } from '../lib/api/programs';
import { TOKENS } from '../tokens';
import { DataState } from '../components/ui';

// Detail view + fork flow. Forking creates a draft user_program, then routes
// to /programs/draft/:id — the wizard page — where the user customizes the
// draft and starts the mesocycle.
export default function ProgramDetailPage() {
  const { slug = '' } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const [forking, setForking] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onFork(s: string, template: ProgramTemplate) {
    setForking(true);
    setErr(null);
    try {
      // Default to "My ${template name}" so the user's first program label
      // is the human-readable template title, not the slug.
      const name = `My ${template.name}`;
      const draft = await forkProgramTemplate(s, { name });
      navigate(`/programs/draft/${draft.id}`);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setForking(false);
    }
  }

  return (
    <div style={{ color: TOKENS.text }}>
      <ProgramTemplateDetail slug={slug} onFork={onFork} />
      {forking ? (
        <div role="status" style={{ padding: '0 24px 24px', color: TOKENS.textDim, fontSize: 13 }}>
          Creating your editable copy…
        </div>
      ) : null}
      {err ? (
        <div style={{ padding: '0 24px 24px' }}>
          <DataState compact kind="error" title="The editable copy was not created" body={err} />
        </div>
      ) : null}
    </div>
  );
}
