// Read-side mirror of api/src/services/_muscleLandmarks.ts (MUSCLE_LANDMARKS).
// Exists ONLY so the LandmarksEditor can compute soft-cap / clinical-floor math
// per keystroke without a round-trip. The AUTHORITATIVE validator is the server
// zod schema (api/src/schemas/userLandmarks.ts). If these drift, the editor's
// client-side hints use stale numbers but the server still rejects out-of-bounds
// values — so drift degrades hints, never correctness.
export const MUSCLE_LANDMARKS_SEED: Record<string, { mev: number; mav: number; mrv: number }> = {
  chest: { mev: 10, mav: 14, mrv: 22 },
  lats: { mev: 10, mav: 16, mrv: 22 },
  upper_back: { mev: 10, mav: 16, mrv: 24 },
  front_delt: { mev: 6, mav: 10, mrv: 16 },
  side_delt: { mev: 12, mav: 18, mrv: 26 },
  rear_delt: { mev: 10, mav: 16, mrv: 24 },
  biceps: { mev: 8, mav: 14, mrv: 20 },
  triceps: { mev: 8, mav: 14, mrv: 22 },
  quads: { mev: 8, mav: 14, mrv: 20 },
  hamstrings: { mev: 6, mav: 12, mrv: 18 },
  glutes: { mev: 4, mav: 12, mrv: 16 },
  calves: { mev: 10, mav: 14, mrv: 22 },
};
