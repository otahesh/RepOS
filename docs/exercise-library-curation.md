# Exercise Library Curation Guide

## Process for adding/updating entries

1. Add or edit the entry in `api/src/seed/exercises.ts`
2. Each field is curated against:
   - **muscle_contributions:** RP's *Scientific Principles of Hypertrophy Training* tables. Primary muscle = 1.0; secondaries 0.25–0.75 reflecting actual stimulus.
   - **peak_tension_length:** where peak tension lands relative to muscle length (Pelland 2024, Wolf 2023). Long-length-biased = `long`. Mid-range = `mid`. Short-length = `short`. If the variant exists specifically as a stretch-position partial (e.g., lengthened-partial RDL), `lengthened_partial_capable`.
   - **skill_complexity (1–5):** 1 = leg extension, 3 = back squat, 5 = snatch.
   - **loading_demand (1–5):** training-age threshold to load productively. 1 = beginner-safe, 5 = advanced-only.
   - **systemic_fatigue (1–5):** 1 = leg extension, 3 = bench, 5 = heavy deadlift.
   - **joint_stress_profile:** per-joint subjective load. Be honest; this gates v2 injury filters.
   - **contraindications:** drawn from the controlled vocabulary in the seed file header.
   - **screening BOOLEANs:** answer literally for the standard execution.

3. Run `npm test tests/seed/validator.test.ts` to confirm structure.
4. Run `npm run seed` against a dev DB to confirm the runner accepts it.
5. PR with the updated seed file.

## Excluded movements (do NOT add to curated seed)

- Behind-the-neck press (any variant)
- Behind-the-neck pulldown
- Narrow-grip pronated upright row above sternum
- Kipping pullups / kipping ring dips
- Jefferson curl under load
- Full-ROM good mornings >bodyweight
- Sissy squat without assistance
- Dragon flag

These can re-enter via v3 user-created exercises with explicit warning UX.

## Vocabulary Gaps (v1 movement_pattern limitations)

The 11 v1 movement patterns (`push_horizontal`, `push_vertical`, `pull_horizontal`,
`pull_vertical`, `squat`, `hinge`, `lunge`, `carry`, `rotation`, `anti_rotation`,
`gait`) do not have a native representation for open-chain knee isolation exercises.

**Workarounds in effect:**

- `leg-extension-machine` is classified as `push_vertical` — the closest functional
  analog (press the lever forward/up, lower-body equivalent of a vertical press).
  This is intentional and prevents the substitution engine from returning leg
  extension as a candidate sub for back squat or front squat (closed-chain squat
  pattern). It is **not** biomechanically precise.

- `leg-curl-machine` is classified as `pull_vertical` — parallel reasoning (pull the
  lever down/back, lower-body equivalent of a vertical pull). Prevents leg curl from
  appearing as a hinge-pattern substitute for RDL or deadlift variants.

**v1.5 action item:** Add `knee_extension` and `knee_flexion` movement patterns to
the schema vocabulary, then re-classify these two entries. Track in the exercise
library roadmap issue.

## Adding a new equipment type

1. Add the key to `api/src/services/equipmentRegistry.ts`
2. Add a corresponding predicate type to `api/src/schemas/predicate.ts`
3. Add the SQL template to `api/src/services/predicateCompiler.ts`
4. Add a stepper UI to `frontend/src/components/settings/EquipmentEditor.tsx`
