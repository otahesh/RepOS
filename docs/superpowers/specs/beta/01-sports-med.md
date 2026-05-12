# Beta Scope — Sports Medicine

**Reviewer:** Sports Medicine specialist
**Date:** 2026-05-07
**Inputs reviewed:**
- `docs/superpowers/specs/2026-05-04-program-model-v1-design.md` (full)
- `docs/superpowers/plans/2026-05-04-program-model-v1.md` (skim §5, §7, all "v2"/"defer"/"out of scope")
- `docs/superpowers/plans/2026-05-04-exercise-library-v1.md` (skim "v2"/"injury"/"joint_stress")
- `Engineering Handoff.md`, `CLAUDE.md`

**Lens:** Real users, live data, ~6+ months of training. V1 = throwaway alpha; Beta = the moment we owe users non-corruption of their training history and reasonable injury-risk hygiene. "Ship clean" applies — Important findings are not v1.5 backlog (per project memory `feedback_ship_clean.md`).

A note on what counts as "clinical risk" here. RepOS is not a medical device and does not need to be one for Beta. The sports-medicine bar is: (a) a user with a typical asymptomatic adult risk profile can run a program for a mesocycle without the app actively driving them into a soft-tissue overuse injury, and (b) the user can recognize and respond to recovery debt before it becomes an injury. Cardiac/clearance screening sits at the legal-disclaimer end of the spectrum, not the schema end.

---

## Must-have for Beta (clinical blockers)

### 1. Pre-program risk acknowledgment + liability disclaimer (one-time, gated)

**Status today:** absent. No PAR-Q, no disclaimer, no consent capture anywhere in spec/plan/handoff.

**Why Beta-blocker:** the moment we onboard a second user with real data, we are prescribing structured loading (compound RIR 1, ramping to MRV-1) to people whose cardiovascular and musculoskeletal status is unknown to us. The cost of a one-screen acknowledgment is trivial; the cost of *not* having one when a user with undiagnosed hypertension or a recent surgical history starts a 4-day upper/lower at MRV-1 is asymmetric. This is the lowest-effort, highest-leverage clinical safety control available.

**Minimum viable shape for Beta (not asking for a CDC-grade PAR-Q+):**
- 6–8 yes/no items (chest pain on exertion, doctor-restricted activity, recent surgery <12 weeks, current pregnancy with no clinician sign-off, dizziness/syncope on exertion, known cardiac/metabolic/renal disease, age ≥65 with no recent activity, current acute injury).
- Any "yes" → soft gate: "Talk to your clinician before starting. You can still use the app to log; we won't auto-progress your loads." Hard gate is overreach for Beta — soft gate keeps existing single-user flow viable while creating the medical-record-of-asking that matters legally and clinically.
- Stored once per user with version + accepted-at timestamp; re-prompt when version bumps.

**Rationale grounded in clinical risk:** ACSM 2022 pre-participation screening guidance frames sudden cardiac events during structured exercise as low-incidence-high-severity. The screening doesn't prevent the event — it shifts who carries the duty of care. Without it, RepOS is the one telling them to push to RIR 1 on a barbell back squat.

### 2. `set_logs`-dependent recovery flags (overreaching + stalled-PR) shipped *in Beta*

**Status today:** schema scaffold lands in #2; evaluators deferred to sub-project #3. The design spec §7.2 even calls them out as deferred.

**Why Beta-blocker:** without these two flags, a user who accumulates real recovery debt has no in-app signal except the bodyweight-crash flag — which only fires on a 7-day −2.0 lb trend, a *late* indicator. Overreaching presents as performance decrement (RIR drift, missed reps, plateaued loads) 1–2 weeks before bodyweight responds. By the time the only flag we ship fires, the user has already spent 7–10 days training in a hole. That's the window where overuse tendinopathies (patellar, lateral epicondylar, supraspinatus) and lumbar irritation manifest.

The auto-ramp formula (§5.2) deliberately drives users toward MRV-1 by week 4. The whole *point* of the ramp is to push close to recovery ceiling. Shipping the ramp without the brake is asymmetric. RP-derived programming and RP-derived recovery flags are a system; we are shipping half the system.

**What Beta needs:** the two evaluators wired against the registry scaffold (already designed in B.10), reading `set_logs` rows that #3 will be writing in production by Beta. Not new schema. Not new UI. Just the missing evaluator code + dismissal storage already designed.

**Note:** This presumes #3 (Live Logger) ships before or with Beta. If #3 slips past Beta, *both* logging and these flags slip — but then the entire app is read-only-program + manual-bodyweight, which isn't really "Beta" in the user-facing sense.

