# Beta Scope — Infra

**Reviewer:** Infrastructure / Ops specialist
**Date:** 2026-05-07
**Inputs reviewed:**
- `CLAUDE.md`, `docs/superpowers/plans/2026-05-03-repos-monolithic-container.md` (skim)
- `docker/Dockerfile`, `docker/nginx/repos.conf`, `docker/root/**` (full s6 service tree)
- `docker/root/usr/local/bin/repos-backup.sh`, `docker/root/etc/s6-overlay/s6-rc.d/backup/{run,type}`
- `.github/workflows/{docker.yml,test.yml}`
- `api/src/db/migrate.ts`, `api/src/db/migrations/` (listing only)
- Memory: `reference_unraid_redeploy.md`, `reference_deployment.md`, `project_arr_style_db_recovery.md`, `reference_deployment_techniques.md`, `project_alpha_state.md`, `project_alpine_smallicu.md`

**Lens:** "Live data, full featured, post-Beta polish only" means data loss is unacceptable, MTTR matters, and the operator must hear about failure before the user does. Alpha got us to "deployed and reachable." Beta requires we can lose any single component (container, host disk, image registry, my laptop) and recover. Where current code already covers a gap, I call it out and stop — no gold-plating. Where it doesn't, I size the smallest credible fix.

A note on what I found vs. what memory implied. The deployment memory dated 2026-05-03 says "no GHCR yet" and CLAUDE.md v2-out-of-scope lists "GHCR + CI builds, log rotation, Postgres backups." All three have actually shipped since then:
- `.github/workflows/docker.yml` builds + pushes `ghcr.io/otahesh/repos:{sha-<short>,latest}` on every `main` push.
- `docker/root/etc/s6-overlay/s6-rc.d/backup/` is a real s6 longrun executing `repos-backup.sh` daily at 03:15 UTC, writing `pg_dump -Fc | gzip` to `/config/backups/`, 14-day retention.
- nginx logs go to stdout/stderr → s6-log per-service consumers; container logs go to Docker daemon (default driver, no rotation set).

So the foundation is much further along than the V2 list suggests. The remaining gaps are mostly **operational discipline** (DR test cadence, alerting, runbooks) rather than missing implementation.

---

## Must-have for Beta (ops blockers)

### 1. DR test — verify the backups we're already taking

**Status today:** backups are running daily; nobody has ever restored from one. Untested backups don't exist.

**Why Beta-blocker:** the backup pipeline has three independently-failing components (pg_dump exit, gzip stream, retention prune) and one silent-failure mode (the `s6-setuidgid postgres pg_dump | gzip > tmp` pipeline: if `pg_dump` fails mid-stream after some bytes have flowed, the `set -o pipefail` in the script *does* catch it, but a `gzip` of an empty stream produces a 20-byte valid `.dump.gz` that `pg_restore -l` rejects loudly — we want to know *that's* what's being kept, not assume it). Restoring once proves the whole chain end-to-end.

