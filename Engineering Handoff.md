# RepOS · Health Sync — Engineering Handoff

**Owner:** Design → Backend
**Scope:** Apple Health bodyweight ingestion via iOS Shortcut
**Cadence:** Once-daily push (no read-back, no realtime)
**Status:** Spec ready for build

---

## 1. Architecture (one diagram, words)

```
iPhone · Health app
        │  (morning weight entry, manual or smart-scale)
        ▼
iOS Shortcut · "RepOS Daily Weight Sync"
        │  Trigger: Personal Automation · 07:30 daily
        │  Action: Get Latest Health Sample (Body Mass)
        │  Action: Get Current Date
        │  Action: Get Contents of URL · POST · JSON body
        ▼
RepOS API · POST /api/health/weight
        │  Auth: device-bound bearer token (per-user, long-lived)
        │  Validate · dedupe · upsert
        ▼
Postgres · health_weight_samples
        ▼
Read APIs · GET /api/health/weight?range=90d
        ▼
Web dashboard (BodyweightChart) + mobile context chip
```

No HealthKit SDK. No background refresh. The Shortcut is the only writer.

---

## 2. The wire contract

### 2.1 Request

```http
POST /api/health/weight HTTP/1.1
Host: api.repos.app
Authorization: Bearer <user_device_token>
Content-Type: application/json
Idempotency-Key: <sha256(user_id + date + source)>   # recommended, not required

{
  "weight_lbs": 185.4,
  "date": "2026-04-26",
  "time": "07:32:00",
  "source": "Apple Health"
}
```

### 2.2 Field rules

| Field | Type | Required | Notes |
|---|---|:-:|---|
| `weight_lbs` | number | ✓ | Range `50.0 – 600.0`. Reject outside. Round to 1 decimal on store. |
| `date` | string `YYYY-MM-DD` | ✓ | User-local date the sample was *recorded*, not posted. |
| `time` | string `HH:MM:SS` | ✓ | 24h, user-local. Treat as opaque label, don't compute UTC from it. |
| `source` | string | ✓ | Enum: `"Apple Health" | "Manual" | "Withings" | "Renpho"`. Reject unknown. |

### 2.3 Responses

| Status | Body | When |
|---|---|---|
| `201 Created` | `{id, date, weight_lbs, deduped: false}` | New row inserted |
| `200 OK` | `{id, date, weight_lbs, deduped: true}` | Same `(user_id, date, source)` already exists; latest value kept |
| `400` | `{error, field}` | Validation failure (range, format, enum) |
| `401` | — | Missing / invalid bearer token |
| `409` | `{error: "rate_limited"}` | >5 writes per `(user, date)` in 24h — Shortcut malfunction |
| `5xx` | — | Shortcut should retry up to 3× with 30s/2m/10m backoff |

### 2.4 Idempotency

The Shortcut may fire twice (network retry, automation re-run). Server **must** dedupe on `(user_id, date, source)`:
- If incoming `weight_lbs` differs by > 0.05 lb from the existing row, **update** and bump `updated_at`.
- Otherwise return `200 OK` with `deduped: true`.

This is why we don't dedupe on `time` — same-day re-syncs are normal.

---

## 3. Data model

### 3.1 Table: `health_weight_samples`

```sql
CREATE TABLE health_weight_samples (
  id               BIGSERIAL PRIMARY KEY,
  user_id          UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sample_date      DATE         NOT NULL,
  sample_time      TIME         NOT NULL,
  weight_lbs       NUMERIC(5,1) NOT NULL CHECK (weight_lbs BETWEEN 50.0 AND 600.0),
  source           TEXT         NOT NULL CHECK (source IN ('Apple Health','Manual','Withings','Renpho')),
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),

  UNIQUE (user_id, sample_date, source)
);

CREATE INDEX idx_hws_user_date ON health_weight_samples (user_id, sample_date DESC);
```

**Why one row per (user, date, source)?** Once-daily cadence. Multiple syncs same day = update, not append. Simplifies chart queries dramatically.

**Why store `time` if we don't index on it?** Display only — UI shows "Last synced 7:32 AM" so users can tell if their automation is firing on schedule.

### 3.2 Companion table: `health_sync_status` (optional, recommended)

```sql
CREATE TABLE health_sync_status (
  user_id          UUID         PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  source           TEXT         NOT NULL,
  last_fired_at    TIMESTAMPTZ  NOT NULL,
  last_success_at  TIMESTAMPTZ,
  last_error       TEXT,
  consecutive_failures INT      NOT NULL DEFAULT 0
);
```

Updated on every POST. Powers the "SYNCED 07:32 · APPLE HEALTH" pill and the staleness state.

---

## 4. Sync-cadence semantics

The Shortcut runs **once daily** at ~07:30 user-local. We design around that, not against it.

| State | Condition | UI |
|---|---|---|
| **Fresh** | `last_success_at` within 36h | green dot, value shown |
| **Stale** | 36h – 72h since last success | amber dot, "Last sync 2d ago" |
| **Broken** | > 72h or 3 consecutive failures | red dot, "Sync paused — check Shortcut" + link to docs |