### 3. Manual mid-mesocycle deload trigger

**Status today:** deferred to v1.5 (Q5 in design spec).

**Why Beta-blocker:** real-world adherence variability is the rule, not the exception. A user gets sick, sleeps poorly for a week, has a stressful work cycle, tweaks something — they need an in-app "I'm cooked, deload me" button. Without it, the auto-ramp keeps incrementing toward MRV-1 regardless of how the user feels. The user's only escape hatches are (a) per-day override (which doesn't shift week-N+1's baseline) or (b) abandon the mesocycle. Neither is right.

The clinical risk: a user who feels beaten up but doesn't have the agency to deload will either push through (injury risk) or abandon the program (adherence loss → behavior loss → no Beta retention data). The first is the sports-med concern. The second is the product concern. Both compound.

**Minimum viable shape:** one-click "deload this week" on the Today/Program page. Service-layer logic: rewrite remaining `planned_sets` for the current week to deload week values (sets ÷ 2, RIR +2). Append `mesocycle_run_events` row `event_type='customized'` with payload `{trigger:'manual_deload'}`. Reuses already-designed override mechanics; no new tables.

### 4. Stop blocking abs/core taxonomy gap from shipping a closed Beta loop

**Status today:** Library v1 has `group_name='core'` as a heatmap rollup bucket but no abs/core landmarks in §5.1, no abs/core exercise rows seeded, and §1's deferral table sends mobility/warmup/cooldown to v2 but is silent on abs.

**Why Beta-blocker (qualified):** lumbar safety. The §7.1 joint-stress aggregation soft-caps lumbar high-stress sets at 16/wk. None of the three curated programs include direct anti-rotation/anti-extension trunk training (the protective work). The `anti_rotation`, `anti_extension`, and `carry` movement patterns exist in Library v1's enum, but without seeded exercises and a per-muscle landmark for core, the volume rollup will under-count and the programs will under-prescribe. Athletes loading hinge + squat + carry-pattern lifts at MRV-1 *without* dedicated trunk stiffness work is a textbook lumbar-strain pattern, especially at the demographic (30s–50s desk-sitters) most likely to find this app.

**What Beta needs (smallest version):**
- Add 6–8 core/anti-rotation/anti-extension exercises to the seed (Pallof press, dead bug, suitcase carry, hanging leg raise, ab wheel, side plank, etc.).
- Add `core` (or split: `abs`, `obliques`, `low_back`) to the §5.1 landmark table with conservative MV/MEV/MAV/MRV (e.g. core: MV 0, MEV 6, MAV 12, MRV 18 sets/wk).
- Optionally add 1–2 core blocks to each curated program's late-session slot.

This is a content/seed task, not an architecture task. Plausibly a half-day of work for a strength coach + the seed-runner already designed.

---

## Nice-to-have for Beta (negotiable)

### 5. Warmup display polish, no mobility module

**Status today:** §7.4 ships compound auto-warmup as 2–3 sets at 40/60/80% (display-only); cooldown and per-exercise mobility deferred to v2.

**Position:** this is fine for Beta. The warmup ladder is the load-specific protective piece — it preconditions tissue tolerance for the working sets. Mobility/cooldown is a polish layer; clinical evidence for static-stretching-as-injury-prevention is weak and contested. The risk-adjusted call is: ship the warmup ladder, leave mobility to v2.

**Caveat:** the warmup ladder skips loads <45 lb (per B.12 test). For DB-only home lifters running a Goblet squat or DB Romanian, the system shows zero warmup guidance. Beta-nice-to-have: render a "do 1–2 light sets first" generic hint when the calculator returns empty. Cheap, prevents the "app says no warmup needed" misread.

### 6. Per-injury contraindication filtering — *partial* lift

**Status today:** deferred to v2 (Q42 in plan F.3). No `users.injury_flags`, no `exercises.contraindications`. Per-injury substitution filtering is YAGNI'd.

**Position:** full per-injury filtering with structured contraindications is correctly deferred. But Beta needs *something* — a free-text "current injuries / things to avoid" field on the user profile that surfaces at exercise-swap time as a passive reminder ("You noted: 'left knee meniscus 2024'. Consider substitution if barbell back squat is loaded."). Not enforcement. Not filtering. Just a memory aid in the substitution sheet.

