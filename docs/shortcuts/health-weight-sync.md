# RepOS Daily Weight Sync — iOS Shortcut

This document is the build-from-scratch recipe for the iOS Shortcut that pushes the user's most-recent Apple Health bodyweight sample to `https://repos.jpmtech.com`. It pairs with a Personal Automation that fires the Shortcut on a schedule.

The Shortcut runs **silently** — no UI prompts, no notifications on success. A failure shows a single notification so the user can investigate.

> **Verified against iOS 26.4.2.** Action names and field labels described below match the current iOS Shortcuts app. Earlier iOS versions may show different labels for some fields (notably the `If` condition picker, which used to read "has any value" and now reads "is not empty"). Items that couldn't be confirmed against an iOS 26 source are marked **iOS 26 spot-check** inline — verify on your phone and let the doc owner know if anything reads differently.

> **Why hand-build instead of importing a `.shortcut` file?** Apple signs `.shortcut` bundles with iCloud keys tied to the device that authored them. There is no supported way to generate that binary off-device. Hand-building takes ~10 minutes and gives you a clean signature on your own iCloud account.

---

## 1. Prerequisites

| Requirement | Why |
|---|---|
| iPhone running iOS 26 or later | This doc verified against iOS 26.4.2 specifically |
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

> Notation: `Field: Value` means the named parameter inside the action card. `Why:` explains the choice. "Magic variable" means the output of a previous step that you reference by tapping it into a field.

### Step 1: Find Health Samples

Add **"Find Health Samples"** (in the Health category — iOS 26 spot-check: the action card may also read "Find All Health Samples Where" depending on whether you tap the action title or the embedded summary).

- `Type: Body Mass`
- `Sort by: End Date`
- `Order: Latest First`
- `Limit: 1 sample`
- `Filter: (none — leave empty)`
- **Why:** We want exactly one sample, the most recent.

### Step 2: Get Details of Health Samples

Add **"Get Details of Health Samples"**.

- `Input: Health Samples` (the magic-variable output of Step 1)
- `Get: Quantity`
- **Why:** Returns the numeric weight value. Apple stores Body Mass in kilograms internally regardless of the user's display preference, so we'll convert in Step 3.

Add a **second** copy of **"Get Details of Health Samples"**:

- `Input: Health Samples` (same magic variable from Step 1)
- `Get: End Date`
- **Why:** The wall-clock timestamp of when the scale recorded the reading. Used for the `date` and `time` fields. Spec stores `time` as a display label only — no UTC conversion.

### Step 3: Convert kg → lb

Add **"Calculate"**.

- `Operand: Quantity` (the magic variable from the first Step 2)
- `Operation: ×`
- `Operand: 2.20462`
- **Why:** Apple Health's `Quantity` value is a bare number in kilograms. Multiplying by the kg→lb factor produces a plain number ready for the JSON payload. (`Convert Measurement` also exists and works on `Measurement` objects, but on a bare numeric `Quantity` it's flaky and requires a `Get Numbers from Input` action afterwards. Calculate is one action shorter and reliable.)

### Step 4: Round Number

Add **"Round Number"**.

- `Number: Result` (output of Step 3)
- `Round: 1 Decimal Place` *(iOS 26 spot-check: pre-iOS 26 this read "To 1 Place")*
- `Mode: Normal` (round half-up)
- **Why:** API rounds to 1 decimal on store. Pre-rounding here keeps the request body tidy and avoids `185.39999999...` artifacts from the kg→lb multiplication.

Long-press the magic-variable output and rename it to **"Rounded Weight"**.

### Step 5: Format Date — `yyyy-MM-dd`

Add **"Format Date"**.

- `Date: End Date` (output of the second Step 2)
- `Date Format: Custom`
- `Format String: yyyy-MM-dd`
- `Time Format: None`
- **Why:** API regex is `^\d{4}-\d{2}-\d{2}$`. iOS 26's Format Date picker has only `Short`, `Medium`, `Long`, `None`, and `Custom` for Date Format — no built-in ISO 8601 / `yyyy-MM-dd` preset, so `Custom` is required. Format string syntax is Unicode TR35: lowercase `yyyy` = 4-digit year, uppercase `MM` = 2-digit month, lowercase `dd` = 2-digit day.

Long-press the magic variable and rename it to **"Sample Date"**.

### Step 6: Format Date — `HH:mm:ss`

Add a second **"Format Date"**.

