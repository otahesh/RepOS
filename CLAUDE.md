# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

RepOS is a fitness tracking app — Apple Health weight-sync is v1. **Status: alpha, deployed.** The full backend (Fastify + Postgres) and frontend (Vite + React) ship from this repo, run as a single Docker container on Unraid, and are publicly reachable as `https://repos.jpmtech.com` via Cloudflare Tunnel.

For current operational state see:
- `docs/superpowers/plans/2026-05-11-repos-beta.md` — the master Beta plan (9 waves, 15 acceptance gates); W0 is operationally complete
- `docs/superpowers/plans/2026-05-03-repos-monolithic-container.md` — the implementation plan that drove the alpha deploy
- `Engineering Handoff.md` — authoritative product spec; **do not modify** without checking in first

## Repo Layout

- `api/` — Fastify 5 + TypeScript backend (production source)
- `frontend/` — Vite 5 + React 18 + TypeScript frontend (production source)
- `docker/` — Dockerfile, nginx config, s6-overlay v3 service tree
- `RepOS.html` + `*.jsx` files at root — original hi-fi design prototype (React via CDN). **Visual reference only — do not modify.** The live UI is in `frontend/`.

## Working in this Repo

- **Bash tool calls do NOT preserve cwd between calls.** Always use absolute paths (e.g. `cd /Users/jasonmeyer.ict/Projects/RepOS/api && npm test`) or chain with `&&` in a single call. A bare `npm test` in a follow-up call will fail because the next bash invocation starts from the project root.
- **Local dev DB no longer exists.** The standalone `repos-postgres` container at `192.168.88.2:5432` was retired during the monolithic-container deploy. To run `npm test` locally you need a separate dev Postgres or to test inside the production container path. (Follow-up not yet done.)
- **Conventional Commits** — see parent `../CLAUDE.md` for format. Frequent small commits per step, not one giant feature commit.

## Design System

Fonts: **Inter Tight** (UI) and **JetBrains Mono** (all data: weight, reps, RPE, PR delta).

Color tokens (dark theme):
- Accent / effort: `#4D8DFF`
- Good / PR: `#6BE28B`
- Warn / MAV: `#F5B544`
- Danger / MRV: `#FF6A6A`
- Surface: `#10141C`
- Background: `#0A0D12`

Voice: short sentences, verbs first, all-caps for CTAs. No fluff.

## Backend Spec Highlights (full text in `Engineering Handoff.md`)

### Key constraints

- **Deduplication key:** `(user_id, date, source)` — not time. Same-day re-syncs update, not append.
- **Weight range:** 50.0–600.0 lbs. Reject outside. Store as `NUMERIC(5,1)`.
- **Sources enum:** `Apple Health | Manual | Withings | Renpho`. Reject unknown.
- **Rate limit:** 409 on >5 writes per `(user, date)` in 24h.
- **Idempotency:** update if incoming weight differs by >0.05 lb from existing; otherwise return `200 deduped:true`.
- **Sync state thresholds:** fresh <36h, stale 36–72h, broken >72h. 36h (not 24h) absorbs iOS Personal Automation drift.
- **Token auth:** opaque bearer (`<16-hex-prefix>.<64-hex-secret>`), scoped to `health:weight:write`, stored hashed (argon2id) with prefix prepended for O(log n) lookup via `text_pattern_ops` index. JWT not preferred — opaque + DB lookup for simpler rotation.
- **Time handling:** store wall-clock `time` as display label only. Do not derive UTC. Store user TZ on the user record.

### Primary table

```sql
CREATE TABLE health_weight_samples (
  id           BIGSERIAL PRIMARY KEY,
  user_id      UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sample_date  DATE         NOT NULL,
  sample_time  TIME         NOT NULL,
  weight_lbs   NUMERIC(5,1) NOT NULL CHECK (weight_lbs BETWEEN 50.0 AND 600.0),
  source       TEXT         NOT NULL CHECK (source IN ('Apple Health','Manual','Withings','Renpho')),
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
  UNIQUE (user_id, sample_date, source)
);
```

### API surface (v1)

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/health/weight` | Ingest single sample from Shortcut |
| `POST` | `/api/health/weight/backfill` | Bulk ingest (max 500 per call, same dedupe rules) |
| `GET` | `/api/health/weight?range=7d\|30d\|90d\|1y\|all` | Chart data + stats |
| `GET` | `/api/health/sync/status` | Lightweight sync pill; `Cache-Control: private, max-age=60` |
| `POST/GET/DELETE` | `/api/tokens[/:id]` | Token mint/list/revoke; `X-Admin-Key`-gated, additionally Cloudflare-Access-gated at the edge in production |

Stats (`trend_7d_lbs`, `trend_30d_lbs`, `trend_90d_lbs`, `adherence_pct`, `missed_days`) are computed server-side so web and mobile agree.

### Test acceptance

`api/tests/weight.test.ts` — 14 cases (13 from spec §7 plus calendar-invalid date). Must pass before merging to `main`.

## Scope

**Alpha (shipped):** Apple Health bodyweight sync, web chart, mobile read-only chip, sync status pill, manual backfill API, single-container deploy on Unraid behind Cloudflare Tunnel + Access, GHCR + CI builds, nightly Postgres backups (14-day retention), per-service s6-log rotation, CF Access whole-host auth (built; flag-bypassed in alpha, default-on in Beta).

**Beta (in-flight):** see `docs/superpowers/plans/2026-05-11-repos-beta.md`. 9 waves, 15 binary acceptance gates. W0 (auth flip + cleanup + JWKS test) covered by `docs/superpowers/plans/2026-05-11-beta-W0-auth-flip.md`.

**Post-Beta / GA (out of scope for Beta):** multi-metric body composition, Withings/Renpho direct integration, automated backfill, source-priority UI, image signing (cosign), WAL archiving / PITR, multi-region / HA Postgres, light theme, notification settings panel.