This is the difference between "RepOS forgot the user has a bad knee" (Beta complaint) and "RepOS doesn't yet auto-filter contraindicated exercises by injury type" (defensible v2 deferral). The user's memory of their own injuries is the v1 substitute for a contraindication ontology — but only if the app gives them a place to record it.

### 7. Frequency-limit + same-pattern-consecutive warnings *enforced at edit time*

**Status today:** §7.3 specifies the rules; B.13 implements; the design says "warn at edit time" but it's not clear whether all editor surfaces (fork wizard + program-page inline customize) actually call the validator pre-save.

**Position:** clinical risk is real (back-to-back heavy hinge days at RIR 1 is a recipe for lumbar trouble), and the rules are already implemented. Beta-quality requires verifying every edit surface actually surfaces the warning. If it's already wired, this is a non-issue. Cross-team check.

---

## Defer to GA / post-Beta

### 8. Stimulus reports (SF / JFR / Pump / Burn per Israetel)

**Status today:** v2 (Q10).

**Position:** correctly deferred. These are auto-regulation refinements that require a literate user — meaningful only after onboarding teaches what each rating means. For Beta users new to RP-style programming, stimulus self-reports add cognitive load without yet earning trust. Defer.

**Mitigation already in place:** the bodyweight-crash flag plus the two #3-deferred recovery flags (if shipped per Must-have #2) cover the proximal "are you cooked?" question without asking the user to rate four dimensions per exercise.

### 9. RIR 0 (true-failure) targets

**Status today:** capped at RIR 1 globally in v1 (Q4).

**Position:** correctly capped. RIR 1 ceiling is the clinically conservative call and the right one for Beta. RIR 0 on isolation last-week is a v2 unlock once we have real adherence data and can identify users who are RIR-literate. Defer.

**Caveat:** RIR self-report drift among novices is well-documented (Helms et al. estimate novice RIR over-estimation of ~2 reps). For users new to RIR, a "compound RIR 1" prescription often produces actual RIR 0 — meaning we *are* already pushing near-failure for that population. The conservative cap protects against the worst case of this drift. Don't relax.

### 10. Cardiac/metabolic safety screening (beyond #1's PAR-Q-lite)

**Status today:** absent.

