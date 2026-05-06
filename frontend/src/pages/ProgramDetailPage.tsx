import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ProgramTemplateDetail } from '../components/programs/ProgramTemplateDetail'
import { ForkWizard } from '../components/programs/ForkWizard'
import { forkProgramTemplate, getProgramTemplate, type ProgramTemplate } from '../lib/api/programs'
import { TOKENS } from '../tokens'

// Detail view + fork flow. Forking creates a draft user_program; the wizard
// then customizes that draft and starts the mesocycle. Once started we route
// to the active program view.
export default function ProgramDetailPage() {
  const { slug = '' } = useParams<{ slug: string }>()
  const navigate = useNavigate()
  const [template, setTemplate] = useState<ProgramTemplate | null>(null)
  const [draftUserProgramId, setDraftUserProgramId] = useState<string | null>(null)
  const [forking, setForking] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    if (!slug) return
    let ignore = false
    getProgramTemplate(slug)
      .then((t) => { if (!ignore) setTemplate(t) })
      .catch((e) => { if (!ignore) setErr(e instanceof Error ? e.message : String(e)) })
    return () => { ignore = true }
  }, [slug])

  async function onFork(s: string) {
    setForking(true)
    setErr(null)
    try {
      // Default to "My ${template name}" so the user's first program label
      // is the human-readable template title, not the slug.
      const name = template ? `My ${template.name}` : s
      const draft = await forkProgramTemplate(s, { name })
      setDraftUserProgramId(draft.id)
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setForking(false)
    }
  }

  if (draftUserProgramId) {
    return (
      <div style={{ color: TOKENS.text }}>
        <ForkWizard
          userProgramId={draftUserProgramId}
          onStarted={(mesocycleRunId) => navigate(`/my-programs/${mesocycleRunId}`)}
        />
      </div>
    )
  }

  return (
    <div style={{ color: TOKENS.text }}>
      <ProgramTemplateDetail slug={slug} onFork={onFork} />
      {forking ? (
        <div style={{ padding: '0 24px 24px', color: TOKENS.textDim, fontSize: 13 }}>Forking…</div>
      ) : null}
      {err ? (
        <div style={{ padding: '0 24px 24px', color: TOKENS.danger, fontSize: 13 }}>Couldn't fork: {err}</div>
      ) : null}
    </div>
  )
}
