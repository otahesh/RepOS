# RepOS Daily Weight Sync — iOS Shortcut

This document is the build-from-scratch recipe for the iOS Shortcut that pushes the user's most-recent Apple Health bodyweight sample to `https://repos.jpmtech.com`. It pairs with a Personal Automation that fires the Shortcut whenever a new bodyweight sample is written to Health (typically by a smart scale).

The Shortcut runs **silently** — no UI prompts, no notifications on success. A failure shows a single notification so the user can investigate.

> **Why hand-build instead of importing a `.shortcut` file?** Apple signs `.shortcut` bundles with iCloud keys tied to the device that authored them. There is no supported way to generate that binary off-device. Hand-building takes ~10 minutes and gives you a clean signature on your own iCloud account.

---

## 1. Prerequisites

| Requirement | Why |
|---|---|
| iPhone running iOS 17.0 or later | `Find Health Samples` action and "Run Without Asking" on Personal Automations |
| Shortcuts app installed (default on iOS) | — |
| Health app installed and at least one bodyweight sample logged | Source the sample from |
| RepOS user record exists in the production DB | Token is minted against a `user_id` |
| You can SSH to the Unraid host **or** are on the Cloudflare Access allowlist for `https://repos.jpmtech.com/api/tokens` | Required to mint the bearer token |
| `ADMIN_API_KEY` value from `/mnt/user/appdata/repos/.env` | Authenticates the mint call inside the tunnel |

### 1.1 Mint the bearer token

The token endpoint is gated by both **Cloudflare Access** (email allowlist) and the `X-Admin-Key` header. Two paths:

#### Option A — From your dev Mac through the public hostname

You'll get a Cloudflare browser challenge first. After authenticating once, your browser cookie is also valid for `curl` if you pass it via `--cookie`. Easier to use the SSH path below.

#### Option B — From the Unraid host (recommended)

```bash
ssh unraid
ADMIN_KEY=$(grep ^ADMIN_API_KEY= /mnt/user/appdata/repos/.env | cut -d= -f2-)
USER_ID=<your-user-uuid-from-the-users-table>

curl -sS -X POST http://127.0.0.1/api/tokens \
  -H "X-Admin-Key: $ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"user_id\":\"$USER_ID\",\"label\":\"iPhone — Health Sync\"}"
```

Response:

```json
{
  "id": 7,
  "token": "a1b2c3d4e5f60718.<64 hex chars>",
  "created_at": "2026-05-03T..."
}
```

**Copy the `token` value into a password manager NOW.** The plaintext is shown once. The DB only stores an argon2 hash of the secret half. If you lose it, you re-mint and revoke.

The token format is `<16-hex-prefix>.<64-hex-secret>`. Sent as `Authorization: Bearer <token>`. Scope is implicit `health:weight:write` (the only scope a device token has in v1).

### 1.2 Health permissions

The Shortcut will prompt for **Read access to Body Mass** the first time it runs. Grant it. If you ever revoke it, the Shortcut will fail silently — the `Find Health Samples` step returns zero results and the POST never fires.

---

## 2. Build the Shortcut

Open Shortcuts → tap **+** → name the new shortcut **"RepOS Daily Weight Sync"**. Add the actions in order. Tap each step's grey field to expand it; the values below go into those fields.

> Notation: `Field: Value` means the named parameter inside the action card. `Why:` explains the choice.

### Step 1: Find Health Samples

This is the action labeled **"Find Health Samples Where..."** in the Health category.

- `Type: Body Mass`
- `Sort by: End Date`
- `Order: Latest First`
- `Limit: 1 sample`
- `Filter: (none — leave empty)`
- **Why:** We want exactly one sample, the most recent. The Personal Automation fires when a new sample is logged, but we still query "latest" to be tolerant of multiple writes within the same automation tick.

### Step 2: Get Details of Health Samples

Add **"Get Details of Health Samples"**.

- `Input: Health Samples` (the magic-variable output of Step 1)
- `Get: Quantity`
- **Why:** Returns the numeric weight value with its native unit. Apple's storage unit for Body Mass is kilograms regardless of the user's display preference, so we'll convert in Step 3.

Add a **second** copy of **"Get Details of Health Samples"**:

- `Input: Health Samples` (same magic variable from Step 1)
- `Get: End Date`
- **Why:** The wall-clock timestamp of when the scale recorded the reading. Used for the `date` and `time` fields. Spec stores `time` as a display label only — no UTC conversion.

### Step 3: Convert to Pounds

Add **"Convert Measurement"**.

- `Measurement: Quantity` (the magic variable from the first Step 2)
- `Unit Type: Mass`
- `Unit: Pounds`
- **Why:** Health stores Body Mass in kg internally even when the UI shows lb. The API contract is `weight_lbs` strictly between 50.0 and 600.0, so we convert before rounding.

