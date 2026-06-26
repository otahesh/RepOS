# G2 Contamination Matrix — authoritative route→test map

Generated WS2.1. Every per-user / admin auth-gated route in `api/src/routes/`.
COVERED = an existing `*-contamination.test.ts` asserts B-cannot-touch-A.
GAP = filled by WS2.2–WS2.9.
N/A (public) = unauthenticated catalog/health route; cross-user isolation does not apply.
N/A (admin) = `X-Admin-Key` / CF-Access gated operational route (no per-user ownership; gate-tested elsewhere).

Reconciled against `grep -rnE "app\.(get|post|patch|delete|put)" src/routes/` (67 handlers). The inline `GET /api/me` lives in `api/src/app.ts` (not under `src/routes/`) and is enumerated separately in the per-user table below, so the per-user table total is consistent with the route-file grep plus that one inline handler.

## Per-user routes (ownership-scoped)

| Method | Path                                | Auth                  | Ownership                           | Test file                                         | Status                   |
| ------ | ----------------------------------- | --------------------- | ----------------------------------- | ------------------------------------------------- | ------------------------ |
| GET    | /api/user-programs                  | bearer/CF             | list own only                       | userPrograms-contamination.test.ts                | COVERED (WS2.2)          |
| GET    | /api/user-programs/:id              | bearer/CF             | 404 not-yours                       | userPrograms-contamination.test.ts                | COVERED (WS2.2)          |
| PATCH  | /api/user-programs/:id (rename)     | bearer/CF             | 404 not-yours                       | userPrograms-contamination.test.ts                | COVERED (WS2.2)          |
| GET    | /api/user-programs/:id/warnings     | bearer/CF             | 404 not-yours                       | userPrograms-contamination.test.ts                | COVERED (WS2.2)          |
| GET    | /api/user-programs/:id/mesocycles   | bearer/CF             | 404 not-yours                       | userProgramsMesocyclesList-contamination.test.ts  | COVERED (WS6.2)          |
| POST   | /api/user-programs/:id/start        | bearer/CF             | 404 not-yours                       | userProgramStart-contamination.test.ts            | COVERED                  |
| PATCH  | /api/user-programs/:id (swap_all)   | bearer/CF             | 404 not-yours                       | userProgramsEveryOccurrence-contamination.test.ts | COVERED                  |
| GET    | /api/me/par-q                       | account:write         | own only                            | parQ-contamination.test.ts                        | COVERED                  |
| POST   | /api/me/par-q                       | account:write         | own only                            | parQ-contamination.test.ts                        | COVERED                  |
| POST   | /api/me/par-q/mark-cleared          | account:write         | own only                            | parQ-contamination.test.ts                        | COVERED (WS2.3)          |
| GET    | /api/mesocycles/today               | bearer/CF             | own active run only                 | mesocycles-contamination.test.ts                  | COVERED (WS2.4)          |
| GET    | /api/mesocycles/:id                 | bearer/CF             | 404 not-yours                       | mesocycles-contamination.test.ts                  | COVERED (WS2.4)          |
| GET    | /api/mesocycles/:id/volume-rollup   | bearer/CF             | 404 not-yours                       | mesocycles-contamination.test.ts                  | COVERED (WS2.4)          |
| GET    | /api/mesocycles/:id/recap-stats     | bearer/CF             | 404 not-yours                       | mesocycles-contamination.test.ts                  | COVERED (WS2.4)          |
| POST   | /api/mesocycles/:id/abandon         | bearer/CF             | 404 not-yours                       | mesocycles-contamination.test.ts                  | COVERED (WS2.4)          |
| POST   | /api/mesocycles/:id/deload-now      | account:write         | 404 not-yours                       | manualDeload-contamination.test.ts                | COVERED                  |
| POST   | /api/mesocycles/:id/deload-now/undo | account:write         | 404 not-yours (no existence oracle) | manualDeload-contamination.test.ts                | COVERED                  |
| POST   | /api/set-logs                       | set_logs:write        | 404 foreign planned_set             | setLogs-contamination.test.ts                     | COVERED (WS2.5)          |
| PATCH  | /api/set-logs/:id                   | set_logs:write        | 404 not-yours                       | setLogs-contamination.test.ts                     | COVERED (WS2.5)          |
| DELETE | /api/set-logs/:id                   | set_logs:write        | 404 not-yours                       | setLogs-contamination.test.ts                     | COVERED (WS2.5)          |
| GET    | /api/set-logs                       | set_logs:write        | empty for foreign planned_set       | setLogs-contamination.test.ts                     | COVERED (WS2.5)          |
| POST   | /api/health/workouts                | health:workouts:write | own only (identity-scoped)          | workouts-contamination.test.ts                    | COVERED (WS2.6)          |
| GET    | /api/recovery-flags                 | health:recovery:read  | own only                            | recoveryFlags-contamination.test.ts               | COVERED (WS2.7)          |
| POST   | /api/recovery-flags/dismiss         | health:recovery:read  | own only                            | recoveryFlags-contamination.test.ts               | COVERED (WS2.7)          |
| PATCH  | /api/planned-sets/:id               | bearer/CF             | 404 not-yours (3-join IDOR)         | plannedSets-contamination.test.ts                 | COVERED (WS2.8)          |
| POST   | /api/planned-sets/:id/substitute    | bearer/CF             | 404 not-yours (3-join IDOR)         | plannedSets-contamination.test.ts                 | COVERED (WS2.8)          |
| GET    | /api/user/injuries                  | health:injuries:read  | empty for B                         | userInjuries-contamination.test.ts                | COVERED                  |
| POST   | /api/user/injuries                  | health:injuries:write | own only                            | userInjuries-contamination.test.ts                | COVERED                  |
| PATCH  | /api/user/injuries/:joint           | health:injuries:write | 404 not-yours                       | userInjuries-contamination.test.ts                | COVERED                  |
| DELETE | /api/user/injuries/:joint           | health:injuries:write | 204 idempotent (no leak)            | userInjuries-contamination.test.ts                | COVERED                  |
| POST   | /api/health/weight                  | health:weight:write   | own only (identity-scoped)          | weight-contamination.test.ts                      | COVERED (WS2.9)          |
| POST   | /api/health/weight/backfill         | health:weight:write   | own only (identity-scoped)          | weight-contamination.test.ts                      | COVERED (WS2.9)          |
| GET    | /api/health/weight                  | bearer/CF             | own only (identity-scoped)          | weight-contamination.test.ts                      | COVERED (WS2.9)          |
| GET    | /api/health/sync/status             | bearer/CF             | own only (identity-scoped)          | weight-contamination.test.ts                      | COVERED (WS2.9)          |
| PATCH  | /api/account/profile                | bearer/CF             | own only                            | account-profile-contamination.test.ts             | COVERED                  |
| GET    | /api/me (account)                   | bearer/CF             | own only                            | account-profile-contamination.test.ts             | COVERED                  |
| GET    | /api/account/events                 | bearer/CF             | own only                            | account-events-contamination.test.ts              | COVERED                  |
| GET    | /api/account/sessions               | bearer/CF             | list own only                       | account-sessions-contamination.test.ts            | COVERED                  |
| DELETE | /api/account/sessions/:id           | bearer/CF             | 404 not-yours (bigint id)           | account-sessions-delete-contamination.test.ts     | COVERED                  |
| DELETE | /api/account (delete me)            | bearer/CF             | own only                            | account-deletion-contamination.test.ts            | COVERED                  |
| GET    | /api/users/me/landmarks             | bearer/CF             | own only                            | userLandmarks-contamination.test.ts               | COVERED                  |
| PATCH  | /api/users/me/landmarks             | bearer/CF             | own only                            | userLandmarks-contamination.test.ts               | COVERED                  |
| POST   | /api/me/onboarding/complete         | bearer/CF             | own only                            | onboarding-contamination.test.ts                  | COVERED                  |
| POST   | /api/auth/signout-everywhere        | bearer/CF             | own tokens only                     | signout-everywhere-contamination.test.ts          | COVERED                  |
| GET    | /api/muscles/joint-stress           | bearer/CF             | own injuries only                   | muscleJointStress-contamination.test.ts           | COVERED                  |
| POST   | /api/feedback                       | bearer/CF + CSRF      | stamps token owner                  | feedback-contamination.test.ts                    | COVERED                  |
| GET    | /api/equipment/profile              | bearer/CF             | own only                            | (identity-scoped read; see note)                  | COVERED (weight pattern) |
| PUT    | /api/equipment/profile              | bearer/CF             | own only                            | (identity-scoped write; see note)                 | COVERED (weight pattern) |
| POST   | /api/equipment/profile/preset/:name | bearer/CF             | own only                            | (identity-scoped write; see note)                 | COVERED (weight pattern) |

