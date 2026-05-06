import type { ProgramTemplateStructure, UserProgramRecord } from './programs';
import type { ScheduleWarning } from '../../components/programs/ScheduleWarnings';

// Mirror of api/src/services/resolveUserProgramStructure.ts ResolvedUserProgram.
// API returns `effective_structure` (resolved with customizations applied) — not
// `structure`. Frontend was reading `structure` and rendering blank pages on
// every user-program detail load.
export type UserProgramDetail = UserProgramRecord & {
  effective_name: string;
  effective_structure: ProgramTemplateStructure;
  latest_run_id?: string;
};

export type UserProgramPatch = Partial<{
  name: string;
  swap: { day_idx: number; block_idx: number; to_exercise_slug: string };
  add_set: { day_idx: number; block_idx: number };
  remove_set: { day_idx: number; block_idx: number; set_idx: number };
  shift_day: { from_day_idx: number; to_day_offset: number };
  skip_day: { day_idx: number };
}>;

async function jsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`HTTP ${res.status}: ${body || res.statusText}`);
  }
  return res.json() as Promise<T>;
}

export async function listMyPrograms(): Promise<UserProgramRecord[]> {
  const res = await fetch('/api/user-programs', { credentials: 'same-origin' });
  return jsonOrThrow(res);
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
