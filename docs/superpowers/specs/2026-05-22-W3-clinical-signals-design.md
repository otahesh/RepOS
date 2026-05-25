# W3 — Clinical Signals + Injury Swap (Design)

**Date:** 2026-05-22
**Status:** Design approved by user. Implementation plan pending (next: `superpowers:writing-plans`).
**Master plan:** [docs/superpowers/plans/2026-05-11-repos-beta.md §W3](../plans/2026-05-11-repos-beta.md)
**Live dashboard:** [docs/superpowers/goals/beta.md](../goals/beta.md)
**Signal contract pinned by W1:** [api/tests/integration/set-logs-to-recovery-flags.test.ts](../../../api/tests/integration/set-logs-to-recovery-flags.test.ts)

## Outcome

Ship the clinical-safety layer of RepOS Beta:

1. **Recovery-flag evaluators** (`stalledPrEvaluator` + `overreachingEvaluator`) that read the `set_logs` data W1 ships and surface advisory toasts on the live logger.
2. **Injury-aware substitution ranker** that demotes (but never blocks) candidates whose `joint_stress_profile` overlaps the user's noted injuries, surfacing a *joint-stress reason* — never the user's raw injury note.
3. **"Got a tweak?" entry point** on `<TodayWorkoutMobile>` that opens `<MidSessionSwapSheet>` pre-loaded with injury context.
4. **Settings injury-notes UI** — multi-select chips with inline per-row severity + notes + onset date, persisted to a dedicated `user_injuries` table.

The wave contributes to G2 (contamination matrix gains 4 new routes) and G7 (reachability — `/settings/injuries` and "Got a tweak?" reachable from `/` in ≤3 clicks).

## Locked decisions (Q1–Q7)

The brainstorming pass narrowed seven structural choices. Each is binding for the implementation plan; deviations require re-opening this spec.

| # | Decision | Rationale anchor |
|---|----------|------------------|
| Q1 | **Strict overreaching evaluator:** `AND(≥3 RIR-0 sessions in trailing 7d on compound exercises, current-ISO-week volume ≥ MAV for the worked muscle, not dismissed this ISO week)`. Compounds = `movement_pattern IN ('squat','hinge','push_horizontal','push_vertical','pull_horizontal','pull_vertical')`. Volume sourced from W1's `volumeRollup` service, which is ISO-week-keyed and already blends cardio strain per [[feedback_cardio_first_class]]. | Master plan §W3 + reviewer NIT line 615. Beta is the validation surface ([[project_beta_no_staging]]) — a noisy toast erodes trust faster than a missed signal. |
| Q1b | **Stalled-PR evaluator** (pinned by master plan, not negotiated this pass): fires when the most recent 3 logged sessions on a single exercise show no `weight_lbs` *or* `reps` increase, with `performed_rir = 0` on every set in those sessions. Per-exercise, per-user. Same ISO-week dismiss model as overreaching (Q6). | Master plan §W3 W3.1. |
| Q2 | **Separate `user_injuries` table** with per-joint severity, notes, onset_at. Not a column on `users`. | Audit-grade row events; clean joins for the ranker; user preference for flexibility over compactness. |
| Q3 | **Expanding chips Settings UI.** Chip toggle inserts/deletes a row; expanded chip shows inline severity buttons, notes textarea, optional onset_at date. Mobile + desktop, same component. | Uses every column of the C-schema; matches design-system chip-expand pattern (e.g. `EquipmentEditor`); mobile-friendly per [[project_responsive_chrome]]. |
| Q4 | **Hybrid ranker.** Server reorders candidates + tags each penalized one with `injury_advisory: { joint, level }`. Client renders human copy from the structured tag via `t()` helper. | Clinical scoring stays deterministic + vitest-testable server-side; copy stays in design-system voice client-side ([[feedback_terms_of_art_tooltips]] applies to advisory copy); structured tag is exactly what `recovery_flag_events` telemetry will consume. |
| Q5 | **Per-block "..." overflow menu** on `<TodayWorkoutMobile>`. Menu items: "Got a tweak?" → opens `<MidSessionSwapSheet>` pre-loaded with injury context; "Swap exercise" (direct swap UX kept for power users); future "Skip remaining sets" entry point. | Reviewer NIT line 618; reuses existing overflow pattern; doesn't compete with W1.3 `<LogBufferRecovery>` / `<SessionExpiredBanner>` real estate at the top. |
| Q6 | **Strict ISO-week dismiss model.** Show on first poll per ISO week where condition is true AND not dismissed-this-week. Dismiss silences for the rest of the ISO week (Monday 00:00 user-TZ resets). Refire next Monday if condition still true. | Master plan as-written; `recovery_flag_dismissals` (migration 024, already shipped) is already keyed per ISO week — zero schema churn. |
| Q7 | **7 injury chips:** `shoulder_left`, `shoulder_right`, `low_back`, `knee_left`, `knee_right`, `elbow`, `wrist`. No extensions. | Every chip maps to a joint key the `joint_stress_profile` actually carries — adding non-mapped chips (ankle, hip, neck) would be a UX lie since the ranker can't act on them until exercise seeds gain those keys (post-Beta data exercise). |

