# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

RepOS is a fitness tracking app. This repository is currently in **spec/design phase** — no backend or frontend application code has been built yet. The two artifacts here are:

- `Engineering Handoff.md` — The authoritative backend spec for the Apple Health weight sync feature (v1)
- `RepOS.html` — A hi-fi design prototype (React via CDN + Babel standalone) referencing external JSX files that don't yet exist in this repo

## The Prototype

`RepOS.html` loads React 18 from CDN and compiles JSX via `@babel/standalone`. It references six JSX component files that need to be co-located:

- `tokens.jsx` — Design tokens (`REPOS_TOKENS`, `REPOS_FONTS`)
- `design-canvas.jsx` — Layout primitives (`DesignCanvas`, `DCSection`, `DCArtboard`, `DCPostIt`)
- `ios-frame.jsx` — iOS device frame wrapper
- `desktop-dashboard.jsx` — `DesktopDashboard` component (home screen with bodyweight chart)
- `mobile-live.jsx` — `MobileLive` component (mid-workout logging screen)
- `health-sync.jsx` — `SettingsIntegrations` component (Apple Health config surface)

Open `RepOS.html` directly in a browser to preview — no build step required.

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

## Backend Spec (from Engineering Handoff.md)

### Key constraints

- **Deduplication key:** `(user_id, date, source)` — not time. Same-day re-syncs update, not append.
- **Weight range:** 50.0–600.0 lbs. Reject outside. Store as `NUMERIC(5,1)`.
- **Sources enum:** `Apple Health | Manual | Withings | Renpho`. Reject unknown.
- **Rate limit:** 409 on >5 writes per `(user, date)` in 24h.
- **Idempotency:** update if incoming weight differs by >0.05 lb from existing; otherwise return `200 deduped:true`.
- **Sync state thresholds:** fresh <36h, stale 36–72h, broken >72h. 36h (not 24h) absorbs iOS Personal Automation drift.
- **Token auth:** opaque bearer, scoped to `health:weight:write`, stored hashed (bcrypt/argon2id). No plaintext. JWT not preferred — opaque + DB lookup for simpler rotation.
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
| `POST` | `/api/health/weight/backfill` | Bulk ingest (same dedupe rules) |
| `GET` | `/api/health/weight?range=7d\|30d\|90d\|1y\|all` | Chart data + stats |
| `GET` | `/api/health/sync/status` | Lightweight sync pill; cacheable 60s |

Stats (`trend_7d_lbs`, `trend_30d_lbs`, `trend_90d_lbs`, `adherence_pct`, `missed_days`) are computed server-side so web and mobile agree.

### Required test cases

See §7 of `Engineering Handoff.md` for the 13 required backend test cases. These are the acceptance criteria for the v1 endpoint.

## Scope

**v1 (this spec):** Weight only, Apple Health source, web chart, mobile read-only chip, sync status pill, manual backfill API.

**v2 (out of scope here):** Multi-metric, Withings/Renpho direct integration, automated backfill, source-priority UI.
