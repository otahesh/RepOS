# Beta Scope — Clinical Research

**Author:** Clinical Research specialist
**Date:** 2026-05-07
**Charter:** Rank V1's deferred items by published evidence base for a 6-month Beta cohort. Inputs: program-model V1 spec/plan, exercise-library V1 plan, V1 decisions log Q1–Q24.

This memo evaluates **nine deferred items** against the peer-reviewed literature (RP/Israetel internal, Schoenfeld dose-response work, Grgic/Refalo proximity-to-failure, Wilson/Hawley concurrent-training, Bell scoping review on overreaching, Zourdos RIR validity, McGill core, Plews/Buchheit HRV). Every recommendation cites the strongest evidence available and flags where the literature is thin.

The framing question for each: **does a 6-month Beta user materially train differently if this ships, and does the published evidence say that difference matters for outcomes (hypertrophy, strength, injury, adherence)?**

---

## Evidence-supported Beta blockers

### B1. Apple Health Workouts ingestion (item #9)

**Verdict: Beta blocker — not on physiological grounds, on positioning grounds.**

The clinical literature is silent on "should an app ingest workout files." But two facts collapse this into Beta:

1. **Cardio is first-class per project memory (`feedback_cardio_first_class.md`)** and per V1 Q13 cardio integration. The volume-rollup feed already emits `minutes_by_modality`. Without ingestion, the rollup is **prescribed-only** — there is no adherence signal for cardio in Beta. The strength side gets adherence via `set_logs` (sub-project #3); the cardio side gets nothing.
2. **Concurrent-training literature requires modality fidelity to apply the interference rules V1 already encodes.** Wilson et al. 2012 (*JSCR*) showed modality-dependence (running > cycling for hypertrophy interference); Hawley's group showed the mTOR-suppression window is dose- and intensity-dependent. The interference warnings V1 ships in `validateCardioScheduling` (B.14) are advisory based on **prescribed** zone — but if a user logs Z2 on the watch and actually ran 5K of intervals, the warning was wrong. No ingestion = warnings are blind to reality.

Apple's HealthKit framework readily exposes `HKWorkout` samples with modality (`HKWorkoutActivityType`), duration, distance, and average HR. The architectural cost is one more iOS Shortcut + one ingest endpoint mirroring `/api/health/weight`. This is small relative to its leverage on Beta credibility.

**Recommendation: Ship Beta.** Schema is mostly the same as `health_weight_samples` — `(user_id, started_at, modality, duration_sec, distance_m, avg_hr, source)` with the same `(user, started_at, source)` dedupe key.

Sources: [HealthKit framework](https://developer.apple.com/documentation/healthkit), [Wilson et al. 2012 concurrent training meta-analysis](https://pubmed.ncbi.nlm.nih.gov/22002517/), [Hawley/Coffey concurrent exercise](https://pmc.ncbi.nlm.nih.gov/articles/PMC5407958/).

---

### B2. Stalled-PR + Overreaching recovery rules (item #5)

**Verdict: Beta blocker for stalled-PR; Beta nice-to-have for overreaching.**

The V1 spec already creates the storage and the registry. The blocker is `set_logs` which lands with #3 Live Logger — by Beta these are necessarily wired.

**Stalled-PR detection** (3 sessions same exercise, no load/rep increase, RIR 0):

- This is the *practical* detection signal for non-functional overreaching at the muscle/exercise level. Bell et al. 2020 scoping review (*Sports Med*) on overreaching/overtraining in resistance training flatly notes **"no reliable biomarkers exist"** to distinguish FOR/NFOR/OTS — instead the literature converges on **performance plateau/decrement** as the most clinically actionable surrogate.
- A 6-month Beta cohort *will* hit plateaus — the auto-ramp drives them to MRV-1 across 4 accumulation weeks; with the global RIR ≤ 1 cap, week 3–4 of any meso is high-fatigue territory. Detection is the only thing that distinguishes "smart system" from "spreadsheet that climbs forever."
- Cost: ~50 lines of evaluator code on the existing registry; data is already in `set_logs` once #3 ships.

**Overreaching toast** (≥3 sessions/7d at RIR 0 on compounds AND ≥ MAV):

- The published evidence here is weaker. Bell et al. note resistance training overreaching is poorly characterized vs. endurance; available markers (POMS, HRV, RPE, jump height) require instrumentation Beta won't have. The proxy V1 picked (RIR 0 frequency × volume threshold) is a coach-heuristic with **face validity but no published threshold**.
- Still cheap once `set_logs` exists; ship if it's free.

**Recommendation: Stalled-PR is Beta blocker.** Overreaching is a free add-on if the evaluator surface is already built.

Sources: [Bell et al. 2020 — Overreaching/Overtraining in Strength Sports scoping review](https://pubmed.ncbi.nlm.nih.gov/32602418/), [MDPI 2022 — Recommendations for Advancing the Resistance Exercise Overtraining Research](https://www.mdpi.com/2076-3417/12/24/12509).

---

### B3. Joint-stress profile injury filtering (item #3)

**Verdict: Beta blocker as *advisory filter*, not as hard contraindication logic.**

Library V1 already populates `joint_stress_profile` per exercise (e.g. `{shoulder: 'mod', elbow: 'mod'}`). V1 Q42 in the program model deferred *filtering UI/logic* to V2.

The clinical evidence base:

- **Shoulder pain (subacromial impingement) prevalence in lifters is high** (~60% of resistance trainees report shoulder symptoms in surveys). The JOSPT 2020 update on conservative interventions for subacromial pain emphasizes **load modification + motor-control retraining** over rest — i.e. *exercise selection swap* is the active ingredient, not avoidance.
- **Low-back pain similar story:** McGill's "spare the spine" principle and the JOSPT/APTA back-pain CPG emphasize **avoiding combined flexion-under-load + repeated end-range flexion** rather than avoiding any one exercise.
- These are exercise-*swap* recommendations, not exercise-*ban* recommendations — exactly what the existing Library V1 substitution ranker does, except keyed off `joint_stress_profile` instead of equipment.

A 6-month Beta with a single-user alpha background is *guaranteed* to encounter at least one tweak/strain. Without an injury-aware swap, the user's workaround is "don't do today's workout" — which kills adherence and breaks the auto-ramp baseline.

**Cost:** small. Schema exists. Add `users.active_injuries TEXT[]` (e.g. `['shoulder', 'low_back']`), feed it into the existing substitution ranker as a penalty term against `joint_stress_profile[joint] IN ('mod','high')`. Surface as "Got a tweak? Swap..." button on `<TodayWorkoutMobile>`.

**Recommendation: Ship Beta as advisory swap, not as hard block.** Hard contraindication logic (preventing the user from selecting an exercise) requires medical authorship and is correctly a V2/post-Beta item.

Sources: [JOSPT 2020 — Update of Systematic Reviews on Subacromial Shoulder Pain](https://www.jospt.org/doi/10.2519/jospt.2020.8498), [McGill 2010 — Core Training: Evidence Translating to Better Performance and Injury Prevention](https://journals.lww.com/nsca-scj/Fulltext/2010/06000/Core_Training__Evidence_Translating_to_Better.4.aspx).

---

### B4. Abs/core taxonomy (item #6)

**Verdict: Beta blocker.**

This one is unambiguous:

- The Library V1 muscle taxonomy explicitly omits abs/core; the V1 spec §5.1 acknowledges this gap.
- McGill 2010 (*Strength & Conditioning Journal*) establishes core training's role for injury prevention — anti-extension/anti-rotation/anti-flexion patterns. The V1 cardio template `strength-cardio-3+2` is the demographic *most* likely to need anti-extension work (runners + lifters, lumbar load stack).
- Schoenfeld's work on rectus abdominis hypertrophy (Vispute et al. 2011, *JSCR*) found that compound lifts alone are insufficient for direct rectus abdominis hypertrophy — direct work increases muscle thickness measurably. So "compounds train your core" is **wrong as stated** for the hypertrophy goal V1's templates target.
- Practically: the `upper-lower-4-day` template prescribes ~58–62 min sessions with **zero core work**. Any user comparing RepOS to a published RP/Boostcamp/Stronger by Science template will notice immediately. This is a credibility issue, not just a coverage issue.

**Cost:** add `core` to the muscle enum, add ~6 exercises (plank/dead bug/pallof press/cable crunch/hanging leg raise/ab wheel) to the seed, append a 1–2-set core block to each template's strength day. Landmark estimates from RP: MV 0, MEV 4, MAV 12, MRV 16 (rough — abs respond like other small muscles).

**Recommendation: Ship Beta.** Two-day work item.

Sources: [McGill 2010 — Core Training: Evidence Translating to Better Performance and Injury Prevention](https://journals.lww.com/nsca-scj/Fulltext/2010/06000/Core_Training__Evidence_Translating_to_Better.4.aspx), Vispute et al. 2011 *JSCR* — direct vs indirect ab training (referenced via Schoenfeld lookgreatnaked.com summary).

---

## Evidence-supported Beta nice-to-have

### N1. Multi-metric tracking — body fat % + resting HR (item #4)

**Verdict: Ship if cheap. Body fat NO, resting HR maybe, HRV NO.**

The literature splits sharply by metric:

- **Body fat % from BIA scales**: weight is highly accurate, but BF% has 3–5 percentage-point error vs DEXA, with hydration noise that masks weekly change in lean mass. *Tracking adjustments* (cut deeper, bulk slower) require real signal — and BIA noise typically exceeds the weekly true change. Ingesting the field gives the *illusion* of a precision the data doesn't have. Healthline and Cedars-Sinai reviews both land here: trends OK, point-in-time wrong. **Don't ship a BF% chart in Beta** — it'll mislead the user's training adjustments, which is a worse failure mode than not having the data.
- **Resting HR (RHR)**: Apple Watch reports this passively and reliably. Plews/Buchheit and the 2024 *Heart Rate Variability Applications in Strength and Conditioning* narrative review (MDPI) confirm RHR + HRV are sensitive to training-load microcycles for endurance athletes; mixed for resistance training. **Useful for cardio adherence and overreaching corroboration**, but not actionable as a sole training-adjustment input.
- **HRV** has more evidence than RHR but requires daily morning-supine measurement protocol; if the user isn't doing the protocol, the data is junk.

**Recommendation: Beta nice-to-have.** Add `health_resting_hr_samples` ingestion mirroring weight if the Apple Health Workouts ingest is going in anyway (B1) — the cost is incremental. Defer body fat % to GA. Defer HRV to GA + dedicated onboarding.

Sources: [Plews et al. — HRV Applications in Strength and Conditioning narrative review (PMC11204851)](https://pmc.ncbi.nlm.nih.gov/articles/PMC11204851/), [Healthline — Body Fat Scale Accuracy](https://www.healthline.com/health/body-fat-scale-accuracy).

---

### N2. Concurrent strength + cardio programming (item #8)

**Verdict: Already mostly handled by V1; full multi-program-concurrent is correctly post-Beta.**

The interference-effect literature is mature and the V1 plan correctly internalized the practical takeaways:

- Wilson et al. 2012 meta-analysis (n=21 studies, 422 effect sizes): hypertrophy ES = 1.23 (strength only) vs 0.85 (concurrent), with **modality-dependence** (running interferes more than cycling) and **frequency/duration dose-dependence**.
- Hawley/Apró: 30 min Z2 cycling 15 min after strength does NOT suppress mTOR; sprints DO. This is exactly V1's Q13 rule: "Z2 ≤ 30 min same-day-as-heavy-lower allowed; intervals ≥4h gap or different day."
- The 2024 *Concurrent Strength and Endurance Training* meta-analysis (PMC10933151) and 2025 Frontiers semi-systematic review confirm: with proper sequencing, the interference penalty is small for trained populations.

V1 already encodes all of this — `strength-cardio-3+2` template, the cardio scheduling validator (Task B.14), the modality field in `planned_cardio_blocks`. What V1 *doesn't* do is allow multiple concurrent active mesocycles (e.g. lifting program + 5K plan running simultaneously). For a 6-month Beta of mostly-hypertrophy-focused users this is fine. Marathon plans + lifting plans concurrent is real but a niche audience that can wait for #7.

**Recommendation: No Beta change.** V1's solution is evidence-aligned. Multiple-active-meso is correctly post-Beta.

Sources: [Wilson et al. 2012 — Concurrent Training meta-analysis](https://pubmed.ncbi.nlm.nih.gov/22002517/), [Concurrent Strength and Endurance Training, 2024 (PMC10933151)](https://pmc.ncbi.nlm.nih.gov/articles/PMC10933151/), [Hawley/Coffey — Concurrent exercise: do opposites distract?](https://pmc.ncbi.nlm.nih.gov/articles/PMC5407958/).

---

### N3. Auto-regulation via RIR — relax RIR 1 cap per context (item #7)

**Verdict: Beta nice-to-have. Evidence does not support relaxing globally — does support contextual relaxation.**

The proximity-to-failure literature is now strong:

- **Refalo, Helms, Schoenfeld et al. 2024** (*Journal of Sports Sciences*): 8-week trial, RIR 0 vs RIR 1–2, **identical quadriceps thickness gains** (0.181 cm vs 0.182 cm). Identical hypertrophy.
- **Grgic et al. 2022 systematic review** (Sports Med): no advantage of failure for hypertrophy, ES = 0.12 (95% CI -0.13 to 0.37).
- **Israetel/RP's own framing**: stimulus is roughly linear with reps near failure; fatigue is exponential past failure. SFR favors RIR 1–3 over RIR 0.

So the V1 hard-cap at RIR 1 is **evidence-supported as the floor** — going below buys no hypertrophy, costs more recovery. The question is whether to *relax* it to RIR 0 in specific contexts:

- **Isolation final set, final week** (V1's stated v2 plan): defensible. Iso work has lower SFR risk because joint stress is bounded.
- **Compound RIR 0 globally**: not supported. Recovery cost dominates.

**Recommendation: Beta nice-to-have.** Adding "RIR 0 allowed on isolation last set of last accumulation week" matches the literature; gives the data-aware user agency without exposing them to the high-fatigue trap. Hard-banning RIR 0 on compounds in Beta is correct.

But: this depends on RIR self-reporting being accurate. **Zourdos et al.** found experienced lifters' RIR predictions are accurate (r ≈ 0.65–0.75 with velocity); **novices over-estimate by ~2 reps** at high RIR (predict RIR 4 when true is RIR 2). For a Beta cohort that *includes* novices, relaxing the cap creates a "user logged RIR 0 but was actually at RIR 2" failure mode. The risk is asymmetric: under-loading does no harm, over-loading drives overreaching.

**Final call: defer to GA unless user-experience-flag exists.** Add a setting "Allow RIR 0 on isolation final week" defaulted off; advanced users opt in. Same total dev cost.

Sources: [Refalo, Helms et al. 2024 — Similar muscle hypertrophy with failure or RIR](https://pubmed.ncbi.nlm.nih.gov/38393985/), [Grgic et al. 2022 — Influence of Proximity-to-Failure on Hypertrophy: meta-analysis](https://pubmed.ncbi.nlm.nih.gov/36334240/), [Zourdos et al. 2016 — RIR-RPE scale](https://pmc.ncbi.nlm.nih.gov/articles/PMC4961270/), [Remmert/Zourdos 2023 — RIR accuracy single/multi-joint](https://journals.sagepub.com/doi/10.1177/00315125231169868).

---

## Defer to GA / post-Beta — research-supported reasoning

### D1. User-editable per-muscle MEV/MAV/MRV landmarks (item #1)

**Verdict: Defer.**

The Israetel landmarks in V1 §5.1 are the published RP defaults. The RP framework explicitly acknowledges individual variation — "MRV varies 18–30+ sets depending on genetics, recovery, training age" — but:

1. **Israetel's own published guidance is for users to *tune* MEV/MAV/MRV by feel (pump, soreness, performance) over multiple meso runs.** This is fundamentally a *post-deload* decision, not a Beta-day-one decision. A 6-month Beta gives the user 4–5 meso runs total — barely enough to learn the *system*, let alone customize landmarks.
2. **Without `set_logs` history of multiple mesos, the user has no information to edit with.** Editing landmarks before completing 1–2 mesos is guessing, which makes the feature actively harmful (user moves chest MRV to 30 because "I never got sore" and crashes recovery).
3. The published evidence on individual variation magnitude (Schoenfeld 2017 dose-response, 0.24%/set at avg 12.25 sets/week) is **population-level**, not individual-prescription. Ranges are wide but the central tendency justifies fixed defaults for novice-to-early-intermediate users — which is the Beta cohort.

**Cost vs benefit:** adding user-editable landmarks adds a settings page + validation + auto-ramp recompute logic, all to serve a feature most Beta users shouldn't use yet.

**Recommendation: Defer to GA.** Landmark editing only becomes valuable after meso #3 — well into post-Beta. Earlier add: a "your performance suggests chest MRV may be higher" *suggestion* powered by stalled-PR data, GA-era.

Sources: [Schoenfeld et al. 2017 — Dose-response weekly volume meta-analysis](https://pubmed.ncbi.nlm.nih.gov/27433992/), [Schoenfeld et al. 2025 — Resistance Training Dose-Response meta-regressions](https://pubmed.ncbi.nlm.nih.gov/41343037/), [RP Strength — Volume Landmarks](https://rpstrength.com/blogs/articles/training-volume-landmarks-muscle-growth).

---

### D2. Stimulus reports — SF/JFR/Pump/Burn per Israetel (item #2)

**Verdict: Defer.**

This was V1 Q10's call ("both physiology and sports-med agree — needs onboarding to be meaningful") and the literature backs it:

- **Stimulus-to-fatigue ratio (SFR)** is an internal RP framework. There's no peer-reviewed validation of the four-component scale (Soreness/Joint-Function/Pump/Burn) as an outcome predictor. Israetel's framework asks the user to rate each per-set; one recent study (referenced in Stronger By Science MASS review 2023) found **fatigue indicators are weakly predictive of hypertrophy** — but that's a population-level signal, not a per-set adjustment input.
- **Per-set rating adds significant logging friction** during a live workout. Sub-project #3's logger already asks for reps + load + RIR. Adding 4 more taps/set in a hypertrophy session of ~40 working sets means 160 extra inputs — at least one of which the user *will* skip, breaking the data integrity.
- **The benefit is mostly self-reflective** — pump/burn data is already implicitly captured in RIR + performance trends. The marginal information from explicit ratings is small.

**Recommendation: Defer to GA.** The juice isn't worth the squeeze in Beta; revisit once Live Logger usage data shows whether users *would* tolerate the overhead.

Sources: [MASS Research Review — RPE and RIR Complete Guide 2023](https://massresearchreview.com/2023/05/22/rpe-and-rir-the-complete-guide/), [Outlift — SFR explained](https://outlift.com/stimulus-to-fatigue-ratio-sfr/).

---

## Evidence gaps that affect prioritization

### G1. Resistance training overreaching has no validated detection threshold

Bell et al. 2020 scoping review explicitly: **no biomarker, no symptom-cluster threshold has been validated for resistance training overreaching.** The endurance-sport literature (POMS, HRV, performance) is the only well-studied side. This means:

- The "≥3 sessions at RIR 0 + ≥ MAV" overreaching trigger V1 specs is **face-valid coach heuristic, not evidence-based threshold.** It might warn at the wrong frequency.
- Whether to ship it in Beta becomes a judgment call: ship the heuristic and tune by user feedback (cheap, low-risk if it's a dismissible toast), or wait for better evidence (which won't come — endurance science isn't generalizing back to RT).

**Implication:** ship the heuristic in Beta, treat it as a measurement tool not a feature, log dismissal-rate to inform threshold tuning.

### G2. RIR self-reporting accuracy at high reps

Zourdos validated RIR at high intensity / low reps (≤6). At hypertrophy ranges (8–15 reps), accuracy is meaningfully worse — **novices overestimate RIR by ~2 reps**. The V1 program assumes RIR is reliable input.

**Implication:** the proximity-to-failure decisions cascade off RIR. Frontend should treat user-entered RIR as a noisy signal — never block or auto-deload on a single session of "RIR 0." Multi-session corroboration (B2's stalled-PR rule) is the right way to use RIR data, which is why stalled-PR is a Beta blocker.

### G3. Joint-stress profiles are coach-graded, not evidence-graded

The `joint_stress_profile` JSON in `exercises` is curated by whoever seeds the table — Library V1 uses 'low'/'mod'/'high' labels. There's no published canonical mapping of (exercise → joint stress level). This is OK *for advisory swap* (B3) but **insufficient for hard contraindication** — which is why V1 correctly deferred filtering UI.

**Implication:** Beta ships swap-advisory only. Anything stronger needs medical-grade authorship that isn't present in the seed data.

### G4. Body composition trend signal-to-noise for individual users

Smart-scale BIA noise is well-characterized in groups; *individual* week-over-week reliability is poorly studied. This affects the multi-metric question — we know group-level error but not "if user X's reading drops 1.5%, does that mean anything for *their* training adjustment?" The honest answer in the literature is: probably not.

**Implication:** body fat % stays out of Beta. If the user wants the data, the scale's own app provides it; RepOS shouldn't add false precision.

---

## Open questions for cross-team review

1. **(Engineering)** Is the Apple Health Workouts ingestion endpoint cheap enough to ship Beta-day-1 alongside weight, or does the iOS Shortcut authoring drag it past Beta cutoff? (Beta-blocker assessment in B1 assumes shortcut cost ~= weight shortcut.)

2. **(Engineering / Sports Med)** For B3 (injury swap), what does the `users.active_injuries` enum look like? `['shoulder_left', 'shoulder_right', 'low_back', 'knee_left', 'knee_right', 'elbow', 'wrist']` is the minimum useful set. Anything more granular requires actual physiotherapy input.

3. **(Sports Med)** For B4 (abs taxonomy), do we want `core` as one muscle slug or split `rectus_abdominis` / `obliques` / `transverse_abdominis` / `erector_spinae`? Library V1's other muscle splits are anatomical; matching that pattern argues for the split. RP-canonical practice uses unified `core`. Pick one before seeding.

4. **(Engineering)** B2's overreaching toast threshold (≥3 sessions/7d RIR 0) — should we instrument toast-shown vs toast-dismissed rates to calibrate the threshold, given G1's evidence gap?

5. **(Frontend / Sports Med)** N3's "advanced user opts into RIR 0 on isolation last week" — where does this live? `users.preferences JSONB` with a default-off flag, surfaced in Settings → Programs? Or per-mesocycle-fork toggle?

6. **(Sports Med)** Joint-stress profile labels in `exercises.joint_stress_profile` — do we have confidence in the seed data Library V1 published, or do we need a clinical pass before B3 routes substitutions off it? "Mod shoulder stress" on overhead press is uncontroversial; "low elbow stress" on close-grip bench varies by individual.

7. **(Product)** N1 (resting HR ingest) — is the Beta cohort plausibly going to wear a watch consistently enough for the data to be useful? If not, defer; the architectural cost is moot if the data is sparse.

---

## Summary table

| # | Item | Recommendation | Confidence | Key source |
|---|---|---|---|---|
| 9 | Apple Health Workouts ingestion | **Beta blocker** | High | Wilson 2012; HealthKit framework |
| 5 | Stalled-PR detection | **Beta blocker** | High | Bell 2020 |
| 5 | Overreaching toast | **Beta nice-to-have** | Medium (heuristic) | Bell 2020 |
| 3 | Injury swap (advisory) | **Beta blocker** | High | JOSPT 2020; McGill 2010 |
| 6 | Abs/core taxonomy | **Beta blocker** | High | McGill 2010; Vispute 2011 |
| 4 | Multi-metric: RHR ingest | **Beta nice-to-have** | Medium | Plews 2024 |
| 4 | Multi-metric: BF% / HRV | **Defer to GA** | High | Healthline; Plews 2024 |
| 8 | Concurrent strength+cardio programming | **No Beta change** (V1 already correct) | High | Wilson 2012; Hawley/Coffey |
| 7 | Auto-reg RIR (relax cap) | **Beta nice-to-have** (opt-in flag) | Medium | Refalo/Helms 2024; Grgic 2022 |
| 1 | User-editable MEV/MAV/MRV | **Defer to GA** | High | Schoenfeld 2017/2025; RP framework |
| 2 | Stimulus reports (SF/JFR/Pump/Burn) | **Defer to GA** | High | MASS Review 2023; SFR framework |

---

*End of clinical research memo.*