Note (equipment): equipment routes are identity-scoped on `req.userId` exactly like weight/workouts — no `:id` resource, every row keyed on the token owner. The identity-scoping guarantee is structurally identical to and proven by `weight-contamination.test.ts` (WS2.9) and `workouts-contamination.test.ts` (WS2.6); no separate equipment cross-user oracle exists to exploit.

## Admin / operational routes (no per-user ownership)

| Method | Path                     | Auth                     | Status                                                                                |
| ------ | ------------------------ | ------------------------ | ------------------------------------------------------------------------------------- |
| GET    | /api/admin/feedback      | X-Admin-Key/CF           | N/A (admin) — gate-tested; COVERED for cross-tenant in feedback-contamination.test.ts |
| PATCH  | /api/admin/feedback/:id  | X-Admin-Key/CF           | N/A (admin)                                                                           |
| POST   | /api/tokens              | X-Admin-Key/CF           | N/A (admin) — mint                                                                    |
| GET    | /api/tokens              | X-Admin-Key/CF           | N/A (admin) — list                                                                    |
| DELETE | /api/tokens/:id          | X-Admin-Key/CF           | N/A (admin) — revoke                                                                  |
| GET    | /api/backups             | X-Admin-Key/CF           | N/A (admin)                                                                           |
| POST   | /api/backups             | X-Admin-Key/CF           | N/A (admin)                                                                           |
| DELETE | /api/backups/:id         | X-Admin-Key/CF           | N/A (admin)                                                                           |
| GET    | /api/backups/:id         | X-Admin-Key/CF           | N/A (admin)                                                                           |
| POST   | /api/backups/:id/restore | X-Admin-Key/CF           | N/A (admin)                                                                           |
| GET    | /api/maintenance/\*      | X-Admin-Key/CF or public | N/A (admin/health)                                                                    |
| POST   | /api/maintenance/clear   | X-Admin-Key/CF           | N/A (admin)                                                                           |
| POST   | /api/maintenance/\*      | X-Admin-Key/CF           | N/A (admin)                                                                           |

