// frontend/src/lib/api/manualDeload.ts
// W2.6 — manual mid-meso deload client wrappers.
import { apiFetch } from '../../auth';

export interface ManualDeloadResult {
  run_id: string;
  removed_planned_sets: number;
  affected_planned_sets: number;
  affected_day_workouts: number;
  affected_week_idxs: number[];
  triggered_at: string;
}

export async function triggerManualDeload(runId: string): Promise<ManualDeloadResult> {
  const res = await apiFetch(`/api/mesocycles/${runId}/deload-now`, { method: 'POST' });
  if (!res.ok) throw new Error(`manual_deload_failed_${res.status}`);
  return res.json();
}

export async function undoManualDeload(runId: string): Promise<{ reversed_at: string }> {
  const res = await apiFetch(`/api/mesocycles/${runId}/deload-now/undo`, { method: 'POST' });
  if (!res.ok) throw new Error(`manual_deload_undo_failed_${res.status}`);
  return res.json();
}
