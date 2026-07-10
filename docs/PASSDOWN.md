# PASSDOWN — Beta cutover operational log

Operational record for the pre-cutover prod window and Beta period. Newest
entries first. Referenced by `docs/runbooks/beta-cutover-checklist.md`,
`docs/runbooks/bug-triage.md`, and `docs/runbooks/dr-dry-fire.md`.

---

## Sev-1 dry-fire (G10) — 2026-07-10 — GREEN

Synthetic Sev-1 ("core flow down") declared and mitigated via image rollback
per `docs/runbooks/bug-triage.md`.

- Declaration: 17:59:01 UTC
- Decision (rollback to last-known-good `sha-69c5a09`): 17:59:01 UTC
- Mitigation verified (container healthy on pinned image, outside-in 302,
  `/health` 200): 17:59:41 UTC
- **Declaration → mitigation: 40 seconds** (target < 10 min) — GREEN
- Roll-forward to `sha-28ccfc9` complete + verified: 18:00:51 UTC
- Mitigation path: `docker/scripts/rollback.sh 69c5a09` from the dev mac.

Finding (fixed same day): `rollback.sh` env-preservation carried the OLD
image's baked `APP_SHA` into the recreated container, so the rolled-back
container *reported* the new sha — a verification trap mid-incident. Fixed by
stripping `APP_SHA` from the captured env (`docker/scripts/rollback.sh` +
assertion in `tests/dr/rollback.test.sh`). Image pin was verified via
`docker inspect .Config.Image` during the drill.

Note: the container now runs with the `--memory=2g --cpus=2` caps (rollback.sh
recipe), which the plain `redeploy.sh` path does not apply.
