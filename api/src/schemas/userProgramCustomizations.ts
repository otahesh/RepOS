// The shape persisted in user_programs.customizations (JSONB). Written ONLY by
// the PATCH reducer in routes/userPrograms.ts and read by
// services/resolveUserProgramStructure.ts + services/materializeMesocycle.ts.
// Typing the blob (it was `any`) means a mismatched key between writer and
// reader — the silent-program-corruption class the spec cares about — no longer
// compiles. All fields are optional: a customizations blob starts as `{}`.

/** A single-block exercise swap. week_idx is always 1 (program-wide). */
export interface SwapEntry {
  week_idx: number;
  day_idx: number;
  block_idx: number;
  from_slug: string;
  to_slug: string;
}

/** Audit sibling of a swap_exercise_all op (the every-occurrence rewrite). */
export interface SwapAllEntry {
  from_slug: string;
  to_slug: string;
}

/** Set-count delta at a block (summed across repeated add/remove). */
export interface SetCountOverride {
  week_idx: number;
  day_idx: number;
  block_idx: number;
  delta: number;
}

/** Move a day to a different day-of-week offset. */
export interface DayOffsetOverride {
  week_idx: number;
  day_idx: number;
  new_day_offset: number;
}

/** A skipped day. */
export interface SkippedDay {
  week_idx: number;
  day_idx: number;
}

/** A per-block target-RIR override. */
export interface RirOverride {
  week_idx: number;
  day_idx: number;
  block_idx: number;
  target_rir: number;
}

export interface UserProgramCustomizations {
  name_override?: string;
  swaps?: SwapEntry[];
  swaps_all?: SwapAllEntry[];
  set_count_overrides?: SetCountOverride[];
  day_offset_overrides?: DayOffsetOverride[];
  skipped_days?: SkippedDay[];
  rir_overrides?: RirOverride[];
  /** Drop the last N weeks of the mesocycle. */
  trim_last_n?: number;
  // User-authored program path (no template_id): the structure + week count
  // live in the blob. Kept `unknown` here so callers narrow explicitly.
  structure?: unknown;
  weeks?: number;
}