**Position:** beyond the must-have one-time disclaimer (#1), full cardiac risk stratification (resting HR, BP capture, prior MI flagging, beta-blocker awareness) is GA territory. The Beta disclaimer transfers duty-of-care; structured stratification only matters if we then *use* the data to alter programming, which Beta's three-template catalog can't meaningfully do. Defer to GA when programming becomes responsive.

### 11. Hybrid concurrent training (5K + lifting in parallel mesocycles)

**Status today:** one active `mesocycle_run` per user globally (Q6); concurrent strength + 5K plan deferred to v2.

**Position:** correctly deferred. The `strength-cardio-3+2` template covers the common hybrid case (3 lift + 2 Z2) within a *single* mesocycle. The narrow group penalized by the single-active rule is users actively training for a specific endurance event (race plan + hypertrophy block). For Beta, that's a small minority; the workaround (use the 3+2 template, run race-pace work as cardio overrides) is acceptable.

**Clinical note:** the interference-tracking design (Q13) — emit `minutes_by_modality` rather than subtract from MAV — is the right call for Beta. Subtracting cardio minutes from strength MAV would mis-prescribe for any hybrid user.

### 12. Auto-deload on flag (vs. manual trigger from #3)

**Status today:** not specified. Recovery flags surface advisory toasts only.

**Position:** advisory-only is correct for Beta. The user keeps agency. Auto-rewriting their plan because three sessions hit RIR 0 risks paternalism and trains learned helplessness. The "manual deload trigger" (Must-have #3) gives the agency; the flag (Must-have #2) gives the signal. The user closes the loop. Defer auto-deload to GA where we'd have outcome data to validate the auto-trigger thresholds.

### 13. Cooldown / mobility / per-exercise warm-up specificity

**Status today:** v2.

**Position:** correctly deferred. As noted in #5, the evidence base for these as injury-prevention tools is weaker than for load-specific warmup ladders. Beta lifters are not under-served by their absence.

---

## Risks / unknowns in my domain

- **No liability disclaimer or PAR-Q.** Users with cardiac history, recent surgery, current pregnancy, or pediatric/geriatric edges can begin a structured program at MRV-1 with no clinician-of-record gate. Lowest-cost highest-leverage Beta gap (Must-have #1).
- **`set_logs`-dependent flags stranded in #3.** If #3 ships after Beta, users will train for a full mesocycle with only the bodyweight-crash flag — a late indicator that fires after recovery debt has already been accumulating. Window of overuse-injury risk is roughly weeks 3–4 of a 5-week meso (the MRV-1 push).
- **No core/trunk taxonomy in seeded exercises.** Hinge + squat + carry programming at MRV-1 without dedicated anti-rotation/anti-extension work is a documented lumbar-strain pattern. Soft-cap of 16 lumbar high-stress sets/wk is necessary but not sufficient — protective trunk work is the other half.
- **No mid-meso deload escape hatch.** Adherence + recovery are coupled; users who feel beaten will either push through (injury) or quit (retention loss). Both are bad. Manual deload trigger is the asymmetric fix (Must-have #3).
- **RIR self-report drift among novices is real and uncalibrated.** RIR 1 cap is the conservative answer, but we have no in-app calibration affordance (e.g. an early-mesocycle "rate this set" check-in that compares to a target). For Beta, the cap holds. For GA, calibration becomes a gap.
- **Joint-stress aggregation has no public surface in v1.** §7.1 service exists; sub-project #4 will expose it. Until then, a user editing a custom program day cannot see "you just stacked 24 high-knee-stress sets." Editor warnings exist but only for frequency-pattern violations, not joint-load totals.
- **Cardio interference flagging is implemented as warnings, not blockers (Q13 / §7.5).** Correct for Beta autonomy, but a user who routinely runs HIIT 2h before heavy squats will get a warning, dismiss it, and accumulate recovery debt that the bodyweight-crash flag won't catch for ~7 days. Tolerable for Beta but documented here.
- **Materialize-at-start means template fixes don't reach active mesocycles.** If we discover a clinical issue with a curated program post-Beta-launch (e.g. lumbar load too high in upper-lower-4-day week 3), users on active runs keep the buggy plan until they finish or re-fork. Hot-patch path is missing.
- **No injury-history field at all.** Even free-text. The user has no place in the app to remember that they tweaked their shoulder last year. (Nice-to-have #6.)

---

## Open questions for cross-team review

1. **Backend / Schema bandwidth:** if we lift the two `set_logs`-dependent recovery flags (overreaching, stalled-PR) into Beta scope (Must-have #2), does that require #3 (Live Logger) to also land before Beta? My read of the plan (B.10 + #3 wiring) is yes — the evaluators need real `set_logs` rows to be meaningful. Backend please confirm scope.

2. **Frontend / UX:** the PAR-Q-lite disclaimer (Must-have #1) — where in the user journey? My instinct: first-run after authentication, before the catalog renders. But the app is single-user with `PLACEHOLDER_USER_ID` today; auth lands when? The disclaimer needs a stable user identity to attach to.

3. **Clinical Research:** the proposed PAR-Q-lite item set (8 yes/no items) needs a sign-off from someone with ACSM/NSCA literacy. I drafted the rough shape; happy to be overruled on items, but the structure (one-time, version-bumped, soft-gate any-yes) should hold. Anyone we can route to?

4. **Frontend / UX:** the manual-deload trigger (Must-have #3) — where on the Program page does the button live, and what's the confirm/undo affordance? "Deload this week" is destructive (rewrites planned_sets), and a misclick at week 4 of a hard-earned mesocycle is high-regret. Suggest 2-step confirm + 24h undo via `mesocycle_run_events` reversal.

5. **Backend / Seed:** core/trunk seed additions (Must-have #4) — does the seed-adapter pattern handle adding new exercises + a new landmark row to §5.1 within the same Beta cut, or does adding `core` to the per-muscle landmark table cascade into the volume rollup query and require #4's heatmap to also know about it? Confirm scope.

6. **Frontend / UX:** the free-text "current injuries / things to avoid" field (Nice-to-have #6) — does this fit on the existing Settings → Programs surface, or does it warrant a Settings → Health/Injuries surface? Future contraindication filtering will land somewhere; pre-allocating the surface now is cheap.

7. **QA:** is there a QA budget for re-running the §8.3 edge-case suite against any new Beta-scope items (manual-deload trigger, PAR-Q gate, core seed additions)? The plan assumes ~40 API tests + ~10 service tests are sufficient for the v1 shape; Beta-scope additions will push past that.

8. **Engineering Lead:** the §10 risk register has 10 entries. None of them is "user injures themselves following the program as designed." Should that be on the register? My read of "ship clean" is that an Important clinical-safety gap (no PAR-Q) belongs on the register even if the response is "accept residual risk via disclaimer." Calling it out explicitly so the call is on paper.

---

*End of sports-medicine Beta scope.*
