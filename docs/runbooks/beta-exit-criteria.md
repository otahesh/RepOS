# Beta Exit Criteria (G15)

Beta exits to GA only when **all** of the following hold. This is the D13
stricter floor (`docs/superpowers/specs/beta/round2-qa-challenges.md` §D13;
master plan §"Exit criteria captured ... per G15"). Any unmet condition keeps
Beta open. No partial credit.

## Exit conditions
1. **30 days with no Sev-1 incidents.** (Sev-1 per `docs/runbooks/bug-triage.md`:
   data loss, auth lockout, core flow down — and PAR-Q-bypass by class.)
2. **Zero Sev-2 in the final 14 days.** Catches "users blocked on a critical
   flow" that does not trip Sev-1.
3. **Zero PAR-Q-bypass incidents.** A user reaching a workout without an
   acknowledged PAR-Q is a Critical clinical-safety bug class, independent of
   Sev-1 symptoms.
4. **A backup-restore DR dry-fire passed within the final 30 days**
   (`docs/runbooks/dr-dry-fire.md`; cadence per G5). The test must be fresh at
   GA cutover — a 5-month-old pass does not count.
5. **No outstanding Important security findings** (`feedback_ship_clean` — applies
   at GA exit too; track in `docs/superpowers/specs/beta/08-qa.md`).
6. **At least 5 users completed a full mesocycle AND submitted feedback.** The
   feedback-loop closing is a usage signal, not just a click signal.

## Review cadence
- **Weekly during Beta.** The engineering operator reviews this checklist once a
  week and records status (GREEN/RED per condition) in PASSDOWN.
- The **final** weekly review (the one immediately before declaring GA-ready)
  must show **no blocking gaps in the final 14 days** for conditions 2 and 3.
- A RED on any condition resets the relevant clock (e.g. a new Sev-1 restarts
  the 30-day counter in condition 1).

## Authorizing GA
All six conditions GREEN at a weekly review, with the final-14-days check clean,
authorizes the GA cutover. Record the authorizing review date in PASSDOWN and
flip the G15 row in `docs/superpowers/goals/beta.md`.