## Architecture

```
┌──────────────────────── client (frontend) ────────────────────────┐
│                                                                   │
│  /settings/injuries           /today/:runId/log                   │
│  ┌─────────────────────┐      ┌─────────────────────────────┐    │
│  │ <InjuryChipsEditor> │      │ <TodayWorkoutMobile>        │    │
│  │  expanding chips    │      │   ┌─────────────────────┐   │    │
│  │  → CRUD on rows     │      │   │ <BlockOverflowMenu> │──┼─┐  │
│  └─────────────────────┘      │   │  "Got a tweak?"     │   │ │  │
│           │                   │   └─────────────────────┘   │ │  │
│           ▼                   │   ┌─────────────────────┐   │ │  │
│  GET/POST/PATCH/DELETE        │   │ <RecoveryFlagToast> │   │ │  │
│  /api/user/injuries           │   └─────────────────────┘   │ │  │
│                               └─────────────────────────────┘ │  │
│                                              │                │  │
│                              GET /api/recovery-flags          │  │
│                              POST /api/recovery-flags/dismiss │  │
│                                                               │  │
│                                            opens with         │  │
│                                            injury context ────┘  │
│                                            <MidSessionSwapSheet> │
└──────────────────────────────────────────────────────────────────┘
                                       │
                                       │ HTTPS
                                       ▼
┌──────────────────────── server (api) ─────────────────────────────┐
│                                                                   │
│  routes/userInjuries.ts    routes/recoveryFlags.ts (existing)     │
│       │                          │                                │
│       │                  ┌───────┴──────┐                         │
│       │                  │ evaluators:  │                         │
│       │                  │  bodyweight  │ (existing)              │
│       │                  │  overreaching│ NEW W3.1                │
│       │                  │  stalledPr   │ NEW W3.1                │
│       │                  └──────────────┘                         │
│       │                          │                                │
│       │                          │ writes telemetry               │
│       │                          ▼                                │
│       │              recovery_flag_events  (migration 033)        │
│       │                                                           │
│       ▼                                                           │
│  user_injuries (migration 032)                                    │
│                                                                   │
│  routes/exercises.ts → services/substitutions.ts (existing,       │
│       │                                            extended)      │
│       │                          │                                │
│       │                          ▼                                │
│       │                  injuryRanker.ts (NEW W3.2)               │
│       │                  - reads user_injuries                    │
│       │                  - matches joint_stress_profile           │
│       │                  - emits injury_advisory tag              │
└───────────────────────────────────────────────────────────────────┘
```

Three new server units: `routes/userInjuries.ts`, `services/injuryRanker.ts`, two new evaluators registered in `services/recoveryFlags.ts`. Two new tables (migrations 032 + 033). Two new frontend components: `<InjuryChipsEditor>` (settings) and `<RecoveryFlagToast>` (today screen). Everything else extends what W1 already shipped.

### Sequencing — Approach A (schema-first, then parallel fan-out)

```
Phase 1 (serial): migrations 032 (user_injuries) + 033 (recovery_flag_events)
                  + zod schemas + userInjuries CRUD routes
Phase 2 (parallel via worktrees, per [[feedback_worktree_isolation]]):
  ├─ W3.1 evaluators   stalledPr + overreaching, registered in recoveryFlags service
  ├─ W3.2 ranker       extend findSubstitutions + injury_advisory tag
  ├─ W3.3 entry point  "Got a tweak?" per-block menu wiring
  └─ W3.4 Settings UI  expanding chips against the live user_injuries API
Phase 3 (serial): reviewer matrix → fixes → wave-complete summary → merge
```

