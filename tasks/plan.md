# RepOS v1 — Implementation Plan

## Context

Spec/design phase is complete. Two artifacts exist: `Engineering Handoff.md` (authoritative backend spec) and `RepOS.html` (hi-fi prototype shell that references 6 missing JSX files). Nothing has been built yet.

This plan covers:
1. **Prototype** — the 6 JSX component files that make RepOS.html functional in a browser
2. **Backend API** — Postgres schema + 4 endpoints + auth + 13 required test cases

---

## Dependency Graph

### Prototype
```
tokens.jsx
  ├── design-canvas.jsx  (uses REPOS_TOKENS, REPOS_FONTS)
  ├── ios-frame.jsx
  ├── desktop-dashboard.jsx
  ├── mobile-live.jsx    (depends on ios-frame.jsx)
  └── health-sync.jsx
```

### Backend
```
DB migrations
  ├── device_tokens table
  │   └── auth middleware
  │       ├── POST /api/health/weight
  │       └── POST /api/health/weight/backfill
  ├── health_weight_samples
  │   ├── POST /api/health/weight        (writes + sync_status update)
  │   ├── POST /api/health/weight/backfill
  │   └── GET  /api/health/weight        (reads + stats computation)
  └── health_sync_status
      └── GET  /api/health/sync/status
```

---

## Tech Stack (confirm before Phase 3)

**Backend:** Node.js + Fastify + TypeScript + `pg` (node-postgres)
- Fastify provides schema-validated routes and good TS support
- `pg` keeps SQL explicit — important for the custom dedupe/upsert logic
- Alternatives: Python/FastAPI if team has Python preference; Go/chi for max throughput

**Open decisions before backend work starts:**
1. Backend language/framework (default: Node/Fastify/TS above)
2. Stats computation — `trend_7d_lbs` as linear regression slope or simple first-vs-last delta?
3. Retention — keep all samples forever (v1 safe default)

---

## Vertical Slices

### Phase 1 — Prototype: Design System

**Task P1:** `tokens.jsx` + `design-canvas.jsx` + `ios-frame.jsx`

Implements:
- `REPOS_TOKENS` — dark/light theme objects with all color tokens from CLAUDE.md
- `REPOS_FONTS` — `{ui: 'Inter Tight', mono: 'JetBrains Mono'}`
- `DesignCanvas`, `DCSection`, `DCArtboard`, `DCPostIt` — layout scaffolding
- `IOSFrame` — device chrome wrapper used by mobile-live

Acceptance criteria:
- `RepOS.html` opens in browser with no JS errors
- Artboard scaffolding is visible (even with missing screen content)

Verification: open `file://…/RepOS.html`, check console — zero errors

---

### Phase 2 — Prototype: Screens (parallel after P1)

**Task P2:** `desktop-dashboard.jsx` → `DesktopDashboard`

Implements home screen: bodyweight chart (sparkline + trend labels), sync status pill (fresh/stale/broken states), program dashboard stub, volume heat-map section.

Acceptance criteria:
- Home artboard renders at 1440×1300 with hardcoded mock data
- Theme toggle (dark/light) and persona toggle (beginner/advanced) both work
- All three sync states (green/amber/red pill) are exercisable via tweaks panel

Verification: browser visual check + toggle all tweaks

---

**Task P3:** `mobile-live.jsx` → `MobileLive`

Implements mid-workout logging screen: exercise card, set logging, bodyweight chip (reads sync state from mock data).

Acceptance criteria:
- Mobile artboard renders inside iOS device frame at 402×956
- Bodyweight chip shows weight + sync dot

---

**Task P4:** `health-sync.jsx` → `SettingsIntegrations`

Implements Settings → Integrations page: token generation UI (copy + QR placeholder), sync status display, device list, Shortcut download button.

Acceptance criteria:
- Settings artboard renders all three sync state variants
- Token UI shows "generated token" state with masked value + copy button

---

**Checkpoint A:** All 3 artboards fully render, all tweaks work, zero console errors

---

### Phase 3 — Backend: Foundation

**Task B1:** Project scaffolding in `api/`

- `api/package.json`, `api/tsconfig.json`, Fastify server, `npm run dev`, `npm run test`
- `GET /health` → `200 {"status":"ok"}`

---

**Task B2:** Database migrations

Creates tables per spec §3:
- `users` (id UUID, email, timezone TEXT)
- `device_tokens` (id, user_id, token_hash TEXT, scope TEXT, last_used_at, revoked_at, created_at)
- `health_weight_samples` — exact DDL from spec §3.1 including UNIQUE(user_id, sample_date, source)
- `health_sync_status` — exact DDL from spec §3.2
- Index: `idx_hws_user_date ON health_weight_samples (user_id, sample_date DESC)`

Acceptance criteria:
- `npm run migrate` runs clean
- `\d health_weight_samples` shows constraint + index

---

**Checkpoint B:** `npm run dev` starts; `npm run migrate` clean

---

### Phase 4 — Auth

**Task B3:** Token mint + revoke

- `POST /api/tokens` — mint opaque random token, argon2id-hash before store, return plaintext once; surface `last_used_ip`, `last_used_at`
- `DELETE /api/tokens/:id` — revoke (set `revoked_at`); revocation effective within 60s via TTL cache

