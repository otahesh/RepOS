import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ProgramTemplateDetail } from '../components/programs/ProgramTemplateDetail';
import { forkProgramTemplate, getProgramTemplate, type ProgramTemplate } from '../lib/api/programs';
import { TOKENS } from '../tokens';

// Detail view + fork flow. Forking creates a draft user_program, then routes
// to /programs/draft/:id — the wizard page — where the user customizes the
// draft and starts the mesocycle.
export default function ProgramDetailPage() {
  const { slug = '' } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const [template, setTemplate] = useState<ProgramTemplate | null>(null);
  const [forking, setForking] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!slug) return;
    let ignore = false;
    getProgramTemplate(slug)
      .then((t) => {
        if (!ignore) setTemplate(t);
      })
      .catch((e) => {
        if (!ignore) setErr(e instanceof Error ? e.message : String(e));
      });
    return () => {
      ignore = true;
    };
  }, [slug]);

  async function onFork(s: string) {
    setForking(true);
    setErr(null);
    try {
      // Default to "My ${template name}" so the user's first program label
      // is the human-readable template title, not the slug.
      const name = template ? `My ${template.name}` : s;
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
        <div style={{ padding: '0 24px 24px', color: TOKENS.textDim, fontSize: 13 }}>Forking…</div>
      ) : null}
      {err ? (
        <div style={{ padding: '0 24px 24px', color: TOKENS.danger, fontSize: 13 }}>
          Couldn't fork: {err}
        </div>
      ) : null}
    </div>
  );
}
