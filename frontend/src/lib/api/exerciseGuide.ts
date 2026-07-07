/**
 * Frontend client for GET /api/exercises/:slug/guide (W2 setup cards).
 * Manually kept in sync with api/src/schemas/exerciseGuide.ts
 * (ExerciseGuideResponse) — see api/src/schemas/README.md.
 */

import { apiFetch } from '../../auth';
import { ApiError, jsonOrThrow } from './_http';

export type ExerciseGuide = {
  slug: string;
  setup_callout: string;
  setup_facts: Record<string, number | string>;
  cues: string[];
  donts: string[];
  media: { start?: string; end?: string };
};

/** 404 → null: "no guide" is an expected state (the UI hides ⓘ), not an error. */
export async function getExerciseGuide(slug: string): Promise<ExerciseGuide | null> {
  const res = await apiFetch(`/api/exercises/${encodeURIComponent(slug)}/guide`, {});
  try {
    return await jsonOrThrow<ExerciseGuide>(res);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}
