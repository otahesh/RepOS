// api/src/services/_deloadConstants.ts
// W2 + W4 shared deload constants. Both manual mid-meso deload (W2.5)
// and full deload-mesocycle (W4) compute reduced volume + reduced RIR
// from these numbers. Changing the constants here changes both surfaces.
//
// Manual-deload reduction (user decision D3, 2026-05-26):
//   reduced_sets = floor(MAV * MANUAL_DELOAD_MAV_FACTOR)
//   target_rir   = MANUAL_DELOAD_RIR
// where MAV is the per-user resolved landmark for the muscle of the
// block's primary exercise. If W4's resolveUserLandmarks() isn't yet
// available, the manual-deload service falls back to the seeded
// _muscleLandmarks.MUSCLE_LANDMARKS[muscle].mav (see manualDeload.ts).

export const MANUAL_DELOAD_MAV_FACTOR = 0.5;  // floor(MAV * 0.5)
export const MANUAL_DELOAD_RIR        = 4;    // RIR floor (was RIR=3 in v1 draft)

// (W4 may add FULL_DELOAD_* constants here when it lands.)
