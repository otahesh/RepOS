# RepOS Workouts Sync — iOS Shortcut

This document is the build-from-scratch recipe for the iOS Shortcut that pushes a completed Apple Watch workout to `https://repos.jpmtech.com`. It pairs with a Personal Automation that fires the Shortcut at the **end of every Apple Watch workout** — no schedule, no manual run required day-to-day.

The Shortcut runs **silently** — no UI prompts, no notifications on success. A failure shows a single notification so the user can investigate.

> **Verified against iOS 26.4.2.** Action names and field labels described below match the current iOS Shortcuts app. Items that couldn't be confirmed against an iOS 26 source are marked **iOS 26 spot-check** inline — verify on your phone and let the doc owner know if anything reads differently.

> **Why hand-build instead of importing a `.shortcut` file?** Apple signs `.shortcut` bundles with iCloud keys tied to the device that authored them. There is no supported way to generate that binary off-device. Hand-building takes ~10 minutes and gives you a clean signature on your own iCloud account. **Do NOT paste a workouts token into a Shortcut import URL** (`https://www.icloud.com/shortcuts/...`) — that route round-trips the secret through Apple's CDN cache, which is exactly the leak vector the bearer-prefix design is meant to avoid.

This doc assumes you have already built the weight Shortcut from [`health-weight-sync.md`](./health-weight-sync.md) **or** that you are building a workouts-only Shortcut from scratch. Where the procedure is identical, this doc references the weight doc by section number rather than duplicating it.

---

## 1. Prerequisites

| Requirement | Why |
|---|---|
| iPhone running iOS 26 or later, paired with an Apple Watch | Workout End trigger lives on the Watch side of the automation |
| At least one completed Apple Watch workout in Health | The Shortcut reads the most-recent workout |
| RepOS user record exists in production | Token is minted against a `user_id` |
| You can SSH to the Unraid host **or** are on the Cloudflare Access allowlist for `https://repos.jpmtech.com/api/tokens` | Required to mint the bearer token |
| `ADMIN_API_KEY` value from `/mnt/user/appdata/repos/.env` | Authenticates the mint call inside the tunnel |
| `jq` ≥ 1.7 for the smoke-test commands below | Tested against `jq-1.7.1` |
| CF Access **Bypass** policy live on `/api/health/*` | Without it the Shortcut hits an HTML challenge page instead of the API |

### 1.1 Token hygiene — read before minting

- **Mint tokens via the CF Access-protected RepOS UI / curl path, never via a public form.** The endpoint is gated by both Cloudflare Access (email allowlist) and the `X-Admin-Key` header.
- **Paste the secret into the Shortcut's `Authorization` header field ONCE, then delete it from any clipboard manager** (1Password, Clipy, Paste, etc.). The plaintext appears once at mint-time and is never recoverable from the server — RepOS stores only the argon2id hash with the 16-hex prefix prepended for indexed lookup.
- **NEVER paste tokens into a Shortcut import URL** (`https://www.icloud.com/shortcuts/...`). That URL is fetched through Apple's iCloud CDN and the body is cached at the edge — anything pasted into it can persist outside your control.
- **If you suspect leak, revoke immediately** via `DELETE /api/tokens/:id` (see §5 below) and mint a fresh one. Revocation is effectively instant — there is no auth cache.
- **Never share screenshots of the Shortcut editor that include the `Authorization` header** — the bearer secret is visible in plaintext. If you need to ask for help, paste only the part of the Shortcut that's failing, or redact the header value before sharing.

### 1.2 Mint a workouts-scoped token

The mint procedure is identical to the weight Shortcut's, with one body delta: pass an explicit `scopes` array containing `"health:workouts:write"`. Refer to [`health-weight-sync.md` §1.1](./health-weight-sync.md#11-mint-the-bearer-token) for the surrounding SSH / `X-Admin-Key` walkthrough — only the body of the POST changes.

