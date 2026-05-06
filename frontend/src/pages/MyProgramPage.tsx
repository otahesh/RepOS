import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { ProgramPage } from '../components/programs/ProgramPage'
import { DayCard } from '../components/programs/DayCard'
import { ScheduleWarnings, type ScheduleWarning } from '../components/programs/ScheduleWarnings'
import { getMesocycle, type MesocycleRunDetail } from '../lib/api/mesocycles'
import {
  getUserProgram,
  getUserProgramWarnings,
  patchUserProgram,
  type UserProgramDetail,
} from '../lib/api/userPrograms'
import { TOKENS } from '../tokens'

// :id here is the mesocycle_run_id — that's what ProgramPage and the
// volume rollup keys off. The user_program_id is derived from the run.
export default function MyProgramPage() {
  const { id = '' } = useParams<{ id: string }>()
  const [run, setRun] = useState<MesocycleRunDetail | null>(null)
  const [up, setUp] = useState<UserProgramDetail | null>(null)
  const [warnings, setWarnings] = useState<ScheduleWarning[]>([])
  const [err, setErr] = useState<string | null>(null)

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
      await patchUserProgram(up.id, { add_set: { day_idx: dayIdx, block_idx: blockIdx } })
      await refreshUserProgram()
    } catch (e) {
      setErr(`Add set failed: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  async function handleRemoveSet(dayIdx: number, blockIdx: number, setIdx: number) {
    if (!up) return
    try {
      await patchUserProgram(up.id, { remove_set: { day_idx: dayIdx, block_idx: blockIdx, set_idx: setIdx } })
      await refreshUserProgram()
    } catch (e) {
      setErr(`Remove set failed: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  if (err) return <div style={{ padding: 16, color: TOKENS.danger }}>Couldn't load program: {err}</div>
  if (!run) return <div style={{ padding: 16, color: TOKENS.textDim }}>Loading…</div>

  // Completed-mesocycle placeholder. Real recap UI lands when the
  // /mesocycles/:id/recap-stats endpoint exists; rendering MesocycleRecap
  // with zeros here would show a misleading "0 sets · 0 PRs".
  if (run.status === 'completed') {
    return (
      <div style={{ padding: 24, color: TOKENS.text }}>
        <h2 style={{ fontSize: 22, fontWeight: 700, letterSpacing: -0.5, marginBottom: 8 }}>Mesocycle complete</h2>
        <p style={{ color: TOKENS.textDim, fontSize: 14, lineHeight: 1.5, maxWidth: 520 }}>
          You wrapped this mesocycle ({run.weeks} weeks). The full recap — total working sets, PRs, deload recommendation — lands in a follow-up PR alongside the recap-stats endpoint.
        </p>
      </div>
    )
  }

  return (
    <div style={{ color: TOKENS.text, display: 'flex', flexDirection: 'column', gap: 24 }}>
      <ProgramPage mesocycleRunId={id} />

      <ScheduleWarnings warnings={warnings} />

      {up ? (
        <section style={{ padding: '0 24px 24px' }}>
          <h3 style={{ margin: '0 0 12px', fontSize: 14, color: TOKENS.textDim, fontFamily: 'Inter Tight' }}>
            Days
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(${up.structure.days.length}, 1fr)`, gap: 12 }}>
            {up.structure.days.map((d) => (
              <DayCard
                key={d.idx}
                day={d}
                onAddSet={(dayIdx, blockIdx) => void handleAddSet(dayIdx, blockIdx)}
                onRemoveSet={(dayIdx, blockIdx, setIdx) => void handleRemoveSet(dayIdx, blockIdx, setIdx)}
                onSwap={(_dayIdx, _blockIdx) => alert('Exercise picker not yet wired — coming in next PR.')}
              />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  )
}
