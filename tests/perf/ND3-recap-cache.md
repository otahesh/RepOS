# ND3 (contingency) — recap_stats_cache — NOT BUILT

**Status:** documented, not implemented. **Trigger to build:** the cutover
recap-stats k6 run shows p95 > 1600ms (2× the 800ms budget) at 25 VUs, OR any
5xx in the burst. Until then this stays unbuilt (YAGNI). Estimated effort: ~2
engineer-days incl. migration, trigger, backfill, and a contamination test.

## Why recap-stats is the suspect
`GET /api/mesocycles/:id/recap-stats` (`api/src/routes/mesocycles.ts`, the
`/mesocycles/:id/recap-stats` route) runs a per-exercise PR CTE (`this_run_maxes`
∪ `prior_maxes` over all of a user's runs). It is the heaviest read in the
system and scales with a user's full lifting history, not just the current run.
A cold buffer cache + 25 VUs is exactly the scenario that surfaces a full-scan
cliff.

## The contingency design (if built)
1. **Table** `recap_stats_cache (mesocycle_run_id PK → mesocycle_runs ON DELETE
   CASCADE, user_id, weeks INT, total_sets INT, prs INT, computed_at TIMESTAMPTZ)`.
   Ownership column mirrors the run so the route's existing
   `WHERE id=$1 AND user_id=$2` ownership check still applies.
2. **Refresh on session-end**, not on every read: a trigger (or the set-log
   "finish workout" path) recomputes the row when a day_workout flips to
   completed / the run finishes. The expensive CTE runs at write time (rare),
   the read becomes a single indexed row fetch.
3. **Route change:** recap-stats reads the cache row; on a miss (older runs
   pre-cache) it computes live and backfills. No response-shape change
   (`MesocycleRecapStatsResponse` is unchanged).
4. **Tests required before merge:** unit test that the cached value equals the
   live CTE for a fixture run; a contamination test that user B cannot read
   user A's cache row (feeds WS2's matrix — the cache table is a new per-user
   resource); a re-run of the recap-stats k6 script showing p95 back under
   budget.

## Explicitly out of scope of W8 authoring
No migration, no table, no trigger, no route change ships in W8. This doc exists
so the cutover operator can execute the fix inside the ~2-day budget without a
fresh design cycle.