### Step 4: Get Numeric Value

Add **"Get Numbers from Input"**.

- `Input: Measurement` (output of Step 3)
- **Why:** `Convert Measurement` returns a measurement object like `185.4 lb`. We need just the number for the JSON payload.

### Step 5: Round Number

Add **"Round Number"**.

- `Number: Numbers` (output of Step 4)
- `Round: To 1 Place`
- `Mode: Normal` (round half-up)
- **Why:** API rounds to 1 decimal on store. Pre-rounding here keeps the request body tidy and avoids `185.39999999...` artifacts from the kg→lb conversion.

### Step 6: Format Date — `yyyy-MM-dd`

Add **"Format Date"**.

- `Date: End Date` (output of the second Step 2)
- `Date Format: Custom`
- `Format String: yyyy-MM-dd`
- `Time Format: None`
- **Why:** API regex is `^\d{4}-\d{2}-\d{2}$` and the value must be a calendar-valid date. ISO date format with no time component matches.

Tap the action's title bar and rename the magic-variable output to **"Sample Date"** so it's distinguishable from Step 7. (Long-press the variable → Rename Variable.)

### Step 7: Format Date — `HH:mm:ss`

Add a second **"Format Date"**.

- `Date: End Date` (output of the second Step 2)
- `Date Format: Custom`
- `Format String: HH:mm:ss`
- `Date Format (date part): None`
- **Why:** API regex is `^\d{2}:\d{2}:\d{2}$`, 24-hour. Spec explicitly says "treat as opaque label, don't compute UTC from it." Wall-clock from the Health sample is exactly what we want.

Rename the output magic variable to **"Sample Time"**.

### Step 8: Dictionary

Add **"Dictionary"**. Inside, add 4 key/value rows:

| Key | Type | Value |
|---|---|---|
| `weight_lbs` | Number | output of Step 5 (Rounded Number) |
| `date` | Text | Sample Date (Step 6) |
| `time` | Text | Sample Time (Step 7) |
| `source` | Text | `Apple Health` |

**Why:** This is the request body matching `validate()` in `api/src/routes/weight.ts`. The `source` value MUST be the exact string `Apple Health` — case-sensitive, with the space, no dash. Other accepted values (`Manual`, `Withings`, `Renpho`) are not what we are.

### Step 9: Get Contents of URL

Add **"Get Contents of URL"**.

- `URL: https://repos.jpmtech.com/api/health/weight`
- Tap **Show More** to reveal advanced options.
- `Method: POST`
- `Headers:` (add two)
  - `Authorization` → `Bearer a1b2c3d4e5f60718.<64 hex chars>` (paste the full token from §1.1)
  - `Content-Type` → `application/json`
- `Request Body: JSON`
- `JSON: Dictionary` (the magic variable from Step 8)
- **Why:** Same-origin POST to the Cloudflare-tunneled production host. Bearer auth is the only thing the route accepts (`/api/health/weight` is not behind Access — only `/api/tokens` is).

### Step 10: Get Dictionary from Input

Add **"Get Dictionary from Input"**.

- `Input: Contents of URL` (output of Step 9)
- **Why:** Parses the JSON response so we can inspect `deduped` / `error`. Required for Steps 11–12 to work.

### Step 11: If — handle non-2xx

This is the trickiest part because Shortcuts doesn't expose an HTTP status code from `Get Contents of URL`. We use the response body as a proxy: a successful body has either `"id"` (success) or `"error"` (failure). We detect the failure case.

Add **"Get Dictionary Value"**.

- `Get: Value`
- `Key: error`
- `Dictionary: Dictionary` (output of Step 10)

Add **"If"**.

- `Condition: Dictionary Value has any value`
- `Otherwise: (default)`

Inside the **If** branch (error path), add:

1. **"Show Notification"**
   - `Title: RepOS sync failed`
   - `Body:` magic variable for `Dictionary Value` (the error string)
   - `Play Sound: Off`
   - `Why:` Single user-visible feedback. Common values: `rate_limited` (Shortcut firing too often), validation field names, or a generic body if the server returned 5xx with HTML.

Inside the **Otherwise** branch (success path), leave it empty — we run silently on success. Do NOT add a "Show Notification" or "Speak Text" here; the spec is silent-on-success.

End the If block.

### Step 12: Save the Shortcut

Tap **Done** in the top right.

---

## 3. Personal Automation trigger — "When weight is logged in Health"

Apple Health does not expose a per-quantity-type "new sample" trigger out of the box. There are two viable approaches; pick one.

### 3.1 Recommended — Time-of-Day automation

This is what the spec assumes (`07:30 daily, Run Immediately`). Most users weigh in around the same time; a daily fire is reliable.