```bash
ssh unraid
ADMIN_KEY=$(grep ^ADMIN_API_KEY= /mnt/user/appdata/repos/.env | cut -d= -f2-)
USER_ID=<your-user-uuid-from-the-users-table>

curl -sS -X POST http://127.0.0.1/api/tokens \
  -H "X-Admin-Key: $ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"user_id\":\"$USER_ID\",\"label\":\"iPhone — Workouts Sync\",\"scopes\":[\"health:workouts:write\"]}"
```

Response:

```json
{
  "id": 12,
  "token": "9f8e7d6c5b4a3210.<64 hex chars>",
  "created_at": "2026-05-14T..."
}
```

**Copy the `token` value into a password manager NOW.** Plaintext is shown once.

Notes on scope validation (from `api/src/routes/tokens.ts`):

- `scopes` missing → defaults to `['health:weight:write']` (alpha compatibility). **This is the wrong scope for workouts** — you must pass `scopes` explicitly.
- `scopes: []` → 400 `{ error: "invalid_scope", scope: "" }`.
- Unknown scope value → 400 `{ error: "invalid_scope", scope: "<bad>" }`. Valid values are listed in `api/src/auth/scopes.ts` (`health:weight:write`, `health:workouts:write`, `program:write`).
- Sending one token with both scopes is permitted (`"scopes":["health:weight:write","health:workouts:write"]`) but **not recommended** — keep one device-scope per token so a leak is contained.

### 1.3 Health permissions

The Shortcut will prompt for **Read access to Workouts** the first time it runs. Grant it. If revoked later, `Find Workouts` returns zero results and the POST never fires — the failure is silent unless you wire the §6.1 hardening.

---

## 2. Build the Shortcut

Open Shortcuts → tap **+** → name the new shortcut **"RepOS Workout Sync"**. Add the actions in order.

> Notation: `Field: Value` means the named parameter inside the action card. `Why:` explains the choice. "Magic variable" means the output of a previous step that you reference by tapping it into a field.

### Step 1: Find Workouts

Add **"Find Workouts"** (in the Health category — iOS 26 spot-check: may also render as "Find All Workouts Where").

- `Sort by: End Date`
- `Order: Latest First`
- `Limit: 1 workout`
- `Filter: (none — leave empty)`
- **Why:** We want exactly one workout, the most recent. Because the trigger fires at the end of an Apple Watch workout (§3), the most-recent row is the one that just ended.

### Step 2: Get Details of Workouts — start date

Add **"Get Details of Workouts"**.

- `Input: Workouts` (magic variable from Step 1)
- `Get: Start Date`
- **Why:** Apple's `Start Date` is a Date object including timezone offset. The API requires ISO-8601 with offset, so we'll format it in Step 6.

Long-press the magic-variable output → rename it to **"Workout Start"**.

### Step 3: Get Details of Workouts — end date

Add another **"Get Details of Workouts"**.

- `Input: Workouts`
- `Get: End Date`

Long-press → rename to **"Workout End"**.

### Step 4: Get Details of Workouts — duration

Add another **"Get Details of Workouts"**.

- `Input: Workouts`
- `Get: Duration`
- **Why:** Apple exposes `Duration` as a Measurement in seconds. The API expects a bare integer count of seconds. We'll coerce to a number in Step 7 by referencing the magic variable directly into a Number-typed JSON field — Shortcuts strips the unit suffix automatically when the destination type is Number. If your Shortcuts build does NOT strip the suffix (rare), insert a **"Get Numbers from Input"** action immediately after this step.

Long-press → rename to **"Workout Duration"**.

### Step 5: Get Details of Workouts — distance and activity type

Add a fifth **"Get Details of Workouts"**.

- `Input: Workouts`
- `Get: Total Distance`
- **Why:** Apple's `Total Distance` is exposed as meters for HKWorkoutActivityType walking / running / cycling / swimming. For strength sessions and other distance-less activities this returns 0 or empty — we'll guard the JSON field in Step 9 so distance is omitted from the body in that case.