This mirrors the W1 playbook (migrations 029/030 landed first, then fan-out).

## Components

| Layer | Path | Purpose | Est. LOC |
|-------|------|---------|---------|
| migration | `api/src/db/migrations/032_user_injuries.sql` | rows: `(user_id, joint, severity, notes, onset_at, created_at, updated_at)`; PK `(user_id, joint)`; FK to `users(id) ON DELETE CASCADE`; `joint` CHECK against 7-key enum; `severity` CHECK in `('low','mod','high')` | 25 |
| migration | `api/src/db/migrations/033_recovery_flag_events.sql` | rows: `(id, user_id, flag, week_start, event_type, occurred_at)`; `event_type` CHECK in `('shown','dismissed')`; index on `(user_id, week_start, flag)` | 20 |
| schema | `api/src/schemas/userInjuries.ts` | zod schemas + types for `UserInjuryItem`, `UserInjuryUpsertRequest`, list response, joint-key enum, severity enum | 80 |
| route | `api/src/routes/userInjuries.ts` | `GET /api/user/injuries` (list), `POST /api/user/injuries` (upsert), `PATCH /api/user/injuries/:joint` (edit), `DELETE /api/user/injuries/:joint` (remove). All bearer-OR-CF-Access. New scopes: `health:injuries:write` (POST/PATCH/DELETE), `health:injuries:read` (GET) | 120 |
| service | `api/src/services/injuryRanker.ts` | `applyInjuryAdvisory(candidates, userId): Promise<Candidate[]>` — reads `user_injuries`, maps joints via `joint_root()`, penalizes scores (`mod`: -150, `high`: -300), attaches `injury_advisory: { joint, level }`, re-sorts | 60 |
| extend | `api/src/services/recoveryFlags.ts` | Add `overreachingEvaluator` + `stalledPrEvaluator`. Both record telemetry rows to `recovery_flag_events` on `shown` emit. | 90 |
| extend | `api/src/services/substitutions.ts` | Pipe `findSubstitutions` result through `injuryRanker.applyInjuryAdvisory` before truncation; surface `injury_advisory` in `SubResult.subs[]` | 20 |
| extend | `api/src/schemas/exercises.ts` | `SubstitutionResponse.subs[]` gains optional `injury_advisory: { joint, level }` | 10 |
| frontend | `frontend/src/components/settings/InjuryChipsEditor.tsx` | 7 chip grid; chip toggle = insert/delete row; expanded chip shows inline severity buttons (low/mod/high), notes textarea, optional onset_at date picker; aria-expanded on each chip | 220 |
| frontend | `frontend/src/components/programs/RecoveryFlagToast.tsx` | Renders one flag at a time (queue if multiple); dismiss button → optimistic hide + `POST /api/recovery-flags/dismiss` with offline-queue fallback (reuse W1.3 `logBuffer` pattern) | 90 |
| frontend | `frontend/src/components/programs/BlockOverflowMenu.tsx` (new, used by `TodayWorkoutMobile`) | Per-block "..." trigger; menu items: "Got a tweak?" / "Swap exercise" / placeholder for future "Skip remaining sets" | 60 |
| frontend | extend `TodayWorkoutMobile.tsx` | Mount `<BlockOverflowMenu>` per block; on "Got a tweak?" open `<MidSessionSwapSheet>` with `prefilledByInjuries: true` flag | 30 |
| frontend | extend `MidSessionSwapSheet.tsx` | Fetch candidates via existing `getSubstitutions`; read `injury_advisory` per candidate; render advisory copy via `t('injury_advisory', advisory)` helper; demoted candidates still clickable (advisory ≠ block) | 30 |
| frontend | `frontend/src/lib/api/userInjuries.ts` | typed client: `listInjuries()`, `upsertInjury(data)`, `deleteInjury(joint)` | 50 |
| frontend | extend `frontend/src/lib/api/recoveryFlags.ts` | already exists; no new shape needed | 0 |
| frontend | extend `frontend/src/lib/terms.ts` | add `<Term>` entries: `overreaching`, `stalled-pr`, `joint-stress`. (RIR/MAV already present.) Per [[feedback_terms_of_art_tooltips]]. | 15 |