Acceptance criteria:
- POST → 201 with plaintext token string
- DELETE → 204; subsequent DELETE → 404

---

**Task B4:** Auth middleware

- Parse `Authorization: Bearer <token>`; hash and lookup; set `req.userId`
- Reject missing → 401; revoked → 401; invalid → 401

Acceptance criteria: test cases **8** (no bearer → 401) and **9** (revoked bearer → 401) pass

---

**Checkpoint C:** Auth test cases 8–9 pass

---

### Phase 5 — Write Path

**Task B5:** `POST /api/health/weight`

Validation:
- `weight_lbs`: number, 50.0–600.0, round to 1 decimal → 400 + `field: "weight_lbs"` if outside
- `date`: `YYYY-MM-DD` format → 400 + `field: "date"` if malformed
- `time`: `HH:MM:SS` format
- `source`: must be in `['Apple Health','Manual','Withings','Renpho']` → 400 + `field: "source"`

Dedupe:
- Check existing row for `(user_id, date, source)`
- If exists and `|incoming - existing| <= 0.05` → return `200 {deduped: true}` (no write)
- If exists and `|incoming - existing| > 0.05` → UPDATE `weight_lbs` + `updated_at`, return `200 {deduped: true}`
- If not exists → INSERT, return `201 {deduped: false}`

Rate limit: count writes for `(user_id, date)` in past 24h; if ≥ 5 → `409 {error: "rate_limited"}`

On every successful write: upsert `health_sync_status` (`last_fired_at`, `last_success_at`, clear `last_error`, reset `consecutive_failures`)

Acceptance criteria: test cases **1–10** pass

---

**Task B6:** `POST /api/health/weight/backfill`

- Accept `{samples: [{weight_lbs, date, time, source}]}`
- Apply same validation + dedupe logic per sample
- Run in a single transaction; return `{created: N, deduped: N}`

Acceptance criteria: test case **13** passes (30 samples, 5 already exist → `{created: 25, deduped: 5}`)

---

**Checkpoint D:** Test cases 1–10, 13 pass

---

### Phase 6 — Read Path

**Task B7:** `GET /api/health/weight?range=7d|30d|90d|1y|all`

Query samples for `user_id` in the requested range, ordered by `sample_date ASC`.

Response shape (per spec §5.1):
- `current` — most recent sample `{weight_lbs, date, time}` across all time (not scoped to range)
- `samples` — array of samples in the requested range
- `stats`:
  - `trend_7d_lbs` / `trend_30d_lbs` / `trend_90d_lbs` — weight delta (last minus first) computed over their **own fixed windows** regardless of the requested `range` (e.g. `trend_7d_lbs` always looks back 7 days from today); null if fewer than 2 samples in that window
  - `adherence_pct` — `(days_with_sample / total_days_in_range) * 100`, rounded to 1 decimal, scoped to the requested range
  - `missed_days` — `YYYY-MM-DD` strings with no sample within the requested range
- `sync` — `{source, last_success_at, state}` pulled from `health_sync_status`

Empty table returns `{current: null, samples: [], stats: {trend_7d_lbs: null, trend_30d_lbs: null, trend_90d_lbs: null, adherence_pct: null, missed_days: []}, sync: null}`.

Cache-Control: `no-store` (personalized data)

Acceptance criteria: test case **11** passes

---

**Task B8:** `GET /api/health/sync/status`

Join `health_sync_status` for `user_id`. Compute `state`:
- `fresh` if `last_success_at` within 36h
- `stale` if 36h–72h
- `broken` if >72h **or** `consecutive_failures >= 3`

Cache-Control: `max-age=60`

Acceptance criteria: test case **12** passes (`last_success_at > 72h ago` → `state: "broken"`)

---

**Checkpoint E:** All 13 test cases pass

---

## Files to Create

### Prototype (repo root)
| File | Exports |
|---|---|
| `tokens.jsx` | `REPOS_TOKENS`, `REPOS_FONTS` |
| `design-canvas.jsx` | `DesignCanvas`, `DCSection`, `DCArtboard`, `DCPostIt` |
| `ios-frame.jsx` | `IOSFrame` |
| `desktop-dashboard.jsx` | `DesktopDashboard` |
| `mobile-live.jsx` | `MobileLive` |
| `health-sync.jsx` | `SettingsIntegrations` |

### Backend (`api/` subdirectory)
```
api/
  package.json
  tsconfig.json
  src/
    index.ts              — Fastify app entry
    db/
      client.ts           — pg Pool setup
      migrations/
        001_users.sql
        002_device_tokens.sql
        003_health_weight_samples.sql
        004_health_sync_status.sql
    middleware/
      auth.ts             — Bearer token validation
    routes/
      tokens.ts           — mint/revoke
      weight.ts           — POST single + backfill + GET
      sync.ts             — GET /sync/status
    services/
      stats.ts            — trend/adherence computation
  tests/
    weight.test.ts        — all 13 spec test cases
```

---

## Verification

Full test suite: `cd api && npm test` → all 13 cases pass
Prototype smoke test: open `RepOS.html` in browser → zero JS console errors, all artboards render
