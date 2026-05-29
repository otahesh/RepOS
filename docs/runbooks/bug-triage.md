# Bug Triage + Incident Runbook (G10)

Incident-handling runbook for Beta. **Distinct from `beta-triage.md`**, which is
the feedback-row cadence doc (how often you read `/api/admin/feedback`). This doc
is what you open when something is *broken in production*: how to classify it,
how fast it must be mitigated, and how to decide between hotfix-forward and a
container rollback.

## Severity tiers (definition + time-to-mitigate)

"Mitigate" = the user-facing impact is stopped (rollback, feature-flag-off, or
fix deployed). It is NOT "root-caused." Root-cause + permanent fix can follow.

| Sev | Definition | Time-to-mitigate | Examples |
|-----|------------|------------------|----------|
| **Sev-1** | Data loss, auth lockout, or a core flow is fully down for all users | **< 10 min** (dry-fire target per G10) | Can't log a set; restore corrupts data; CF Access universal 401; placeholder UUID re-introduced into prod writes |
| **Sev-2** | A feature is broken but no data loss and a workaround exists | **< 1 business day** | Recap stats 500 on one program; backup badge stuck on "warn"; chart range toggle broken |
| **Sev-3** | Cosmetic, copy, or enhancement | **< 1 week** | Misaligned badge; tooltip typo; missing empty-state |

**PAR-Q-bypass is Sev-1 by class**, not by symptom: if a user reaches a workout
without an acknowledged PAR-Q, treat it as Sev-1 even if nothing "looks" broken
(it is a clinical-safety hole and a G15 exit blocker — see `beta-exit-criteria.md`).

## Declaration

1. Note the wall-clock UTC time of **declaration** (`date -u`). This starts the
   time-to-mitigate clock for the PASSDOWN entry.
2. Classify with the table above. When in doubt, round **up** a tier.
3. For Sev-1, capture timestamps in PASSDOWN as you go (declaration → decision →
   mitigation) — the G10 dry-fire asserts declaration→mitigation < 10 min.

## Rollback decision tree

```
Is the impact Sev-1 (data loss / auth lockout / core flow down)?
├─ NO  → Hotfix-forward. Open a PR, let CI gate it, deploy normally
│        (docker.yml builds :sha + :latest; pull + recreate per
│        reference_unraid_redeploy). Do NOT roll back for Sev-2/3.
└─ YES → Is the cause a BAD DEPLOY (regression traced to the last image)?
         ├─ YES → ROLL BACK NOW: docker/scripts/rollback.sh <last-good-sha>.
         │        This is the fastest mitigation (no build wait). Then
         │        hotfix-forward at leisure.
         └─ NO  → Is it a DATA problem (a restore/migration corrupted rows)?
                  ├─ YES → This is a DR event, not a rollback.
                  │        Follow docs/runbooks/dr-dry-fire.md "Restoring from a
                  │        local file" using the pre_restore snapshot
                  │        (scripts/pre-restore-snapshot.sh output) as the
                  │        rollback point. Rolling the IMAGE back will not undo
                  │        committed DB writes.
                  └─ NO  → Is it CONFIG (e.g. CF_ACCESS_AUD drift, universal
                           401)? → docs/runbooks/cf-access-aud-drift.md.
                           Otherwise mitigate by feature-flag / env change +
                           container recreate; rollback only if no faster path.
```

## Rollback procedure (image)

`docker/scripts/rollback.sh <sha>` pins the container to a specific GHCR image
tag (`ghcr.io/otahesh/repos:sha-<sha>`), preserving the existing network, IP,
mounts, and env, and applies the `--memory=2g --cpus=2` resource caps. It is the
formalized, env-preserving form of the `reference_unraid_redeploy` recipe. Run it
from the dev Mac (it SSHes to `unraid`):

```bash
docker/scripts/rollback.sh 4e8e639      # roll prod to image sha-4e8e639
docker/scripts/rollback.sh --help       # usage; touches nothing
```

It only ever runs `docker pull / stop / rm / run` against the `unraid` host. It
never touches the local repo or the DB. After it runs, verify health and run the
post-deploy smoke (`.github/workflows/post-deploy-smoke.yml`, WS5) or curl
`https://repos.jpmtech.com/health`.

**Resource caps (`--memory=2g --cpus=2`)** are the pathological-query guardrail.
They are baked into `rollback.sh` and MUST also be present on the standard
forward-deploy recipe — see `docs/superpowers/plans/2026-05-03-repos-monolithic-container.md`
(~line 1216) and the `reference_unraid_redeploy` memory recipe. A redeploy that
omits them leaves prod uncapped.

## After mitigation

1. Record in PASSDOWN: Sev, declaration time, mitigation time, total minutes,
   action taken (rollback to which sha / hotfix PR link / restore filename).
2. File the permanent-fix issue (if mitigation was a rollback or flag).
3. Sev-1 → schedule a short retro; feed any process gap into this runbook.
