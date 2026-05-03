# RepOS v1 — Task List

## Design Reference (do not modify)
- `RepOS.html` + 6 JSX files = Figma-style design canvas. Hardcoded mock data, sticky notes, artboards.
- Use as visual spec for colors, typography, component layout, and copy voice.
- Design tokens live in `tokens.jsx` (REPOS_TOKENS dark/light, REPOS_FONTS).

## Phase 1 — Frontend: Design System
- [ ] **P1** Set up real frontend app (framework TBD) with Inter Tight + JetBrains Mono, color tokens, dark theme
- [ ] **P2** Core layout: sidebar, topbar with sync pill, main content area
- [ ] **P3** DesktopDashboard — bodyweight chart, volume heat-map, program header, schedule
- [ ] **P4** MobileLive — workout logging screen with bodyweight chip
- [ ] **P5** SettingsIntegrations — token generation UI, sync status, device list

### Checkpoint A
- [ ] All screens match design reference, dark/light theme works, zero console errors

## Phase 3 — Backend: Foundation
- [ ] **B1** Project scaffolding (`api/` — Fastify + TypeScript + pg)
- [ ] **B2** Database migrations (users, device_tokens, health_weight_samples, health_sync_status)

### Checkpoint B
- [ ] `npm run dev` starts; `npm run migrate` clean

## Phase 4 — Auth
- [ ] **B3** Token mint + revoke (`POST /api/tokens`, `DELETE /api/tokens/:id`)
- [ ] **B4** Auth middleware (Bearer token → userId, 401 on missing/revoked/invalid)

### Checkpoint C
- [ ] Test cases 8–9 pass

## Phase 5 — Write Path
- [ ] **B5** `POST /api/health/weight` (validate, dedupe, upsert, rate limit, sync_status update)
- [ ] **B6** `POST /api/health/weight/backfill` (batch, same dedupe rules, single transaction)

### Checkpoint D
- [ ] Test cases 1–10, 13 pass

## Phase 6 — Read Path
- [ ] **B7** `GET /api/health/weight?range=` (samples + current + stats + sync block)
- [ ] **B8** `GET /api/health/sync/status` (state: fresh/stale/broken, cacheable 60s)

### Checkpoint E
- [ ] All 13 test cases pass