1. Shortcuts app → **Automation** tab → **+**
2. Tap **Create Personal Automation**
3. Tap **Time of Day**
   - `Time: 7:30 AM` (or your weigh-in time + 5 minutes of buffer)
   - `Repeat: Daily`
4. **Next**
5. Add action: **Run Shortcut** → pick **RepOS Daily Weight Sync**
6. **Next**
7. Toggle **Run Immediately: ON**
8. Toggle **Notify When Run: OFF**
9. **Done**

**Why this works:** Even if the smart scale logs the weight at 7:02 AM, the 7:30 fire reads the most-recent sample. If you weigh in at 8:00 AM occasionally, the next morning's run still picks up the previous day's weight. The 36h "fresh" threshold in `health_sync_status` absorbs the drift.

### 3.2 Alternative — Health-event automation (iOS 17+)

If you have iOS 17 or later you may see a Health trigger:

1. Automation tab → **+** → **Create Personal Automation**
2. Scroll to **Health** → tap it
3. `When: Body Mass · Is Updated`
4. Run Immediately ON, Notify When Run OFF, action = Run Shortcut → "RepOS Daily Weight Sync"

This fires every time a Body Mass sample is written. Better for users with multiple weigh-ins per day, but the dedupe logic on `(user_id, date, source)` already handles re-fires harmlessly so the time-of-day automation is fine.

> **Run Without Asking note:** iOS will prompt the first time the automation fires. Tap "Run Without Asking" inside the prompt or pre-toggle it on the automation detail screen. Without this, the Shortcut will sit waiting for confirmation and the sync will silently fail to fire.

---

## 4. Test plan

### 4.1 Manual run from the Shortcuts app

1. Make sure you have at least one Body Mass sample in Health for today. If not: Health app → Browse → Body Measurements → Weight → Add Data → enter a value.
2. Open Shortcuts → tap **RepOS Daily Weight Sync** to run it manually.
3. **Expected:** No notification. The shortcut completes in 1–3 seconds.

### 4.2 Verify the row landed

From the Unraid host:

```bash
ssh unraid
docker exec -it RepOS psql -U repos -d repos -c \
  "SELECT sample_date, sample_time, weight_lbs, source, created_at, updated_at
   FROM health_weight_samples
   WHERE user_id = '<your-user-uuid>'
   ORDER BY created_at DESC LIMIT 5;"
```

You should see the new row with `source = 'Apple Health'` and the weight rounded to 1 decimal.

Or hit the read endpoint with the same bearer token:

```bash
curl -sS https://repos.jpmtech.com/api/health/weight?range=7d \
  -H "Authorization: Bearer <token>" | jq
```

`samples` should include today's date; `sync.state` should be `"fresh"`.

### 4.3 Verify silent dedupe on re-run

Run the Shortcut a second time within a few minutes — same weight, same day.

**Expected:** Still no notification (success path). In the DB:

- The same row exists; `created_at` unchanged; `updated_at` unchanged (because the diff is ≤ 0.05 lb).
- `weight_write_log.write_count` for `(your_user, today)` incremented by 1.

Now edit the Health sample to a different value (e.g. +1.0 lb), run the Shortcut again.

**Expected:** Still silent. In the DB, `weight_lbs` reflects the new value and `updated_at` bumped.

### 4.4 Verify rate-limit guard

Run the Shortcut a 6th time on the same day (you can pad up the count by tweaking the Health sample weight 6 times).

**Expected:** Notification: `RepOS sync failed — rate_limited`. The 6th request returned `409 {"error":"rate_limited"}`. Earlier 5 stored.

### 4.5 Verify the sync pill flips

`https://repos.jpmtech.com` → topbar pill should show **SYNCED 07:32 · APPLE HEALTH** (or whatever wall-clock time is in your sample) within 60s of a successful run.

---

## 5. Token rotation runbook

Tokens don't expire automatically. Rotate when:

- You suspect compromise (token visible in a screenshot, lost device, etc.)
- Someone with access to the device leaves the household
- It's been > 12 months and you want fresh entropy

Steps:

1. **Mint the new token** (§1.1).
2. **Edit the Shortcut** — open Shortcuts → RepOS Daily Weight Sync → tap Step 9 (`Get Contents of URL`) → tap the `Authorization` header → replace the value with `Bearer <new-token>`. Tap Done.
3. **Test it** — run the Shortcut manually (§4.1). Confirm a row lands.
4. **Revoke the old token.** First find its `id`:

   ```bash
   ssh unraid
   ADMIN_KEY=$(grep ^ADMIN_API_KEY= /mnt/user/appdata/repos/.env | cut -d= -f2-)
   USER_ID=<your-user-uuid>
   curl -sS "http://127.0.0.1/api/tokens?user_id=$USER_ID" \
     -H "X-Admin-Key: $ADMIN_KEY" | jq
   ```

   Pick the `id` of the OLD token (compare `created_at` and `last_used_at` — the new one will have a recent `last_used_at` from your test run).