Long-press → rename to **"Workout Distance"**.

Add a sixth **"Get Details of Workouts"**.

- `Input: Workouts`
- `Get: Type` *(iOS 26 spot-check: the picker may label this "Workout Type" or "Activity Type")*
- **Why:** Returns Apple's display label for the workout's `HKWorkoutActivityType` (e.g. `Running`, `Traditional Strength Training`). The values you see in the Shortcut are the localized labels, not the underlying enum constants (`HKWorkoutActivityTypeRunning`, etc.) — keep that in mind when debugging against Apple's HealthKit docs. We map this to the API's lowercase modality enum in Step 7.

Long-press → rename to **"Workout Type"**.

### Step 6: Format ISO-8601 timestamps

The API validates `started_at` and `ended_at` with Zod's `z.string().datetime({ offset: true })`, which requires an explicit timezone segment (e.g. `…-04:00` or `…Z`). The raw Date object Shortcuts produces does NOT serialize to that shape — you must format it.

Add **"Format Date"**.

- `Date: Workout Start` (Step 2)
- `Date Format: Custom`
- `Format String: yyyy-MM-dd'T'HH:mm:ssXXX`
- `Time Format: None` *(iOS 26 spot-check: when Date Format is Custom, the Time Format selector may be hidden — that's expected; the format string already covers the time component)*
- **Why:** `yyyy-MM-dd` = full date, the literal `'T'` separator, `HH:mm:ss` = 24-hour wall time, `XXX` = colon-separated ISO offset like `-04:00`. Lowercase `xxx` would emit `-0400` (no colon) which Zod's `datetime({ offset: true })` rejects.

Long-press → rename to **"Started At"**.

Add another **"Format Date"** with the same configuration but `Date: Workout End`. Rename the output to **"Ended At"**.

### Step 7: Map activity type → API modality

The API allowlist (from `api/src/schemas/healthWorkouts.ts`) is exactly:

```
walk | run | cycle | row | swim | elliptical | strength | other
```

Apple's `HKWorkoutActivityType` names do not match — you must map them. Add **"If"** chains (one **If** action per branch, or a single **Choose from Menu** if you prefer the flatter UI; **If** chains are easier to edit later).

Mapping table (case-sensitive on both sides):

| Apple `Workout Type` value | API `modality` value |
|---|---|
| `Walking` | `walk` |
| `Running` | `run` |
| `Cycling` | `cycle` |
| `Rowing` | `row` |
| `Swimming` | `swim` |
| `Pool Swim` | `swim` |
| `Open Water Swim` | `swim` |
| `Elliptical` | `elliptical` |
| `Traditional Strength Training` | `strength` |
| `Functional Strength Training` | `strength` |
| `Core Training` | `strength` |
| (anything else — Hiking, HIIT, Yoga, Dance, etc.) | `other` |

**What lands in `other` in practice.** Common Apple Watch workout types that fall through to `other` include Hiking, HIIT, Yoga, Pilates, Dance, Tennis, Basketball, Soccer, Core Training, and Functional Strength Training. This is a deliberate W1.4 scoping decision — the 8-entry modality allowlist is fixed by the Zod schema (`api/src/schemas/healthWorkouts.ts`) and the data plan; the Shortcut cannot work around it by sending something else. If you run a varied training week and see `60% other` when you query `health_workouts` in psql, that is expected, not a bug or a missing migration.

Recommended pattern: add a **Text** action with the placeholder `other`, rename it to **"API Modality"**, then add an **If** action per matching row:

- `Input: Workout Type`
- `Condition: is`
- `Text: Running`
- Inside the If branch: **Set Variable** → Variable: `API Modality`, Value: `run`
- End If

Repeat for `Walking`, `Cycling`, etc. Anything that fails to match falls through with the default value `other`, which the API will accept.

**Why this matters:** The API rejects any modality outside the allowlist with `400 modality must be one of: walk, run, cycle, row, swim, elliptical, strength, other`. Apple's HK names ARE NOT in the allowlist, so a Shortcut that passes `Workout Type` straight through to the JSON body will 400 on every workout that isn't `other`.

### Step 8: Guard the distance field

Add **"If"**.

- `Input: Workout Distance`
- `Condition: is`
- `Number: 0` *(iOS 26 spot-check: the comparison operand selector may default to Text; pick Number)*

Inside the If branch: **Set Variable** → Variable: `API Distance`, Value: (leave empty / blank).
Inside the Otherwise branch: **Set Variable** → Variable: `API Distance`, Value: `Workout Distance` (magic variable).
End If.

**Why:** Strength workouts and other distance-less activity types return `0` (or sometimes empty) for `Total Distance`. Sending `distance_m: 0` is legal (the schema accepts non-negative integers) but misleading on the chart. Omitting the field entirely is the correct shape per spec — the schema declares `distance_m` as `.nullable().optional()` precisely for this case.

### Step 9: Get Contents of URL

Add **"Get Contents of URL"**.

- `URL: https://repos.jpmtech.com/api/health/workouts`
- Tap **Show More** to reveal Method, Headers, and Request Body.
- `Method: POST`
- `Headers:` tap **Add new header** *(iOS 26 spot-check: button label may read "Add new")* twice:
  - Key `Authorization` → Text `Bearer 9f8e7d6c5b4a3210.<64 hex chars>` (paste your full workouts-scoped token from §1.2)
  - Key `Content-Type` → Text `application/json`
- `Request Body: JSON`
- Inside the JSON section, tap **Add new field** for each row:

  | Type | Key | Value |
  |---|---|---|
  | Text   | `started_at`   | Started At (Step 6) |
  | Text   | `ended_at`     | Ended At (Step 6) |
  | Text   | `modality`     | API Modality (Step 7) |
  | Number | `distance_m`   | API Distance (Step 8) — leave the field empty in the strength branch |
  | Number | `duration_sec` | Workout Duration (Step 4) |
  | Text   | `source`       | `Apple Health` |

- **Why:** The `source` value MUST be the exact string `Apple Health` — case-sensitive, with the space, no dash. **The workouts endpoint accepts ONLY `Apple Health` or `Manual` — `Withings` and `Renpho` are rejected here even though the weight endpoint accepts them.** This is intentional: workouts come from Apple Watch in v1; Withings/Renpho do not log workouts.

> **Fallback if `Get Contents of URL`'s inline JSON crashes Shortcuts.** Some users have reported Shortcuts crashing on save when an inline JSON body has multiple fields. If you hit this: add a **Text** action above Step 9, paste the JSON template `{"started_at":"<value>","ended_at":"<value>","modality":"<value>","distance_m":<value>,"duration_sec":<value>,"source":"Apple Health"}` replacing each `<value>` with the matching magic variable (and dropping the `distance_m` key entirely in the strength branch), then in Step 9 set `Request Body: File` with the Text action's output as the file. The server accepts both forms.

Copy-pasteable JSON shape the server expects (verbatim — for sanity-checking your Shortcut against curl):

```json
{
  "started_at": "2026-05-14T10:00:00-04:00",
  "ended_at": "2026-05-14T10:32:15-04:00",
  "modality": "run",
  "distance_m": 5240,
  "duration_sec": 1935,
  "source": "Apple Health"
}
```

### Step 10: If — handle non-2xx

`Get Contents of URL` returns its parsed JSON response as the `Contents of URL` magic variable.

Add **"Get Dictionary Value"**.

- `Get: Value`
- `Key: error`
- `Dictionary: Contents of URL` (output of Step 9)

Add **"If"**.

- `Input: Dictionary Value`
- `Condition: is not empty` *(iOS 26 spot-check: pre-iOS 18 this read "has any value")*

Inside the **If** branch (error path), add **"Show Notification"**:

- `Title: RepOS workout sync failed`
- `Body:` magic variable for `Dictionary Value` (the error string)
- `Sound: Off` *(iOS 26 spot-check: pre-iOS 26 this read "Play Sound")*
- **Why:** Single user-visible feedback. Common values: `rate_limit_exceeded` (Shortcut firing too often), `scope_required:health:workouts:write` (token minted with the wrong scope), validation field names like `modality must be one of: …`, or a generic body if the server returned 5xx with HTML.

Inside the **Otherwise** branch (success path), leave it empty — silent-on-success is the spec.

End the If block. Tap **Done** in the top right to save.

---

## 3. Personal Automation trigger — Apple Watch Workout

The workout sync uses an **Apple Watch Workout** trigger, not Time of Day. The trigger fires at the **end** of a workout (the only event the iOS Personal Automations surface for workouts), which is exactly when the just-ended workout becomes the most-recent one in Health.

1. Shortcuts app → **Automation** tab → **+**
2. Tap **Create Personal Automation** *(iOS 26 spot-check: in iOS 26 this may simply be "New Automation" — pick the personal/per-device flow)*
3. Tap **Apple Watch Workout** *(iOS 26 spot-check: confirm against https://support.apple.com/guide/shortcuts/event-triggers-apd932ff833f/ios — if Apple has renamed this trigger, use the current name)*
   - `When: Ends`
   - `Workout Type: Any` (leave broad — the modality mapping in Step 7 handles the variety)
4. **Next**
5. Add action: **Run Shortcut** → pick **RepOS Workout Sync**
6. **Next**
7. Toggle **Run Immediately: ON**
8. Toggle **Notify When Run: OFF**
9. **Done**

> **Run Without Confirmation (iOS 17+):** iOS will prompt the first time the automation fires. Tap "Run Without Asking" inside the prompt, **or** pre-toggle "Run Without Confirmation" on the automation detail screen. Without this, the Shortcut sits waiting for confirmation and the sync silently fails to fire. The trap is identical to the Time-of-Day automation in the weight doc.

**Why the 36h stale threshold matters:** RepOS treats `health_sync_status` as `fresh` for 36h, `stale` from 36–72h, `broken` past 72h (CLAUDE.md: "the 36-hour stale threshold absorbs iOS Personal Automation drift"). If you skip a couple of days of workouts, the pill stays `stale`, not `broken`. The threshold is the same for weight and workouts — there is no separate sync-state row per scope in v1.

---

## 4. Test plan

### 4.1 Manual run from the Shortcuts app

1. Make sure you have at least one completed workout in Health. If not: start any Apple Watch workout (Other works fine) and end it after 30 seconds.
2. Open Shortcuts → tap **RepOS Workout Sync** to run it manually.
3. **Expected:** No notification. The shortcut completes in 1–3 seconds.

### 4.2 Verify the row landed (psql)

There is **no `GET /api/health/workouts` endpoint in v1** — only POST. Verification is psql-only until a future wave adds the read endpoint. From the Unraid host:

```bash
ssh unraid
docker exec -it RepOS psql -U repos -d repos -c \
  "SELECT id, started_at, ended_at, modality, distance_m, duration_sec, source, updated_at
   FROM health_workouts
   WHERE user_id = '<your-user-uuid>'
   ORDER BY started_at DESC LIMIT 5;"
```

You should see the new row with `source = 'Apple Health'`, the mapped `modality` (e.g. `run`), `distance_m` in meters (or NULL for strength), and `duration_sec` in seconds.

### 4.3 Verify silent dedupe on re-run

Run the Shortcut a second time within a few minutes — same workout, no changes in Health.

**Expected:** Still no notification. In the DB: the same row exists (same `id`); `updated_at` **will** bump because the route's upsert always sets `updated_at = now()` on conflict and the table trigger backs that up. The data columns (`ended_at`, `modality`, `distance_m`, `duration_sec`) are unchanged. The HTTP response was `200 { ..., deduped: true }`.

**Important semantic — `deduped: true` is NOT a no-op.** The dedupe key is `(user_id, started_at, source)`. If you edit the workout in Health (or re-run with a different `Workout End`) between two Shortcut runs, the second POST **overwrites** the row's `ended_at`, `modality`, `distance_m`, and `duration_sec` with the new values, AND still returns `deduped: true`. The flag means "I have seen this `started_at` before"; it does NOT mean "I rejected your payload". Freshest payload wins. If an Apple Watch glitch causes the workout to be re-logged with a corrupted end time, the second POST will silently overwrite the good first one. There is no undo path in v1 short of editing the row in psql.

### 4.4 Verify rate-limit guard (10/day)

The workout endpoint caps writes at **10 per (user, day)**, where the day key is derived from the workout's `started_at` local wall-clock date. The 11th write returns `409 { "error": "rate_limit_exceeded" }`. (Note the spelling: the workout endpoint emits `rate_limit_exceeded`; the weight endpoint emits `rate_limited`. They are different strings.)

Easiest way to verify: do 10 short Apple Watch workouts in a single day (or fabricate 11 POSTs via curl in §6). The 11th run produces the notification:

> `RepOS workout sync failed — rate_limit_exceeded`

The cap resets at the user's local midnight (next day's `started_at` slice).

### 4.5 Verify scope rejection

Mint a token WITHOUT the workouts scope and attempt a POST:

```bash
WEIGHT_ONLY_TOKEN=$(curl -sS -X POST http://127.0.0.1/api/tokens \
  -H "X-Admin-Key: $ADMIN_KEY" -H "Content-Type: application/json" \
  -d "{\"user_id\":\"$USER_ID\",\"label\":\"scope-test\",\"scopes\":[\"health:weight:write\"]}" | jq -r .token)

curl -sS -i -X POST https://repos.jpmtech.com/api/health/workouts \
  -H "Authorization: Bearer $WEIGHT_ONLY_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"started_at":"2026-05-14T10:00:00-04:00","ended_at":"2026-05-14T10:30:00-04:00","modality":"run","duration_sec":1800,"source":"Apple Health"}'
```

**Expected:** `HTTP/1.1 403` with body `{"error":"scope_required:health:workouts:write"}`. Revoke the scope-test token afterward (§5).

### 4.6 Sync pill (does NOT refresh on workout sync — W1.4 limit)

The topbar sync pill in W1.4 reflects weight syncs only — the workouts ingest route does not currently update `health_sync_status` (only `api/src/routes/weight.ts` writes that table). A fresh workout sync will NOT bump the pill; you'll still see your last weight sync's state (or `broken` if you have no weight syncs yet). Per-modality sync-state surfacing is a post-W1 concern.

---

## 5. Token rotation runbook

The procedure is identical to [`health-weight-sync.md` §5](./health-weight-sync.md#5-token-rotation-runbook) — mint new, swap the Shortcut's `Authorization` header, test it, then revoke the old token by `id`. **Body delta:** the new mint call uses `"scopes":["health:workouts:write"]` (not the weight scope). Everything else — listing tokens, the `DELETE /api/tokens/:id` call, the 60s revocation propagation — is the same.

---

## 6. Failure modes and recovery

| Symptom | Likely cause | Fix |
|---|---|---|
| `RepOS workout sync failed — rate_limit_exceeded` | More than 10 workouts in a single local-day for this user. | The cap resets at local midnight. If the Shortcut is firing in a loop (e.g. a stale automation pointing at the wrong Workout type), open the Automation tab and confirm the trigger is "Apple Watch Workout — When: Ends" and not a Time-of-Day that fires every minute. |
| `RepOS workout sync failed — scope_required:health:workouts:write` | Token was minted with the default scope (`health:weight:write`) or without the workouts scope. | Re-mint per §1.2 with `"scopes":["health:workouts:write"]`. Swap the new token into Step 9's `Authorization` header. Revoke the old (weight-only) token via §5. |
| `RepOS workout sync failed — modality must be one of: walk, run, cycle, row, swim, elliptical, strength, other` | Step 7's mapping let an unmapped value (e.g. raw `Running` from Apple) reach the JSON body. | Check the If chain in Step 7. The default fallthrough should set `API Modality = other`. If the variable is empty, the default Text action was never wired — re-add it. |
| `RepOS workout sync failed — source must be one of: Apple Health, Manual` | Step 9 `source` value is a typo (`apple health`, `AppleHealth`, `Apple-Health`) **or** you're sending `Withings` / `Renpho`. The workouts endpoint accepts ONLY `Apple Health` and `Manual` — narrower than the weight endpoint. | Fix to the exact string `Apple Health`. |
| `RepOS workout sync failed — started_at` / `ended_at` validation error | The Format Date string is wrong (offset segment missing, or `xxx` lowercase emitting `-0400` instead of `XXX` emitting `-04:00`). | Reset Step 6 to `yyyy-MM-dd'T'HH:mm:ssXXX`. The literal `T` must be quoted with single quotes; uppercase `XXX` is required for the colon-separated offset that Zod's `datetime({ offset: true })` accepts. |
| `RepOS workout sync failed — ended_at must be after started_at` | A workout's End Date is at or before its Start Date — usually an aborted Apple Watch workout that was never properly ended. | Delete the bad workout in Health → Browse → Workouts → swipe the row left → Delete. Re-run the Shortcut manually. |
| `RepOS workout sync failed — duration_sec` validation error | `Workout Duration` came through as a Measurement object with units, not a bare number. | Insert a **Get Numbers from Input** action immediately after Step 4 to coerce. |
| Notification with empty/HTML body, or shortcut hangs | Network down, Cloudflare Tunnel offline, server 5xx, **OR** CF Access HTML challenge intercepting the request. | Check `https://repos.jpmtech.com/health` from a browser. If you get a Cloudflare login page instead of a JSON health check, the Bypass policy on `/api/health/*` is misconfigured — the Shortcut will never authenticate because the bearer auth path is gated behind an interactive browser challenge it cannot complete. Fix the Access policy before debugging anything else. |
| `deduped: true` on a payload-different second POST | Two POSTs hit the same `(user_id, started_at, source)` key with different `ended_at` / `modality` / `distance_m` / `duration_sec`. The route always upserts on conflict and the second POST's payload **wins**. | Intentional behaviour for clipboard-paste retries: freshest payload is what RepOS keeps. If a stray re-run is corrupting a good row (e.g. Apple Watch logged a 5-second workout that overwrote the real one), edit the row directly in psql. There is no in-app undo in v1. |
| `401` on every request, no notification (silent fail) | Token revoked or never set. **The error-key check in Step 10 matches on `error` in the body, but a 401 from the auth middleware has no body.** | Re-mint the token (§1.2) and update Step 9. Add the §6.1 hardening below for louder detection. |
| Shortcut never fires after a workout ends | "Run Without Confirmation" not toggled, OR Focus Mode is blocking automations, OR Low Power Mode disabled background automation. | Settings → Shortcuts → check Personal Automation list. Toggle Run Without Confirmation on. Run the Shortcut manually once via Step 1 of §4.1 to confirm permissions. |
| Health permission revoked | iOS Settings → Privacy → Health → Shortcuts → Workouts turned off. | Re-enable. The Shortcut will silently no-op until then (Find Workouts returns 0 rows; downstream steps run on empty input and may surface a 400 from the API). |

### 6.1 Loud-failure hardening (optional but recommended)

The default error-key check in Step 10 misses 401s and CF Access HTML challenges because neither response includes an `error` JSON field. Mirror [`health-weight-sync.md` §6.1](./health-weight-sync.md#61-loud-failure-hardening-optional) by adding a parallel `id`-key check after Step 10:

- **Get Dictionary Value** → Get: Value, Key: `id`, Dictionary: `Contents of URL`
- **If** → Input: Dictionary Value, Condition: `is empty`
- Inside the If branch → **Show Notification** → Title: `RepOS workout sync failed — auth or empty response`

A successful POST always returns `{ "workout": { "id": <bigint>, ... }, "deduped": <bool> }`, so the `id` lives at `workout.id`. The flat `Get Dictionary Value` action above checks only the top level, which means you'll get a false-positive notification on success. Two correct options:

- Drill into `workout` first: add **Get Dictionary Value** → Key: `workout`, then a second **Get Dictionary Value** on that result → Key: `id`. The final `is empty` check is what guards.
- Or, simpler: check the top-level `deduped` key instead — it's a boolean on every successful response and absent on any error. Condition `is empty` will fire on auth failures and HTML challenges, and never on success.

---

## 7. Smoke test

End-to-end curl smoke test (replace `$TOK` with the plaintext from §1.2):

```bash
TOK="9f8e7d6c5b4a3210.<64 hex chars>"

curl -sS -i -X POST https://repos.jpmtech.com/api/health/workouts \
  -H "Authorization: Bearer $TOK" \
  -H "Content-Type: application/json" \
  -d '{
    "started_at": "2026-05-14T10:00:00-04:00",
    "ended_at":   "2026-05-14T10:32:15-04:00",
    "modality":   "run",
    "distance_m": 5240,
    "duration_sec": 1935,
    "source": "Apple Health"
  }'
```

**Expected (first call):** `HTTP/1.1 201` with body:

```json
{
  "workout": {
    "id": 1,
    "started_at": "2026-05-14T14:00:00.000Z",
    "ended_at":   "2026-05-14T14:32:15.000Z",
    "modality":   "run",
    "distance_m": 5240,
    "duration_sec": 1935,
    "source": "Apple Health"
  },
  "deduped": false
}
```

**Expected (re-run same payload):** `HTTP/1.1 200` with the same `workout` object and `"deduped": true`.

**Expected (11th call same local day):** `HTTP/1.1 409 {"error":"rate_limit_exceeded"}`.

**Expected (token without the workouts scope):** `HTTP/1.1 403 {"error":"scope_required:health:workouts:write"}`.

---

## 8. References

- Route source: `api/src/routes/workouts.ts` (validation, dedupe, rate limit)
- Request/response schemas: `api/src/schemas/healthWorkouts.ts` (modality + source allowlists)
- Auth: `api/src/middleware/auth.ts` (Bearer prefix-indexed lookup), `api/src/middleware/cfAccess.ts` (CF Access JWT verifier)
- Scope guard: `api/src/middleware/scope.ts`
- Scope enum: `api/src/auth/scopes.ts`
- Token mint/revoke: `api/src/routes/tokens.ts`
- Migrations: `api/src/db/migrations/030_health_workouts.sql`, `api/src/db/migrations/031_workout_write_log.sql`
- Companion runbook: [`health-weight-sync.md`](./health-weight-sync.md) (token mint procedure §1.1, rotation §5)
- Apple — [Date and time formats in Shortcuts](https://support.apple.com/guide/shortcuts/date-and-time-formats-apdfbad418ca/ios)
- Apple — [Custom date formats in Shortcuts](https://support.apple.com/guide/shortcuts/custom-date-formats-apd8d9b19184/ios)
- Apple — [Event triggers in Shortcuts](https://support.apple.com/guide/shortcuts/event-triggers-apd932ff833f/ios) (authoritative — confirms the Apple Watch Workout trigger and its End event)
- Apple — [Use If actions in Shortcuts](https://support.apple.com/guide/shortcuts/use-if-actions-apd83dcd1b51/ios)