**Estimated total: ~890 LOC across server + frontend.** For comparison, W1 was ~3,200 LOC; W3 is roughly one-third the size.

### Internal helper — `joint_root()`

Hardcoded mapping from injury-chip key to `joint_stress_profile` key:

```ts
const JOINT_ROOT: Record<InjuryJointKey, string> = {
  shoulder_left:  'shoulder',
  shoulder_right: 'shoulder',
  low_back:       'lumbar',
  knee_left:      'knee',
  knee_right:     'knee',
  elbow:          'elbow',
  wrist:          'wrist',
};
```

Lives in `api/src/services/injuryRanker.ts`. No DB lookup. Adding new chips requires editing this map AND adding the joint to exercise seeds — both intentional.

## Data flow A — overreaching toast fires + dismisses

```
User POSTs 3rd RIR-0 set on Back Squat (compound)
         │
         ▼
POST /api/set-logs  ────►  row inserted in set_logs
         │
         │ frontend then polls (or initial /today mount):
         ▼
GET /api/recovery-flags
         │
         ▼  server-side:
recoveryFlags.evaluateAll({ user_id, now })
  ├─ bodyweightCrashEvaluator → false
  ├─ stalledPrEvaluator       → false
  └─ overreachingEvaluator    → TRUE
       │
       │  isDismissed(user_id, 'overreaching', '2026-W21') → false
       │
       │  → write recovery_flag_events { event_type: 'shown', week_start: '2026-W21', ... }
       ▼
returns: { flags: [{ flag: 'overreaching', message: "Heavy week — consider a deload" }] }
         │
         ▼  client renders <RecoveryFlagToast>
         │
         │  user taps "Dismiss"
         ▼
POST /api/recovery-flags/dismiss { flag: 'overreaching' }
         │
         ▼  server-side:
recordDismissal(user_id, 'overreaching', '2026-W21')
  → insert into recovery_flag_dismissals (existing migration 024)
  → write recovery_flag_events { event_type: 'dismissed', ... }
         │
         ▼
204 → client purges toast from state
```

## Data flow B — "Got a tweak?" with injury-aware ranking

```
User taps "..." on Back Squat block → "Got a tweak?"
         │
         ▼
GET /exercises/back-squat/substitutions?planned_set_id=…
         │
         ▼  server-side:
findSubstitutions(target='back-squat', equipmentProfile)
  → 25 candidates, scored
         │
         │  pipe through:
         ▼
applyInjuryAdvisory(candidates, user_id)
  ├─ SELECT joint FROM user_injuries WHERE user_id=$1 → ['knee_left']
  ├─ for each candidate:
  │   - load joint_stress_profile
  │   - if stress[joint_root('knee_left')] in ('mod','high'):
  │       penalty = (level === 'high' ? 300 : 150)
  │       candidate.score -= penalty
  │       candidate.injury_advisory = { joint: 'knee_left', level: 'high' }
  │   - else: no tag
  └─ re-sort by adjusted score
         │
         ▼
returns: { subs: [
  { id, slug: 'leg-press',              name: 'Leg Press', score: 380, reason: '...', injury_advisory: null },
  { id, slug: 'bulgarian-split-squat',  name: 'BSS',       score: 250, reason: '...',
    injury_advisory: { joint: 'knee_left', level: 'mod' } },  // demoted, tagged
  ...
] }
         │
         ▼  client opens <MidSessionSwapSheet>
         │  for each candidate with injury_advisory:
         │    render copy: t('injury_advisory', advisory)
         │    → "Higher knee load — you noted left knee"
         │    (NOT the user's raw note, per reviewer NIT line 617)
         │
         │  user picks any candidate (including demoted ones — advisory ≠ block)
         │
         ▼
POST /api/planned-sets/:id/substitute { to_exercise_id: <chosen> }
         │
         ▼
202 → planned_sets row updated; sheet closes; UI re-renders
```

### Penalty tuning rationale

The penalty constants (`mod`: -150, `high`: -300) are tuned so that even a `high`-load candidate isn't fully buried. Median score gap between adjacent candidates in the existing seed is ~500, so a `high` penalty drops a candidate ~half a slot — preserving "advisory ≠ block." Constants live in `injuryRanker.ts` and are a single PR to tune post-cohort.

## Error handling

