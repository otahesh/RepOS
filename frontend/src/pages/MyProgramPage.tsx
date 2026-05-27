import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ProgramPage } from '../components/programs/ProgramPage'
import { DayCard } from '../components/programs/DayCard'
import { ScheduleWarnings, type ScheduleWarning } from '../components/programs/ScheduleWarnings'
import { MesocycleRecap, type RecapChoice } from '../components/programs/MesocycleRecap'
import { getMesocycle, getMesocycleRecapStats, abandonMesocycle, type MesocycleRunDetail, type MesocycleRecapStats } from '../lib/api/mesocycles'
import {
  getUserProgram,
  getUserProgramWarnings,
  patchUserProgram,
  type UserProgramDetail,
} from '../lib/api/userPrograms'
import { TOKENS } from '../tokens'
import { pushToast } from '../components/common/ToastHost'
import { ConfirmDialog } from '../components/common/ConfirmDialog'
import { Term } from '../components/Term'
import { DeloadThisWeekButton } from '../components/programs/DeloadThisWeekButton'

// :id here is the mesocycle_run_id — that's what ProgramPage and the
// volume rollup keys off. The user_program_id is derived from the run.
export default function MyProgramPage() {
  const { id = '' } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [run, setRun] = useState<MesocycleRunDetail | null>(null)
  const [up, setUp] = useState<UserProgramDetail | null>(null)
  const [warnings, setWarnings] = useState<ScheduleWarning[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [recapStats, setRecapStats] = useState<MesocycleRecapStats | null>(null)
  const [recapErr, setRecapErr] = useState<string | null>(null)
  const [recapLoading, setRecapLoading] = useState(false)
  const [abandonOpen, setAbandonOpen] = useState(false)
  const [abandoning, setAbandoning] = useState(false)
  const [reloadTick, setReloadTick] = useState(0)

  useEffect(() => {
    if (!id) return
    let ignore = false
    getMesocycle(id)
      .then((r) => { if (!ignore) setRun(r) })
      .catch((e) => { if (!ignore) setErr(String(e)) })
    return () => { ignore = true }
  }, [id])

  useEffect(() => {
    if (!run) return
    let ignore = false
    getUserProgram(run.user_program_id)
      .then((p) => { if (!ignore) setUp(p) })
      .catch((e) => { if (!ignore) setErr(String(e)) })
    getUserProgramWarnings(run.user_program_id)
      .then((w) => { if (!ignore) setWarnings(w) })
      .catch(() => { if (!ignore) setWarnings([]) })
    return () => { ignore = true }
  }, [run])

  // Fetch recap stats when the run is completed.
  useEffect(() => {
    if (!run || run.status !== 'completed') return
    let ignore = false
    setRecapLoading(true)
    getMesocycleRecapStats(run.id)
      .then((s) => {
        if (!ignore) {
          setRecapStats(s)
          setRecapLoading(false)
        }
      })
      .catch((e) => {
        if (!ignore) {
          setRecapErr(e instanceof Error ? e.message : String(e))
          setRecapLoading(false)
        }
      })
    return () => { ignore = true }
  }, [run])

  function handleChoice(choice: RecapChoice) {
    // up may not yet be loaded if the user_program fetch raced. Fall back to
    // the catalog so the user always ends up somewhere useful.
    const slug = up?.template_slug ?? null

    if (choice === 'deload') {
      // V2 will generate a dedicated deload mesocycle. For now, navigate to the
      // fork wizard for the same template with an intent hint so the user can
      // manually select a lighter week. If the template was archived (no slug),
      // fall through to catalog.
      if (slug) {
        navigate(`/programs/${encodeURIComponent(slug)}?intent=deload`)
      } else {
        navigate('/programs')
      }
    } else if (choice === 'run_it_back') {
      // Fork wizard for the same template — no special flag.
      if (slug) {
        navigate(`/programs/${encodeURIComponent(slug)}`)
      } else {
        navigate('/programs')
      }
    } else {
      // 'new_program' — browse catalog.
      navigate('/programs')
    }
  }

  async function refreshUserProgram() {
    if (!up) return
    try {
      const refreshed = await getUserProgram(up.id)
      setUp(refreshed)
    } catch (e) {
      setErr(`Refresh failed: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  async function handleAddSet(dayIdx: number, blockIdx: number) {
    if (!up) return
    try {
      await patchUserProgram(up.id, { op: 'add_set', day_idx: dayIdx, block_idx: blockIdx })
      await refreshUserProgram()
    } catch (e) {
      setErr(`Add set failed: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  async function handleRemoveSet(dayIdx: number, blockIdx: number, _setIdx: number) {
    if (!up) return
    try {
      await patchUserProgram(up.id, { op: 'remove_set', day_idx: dayIdx, block_idx: blockIdx })
      await refreshUserProgram()
    } catch (e) {
      setErr(`Remove set failed: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  // Heavy-tier destructive action. The ConfirmDialog gates this behind a typed
  // match of the program name (per the W6 destructive-confirm tier ladder).
  async function handleAbandon() {
    if (!run) return
    setAbandoning(true)
    try {
      await abandonMesocycle(run.id)
      setAbandonOpen(false)
      pushToast({ severity: 'success', body: 'Mesocycle abandoned.' })
      navigate('/programs')
    } catch (e) {
      setAbandonOpen(false)
      setErr(`Abandon failed: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setAbandoning(false)
    }
  }

  if (err) return <div style={{ padding: 16, color: TOKENS.danger }}>Couldn't load program: {err}</div>
  if (!run) return <div style={{ padding: 16, color: TOKENS.textDim }}>Loading…</div>

  if (run.status === 'completed') {
    if (recapLoading) {
      return <div style={{ padding: 24, color: TOKENS.textDim }}>Loading recap…</div>
    }
    if (recapErr) {
      return (
        <div style={{ padding: 24, color: TOKENS.danger }}>
          Couldn't load recap stats: {recapErr}
        </div>
      )
    }
    if (recapStats) {
      return <MesocycleRecap stats={recapStats} onChoice={handleChoice} />
    }
    // recapStats not yet populated (first render before effect fires) — show
    // a brief spinner to avoid a flash of empty content.
    return <div style={{ padding: 24, color: TOKENS.textDim }}>Loading recap…</div>
  }

  const programName = up?.effective_name ?? up?.name ?? ''

  return (
    <div style={{ color: TOKENS.text, display: 'flex', flexDirection: 'column', gap: 24 }}>
      <ProgramPage key={reloadTick} mesocycleRunId={id} />

      {/* W2.6 — manual mid-meso deload (active runs only). */}
      {run.status === 'active' && (
        <section style={{ padding: '0 24px', display: 'flex', justifyContent: 'flex-end' }}>
          <DeloadThisWeekButton runId={run.id} onChanged={() => setReloadTick((t) => t + 1)} />
        </section>
      )}

      <ScheduleWarnings warnings={warnings} />

      {up ? (
        <section style={{ padding: '0 24px 24px' }}>
          <h3 style={{ margin: '0 0 12px', fontSize: 14, color: TOKENS.textDim, fontFamily: 'Inter Tight' }}>
            Days
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fit, minmax(240px, 1fr))`, gap: 12 }}>
            {up.effective_structure.days.map((d) => (
              <DayCard
                key={d.idx}
                day={d}
                onAddSet={(dayIdx, blockIdx) => void handleAddSet(dayIdx, blockIdx)}
                onRemoveSet={(dayIdx, blockIdx, setIdx) => void handleRemoveSet(dayIdx, blockIdx, setIdx)}
                onSwap={(_dayIdx, _blockIdx) => pushToast({ severity: 'info', body: 'Exercise picker lands in W4. Use mid-session swap on mobile.' })}
              />
            ))}
          </div>
        </section>
      ) : null}

      <section style={{ padding: '0 24px 32px' }}>
        <h3 style={{ margin: '0 0 8px', fontSize: 14, color: TOKENS.danger, fontFamily: 'Inter Tight' }}>
          Danger zone
        </h3>
        <p style={{ margin: '0 0 12px', fontSize: 13, color: TOKENS.textDim, maxWidth: 520, lineHeight: 1.5 }}>
          Abandoning this <Term k="mesocycle" variant="abbr" /> ends it permanently. Logged sets are
          kept for your history, but the remaining schedule is discarded and cannot be resumed.
        </p>
        <button
          type="button"
          onClick={() => setAbandonOpen(true)}
          style={{
            padding: '8px 14px',
            background: 'transparent',
            border: `1px solid ${TOKENS.danger}`,
            borderRadius: 6,
            color: TOKENS.danger,
            fontFamily: 'Inter Tight',
            fontSize: 13,
            cursor: 'pointer',
          }}
        >
          Abandon this program
        </button>
      </section>

      <ConfirmDialog
        open={abandonOpen}
        tier="heavy"
        severity="danger"
        title="Abandon this program?"
        body={`This permanently ends “${programName}”. The remaining schedule is discarded and cannot be resumed. Type the program name to confirm.`}
        requireTyped={programName}
        confirmLabel={abandoning ? 'Abandoning…' : 'Abandon'}
        onConfirm={() => void handleAbandon()}
        onCancel={() => setAbandonOpen(false)}
      />
    </div>
  )
}