- `Date: End Date` (output of the second Step 2)
- `Date Format: None`
- `Time Format: Custom`
- `Format String: HH:mm:ss`
- **Why:** API regex is `^\d{2}:\d{2}:\d{2}$`, 24-hour. **The `Custom` option for time output lives on the `Time Format` side, not `Date Format`** — flipping these is the most common build-error. Set `Date Format: None` so no date prefix sneaks in. Uppercase `HH` = 24h hours; lowercase `hh` = 12h (the doc's most common bug source — verify yours).

Long-press the magic variable and rename it to **"Sample Time"**.

### Step 7: Get Contents of URL

Add **"Get Contents of URL"**.

- `URL: https://repos.jpmtech.com/api/health/weight`
- Tap **Show More** to reveal Method, Headers, and Request Body.
- `Method: POST`
- `Headers:` tap **Add new header** *(iOS 26 spot-check: button label may read "Add new")* twice:
  - Key `Authorization` → Text `Bearer a1b2c3d4e5f60718.<64 hex chars>` (paste your full token from §1.1)
  - Key `Content-Type` → Text `application/json`
- `Request Body: JSON`
- Inside the JSON section, tap **Add new field** four times. For each, choose the value type from the popup, then fill the Key and Value:

  | Type | Key | Value |
  |---|---|---|
  | Number | `weight_lbs` | Rounded Weight (Step 4) |
  | Text   | `date`       | Sample Date (Step 5) |
  | Text   | `time`       | Sample Time (Step 6) |
  | Text   | `source`     | `Apple Health` |

- **Why:** In iOS 26, `Get Contents of URL` builds the JSON body inline — there is no separate `Dictionary` action involved. The `source` value MUST be the exact string `Apple Health` — case-sensitive, with the space, no dash. Other accepted values (`Manual`, `Withings`, `Renpho`) are not what we are.

> **Fallback if `Get Contents of URL`'s inline JSON crashes Shortcuts.** Some users have reported Shortcuts crashing on save when an inline JSON body has multiple fields (intermittent, may be device-specific). If you hit this: add a **Text** action above Step 7, paste the JSON template `{"weight_lbs": "<value>", "date": "<value>", "time": "<value>", "source": "Apple Health"}` replacing each `<value>` with the matching magic variable, then in Step 7 set `Request Body: File` with the Text action's output as the file. The server accepts both forms; the inline-JSON path is preferred when it works.

### Step 8: If — handle non-2xx

`Get Contents of URL` returns its parsed JSON response as the `Contents of URL` magic variable already — no separate `Get Dictionary from Input` step is needed.

Add **"Get Dictionary Value"**.

- `Get: Value`
- `Key: error`
- `Dictionary: Contents of URL` (output of Step 7)

Add **"If"**.

- `Input: Dictionary Value`
- `Condition: is not empty` *(iOS 26 spot-check: pre-iOS 18 this read "has any value")*

Inside the **If** branch (error path), add **"Show Notification"**:

- `Title: RepOS sync failed`
- `Body:` magic variable for `Dictionary Value` (the error string)
- `Sound: Off` *(iOS 26 spot-check: pre-iOS 26 this read "Play Sound")*
- **Why:** Single user-visible feedback. Common values: `rate_limited` (Shortcut firing too often), validation field names, or a generic body if the server returned 5xx with HTML.

Inside the **Otherwise** branch (success path), leave it empty — we run silently on success. Do NOT add a "Show Notification" or "Speak Text" here; the spec is silent-on-success.

End the If block.

### Step 9: Save the Shortcut

Tap **Done** in the top right.

---

## 3. Personal Automation trigger — daily 7:30 AM

Apple does **not** expose a per-quantity-type Health-event trigger in current iOS Personal Automations. The only event triggers available are Time of Day, Alarm, Sleep, Apple Watch Workout, and Sound Recognition. The Time of Day trigger is what the spec assumes (07:30 daily, Run Immediately) and is the right choice.

1. Shortcuts app → **Automation** tab → **+**
2. Tap **Create Personal Automation** *(iOS 26 spot-check: in iOS 26 this may simply be "New Automation" — pick the personal/per-device flow)*
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

`https://repos.jpmtech.com` → topbar pill should show **FRESH 07:32 · APPLE HEALTH** (or whatever wall-clock time is in your sample) within 60s of a successful run.

---

## 5. Token rotation runbook

Tokens don't expire automatically. Rotate when:

- You suspect compromise (token visible in a screenshot, lost device, etc.)
- Someone with access to the device leaves the household
- It's been > 12 months and you want fresh entropy

Steps:

1. **Mint the new token** (§1.1).
2. **Edit the Shortcut** — open Shortcuts → RepOS Daily Weight Sync → tap **Step 7** (`Get Contents of URL`) → tap the `Authorization` header → replace the value with `Bearer <new-token>`. Tap Done.
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

   Returns 204. Per spec, revocation invalidates within 60s — there's no auth cache, so it's effectively instant.

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
| `RepOS sync failed — weight_lbs must be between 50.0 and 600.0` | The kg→lb multiplication produced a value outside `[50.0, 600.0]`, OR a stray Body Mass sample (e.g. tracking a child's weight, dumbbell weight) snuck in. | Open Health → Body Measurements → Weight → check the most recent entry. Delete the bad sample. Re-run the Shortcut manually. |
| `RepOS sync failed — date must be a valid YYYY-MM-DD calendar date` | Step 5 misconfigured. | `Date Format: Custom`, `Format String: yyyy-MM-dd`, `Time Format: None`. Check: lowercase `yyyy` and `dd`, uppercase `MM`. |
| `RepOS sync failed — time must be HH:MM:SS` | Step 6 misconfigured — most often `Date Format: Custom` instead of `Time Format: Custom`. | `Date Format: None`, `Time Format: Custom`, `Format String: HH:mm:ss`. Uppercase `HH` (24h); lowercase `hh` is 12h. |
| `RepOS sync failed — source must be one of: Apple Health, Manual, Withings, Renpho` | Step 7 dictionary `source` value typo (e.g. `apple health`, `Apple-Health`, `AppleHealth`). | Fix to the exact string `Apple Health`. |
| Notification with empty/HTML body, or shortcut hangs | Network down, Cloudflare Tunnel offline, server 5xx. | Check `https://repos.jpmtech.com/health` from a browser. If 502/timeout, check the tunnel and container on the Unraid host. The Shortcut intentionally does NOT auto-retry — running again tomorrow will catch up via Personal Automation, or run manually after the outage clears. |
| Notification: shortcut runs but `sync.state` shows `broken` on the dashboard | More than 72h since last successful sync. | Run the Shortcut manually. If it succeeds the pill will turn green within 60s. If it still fails see the rows above. |
| `401` on every request, no notification (silent fail) | Token revoked or never set. **This is silent because Step 8's error-key check matches on `error` in the body but a 401 from the API has no body.** | Re-mint the token (§1.1) and update Step 7. Consider adding a parallel check that triggers on a missing `id` key (success marker) — left as an optional hardening below. |
| Shortcut never fires automatically | "Run Without Asking" not toggled, OR Focus Mode blocking automations, OR Low Power Mode. | Settings → Shortcuts → check Personal Automation list. Toggle Run Without Asking on. Run manually once to confirm permissions. |
| Health permission revoked | iOS Settings → Privacy → Health → Shortcuts → Body Mass turned off. | Re-enable. The Shortcut will silently no-op until then (Find Health Samples returns 0 rows; subsequent steps run on an empty input and may produce a 400 from the API). |
| Inline JSON body in Step 7 crashes Shortcuts on save | Known intermittent bug with multi-field inline JSON. | Use the Text-action + `Request Body: File` fallback documented inline in Step 7. |

### 6.1 Loud-failure hardening (optional)

If you want louder failure detection beyond the `error`-key check, add this after Step 8:

- **Get Dictionary Value** → Get: Value, Key: `id`, Dictionary: `Contents of URL`
- **If** → Input: Dictionary Value, Condition: `is empty`
- Inside the If branch → **Show Notification** → Title: `RepOS sync failed — auth or empty response`

This catches 401s and other empty-body responses that the `error`-key check would miss.

---

## 7. References

- Route source: `api/src/routes/weight.ts` (validation, dedupe, rate limit)
- Auth: `api/src/middleware/auth.ts` (Bearer prefix-indexed lookup), `api/src/middleware/cfAccess.ts` (CF Access JWT verifier)
- Token mint/revoke: `api/src/routes/tokens.ts`
- Spec: `Engineering Handoff.md` §2 (request shape), §6 (auth), §9 (Shortcut spec)
- Operational handoff: `PASSDOWN.md` (deployment topology, env file location)
- Apple — [Date and time formats in Shortcuts](https://support.apple.com/guide/shortcuts/date-and-time-formats-apdfbad418ca/ios)
- Apple — [Custom date formats in Shortcuts](https://support.apple.com/guide/shortcuts/custom-date-formats-apd8d9b19184/ios)
- Apple — [Event triggers in Shortcuts](https://support.apple.com/guide/shortcuts/event-triggers-apd932ff833f/ios) (authoritative — confirms no Health trigger exists)
- Apple — [Use If actions in Shortcuts](https://support.apple.com/guide/shortcuts/use-if-actions-apd83dcd1b51/ios)