| Surface | Failure mode | Handling |
|---------|--------------|----------|
| `POST /api/user/injuries` | unknown `joint` value | 400 with `field_error: { joint: 'unknown_joint' }`; zod enforces against 7-key enum |
| `POST /api/user/injuries` | duplicate `(user_id, joint)` | 200 idempotent update of `severity`/`notes`/`onset_at`, same shape as health_weight dedup |
| `DELETE /api/user/injuries/:joint` | row not found | 204 idempotent (no-op success) |
| `GET /api/recovery-flags` | evaluator throws (e.g. DB blip) | Catch per-evaluator; skip that flag; log; never 5xx the whole call |
| `GET /exercises/:slug/substitutions` | injury fetch fails | Return candidates without `injury_advisory` tags; log; never fail the swap sheet |
| `<RecoveryFlagToast>` | dismiss POST 5xx | Optimistic UI: hide toast immediately; backoff-retry dismiss in `lib/dismissQueue.ts` (reuse W1.3 `logBuffer` pattern); banner on persistent failure |
| `<InjuryChipsEditor>` | concurrent edit (user toggles two chips fast) | Per-chip pending state; queue mutations FIFO; rollback chip on PATCH error with toast |
| `<MidSessionSwapSheet>` | advisory copy key missing for a joint | Fall back to generic "Joint stress on this lift" copy; `console.warn` (never crash) |
| migration 032 | rollback path (per G6) | CREATE TABLE only — no Step-2 destructive needed. Forward-only; rollback is `DROP TABLE user_injuries CASCADE` if behavior diverges |
| auth | bearer without injury scope hitting `/api/user/injuries` | 403; CF-Access still passes through; new scopes: `health:injuries:write` for write methods, `health:injuries:read` for GET |

**Two principles enforced everywhere:**

- *Never break the workout flow.* W3 is a clinical-safety layer, not a hard dependency. Every server path that touches injuries/flags fails open — the user can always log the next set.
- *Never expose the user's raw note.* Per reviewer NIT line 617, advisory copy derives from the structured `injury_advisory` tag, never from `user_injuries.notes`. Notes are display-only on the Settings page.

## Testing posture

### Unit (vitest) — `api/`

