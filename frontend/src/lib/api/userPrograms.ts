import type { ProgramTemplateStructure, UserProgramRecord } from './programs';
import type { ScheduleWarning } from '../../components/programs/ScheduleWarnings';
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
  | { op: 'add_set'; day_idx: number; block_idx: number }
  | { op: 'remove_set'; day_idx: number; block_idx: number }
  | { op: 'change_rir'; week_idx: number; day_idx: number; block_idx: number; target_rir: number }
  | { op: 'shift_weekday'; day_idx: number; to_day_offset: number }
  | { op: 'skip_day'; week_idx: number; day_idx: number }
  | { op: 'trim_week'; drop_last_n: number };

// include='past' returns abandoned + completed programs in addition to active ones.
// Default (omitted) returns only active programs (draft/active/paused).
export async function listMyPrograms(opts?: { includePast?: boolean }): Promise<UserProgramRecord[]> {
  const url = opts?.includePast ? '/api/user-programs?include=past' : '/api/user-programs';
  const res = await fetch(url, { credentials: 'same-origin' });
  const data = await jsonOrThrow<{ programs: UserProgramRecord[] }>(res);
  return data.programs;
}

export async function getUserProgram(id: string): Promise<UserProgramDetail> {
  const res = await fetch(`/api/user-programs/${encodeURIComponent(id)}`, { credentials: 'same-origin' });
  return jsonOrThrow(res);
}

export async function patchUserProgram(id: string, patch: UserProgramPatch): Promise<UserProgramRecord> {
  const res = await fetch(`/api/user-programs/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify(patch),
  });
  return jsonOrThrow(res);
}

export async function startUserProgram(
  id: string,
  body: { start_date: string; start_tz: string }
): Promise<{ mesocycle_run_id: string }> {
  const res = await fetch(`/api/user-programs/${encodeURIComponent(id)}/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify(body),
  });
  return jsonOrThrow(res);
}

export async function getUserProgramWarnings(id: string): Promise<ScheduleWarning[]> {
  const res = await fetch(`/api/user-programs/${encodeURIComponent(id)}/warnings`, { credentials: 'same-origin' });
  const data = await jsonOrThrow<{ warnings: ScheduleWarning[] }>(res);
  return data.warnings;
}