**Why 36h not 24h?** Personal Automations on iOS drift. A user who works out at 7am sometimes triggers at 7:45am the next day. 24h would false-positive constantly. 36h is the smallest window that absorbs normal drift without hiding real outages.

### Backfill

Users will miss days (phone off, Shortcut paused). Expose:

```http
POST /api/health/weight/backfill
{ "samples": [ {weight_lbs, date, time, source}, ... ] }
```

Same dedupe rules. UI shows missed days as warn-tinted gaps in the chart (already designed).

---

## 5. Read APIs (for the existing UI)

### 5.1 `GET /api/health/weight?range=90d`

```json
{
  "current": { "weight_lbs": 185.4, "date": "2026-04-26", "time": "07:32:00" },
  "samples": [
    { "date": "2026-01-27", "weight_lbs": 191.2, "source": "Apple Health" },
    ...
  ],
  "stats": {
    "trend_7d_lbs": -0.6,
    "trend_30d_lbs": -2.1,
    "trend_90d_lbs": -5.8,
    "adherence_pct": 97.8,
    "missed_days": ["2026-04-06", "2026-04-07"]
  },
  "sync": {
    "source": "Apple Health",
    "last_success_at": "2026-04-26T07:32:00-07:00",
    "state": "fresh"
  }
}
```

`range` accepts `7d | 30d | 90d | 1y | all`.

The 7-day moving average + adherence % are computed server-side so mobile and web agree.

### 5.2 `GET /api/health/sync/status`

Lightweight version of the `sync` block above. Used by the topbar pill and mobile chip — should be cacheable for 60s.

---

## 6. Auth · per-device token

The Shortcut can't do OAuth. Issue a long-lived bearer token via the web app:

1. User logs in on web → Settings → Integrations → "Add Apple Health source"
2. Server mints a token scoped to `health:weight:write`, displayed once as a copy-paste string + QR code
3. User pastes it into the Shortcut's "Authorization" header field
4. Token revocable from the same Settings page; revocation invalidates within 60s

Store hashed (`bcrypt` or `argon2id`). Don't store plaintext. Surface last-used IP/timestamp so users can detect leaks.

---

## 7. Test cases the backend must pass

```
1. POST valid sample → 201, row created
2. POST same (user,date,source) with same weight → 200, deduped:true, no update
3. POST same (user,date,source) with different weight → 200, deduped:true, weight updated, updated_at bumped
4. POST weight_lbs=49.9 → 400, field=weight_lbs
5. POST weight_lbs=600.1 → 400, field=weight_lbs
6. POST source="Fitbit" → 400, field=source
7. POST date="04/26/2026" → 400, field=date
8. POST without bearer → 401
9. POST with revoked bearer → 401
10. 6th POST in 24h for same (user,date) → 409
11. GET /weight?range=90d after empty table → 200, samples:[], stats with nulls
12. GET /sync/status when last_success > 72h ago → state:"broken"
13. Backfill of 30 days, 5 of which already exist → 30 returned, 5 deduped
```

---

## 8. Open questions for engineering

1. **Token format** — opaque random vs. JWT? Lean opaque + DB lookup; rotation is simpler.
2. **Multi-source priority** — if a user has both Apple Health and a Withings scale on the same date, which wins on the chart? Default: most-recent `time`.
3. **Time-zone storage** — sample arrives as wall-clock with no TZ. Store the user's TZ on the user record and stamp received samples with it; do *not* try to derive TZ from the request.
4. **Retention** — keep all samples forever, or aggregate >2y to weekly?
5. **Webhook out** — do we want to push weight updates to other RepOS surfaces (program-recommendation engine) on write, or pull from the read API?

---

## 9. The Shortcut itself (deliverable to users)

We'll publish a signed `.shortcut` file for users to import. Spec for that file:

- Trigger: Personal Automation · Time of Day · 07:30 · Run Immediately (no notification)
- Actions:
  1. `Find Health Samples` — Body Mass, Most Recent, 1 sample
  2. `Format Number` — round to 1 decimal
  3. `Get Current Date` → format `yyyy-MM-dd`, `HH:mm:ss`
  4. `Dictionary` → build payload
  5. `Get Contents of URL` → POST to `https://api.repos.app/api/health/weight` with bearer header
  6. On error: `Show Notification` + `Wait 30s` + retry (max 3)

Bundle download lives on the Settings → Integrations detail page (mocked in design).

---

## 10. What ships in v1 vs. v2

**v1 (this spec):** Weight only, Apple Health source, web chart, mobile read-only chip, sync status pill, manual backfill API.

**v2 (not in this doc):** Multi-metric (body fat %, resting HR), additional sources (Withings/Renpho direct), automated backfill via Shortcut "Find All Samples Since Last Sync" pattern, source-priority UI.

---

*Design artifacts: `RepOS.html` → "Settings · Integrations" artboard for the user-facing sync surface. Bodyweight chart on the Home dashboard. Mobile chip on the Live Workout screen.*
