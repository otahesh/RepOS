import type { ProgramTemplateStructure, UserProgramRecord } from './programs';
import type { ScheduleWarning } from '../../components/programs/ScheduleWarnings';
import { apiFetch } from '../../auth';
import { jsonOrThrow } from './_http';
export { ApiError } from './_http';

// Mirror of api/src/services/resolveUserProgramStructure.ts ResolvedUserProgram.
// API returns `effective_structure` (resolved with customizations applied) — not
// `structure`. Frontend was reading `structure` and rendering blank pages on
// every user-program detail load.
export type UserProgramDetail = UserProgramRecord & {
  effective_name: string;
  effective_structure: ProgramTemplateStructure;
  latest_run_id?: string;
};

// Mirror of api/src/schemas/userProgramPatch.ts UserProgramPatchSchema —
// a discriminated union on `op`. Each op is a flat object, NOT nested.
// Keep these in lockstep with the API; drift is the most common failure
// mode in this codebase.
export type UserProgramPatch =
  | { op: 'rename'; name: string }
  | { op: 'swap_exercise'; day_idx: number; block_idx: number; to_exercise_slug: string }
  | { op: 'swap_exercise_all'; from_slug: string; to_exercise_slug: string } // W4.1 every-occurrence swap
  | { op: 'add_set'; day_idx: number; block_idx: number }
  | { op: 'remove_set'; day_idx: number; block_idx: number }
  | { op: 'change_rir'; week_idx: number; day_idx: number; block_idx: number; target_rir: number }
  | { op: 'shift_weekday'; day_idx: number; to_day_offset: number }
  | { op: 'skip_day'; week_idx: number; day_idx: number }
  | { op: 'trim_week'; drop_last_n: number };

// include='past' returns all non-archived programs (client filters to
// completed/abandoned). include='archived' returns only archived programs.
// Default returns only active programs (draft/active/paused).
export async function listMyPrograms(opts?: {
  includePast?: boolean;
  includeArchived?: boolean;
}): Promise<UserProgramRecord[]> {
  const url = opts?.includeArchived
    ? '/api/user-programs?include=archived'
    : opts?.includePast
      ? '/api/user-programs?include=past'
      : '/api/user-programs';
  const res = await apiFetch(url, {});
  const data = await jsonOrThrow<{ programs: UserProgramRecord[] }>(res);
  return data.programs;
}

export async function deleteUserProgram(id: string): Promise<void> {
  const res = await apiFetch(`/api/user-programs/${encodeURIComponent(id)}`, { method: 'DELETE' });
  // 204 No Content on success; only parse (and throw) on error.
  if (!res.ok) await jsonOrThrow(res);
}

export async function archiveUserProgram(id: string): Promise<void> {
  const res = await apiFetch(`/api/user-programs/${encodeURIComponent(id)}/archive`, {
    method: 'POST',
  });
  await jsonOrThrow<{ ok: boolean }>(res);
}

export async function unarchiveUserProgram(id: string): Promise<void> {
  const res = await apiFetch(`/api/user-programs/${encodeURIComponent(id)}/unarchive`, {
    method: 'POST',
  });
  await jsonOrThrow<{ ok: boolean }>(res);
}

export async function getUserProgram(id: string): Promise<UserProgramDetail> {
  const res = await apiFetch(`/api/user-programs/${encodeURIComponent(id)}`, {});
  return jsonOrThrow(res);
}

export async function patchUserProgram(
  id: string,
  patch: UserProgramPatch,
): Promise<UserProgramRecord> {
  const res = await apiFetch(`/api/user-programs/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  return jsonOrThrow(res);
}

export async function startUserProgram(
  id: string,
  body: { start_date: string; start_tz: string },
): Promise<{ mesocycle_run_id: string }> {
  const res = await apiFetch(`/api/user-programs/${encodeURIComponent(id)}/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return jsonOrThrow(res);
}

export async function getUserProgramWarnings(id: string): Promise<ScheduleWarning[]> {
  const res = await apiFetch(`/api/user-programs/${encodeURIComponent(id)}/warnings`, {});
  const data = await jsonOrThrow<{ warnings: ScheduleWarning[] }>(res);
  return data.warnings;
}

// Mirror of api/src/schemas/userPrograms.ts ProgramMesocycle. Lists a
// program's mesocycle runs newest-first so the Past tab can link a completed
// program to its recap (WS6 / D6 / G7).
export type ProgramMesocycle = {
  id: string;
  status: UserProgramRecord['status'];
  start_date: string;
  finished_at: string | null;
  is_deload: boolean;
  weeks: number;
};

export async function listProgramMesocycles(id: string): Promise<ProgramMesocycle[]> {
  const res = await apiFetch(`/api/user-programs/${encodeURIComponent(id)}/mesocycles`, {});
  const data = await jsonOrThrow<{ mesocycles: ProgramMesocycle[] }>(res);
  return data.mesocycles;
}
