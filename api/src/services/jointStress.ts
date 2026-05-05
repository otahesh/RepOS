// api/src/services/jointStress.ts
import { db } from '../db/client.js';

const SOFT_CAPS: Record<string, number> = {
  lumbar: 16, knee: 20, shoulder: 14,
};
const HIGH_LEVEL = 'high';

export type JointStressWarning =
  | { kind: 'soft_cap_lumbar'; sets: number }
  | { kind: 'soft_cap_knee'; sets: number }
  | { kind: 'soft_cap_shoulder'; sets: number }
  | { kind: 'multi_high_lumbar_in_session'; day_workout_id: string; exercises: string[] };

export type WeekJointStress = {
  week_idx: number;
  joints: Record<string, { sets: number; score: number }>;
  warnings: JointStressWarning[];
};

export type JointStressReport = {
  run_id: string;
  weeks: WeekJointStress[];
};

export async function computeWeeklyJointStress(runId: string): Promise<JointStressReport> {
  const { rows } = await db.query<{
    week_idx: number; day_workout_id: string; exercise_id: string; ex_name: string;
    sets: number; profile: any;
  }>(
    `SELECT dw.week_idx, dw.id AS day_workout_id, e.id AS exercise_id, e.name AS ex_name,
            COUNT(*)::int AS sets,
            e.joint_stress_profile AS profile
     FROM planned_sets ps
     JOIN day_workouts dw ON dw.id=ps.day_workout_id
     JOIN exercises e ON e.id=ps.exercise_id
     WHERE dw.mesocycle_run_id=$1
     GROUP BY dw.week_idx, dw.id, e.id, e.name, e.joint_stress_profile`,
    [runId],
  );

  const byWeek = new Map<number, WeekJointStress>();
  for (const r of rows) {
    let wk = byWeek.get(r.week_idx);
    if (!wk) { wk = { week_idx: r.week_idx, joints: {}, warnings: [] }; byWeek.set(r.week_idx, wk); }

    const profile = r.profile ?? { _v: 1 };
    for (const [joint, raw] of Object.entries(profile)) {
      if (joint === '_v') continue;
      const entry = raw as { level?: string; stress?: number };
      if (typeof entry.stress !== 'number') continue;
      const cur = wk.joints[joint] ?? { sets: 0, score: 0 };
      cur.sets += r.sets;
      cur.score += r.sets * entry.stress;
      wk.joints[joint] = cur;
    }
  }

  // Per-session multi-high-lumbar check.
  const bySession = new Map<string, { week_idx: number; exercises: string[] }>();
  for (const r of rows) {
    const profile = r.profile ?? {};
    const lum = profile?.lumbar;
    if (lum?.level === HIGH_LEVEL) {
      const cur = bySession.get(r.day_workout_id) ?? { week_idx: r.week_idx, exercises: [] };
      if (!cur.exercises.includes(r.ex_name)) cur.exercises.push(r.ex_name);
      bySession.set(r.day_workout_id, cur);
    }
  }
  for (const [dwId, info] of bySession) {
    if (info.exercises.length >= 2) {
      const wk = byWeek.get(info.week_idx);
      wk?.warnings.push({ kind: 'multi_high_lumbar_in_session', day_workout_id: dwId, exercises: info.exercises });
    }
  }

  // Soft-cap warnings — count high-stress sets only.
  const highByWeekJoint = new Map<string, number>();
  for (const r of rows) {
    const profile = r.profile ?? {};
    for (const [joint, raw] of Object.entries(profile)) {
      if (joint === '_v') continue;
      const entry = raw as { level?: string };
      if (entry.level !== HIGH_LEVEL) continue;
      const k = `${r.week_idx}|${joint}`;
      highByWeekJoint.set(k, (highByWeekJoint.get(k) ?? 0) + r.sets);
    }
  }
  for (const [k, sets] of highByWeekJoint) {
    const [wStr, joint] = k.split('|');
    const cap = SOFT_CAPS[joint];
    if (cap && sets > cap) {
      const wk = byWeek.get(Number(wStr));
      const kind = `soft_cap_${joint}` as 'soft_cap_lumbar'|'soft_cap_knee'|'soft_cap_shoulder';
      if (kind === 'soft_cap_lumbar' || kind === 'soft_cap_knee' || kind === 'soft_cap_shoulder') {
        wk?.warnings.push({ kind, sets });
      }
    }
  }

  return { run_id: runId, weeks: Array.from(byWeek.values()).sort((a, b) => a.week_idx - b.week_idx) };
}