**Minimum viable DR test:**
1. `scp` the most recent `/mnt/user/appdata/repos/backups/repos-*.dump.gz` off the Unraid host to dev mac.
2. `gunzip -c repos-*.dump.gz | pg_restore -l` — smoke that the TOC parses (catches gzip/format corruption fast).
3. Spin a throwaway `postgres:16-alpine` container locally. `pg_restore -d testdb -Fc --no-owner --no-privileges <(gunzip -c …)`.
4. Run a 5-row sanity SELECT against the same set of tables hit by the smoke endpoints (`SELECT count(*) FROM users`, `health_weight_samples`, `set_logs` once #3 ships, etc.).
5. Document timing — how long does the restore take, what's the WAL replay/build-index cost on the current dataset size.

**Cost:** ~30 min the first time; ~10 min subsequent runs. Once per Beta release as the gate; quarterly thereafter.

**Disagreement I expect with QA:** they will (correctly) want this run more often than quarterly. My counter: the *deploy gate* is the right cadence enforcer — every time we cut a Beta image, run the restore against that image's schema. That couples DR test cadence to actual schema-change risk instead of a calendar that stops being relevant once schema stabilizes. If QA wants to additionally run a monthly cron-driven restore-to-disposable-volume, it costs us nothing and I won't argue.

### 2. Backup integrity check — fail loudly on a bad dump

**Status today:** `repos-backup.sh` writes a file and reports byte size, but never validates that the file is restorable. The 20-byte-empty-gzip case above is real.

**Why Beta-blocker:** the operator's only "are backups working?" signal is a successful exit code. That's necessary but not sufficient.

**Fix:** add a post-write step to `repos-backup.sh`:

```bash
# Cheap integrity check: pg_restore -l reads the TOC of a custom-format dump
# (or the gzipped stream) and prints the catalog. Fails fast on truncation,
# corruption, or "wrong format" without restoring anything.
if ! gunzip -c "$out" | pg_restore -l >/dev/null 2>>"$log"; then
  echo "[$(date -u +%FT%TZ)] FAIL post-write TOC check on ${out}" | tee -a "$log" >&2
  rm -f "$out"
  exit 1
fi
```

**Cost:** ~2s of CPU per nightly run. Trivial.

### 3. Backup-failure alerting (the only alert that actually pages)

**Status today:** `repos-backup.sh` exits non-zero on failure, the s6 longrun's `run` script appends to `/config/log/backup/scheduler.log`, and… nothing watches that log. A user could go a month with broken backups before anyone noticed.

**Why Beta-blocker:** see the rationale of "live data, full-featured." The single highest-asymmetric ops risk is "we thought we had backups, we didn't, then we needed one." Pages-the-operator is the only state that prevents that.

**Minimum viable alerting (single channel):** Healthchecks.io free tier. One check, one URL, one cron-style "expected: every 1 day with 30 min grace." `repos-backup.sh` POSTs to `$HEALTHCHECK_URL` on success (after the integrity check passes); the run script posts to `$HEALTHCHECK_URL/fail` on the `|| echo …` branch. Healthchecks.io emails when the check goes red or stops checking in.

**Cost:** zero dollars (free tier covers ~20 checks); ~10 lines of bash; one env var added to `.env`.

I'm explicitly **not** recommending Uptime Kuma or self-hosted Prometheus for Beta. The ops surface for "is the alerting alerting" is itself a reliability problem; using a SaaS check whose only job is "did this thing ping me on schedule" sidesteps the meta-problem.

### 4. Container/edge liveness alerting

**Status today:** the Docker `HEALTHCHECK` directive runs `wget -qO- http://127.0.0.1/health` every 30s and Docker marks the container `unhealthy` after three failures. Nobody watches Docker health. Cloudflare Tunnel disconnects emit a Cloudflare-side notification only if the user has Cloudflare Notifications configured — which they should verify is enabled.

**Why Beta-blocker:** if the public URL is down for hours and nobody knows, "live data" is meaningless.

**Minimum viable:** a second Healthchecks.io check, configured in cron-mode "expected every 10 min." A separate one-shot ping script on the Unraid host (host crontab, not in-container — we want to know *the container* is reachable, so the check must originate outside it):

```bash
# /boot/config/plugins/user.scripts/scripts/repos-uptime-ping/script
*/10 * * * * curl -fsS https://repos.jpmtech.com/health \
    && curl -fsS https://hc-ping.com/<uuid> \
    || curl -fsS https://hc-ping.com/<uuid>/fail
```

This catches container death, nginx death, API death, AND tunnel disconnection in one signal. If `/health` 200s through the public URL, all four layers are alive.

**Cost:** ~5 min to wire on Unraid, second free Healthchecks.io check.

**Cloudflare Tunnel notifications:** independently, enable Cloudflare Zero Trust → Notifications → "Tunnel offline" emails to `jason@jpmtech.com`. Belt-and-suspenders with the `/health` ping; CF's side fires faster on tunnel-specific failure modes (cert rotation, token expiry).

### 5. Docker log rotation

**Status today:** s6-log handles per-service rotation (already configured for nginx-log, api-log, postgres-log consumers). But `docker logs RepOS` — which is what an operator types when triaging — pulls from the Docker daemon's json-file driver, which has **no rotation by default**. A long-running RepOS container will eventually fill `/var/lib/docker/containers/<id>/<id>-json.log` until disk pressure on the Unraid array triggers.

**Why Beta-blocker:** silent disk-fill is the worst class of ops failure — everything works until it spectacularly doesn't.

**Fix (host-side, one time):** edit `/etc/docker/daemon.json` on Unraid:

```json
{
  "log-driver": "json-file",
  "log-opts": { "max-size": "50m", "max-file": "5" }
}
```

Then `systemctl reload docker`. Caps any container's stdio log at 250 MB total. Existing RepOS log is preserved on the next container recreate.

Alternative if the user doesn't want to touch the host daemon config: pass `--log-opt max-size=50m --log-opt max-file=5` in the `docker run` line in `reference_unraid_redeploy.md` and update the redeploy recipe. Daemon-wide is better — covers Cloudflared and any future container.

**Cost:** 1 min host-side change, document in PASSDOWN.

### 6. Image-rollback procedure documented and tested

**Status today:** `docker.yml` tags both `sha-<short>` AND `latest` on every main push. Memory's redeploy recipe pulls `:latest`. There is no documented "roll back to the previous good image" procedure.

**Why Beta-blocker:** when (not if) a Beta deploy breaks something, the operator needs a 60-second rollback path. Otherwise rollback time bleeds into "fix forward under pressure," which is how data gets corrupted.

**Fix:** document in PASSDOWN and verify once on a cosmetic change:

```bash
# Find the previous image's sha tag
ssh unraid 'docker image ls ghcr.io/otahesh/repos --format "{{.Tag}}\t{{.CreatedAt}}" | sort -k2'

# Roll back: same recipe as redeploy, but pull a sha tag, not latest
docker pull ghcr.io/otahesh/repos:sha-<previous>
docker stop RepOS && docker rm RepOS
docker run -d --name RepOS --network br0 --ip 192.168.88.65 \
  --restart unless-stopped \
  -v /mnt/user/appdata/repos/config:/config \
  --env-file /tmp/repos.env \
  ghcr.io/otahesh/repos:sha-<previous>
```

**Note on schema rollback:** rolling the *image* back is safe. Rolling a *migration* back is not — the migration runner is forward-only (see `api/src/db/migrate.ts`). If a deploy applies migration N and N is destructive, image rollback to a build that doesn't know about column-N's existence may break runtime. This is the subject of §"Migration runbook" below.

### 7. Branch protection on `main`

**Status today:** I cannot verify from the repo alone, but the workflow file's `on: push: branches: [main]` plus the existence of squash-merge commits in history strongly suggests no required-reviews gate. The `docker.yml` workflow has `permissions: contents: read, packages: write`, which is fine; the gap is on the human side.

**Why Beta-blocker:** Beta means real-user data behind the merge. A force-push or accidental direct commit to main triggers an immediate `:latest` rebuild, which `latest`-tracking deploys would pick up.

**Fix:** GitHub repo Settings → Branches → `main` → require:
- pull request before merging (1 approval; self-approval is fine for solo dev — the gate is "no direct push")
- status checks: `typecheck-api`, `build-frontend`, `validate-frontend` (all already in `test.yml`) must pass
- linear history (forces squash/rebase, no merge commits)
- no force-push, no deletion

**Cost:** 5 min in GitHub UI. **This is "ship clean" applied to the deploy pipeline** — per the user's standing policy.

### 8. ADMIN_API_KEY rotation procedure documented

**Status today:** the key lives in `/mnt/user/appdata/repos/.env`, baked into the container at `docker run --env-file` time. Memory says source-of-truth is the user's password manager. There is no documented rotation procedure.

**Why Beta-blocker:** rotation is the only response to a leaked secret, and "I'll figure it out when I need to" is exactly when the operator is under stress.

**Fix:** document in PASSDOWN. Procedure:
1. Generate new key: `openssl rand -hex 32` → save to password manager.
2. SSH to Unraid: edit `/mnt/user/appdata/repos/.env`, replace `ADMIN_API_KEY=…`.
3. Recreate container per the redeploy recipe (env is read at run-time only).
4. Verify: `curl -fH "X-Admin-Key: <new>" https://repos.jpmtech.com/api/tokens` returns 200; old key returns 401.
5. Revoke old key from password manager.

**Cost:** 5 min to document. Cadence: rotate quarterly, or immediately on any suspected exposure (laptop loss, accidental commit, screenshare leak).

---

## Nice-to-have for Beta

- **Backup off-box redundancy.** Memory `project_arr_style_db_recovery.md` says the Unraid host already backs up `/mnt/user/appdata/` out-of-band; trust that. If the user wants belt-and-suspenders, `rclone` the `/config/backups/` dir to a remote (B2/S3) on a daily host cron. Skip for Beta — duplicates effort already covered host-side.
- **Build provenance / SBOM.** `docker.yml` currently sets `provenance: false`. For a single-user app behind CF Access this is fine. Revisit at GA if multi-user.
- **Restore CLI helper.** A `repos-restore.sh` companion to `repos-backup.sh` that takes a dump file, stops the API service via `s6-rc -d`, drops + recreates the DB, restores, restarts the API. Useful for the in-app `*arr`-style restore UI Backend will design — they should call this script via a privileged endpoint rather than reimplementing pg_restore in TS. Coordinate with Backend.
- **Container resource limits.** Currently no `--memory` or `--cpus` flag in the run recipe. Beta single-user load is well under a single core; postgres will happily use whatever RAM you give it for buffer cache. Set `--memory=2g --memory-swap=2g --cpus=2` in the run recipe — it's a guardrail against a pathological query, not a tuning target.
- **Postgres connection metrics on the sync-status endpoint.** Already half-there (`/api/health/sync/status` returns sync state). Adding pool-utilization fields gives the operator one more failure-mode signal at zero extra round-trip cost.

## Defer to GA / post-Beta

- **Self-hosted observability** (Prometheus/Grafana/Loki). Premature for one app on one host. The Healthchecks.io + CF Notifications combination covers "did it die" for Beta. GA reconsider if the user runs more apps on the same host.
- **Multi-region deploy.** Out of scope; single-host single-region is the architecture.
- **Automated DR drills** (cron-driven test restore to ephemeral container with assertions). Manual once-per-release is enough at Beta scale; automate at GA when releases get more frequent.
- **WAL archiving / point-in-time recovery.** Daily `pg_dump` is sufficient RPO (24h max loss) for a single-user fitness tracker at Beta. PITR is real engineering effort and adds operational surface; revisit only if the user explicitly says "I cannot lose a day."
- **Read replicas / HA Postgres.** Same reasoning: out of scope for Beta single-user.
- **Secret manager integration** (Vault, Doppler, AWS Secrets Manager). `.env` on a single host with file-mode 600 is fine for one operator. GA-era concern.
- **GHCR image signing** (cosign / sigstore). Single-publisher, single-puller, both authenticated to the same GitHub identity. No supply-chain win at this scale.

---

## Backup architecture spec

**Status:** mostly already implemented. This section documents what's there, identifies the small additions, and locks the file format the in-app Restore UI will consume.

**Components:**
- **Producer:** `/usr/local/bin/repos-backup.sh` (in-container script, `s6-setuidgid postgres pg_dump`).
- **Scheduler:** `s6-rc.d/backup` longrun, in-process sleep loop targeting `${REPOS_BACKUP_HOUR:-3}:${REPOS_BACKUP_MIN:-15}` UTC.
- **Storage:** `/config/backups/` (mapped to `/mnt/user/appdata/repos/config/backups/` on Unraid host; covered by Unraid array's existing out-of-band backup).
- **Logs:** `/config/log/backup/{scheduler.log, backup-<ts>.log}`.

**Schedule:** daily, 03:15 UTC. Rationale: 03:15 UTC = ~22:15 CT (user TZ inferred from `Engineering Handoff`), well after the user's last training/weight-sync window and well before the next morning's. Random-minute (15) avoids collision with hourly-aligned tasks.

**Retention:** 14 days rolling, tombstoned via `find -mtime +14 -delete` in the backup script. Rationale for 14 over 7: covers a 2-week vacation where the operator might miss "backups failed" alerts; covers a "I broke something on day 2 and didn't notice until day 10" recovery scenario. 14 days × ~current-DB-size compressed = trivial disk (kilobytes, growing to megabytes once `set_logs` is real). At 100MB/day (worst case post-Beta), 14×100MB = 1.4 GB. The Unraid array has plenty.

**Format:** `pg_dump -Fc --no-owner --no-privileges` (custom format, restorable to *any* DB regardless of original owner/privileges) | `gzip -6` (good ratio, fast). Filename: `repos-YYYYMMDDTHHMMSSZ.dump.gz`. The custom format is critical: it lets `pg_restore` do parallel restore, selective table restore (the *arr-style "Restore from this snapshot" UI may want to offer "restore exercise library only, leave my logs alone"), and TOC introspection without unpacking.

**Lockup of this format with Backend's Restore UI:** the Settings → Backups UI ingests files matching this filename pattern and this format. The backend restore endpoint should:
1. Verify file is `gunzip | pg_restore -l`-parseable before starting (same integrity check as the producer).
2. Open a transaction-equivalent restore: stop API service, `pg_restore --clean --if-exists --no-owner --no-privileges`, restart API. (Truly atomic restore is hard with pg_restore; the next-best is "drop+recreate user-owned tables in one shell of SQL.")
3. Append a row to a future `restore_events` table for audit.

**DR test cadence:** once per Beta release as the deploy gate (see Must-have #1). Quarterly thereafter once Beta is steady-state. Test must restore to a throwaway DB and run a row-count assertion against at least the user, weight, and (post-#3) set_logs tables.

**Failure surfaces:**
- pg_dump non-zero exit → script exits non-zero → scheduler logs failure → Healthchecks.io `/fail` → email.
- gzip stream truncation → handled by `set -o pipefail` (already in script) → same path as above.
- Disk full on `/config` → pg_dump's write fails → same path. (We don't pre-flight check disk; the failure is observable and recoverable.)
- Post-write TOC check fails (proposed Must-have #2) → script deletes the bad file and exits non-zero → same path.
- Backups silently stop running (e.g., backup longrun crashes) → Healthchecks.io check times out → cron-mode "expected every 1 day" → email.

---

## Log rotation spec

**Per-service application logs (already correct):**
- `s6-rc.d/{nginx-log,api-log,postgres-log,backup-log if added}` — each is a `consumer-for` longrun running `s6-log` against the producer's stderr/stdout. s6-log auto-rotates by default (rotates at 100KB, keeps 10 files, in service-specific dirs under `/config/log/`).
- nginx is configured to log to stdout/stderr (see `repos.conf` lines 1–4 and Dockerfile line 56), so its logs flow into the consumer. Postgres has `log_destination=stderr logging_collector=off` for the same reason.
- No change needed.

**Docker daemon container logs (the gap):**
- `docker logs RepOS` reads from the Docker daemon's json-file driver, which has *no rotation* on most Docker installs and definitely no rotation on Unraid stock.
- Fix: add `log-opts` to `/etc/docker/daemon.json` on the Unraid host (see Must-have #5). `max-size=50m, max-file=5` → 250 MB cap per container.
- Alternative: per-container `--log-opt` flags in the `docker run` recipe. Daemon-wide is better.

**Backup logs:**
- `/config/log/backup/backup-<ts>.log` is pruned by the same 14-day `find -mtime` in the backup script (line 43). `scheduler.log` is append-only and grows forever — should be added to the prune step. ~10 lines per day, will reach 1 MB after a couple of years; not urgent.

---

## Monitoring + alerting spec

**Beta-essential alert surface (single channel: email to `jason@jpmtech.com`):**

| Failure mode | Detector | Channel | Latency to alert |
|---|---|---|---|
| Container dead / nginx dead / API dead / tunnel down | Healthchecks.io check pinged from Unraid host cron every 10 min, hitting `https://repos.jpmtech.com/health` | Healthchecks.io email | ~15 min worst case |
| Postgres dead (but other services up) | Same — `/health` proxies to API which queries DB; DB-down → `/health` returns 5xx → check fails | Same | Same |
| Backup job failed | `repos-backup.sh` POSTs to `$HEALTHCHECK_URL/fail`; Healthchecks.io cron-mode "expected every 1 day, 30 min grace" | Healthchecks.io email | ≤24h + 30 min grace |
| Backup job stopped running entirely | Cron-mode timeout on the same Healthchecks.io check | Same | ≤24h + 30 min grace |
| Cloudflare Tunnel offline (CF-side detection, faster than the `/health` ping) | Cloudflare Zero Trust → Notifications → "Tunnel offline" alert | CF email | ~1–5 min |
| Disk full on `/mnt/user/appdata` | Unraid's own array notifications (already configured by the user) | Unraid email | Immediate at threshold |

**Explicitly out-of-scope for Beta alerting:**
- Error-rate spikes — no log aggregation, no metrics. The operator is also the user; they'll see errors in the UI before any alert would fire. GA-era concern.
- Latency SLO breaches — same reasoning.
- Per-endpoint health — `/health` covers the whole stack; finer granularity is GA.

**What I'm *not* recommending:** Uptime Kuma (one more thing to keep up; the meta-monitoring problem), Prometheus (overkill), PagerDuty (this isn't a 24/7 service, email is correct).

**Minimum-viable alerting summary (one line):** Healthchecks.io free tier with two checks (one for backup-job, one for `/health`-from-host-cron) plus Cloudflare's built-in tunnel-offline notification. Total cost: $0.

---

## Secrets rotation procedure

**Inventory (production):**
- `ADMIN_API_KEY` — 32-byte hex, gates `/api/tokens/*`. Defined in code at `api/src/middleware/cfAccess.ts:150`. Rotate quarterly + on suspected exposure.
- `POSTGRES_PASSWORD` — used by the in-container API to connect to the in-container Postgres on `127.0.0.1:5432`. Rotation has zero security benefit (network-isolated, single-host, only the API knows it) but documenting the procedure for completeness.
- Cloudflare tunnel token (in the `CloudflaredTunnel` container's env, not RepOS's) — rotated via Cloudflare Zero Trust dashboard if compromised.
- `CF_ACCESS_AUD`, `CF_ACCESS_TEAM_DOMAIN` — not secrets; identifiers. No rotation.
- Future: session/JWT secrets (if Backend's auth recommendation needs them — see CF Access section).
- Per-user opaque bearer tokens — already rotatable via `/api/tokens` mint/revoke. Argon2id-hashed at rest with a prefix for fast lookup. **Already correct, no procedure change.**

**`ADMIN_API_KEY` rotation procedure:**
1. Generate: `openssl rand -hex 32`. Save new value to password manager.
2. SSH to Unraid: `vi /mnt/user/appdata/repos/.env`. Update `ADMIN_API_KEY=<new>`.
3. Recreate container per `reference_unraid_redeploy.md` recipe (env is read once at `docker run` time; `docker restart` won't pick it up).
4. Verify: `curl -fH "X-Admin-Key: <new>" https://repos.jpmtech.com/api/tokens` returns 200; old key returns 401.
5. Revoke old key from password manager.
6. Cadence: quarterly. Immediately on any suspected exposure (laptop loss, screenshare leak, accidental commit).

**`POSTGRES_PASSWORD` rotation procedure (rare):**
1. Pick new password: `openssl rand -hex 24`. Update `.env`.
2. SSH into the running container: `docker exec -it RepOS bash`.
3. As postgres: `s6-setuidgid postgres psql -h /tmp -U postgres -d repos -c "ALTER USER repos PASSWORD '<new>';"`.
4. Recreate container so the API picks up the new env (the in-container Postgres also re-reads `pg_hba`/auth on boot). The init scripts (`init-postgres-bootstrap`) idempotently no-op when role+db already exist, so the new password persists without re-init.
5. Verify: container becomes healthy.
6. There is no graceful "rotate without downtime" — but downtime is ~15 seconds, single user, off-hours rotation. Acceptable.

**Leaked-secret revoke-without-downtime path:**
- For `ADMIN_API_KEY`: Beta posture is "swap and recreate; ~15s downtime." If the user wants zero-downtime, the API code would need to support a comma-separated list of accepted keys with one being the "new" and one the "old" for a transition window. Not worth building for Beta — `/api/tokens` is a low-traffic admin endpoint and a screenshare leak is the dominant exposure mode. Document zero-downtime as a GA improvement.
- For per-user bearer tokens: already supported via `DELETE /api/tokens/:id` — the user can revoke a leaked Shortcut token without affecting the rest of the system.

---

## CF Access policy change spec

**This section's recommendation is conditional on Backend's auth choice.** I'll lay out the three configurations and their network-side implications; Backend picks one; this section gets locked.

**Today (single-user):**
- CF Access app `RepOS Admin Tokens` covers `repos.jpmtech.com/api/tokens`, allow-list = `jason@jpmtech.com`.
- Other paths (frontend, `/api/health/*`, `/api/exercises`, etc.) are unprotected at the edge and gated either by app-level auth (per-user bearer tokens for `/api/health/weight`) or not gated at all (exercise library reads).
- A "Bypass" CF Access app on `/api/health/*` was/is configured so the iOS Shortcut bearer flow isn't challenged at the edge.

**Beta options:**

**Option (a): CF Access as global allowlist + app-level auth on top.**
- CF Access app on the entire domain `repos.jpmtech.com/*`, allow-list of approved Beta tester emails.
- App-level auth (Backend's choice — likely email/password or magic-link for Beta) on top.
- Pros: belt-and-suspenders, no random-internet fingerprinting/probing of the app, CF Access logs every entry.
- Cons: Beta testers must auth twice (CF + app); requires every Beta user to have a Cloudflare-knowable email at minimum (one-time CF "verify your email" flow, then app login).
- Bypass policy still needed on `/api/health/*` for the iOS Shortcut bearer flow.

**Option (b): Drop CF Access from user-facing paths; keep on `/api/tokens/*` only.**
- CF Access only on `/api/tokens/*` (admin-only); rest of app is open to internet, gated entirely by app-level auth.
- Pros: simpler UX for Beta testers (one auth, one credential).
- Cons: app-level auth becomes the only line of defense against internet-wide enumeration, brute force, and credential stuffing. Backend's chosen auth scheme must be production-grade *now*, not Beta-grade.

**Option (c): Keep CF Access on the entire app + bypass `/api/health/*`, no app-level auth (single-user-still).**
- Status quo, expanded Beta-tester allow-list.
- Only viable if Beta = "the user + 2-3 friends I personally invite" — does not scale to "real users" in any meaningful sense.

**My recommendation, conditional:**
- If Beta = "user + handful of friends I personally know": (c). Cheapest, safest, fastest.
- If Beta = "10–50 testers, some of whom I don't know personally": (a). The CF Access allowlist gives me a kill-switch (remove email = revoke all access) that app-level auth alone doesn't, without coupling that kill-switch to whatever auth scheme Backend ships. Worth the double-auth UX tax for Beta where we're still proving things out.
- (b) only at GA, when app-level auth has been hardened, rate-limited, and observed under real load.

**Open coordination question for Backend:** which auth mechanism do you want to ship for Beta? My infra recommendation depends on the answer. I'll re-spec this section once Backend posts their `02-backend.md` (or equivalent) with the auth choice.

**Network-side mechanics regardless of choice:**
- The Bypass app on `/api/health/*` must be in place for the iOS Shortcut bearer flow. **Verify this still exists post any policy change** — it's the kind of thing that gets dropped during a reorg of CF Access apps.
- The whole-host CF Access app's `CF_ACCESS_AUD` is wired into the API at `api/src/middleware/cfAccess.ts` — ANY change to the CF Access app structure must be reflected in `.env` and the container recreated.

---

## CI/CD hardening

**Status today:**
- `docker.yml`: builds + pushes `ghcr.io/otahesh/repos:{sha-<short>, latest}` on `main` push. ~3-4 min run on hosted GH Actions runner. Cache via `type=gha,mode=max`.
- `test.yml`: typecheck-api, build-frontend, validate-frontend on every PR + push. No actual test execution (because local dev DB was retired and no test-DB step has been added since).
- Deploy: manual, SSH to Unraid, follow `reference_unraid_redeploy.md` recipe.

**Beta hardening:**

1. **Branch protection on `main` (Must-have #7).** Required reviews + required status checks + linear history.

2. **Restore `npm test` in CI.** The handoff explicitly says `weight.test.ts` (14 cases) "must pass before merging to main." It currently can't, because the test job needs a Postgres. Add a `services: postgres:16-alpine` block to `test.yml` and a third job that runs `npm test` against it. Cost: ~2 min added to PR CI. **Required for Beta.** Without it, "must pass before merge" is a comment, not a gate.

3. **Tag discipline.** `:latest` is fine for "what's in production right now"; `sha-<short>` is fine for "this exact commit's image." Add a third tag for Beta releases: `vbeta-N` (manual, via `workflow_dispatch` input). Lets the operator pin a known-good Beta image rather than ride main.

4. **Image-pull-time verification.** Add to `reference_unraid_redeploy.md`: after `docker pull ghcr.io/otahesh/repos:latest`, before recreate, do `docker image inspect --format '{{.Created}}' ghcr.io/otahesh/repos:latest` and confirm it matches the expected `docker.yml` run time. Catches GHCR caching surprises (rare but real). 30 seconds added to the deploy.

5. **Smoke-test post-deploy.** Add to PASSDOWN as part of the redeploy recipe: after the container is healthy, `curl -fsS https://repos.jpmtech.com/health` (basic), `curl -fsS https://repos.jpmtech.com/api/health/sync/status -H "Authorization: Bearer <test-token>"` (auth path), and load the home page in a browser tab to verify frontend assets shipped. ~2 min.

6. **Roll-forward over fix-forward-under-pressure.** Documented rollback procedure (Must-have #6).

7. **Provenance:** keep `provenance: false` for Beta. Revisit at GA.

8. **Out of scope for Beta:** automated Unraid deploy via webhook (the SSH-and-recreate dance is fine for current cadence — adds operational surface in exchange for saving 5 min per deploy, which we don't deploy often enough to justify).

---

## Migration runbook

**The runner (`api/src/db/migrate.ts`):**
- Forward-only, file-name-sorted (`009_…sql`, `010_…sql`, etc.).
- Each migration runs in its own transaction; rollback on any per-statement failure.
- Tracked in `_migrations(filename, applied_at)`. Idempotent across container restarts.
- Runs as the `init-migrations` s6 oneshot, gated on `init-postgres-bootstrap` (which itself is gated on `postgres` being up).

**Authoring rules for any future migration touching live data:**

1. **Forward-only.** No destructive `DROP TABLE` / `DROP COLUMN` without an explicit two-step:
   - Step 1 (one Beta deploy): add new column / new table; backfill from old; *don't* remove the old.
   - Step 2 (next Beta deploy, after observation): drop the old.
   - Rationale: lets us roll the *image* back to the prior Beta if Step 2 misbehaves, without losing data.

2. **Backfill before constraint.** New `NOT NULL` columns: add nullable, backfill, then `ALTER COLUMN SET NOT NULL` in a separate migration. Keeps the migration transaction short and observable.

3. **Long-running migrations split out.** `CREATE INDEX CONCURRENTLY` doesn't run inside a transaction — it must be in its own migration file (and the runner should be allowed to run it; verify the existing runner handles this — the migrate.ts wraps every file in `BEGIN`/`COMMIT`, so `CONCURRENTLY` will fail. Workaround: write the migration as `COMMIT; CREATE INDEX CONCURRENTLY …; BEGIN;` to break out of the wrapping transaction. Document this in the api/README or as a header comment in the first such migration.)

4. **Migration filename = changelog entry.** `028_set_logs_add_rir_drift_column.sql`, not `028_misc.sql`.

**Pre-deploy procedure (any deploy that includes a new migration):**
1. Trigger an out-of-cycle `repos-backup.sh` run before the deploy: `docker exec RepOS /usr/local/bin/repos-backup.sh`. Wait for it to finish; verify the new file is in `/config/backups/`.
2. Eyeball the migration: any DROP, any REINDEX, any UPDATE without a WHERE — flag and double-check.
3. Confirm rollback path: which `sha-<short>` image is the previous one. If the migration is destructive (Step 2 of a two-step), the rollback path is "restore the pre-deploy backup," not "image rollback."

**Post-deploy smoke (from outside, after container reports healthy):**
1. `curl -fsS https://repos.jpmtech.com/health` → 200.
2. `curl -fsS https://repos.jpmtech.com/api/health/sync/status -H "Authorization: Bearer <test-token>"` → 200, sync state present.
3. Load the home page; confirm frontend assets render and the chart populates.
4. (After #3 ships) Log a single test set; confirm it persists.
5. Watch `docker logs --tail 200 RepOS` for any ERROR-level messages.

**Mid-flight migration failure:**
1. Container won't become healthy — `init-migrations` oneshot exited non-zero, downstream services don't start.
2. `docker logs RepOS | grep -A 20 'init-migrations'` shows which migration failed and why.
3. Recovery: image rollback to the previous `sha-<short>` (the previous image's migration runner doesn't see the new migration file because it's not present in that image's `dist/db/migrations/`). DB state may be partially modified if the failed migration wasn't transactional — restore from the pre-deploy backup if so.
4. If the migration failed *inside* its transaction, the runner already rolled back; just rolling the image back is enough.

**"Test on a copy of prod" workflow (for high-risk migrations only):**
1. `scp` a recent backup off Unraid: `scp unraid:/mnt/user/appdata/repos/backups/repos-<latest>.dump.gz ~/scratch/`.
2. Spin a local `postgres:16-alpine` container.
3. `gunzip -c repos-<latest>.dump.gz | pg_restore -d testdb -Fc --no-owner --no-privileges`.
4. Apply the new migration locally: `cd api && DATABASE_URL=postgres://… node dist/db/migrate.js`.
5. Run the post-deploy smoke from §"Post-deploy smoke" against the local DB.
6. If green, deploy to prod with confidence.

This workflow is mandatory for any migration touching live user data tables (set_logs, weight_samples, planned_sets). Optional for migrations adding new tables or seed data only.

---

## Resource budget review

**CPU / memory ceiling:**
- Current: no `--memory` or `--cpus` flags on `docker run`. Container can use the entire Unraid host.
- Beta recommendation: `--memory=2g --memory-swap=2g --cpus=2`. Postgres + Node + nginx + s6 idle is well under 500 MB; query-time spikes for the small Beta DB will not breach 1 GB. The 2g cap is a guardrail against pathological queries (forgotten LIMIT in a `SELECT * FROM set_logs JOIN …`) crashing the Unraid host's other tenants.
- If `set_logs` accumulates to millions of rows post-Beta, revisit. The aggregate-query budget for the volume rollup endpoints needs profiling at GA, not Beta.

**Disk budget on `/config` (`/mnt/user/appdata/repos/config`):**
| Component | Steady-state | Beta growth |
|---|---|---|
| Postgres data dir | ~30 MB seed + structure | + ~5 MB per active user per month |
| Backups (14 retained) | ~14 × current-DB-size compressed | currently ~10–20 MB; → ~100 MB by GA |
| s6-log per-service | ~10 MB per service (s6-log default rotation) | bounded |
| Backup logs | ~kb–MB | bounded by 14-day prune |
| **Total** | **<200 MB** today | **<2 GB by GA** |

The Unraid array has terabytes free. Budget is a non-issue. The constraint is at the *daemon log* layer (Must-have #5) where unrotated `docker logs` can creep into the *host* disk independently.

**Network budget:**
- Cloudflare Tunnel egress: free tier limits are well above any single-user Beta traffic. Non-issue.

---

## Risks / unknowns

1. **Memory drift.** The `reference_deployment.md` memory I read has a system-reminder that says it's 3 days old and may be stale. I cross-checked against actual files and found the GHCR pipeline + backup service are live (memory says they aren't yet). Update the memory.

2. **CLAUDE.md scope-statement drift.** "v2 (out of scope): … GHCR + CI builds, log rotation, Postgres backups." All three have shipped. CLAUDE.md should be edited to reflect Beta-scope reality. Not strictly an ops blocker, but it's lying to future agents.

3. **`init-migrations` failure → container won't start.** Currently this is "fail open visibly" (the container reports unhealthy and the operator notices via the Healthchecks.io alert). For Beta this is right — we'd rather not start than start with a half-applied schema. But operator needs to know that "container failed to start" → first check is `docker logs RepOS | grep init-migrations`.

4. **CF Access AUD value baked into `.env`.** If the user reorganizes CF Access apps and re-creates the whole-host app, the AUD changes and the API will reject every request as 401. The fix is a 30-second `.env` edit and container recreate, but the alert path is "/health returns 5xx → user gets paged" rather than something CF-aware. Document in PASSDOWN.

5. **No HSTS in nginx.** Intentional per the comment in `repos.conf` (CF terminates TLS, sets HSTS for the parent zone). Verify CF's HSTS policy on `jpmtech.com` is set to `includeSubdomains` and a meaningful max-age, otherwise browsers won't enforce HSTS for `repos.jpmtech.com`.

6. **`PLACEHOLDER_USER_ID` in the frontend.** Per CLAUDE.md, the frontend currently uses a hardcoded user ID. This is a Backend / Frontend / Auth concern, not infra — but if Beta = multi-user, this *must* be replaced before any second user touches the system. Flag for the auth spec author.

7. **No backup pre-test in the s6 startup sequence.** If a future migration corrupts the DB on its first run after a deploy, there's no "automatic pre-migration backup" — the operator has to remember to trigger one manually. Adding it to the s6 init chain (oneshot before init-migrations) is a small addition; punted for Beta because the daily backup gives us ≤24h-old protection and Beta deploys are infrequent enough that operator-discipline ("always trigger a backup before a destructive migration") is sufficient. Revisit at GA.

8. **`ssh unraid` is the deploy interface.** If the user's laptop is unavailable and they need to deploy from elsewhere, GHCR + a documented checklist on a phone is enough — but the SSH key is on the laptop only. Consider a second SSH key on a hardware token or a backup authorized key for key-loss recovery. Out of scope for Beta but worth noting.

---

## Open questions for cross-team review

1. **(Backend)** Which auth mechanism do you want for Beta? My CF Access policy recommendation (a vs b vs c) depends on the answer. Default assumption: option (a) — CF Access global allowlist + app-level auth — until told otherwise.

2. **(Backend)** Restore-UI implementation: do you want to call `pg_restore` via a script in the container (I can ship `repos-restore.sh` as a companion to `repos-backup.sh`), or reimplement in TS? Strong preference for the script — `pg_restore`'s edge cases are not something we want to relearn in TypeScript.

3. **(QA)** Acceptable DR-test cadence: I propose "once per Beta release as gate, quarterly thereafter." If you want monthly, I'll automate a cron-driven restore-to-disposable-volume workflow. We'll disagree on this; happy to discuss.

4. **(Frontend / UX)** Will the in-app Backup UI surface the integrity-check status of each backup file (badge: "verified restorable" green)? If yes, the producer must record verification status alongside the file (sidecar `.ok` marker, or an entry in a `backup_runs` table).

5. **(Sports Med + Backend)** When `set_logs` ships in #3, the daily DB size will grow meaningfully. I've sized the disk budget assuming ~5 MB/user/month — please flag if your model expects materially more (e.g., dense per-rep instrumentation).

6. **(All)** "Beta" duration: how long do we expect to be in Beta before GA? My retention/budget numbers assume ~6 months. If it's a year, I'd revisit retention (maybe 30 days instead of 14) and add WAL archiving to the GA list rather than the post-Beta list.

7. **(Operator/User)** Healthchecks.io vs another notification channel: are you OK with email-only for Beta, or do you want SMS / push? Email is what I've specced. SMS adds a dependency (Twilio / similar) without much MTTR win for a non-24/7 service.