5. **Delete the old token:**

   ```bash
   curl -sS -X DELETE "http://127.0.0.1/api/tokens/<old-id>?user_id=$USER_ID" \
     -H "X-Admin-Key: $ADMIN_KEY"
   ```

   Returns 204. The next time auth.ts runs the prefix lookup, the old token will return zero rows (because of `WHERE revoked_at IS NULL`) → 401. Per spec, revocation invalidates within 60s — there's no auth cache, so it's effectively instant.

6. **Confirm the old token is dead:**

   ```bash
   curl -sS -i https://repos.jpmtech.com/api/health/weight?range=7d \
     -H "Authorization: Bearer <old-token>"
   ```

   Should be `HTTP/1.1 401`.

---

## 6. Failure modes and recovery

| Symptom | Likely cause | Fix |
|---|---|---|
| `RepOS sync failed — rate_limited` notification | More than 5 writes for this `(user, date)` already today. Indicates the Shortcut is firing in a loop or the user is editing the Health sample repeatedly. | Wait until tomorrow (the counter is keyed on `log_date`). If the Time-of-Day automation is misconfigured and firing every minute, fix the trigger. |
| `RepOS sync failed — weight_lbs must be between 50.0 and 600.0` | The kg→lb conversion produced a value outside `[50.0, 600.0]`, OR a stray Body Mass sample (e.g. tracking a child's weight, dumbbell weight) snuck in. | Open Health → Body Measurements → Weight → check the most recent entry. Delete the bad sample. Re-run the Shortcut manually. |
| `RepOS sync failed — date must be a valid YYYY-MM-DD calendar date` | The Format Date action is misconfigured (wrong format string, locale override). | Step 6: confirm `Format String: yyyy-MM-dd` exactly. Lowercase `y` and `d`, uppercase `M`. |
| `RepOS sync failed — time must be HH:MM:SS` | Format string in Step 7 is wrong (often `hh:mm:ss` for 12h). | Step 7: `Format String: HH:mm:ss` — uppercase `HH`. |
| `RepOS sync failed — source must be one of: Apple Health, Manual, Withings, Renpho` | Step 8 dictionary `source` value typo (e.g. `apple health`, `Apple-Health`, `AppleHealth`). | Fix to the exact string `Apple Health`. |
| Notification with empty/HTML body, or shortcut hangs | Network down, Cloudflare Tunnel offline, server 5xx. | Check `https://repos.jpmtech.com/health` from a browser. If 502/timeout, check the tunnel and container on the Unraid host. The Shortcut intentionally does NOT auto-retry — running again tomorrow will catch up via Personal Automation, or run manually after the outage clears. (If/when v2 adds backfill-on-recovery this changes.) |
| Notification: shortcut runs but `sync.state` shows `broken` on the dashboard | More than 72h since last successful sync. | Run the Shortcut manually. If it succeeds the pill will turn green within 60s. If it still fails see the rows above. |
| `401` on every request, no notification (silent fail) | Token revoked or never set. **This is silent because Step 11's error-key check matches on `error` in the body but a 401 from the API has no body.** | Re-mint the token (§5) and update Step 9. Consider adding a Step 11b that checks for `"id"` presence (success marker) rather than `"error"` — left as a future hardening. |
| Shortcut never fires automatically | "Run Without Asking" not toggled, OR Focus Mode blocking automations, OR Low Power Mode. | Settings → Shortcuts → check Personal Automation list. Toggle Run Without Asking on. Run manually once to confirm permissions. |
| Health permission revoked | iOS Settings → Privacy → Health → Shortcuts → Body Mass turned off. | Re-enable. The Shortcut will silently no-op until then (Find Health Samples returns 0 rows; subsequent steps run on an empty input and may produce a 400 from the API or just send garbage — neither is good). |

### 6.1 Token revoked while shortcut is in use

Symptoms: dashboard pill goes amber → red over 36h–72h. No error notifications because the Shortcut fires successfully but the API returns 401, which has an empty body, which doesn't match the `error` key check in Step 11.

Recovery: re-mint per §1.1, update Step 9 per §5 step 2.

If you want louder failure detection, add an extra step between Steps 10 and 11:

- **Get Dictionary Value** → Key: `id`
- **If** Dictionary Value has no value → Show Notification "RepOS sync failed — auth or empty response"

---

## 7. References

- Route source: `api/src/routes/weight.ts` (validation, dedupe, rate limit)
- Auth: `api/src/middleware/auth.ts` (Bearer prefix-indexed lookup)
- Token mint/revoke: `api/src/routes/tokens.ts`
- Spec: `Engineering Handoff.md` §2 (request shape), §6 (auth), §9 (Shortcut spec)
- Operational handoff: `PASSDOWN.md` (deployment topology, env file location)