- `services/recoveryFlags.test.ts` (extend) — `stalledPrEvaluator`: 3 sessions same weight+reps RIR-0 fires; 3 sessions with any increase doesn't; non-RIR-0 in the streak doesn't. `overreachingEvaluator`: each of the 3 AND-gate conditions independently fails the rule + combined-true case fires.
- `services/injuryRanker.test.ts` (new) — no injuries (passthrough), one injury matching one candidate (penalty + tag), two injuries one candidate (highest penalty wins), unknown joint (skip), exercise with no `joint_stress_profile.knee` (no tag).
- `routes/userInjuries.test.ts` (new) — CRUD happy path + IDOR test (user A ≠ user B injury access) + scope-rejection (a bearer with `set_logs:write` only can't write injuries) + 7-key joint enum enforcement.

### Integration (vitest) — `api/tests/integration/`

- `recovery-flag-overreaching-e2e.test.ts` — seed user → seed mesocycle with a compound block → POST 3 RIR-0 set_logs → `GET /api/recovery-flags` → assert overreaching present → POST dismiss → GET again → assert empty.
- `recovery-flag-telemetry.test.ts` — verify `recovery_flag_events` rows land on both `shown` and `dismissed` events with the right `week_start`.
- **Re-enable the `it.skip` in `set-logs-to-recovery-flags.test.ts`** — flip the existing W3 UI placeholder into a real assertion against the toast endpoint shape.
- `contamination/userInjuries-contamination.test.ts` (new, contributes to G2) — 4 routes × cross-user IDOR matrix.

### Component (vitest + RTL) — `frontend/`

- `InjuryChipsEditor.test.tsx` (new) — chip toggle inserts row; expanded panel edits notes/severity/onset; delete removes row; `aria-expanded` matches state.
- `RecoveryFlagToast.test.tsx` (new) — renders flag message; dismiss button calls api; optimistic-dismiss hides immediately; offline-queued dismiss survives a reload.
- `MidSessionSwapSheet.test.tsx` (extend) — advisory copy renders for tagged candidates; click-through path on a demoted candidate works (advisory ≠ block per master plan acceptance).
- `BlockOverflowMenu.test.tsx` (new) — keyboard navigation, ESC closes, ARIA roles correct.

### Playwright (e2e) — `frontend/tests/e2e/` or `tests/e2e/`

- `w3-injury-swap-flow.spec.ts` (new) — sign in (CF Access bypass token); add `knee_left` chip in settings; navigate to `/today/:runId/log`; tap "..." on a squat block → "Got a tweak?"; assert demoted candidate has the advisory affordance; pick a demoted candidate (click-through proof); assert successful substitute.

## Acceptance criteria (wave-completion gate)

These map directly to master plan §W3 acceptance bullets. Each is binary; verify by running the test, not by reading checkboxes (per [[feedback_ship_clean]] + `superpowers:verification-before-completion`).

- [ ] Logging 3 RIR-0 sessions on a compound surfaces overreaching toast on next `/api/recovery-flags` poll (integration + Playwright).
- [ ] Logging stagnant load on same exercise 3 sessions surfaces stalled-PR toast (integration).
- [ ] Marking `shoulder_left` active demotes overhead pressing in mid-session swap suggestions, but does NOT block selection (component + Playwright).
- [ ] Click-through path on a demoted candidate logs a successful substitute (Playwright).
- [ ] `recovery_flag_events` rows land on both show and dismiss with correct `week_start` (integration).
- [ ] `/settings/injuries` reachable from `/` in ≤3 clicks (G7 audit).
- [ ] "Got a tweak?" reachable via per-block menu from `/today/:runId/log` (G7 audit).
- [ ] All 4 new injury routes pass cross-user contamination tests (G2 contribution).
- [ ] `npx tsc --noEmit` + `npm test` clean on both `api/` and `frontend/`.
- [ ] Reviewer matrix (backend / frontend / clinical / security) dispatched; every Critical + Important finding closed before merge (per [[feedback_ship_clean]]).

## G-gate contributions

- **G2** — 4 new injury routes each get a contamination integration test in `api/tests/integration/contamination/`.
- **G7** — closes reachability for `/settings/injuries` and the "Got a tweak?" path.
- **G3** — Playwright suite gains `w3-injury-swap-flow.spec.ts`.
- **G6** — migrations 032 + 033 are CREATE-TABLE forward-only; no Step-2 destructive required this wave.
- **G11** — every reviewer-matrix Critical + Important closed pre-merge.

## Open items deferred to writing-plans

These are implementation-sequencing details the writing-plans skill should land in the per-wave plan, not in this design:

1. **Phase 1 commit boundaries** — one commit per migration vs. one combined? (Recommended: separate, but both before any service/UI work.)
2. **TanStack Query vs plain hook for `/api/user/injuries`** — pick one and pin it in `lib/api/userInjuries.ts`.
3. **`<RecoveryFlagToast>` queue policy** — if both overreaching and stalled-PR fire same poll, show one at a time or stack? (Recommend: one at a time, FIFO, oldest first.)
4. **Reviewer matrix composition** — backend / frontend / security are standard; add a *clinical* reviewer agent for the evaluator thresholds + advisory copy. The matrix itself goes in the per-wave plan footer.
5. **`recovery_flag_events` retention policy** — Beta keeps everything (small-data); set a TTL post-cohort. Not blocking.

## Related memories

- [[project_alpha_state]] — `set_logs` and `health_workouts` are real data post-W1; W3 builds on them.
- [[project_beta_no_staging]] — Beta validates on prod; conservative defaults matter.
- [[feedback_cardio_first_class]] — overreaching's "volume ≥ MAV" gate uses W1's `volumeRollup` which already blends cardio strain.
- [[feedback_user_reachability_dod]] — `/settings/injuries` and "Got a tweak?" must be reachable from `/`.
- [[feedback_ship_clean]] — close all Critical + Important reviewer findings before merge.
- [[feedback_terms_of_art_tooltips]] — overreaching / stalled-PR / joint-stress all need `<Term>` wrappers.
- [[feedback_get_plan_reviewed]] — after writing-plans drafts the implementation plan, dispatch it to specialist reviewers before execution.
- [[feedback_worktree_isolation]] — Phase 2 parallel fan-out must use `isolation: "worktree"` and omit absolute paths.
- [[reference_deployment]] — production lives at 192.168.88.65; W3 deploys via the existing GHCR pipeline.