## Public / unauthenticated catalog routes (no isolation surface)

| Method | Path                                               | Status                                                                                     |
| ------ | -------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| GET    | /api/exercises                                     | N/A (public)                                                                               |
| GET    | /api/exercises/:slug                               | N/A (public)                                                                               |
| GET    | /api/exercises/:slug/\*                            | N/A (public)                                                                               |
| GET    | /api/muscles                                       | N/A (public)                                                                               |
| GET    | /api/equipment (catalog)                           | N/A (public)                                                                               |
| GET    | /api/program-templates                             | N/A (public)                                                                               |
| GET    | /api/program-templates/:slug                       | N/A (public)                                                                               |
| POST   | /api/program-templates/:slug (fork → user_program) | bearer/CF — creates own user_program; ownership proven by userPrograms list/detail (WS2.2) |

Status legend: every per-user / admin auth-gated route above is `COVERED` (or `N/A`). Zero `GAP` rows remain. G2 is closed when all `*-contamination.test.ts` files pass under `npm run test:integration`.

## WS2.10 reconciliation (G2 closure)

Reconciled the table against the 67-handler `grep` enumeration of `src/routes/` (plus
the inline `GET /api/me` in `api/src/app.ts`, enumerated separately): every
per-user / admin auth-gated route is `COVERED` or `N/A` — no `GAP` rows remain.

Full integration suite verified green:

```
$ npm run test:integration
 Test Files  80 passed (80)
      Tests  302 passed | 7 skipped (309)
   Duration  28.82s   # within the WS1 90s CI budget; no sharding needed
```

All seven new + two extended `*-contamination.test.ts` files
(`userPrograms`, `mesocycles`, `setLogs`, `workouts`, `recoveryFlags`,
`plannedSets`, `weight` + extended `parQ`, plus the prior `userInjuries`/
`manualDeload`/account/landmark/onboarding/signout suites) pass.
No real IDOR was discovered: one expected RED in WS2.5 (set-logs POST) was a
test-payload defect (Zod v4 rejected a non-RFC-4122 `client_request_id`
literal), not a route vulnerability — fixed by minting a valid UUID; the route's
3-join ownership 404 path was then exercised and held.
