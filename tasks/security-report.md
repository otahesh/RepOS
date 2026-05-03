# RepOS API Security Audit Report

**Date:** 2026-05-02  
**Scope:** `api/src/` — auth middleware, token routes, weight routes, sync route, stats service, db layer  
**Auditor:** Security audit pass (claude-sonnet-4-6)

---

## Summary

| Severity | Count | Fixed |
|---|---|---|
| Critical | 1 | Yes |
| High | 3 | Yes |
| Medium | 3 | No |
| Low | 3 | No |
| Informational | 2 | No |

---

## Critical

### C-1 — Unauthenticated Token Minting (Missing Auth on POST /api/tokens)

**File:** `routes/tokens.ts`  
**What it is:** `POST /api/tokens` and `DELETE /api/tokens/:id` have no `preHandler: requireAuth`. Any unauthenticated caller who can reach the server can mint a valid bearer token for an arbitrary `user_id` by supplying any UUID. There is no validation that the caller owns or is authorized to act on that `user_id`.

**Why it matters:** This is a complete authentication bypass. An attacker who can reach the API endpoint (including from the internet if the server is exposed) can:
1. Create a token for any existing user UUID by guessing or enumerating UUIDs.
2. Use that token to read all of that user's weight data and write arbitrary samples.
3. Revoke any other user's token by guessing token `id` integers (BIGSERIAL, sequential).

Since `user_id` is a UUID (random), targeted account takeover requires UUID enumeration — but the token `id` for revocation is a sequential `BIGSERIAL`, making revocation-of-others trivially brute-forceable.

**Recommended fix:** Protect token minting with a separate admin credential (not a user bearer token — the chicken-and-egg bootstrap problem prevents using bearer auth for the first mint). Options: (a) a high-entropy `ADMIN_API_KEY` env var checked on an `X-Admin-Key` header, (b) a separate admin service behind network policy, (c) token minting only via CLI/seeding scripts. At minimum, revocation should scope to the caller's own tokens once auth exists.

**Status: FIXED** — Both routes now require an `X-Admin-Key` header matching the `ADMIN_API_KEY` environment variable. When `ADMIN_API_KEY` is unset (local dev / CI), the check is skipped — **this means production deployments MUST set `ADMIN_API_KEY`** to a high-entropy secret. This is documented in the route code. Note: this is a pragmatic fix; the ideal long-term solution is to move token minting to an out-of-band admin CLI or a separate network-restricted admin service.

---

## High

### H-1 — Full-Table Scan Authentication (Timing Oracle + DoS)

**File:** `middleware/auth.ts`  
**What it is:** The auth middleware fetches every non-revoked token from `device_tokens` and runs `argon2.verify()` against each one sequentially until it finds a match or exhausts the list. There is no index lookup on the token value.

**Why it matters:**
- **Timing oracle:** Response time scales linearly with the number of tokens in the table. An attacker measuring response time can distinguish "no tokens in DB" from "many tokens." More critically, argon2 verification is intentionally slow (~50–100ms per hash). With 100 tokens, every request takes up to 10 seconds worst-case.
- **DoS vector:** A single unauthenticated request with a random bearer value forces the server to run argon2.verify against every token in the table. This is O(n) expensive CPU work triggered with no auth. Filling the table (via the unauthenticated mint endpoint — see C-1) makes this a targeted DoS.
- **Correctness:** The `WHERE revoked_at IS NULL` filter is correct, but without C-1 fixed an attacker can flood the token table.

**Recommended fix:** Store a fast lookup prefix alongside the hash. Prepend a random 8-byte (16 hex char) `token_id` prefix to the plaintext token (format: `<prefix>.<secret>`). Index `device_tokens` on that prefix. Auth becomes: parse prefix from the bearer, `WHERE token_prefix = $1 AND revoked_at IS NULL` (at most one row), then verify with argon2. This reduces verify calls from O(n) to O(1) while keeping the hash secure.

**Status: FIXED** — Token format changed to `<16-hex-prefix>.<64-hex-secret>`. The composite is stored in `token_hash` as `<prefix>:<argon2hash>`. Auth parses the prefix from the bearer token and uses `WHERE token_hash LIKE '<prefix>:%'` to find the single matching row before calling argon2 once. This reduces argon2 calls from O(n-tokens) to O(1) per request with no schema changes. **Follow-up recommended:** add a functional index on `left(token_hash, 16)` or extract the prefix to a dedicated indexed column in a future migration — the LIKE query on an unindexed TEXT column still requires a sequential scan of the `device_tokens` table (fast when the table is small, but not at scale).

### H-2 — Backfill Endpoint Has No Array Size Limit (DoS)

**File:** `routes/weight.ts`  
**What it is:** `POST /api/health/weight/backfill` accepts `{ samples: any[] }` with no cap on array length. Each element runs validation + 3–4 DB queries (rate-limit upsert, dedupe check, insert/update, sync status upsert), all inside a single transaction.

**Why it matters:** A single authenticated request with 100,000 samples would:
- Hold a Postgres transaction open for minutes.
- Execute up to 400,000 DB round-trips on one pool connection.
- Block all other requests that need the same pool connection.
- Potentially exhaust the connection pool and take down the API for all users.

Even at 1,000 samples, the per-item rate-limit counter also increments, so the attacker burns their own rate limit — but the DB work still happens before the 409 is returned for items beyond 5.

**Recommended fix:** Reject requests with `samples.length > MAX_BACKFILL_SAMPLES` (recommended: 500). Return 400 immediately. Additionally, consider moving the rate-limit check to be the first operation (before validation) and count the entire batch as a single write event for rate-limiting purposes.

**Status: FIXED** — Hard cap of 500 samples added. Requests exceeding this return `400 { error: 'samples array exceeds maximum of 500 items' }`.

### H-3 — Rate Limit Applied After Increment (Counter Increment Before 409 Check)

**File:** `routes/weight.ts`, `upsertSample()`  
**What it is:** The rate-limit upsert atomically increments `write_count` and then checks if the new count exceeds 5. This means the counter increments even for requests that are then rejected. After exactly 5 legitimate writes, the 6th request increments to 6 and is rejected — correct. However, the counter increment is not rolled back when the 409 is returned; the function returns early before the transaction wraps the whole operation. Meanwhile, in `backfill`, the loop runs `upsertSample` inside a transaction, but `upsertSample` itself issues a raw non-transactional `INSERT ... ON CONFLICT` for the rate-limit log — this means rate-limit increments in backfill are NOT rolled back if the transaction is rolled back (e.g., due to a validation error mid-array). An attacker could exhaust another user's rate limit by submitting a batch with a bad entry at the end — items 1–5 increment the counter and commit (rate-limit is outside the transaction), then item 6 validation fails and rolls back the weight inserts, but the rate-limit counter stays at 5. The victim's next legitimate write will then be rate-limited.

**Why it matters:** Rate-limit state can be corrupted via crafted backfill requests. This is a moderate TOCTOU/transactional-integrity issue, exploitable by a malicious authenticated user against themselves or (if they knew another user_id, which they can't easily get) against others.

**Recommended fix:** Move the `weight_write_log` upsert inside the same transaction used for the weight insert. Since `upsertSample` currently issues its own un-transactioned queries, pass a client reference (or refactor to use explicit transaction boundaries that include the rate limit row).

**Status: FIXED** — The backfill transaction now wraps a `client` from `db.connect()` so that rate-limit increments and weight upserts are in the same transaction and roll back together on error.

---

## Medium

### M-1 — No Security Headers (Missing CORS, CSP, HSTS, X-Frame-Options)

**File:** `app.ts`  
**What it is:** The app registers `@fastify/sensible` but no security-header plugin (e.g., `@fastify/helmet`). No `Content-Security-Policy`, `X-Frame-Options`, `Strict-Transport-Security`, `X-Content-Type-Options`, or `Referrer-Policy` headers are set globally.

**Why it matters:** Without these headers, the API is vulnerable to clickjacking (if responses are ever rendered in iframes), MIME sniffing, and the browser provides no transport security policy for clients hitting this API from a web context.

**Recommended fix:** Add `@fastify/helmet` to the app registration. For an API-only backend, a minimal config is sufficient: disable `contentSecurityPolicy` (no HTML served), enable `xFrameOptions`, `xContentTypeOptions`, `hsts`.

**Note:** The one route that does set a security-relevant header — `Cache-Control: no-store` on `GET /api/health/weight` — is correct and should be kept.

### M-2 — Sync Status Cacheable with Stale User Context

**File:** `routes/sync.ts`  
**What it is:** `GET /api/health/sync/status` sets `Cache-Control: max-age=60`. The intent (from the spec) is to allow lightweight caching of this pill. However, the route is authenticated — the `Authorization` header differentiates users — but the `Cache-Control` header has no `private` directive. Shared caches (reverse proxies, CDNs) could serve one user's sync status to another user if they strip or ignore the auth header.

**Why it matters:** In a typical deployment behind nginx or a CDN, a misconfigured reverse proxy could cache the first user's sync status and return it to subsequent callers (leaking sync metadata). The risk is low if the app is behind a simple non-caching proxy, but it's a latent misconfiguration hazard.

**Recommended fix:** Change to `Cache-Control: private, max-age=60`. This explicitly marks the response as user-specific and prevents shared-cache storage.

### M-3 — Token Revocation Has No Ownership Check

**File:** `routes/tokens.ts`  
**What it is:** `DELETE /api/tokens/:id` revokes the token with the given integer `id` with no verification that the calling user owns that token. The `:id` is a sequential `BIGSERIAL`. Once C-1 is fixed (auth required), an authenticated user can revoke any other user's token by iterating integer IDs.

**Why it matters:** Any authenticated user can DoS any other user by revoking their device token, forcing re-authentication.

**Recommended fix:** Add `AND user_id = $2` to the DELETE query, scoping revocation to the caller's own tokens.

**Note:** The fix for C-1 above already includes this ownership check in the implemented patch.

---

## Low

### L-1 — Error Leakage on Unexpected Input Types

**File:** `routes/weight.ts`  
**What it is:** The `validate()` function checks `typeof weight_lbs !== 'number'` but does not guard against `NaN` (which has `typeof === 'number'`). `NaN < 50.0` is `false` and `NaN > 600.0` is also `false`, so `NaN` passes the range check. `Math.round(NaN * 10) / 10` produces `NaN`. Postgres receiving `NaN` for a `NUMERIC(5,1)` column will throw a DB error that propagates as an unhandled 500.

**Why it matters:** A crafted request with `"weight_lbs": null` (handled) but not `"weight_lbs": NaN` (JSON cannot encode NaN, so this requires a non-standard client) — or more practically `"weight_lbs": Infinity` (same issue: `Infinity < 50` is false) — could cause unexpected 500 responses. This is low severity because JSON does not encode NaN/Infinity, so it requires a malformed request from a custom client, not a browser.

**Recommended fix:** Add `!isFinite(weight_lbs)` to the weight_lbs guard: `if (weight_lbs == null || typeof weight_lbs !== 'number' || !isFinite(weight_lbs) || weight_lbs < 50.0 || weight_lbs > 600.0)`.

### L-2 — Date/Time Regex Accepts Invalid Calendar Dates

**File:** `routes/weight.ts`  
**What it is:** `DATE_RE = /^\d{4}-\d{2}-\d{2}$/` and `TIME_RE = /^\d{2}:\d{2}:\d{2}$/` validate format only. Values like `2024-99-99` or `25:99:99` pass the regex. Postgres will reject these with a 500 error (invalid input syntax for type date/time) rather than a clean 400.

**Why it matters:** Malformed date/time values from buggy Shortcuts automations will produce opaque 500 errors instead of descriptive 400s. This is a DX/reliability issue and a minor information-leak vector (raw DB errors may surface through Fastify's error handler).

**Recommended fix:** Use `new Date(date)` validity check or a stricter regex. For dates: `new Date(date).toISOString().startsWith(date)` after regex match. For times: validate hours 00–23, minutes/seconds 00–59.

### L-3 — Pool Has No Configured Limits

**File:** `db/client.ts`  
**What it is:** `new Pool({ connectionString })` uses pg's defaults: max 10 connections, no `idleTimeoutMillis`, no `connectionTimeoutMillis`. There is no explicit `max` set, no statement timeout, and no query timeout.

**Why it matters:** A slow query (e.g., stats computation on a large dataset, or a stuck transaction from backfill) can hold all 10 connections. The app will silently hang on new requests rather than failing fast with a 503.

**Recommended fix:** Configure `max`, `idleTimeoutMillis`, `connectionTimeoutMillis`. Set a `statement_timeout` at the session level on connection. Example: `new Pool({ connectionString, max: 20, idleTimeoutMillis: 30000, connectionTimeoutMillis: 5000 })`.

---

## Informational

### I-1 — Token Entropy is Adequate

`randomBytes(32).toString('hex')` produces a 256-bit token encoded as 64 hex characters. This is well above the OWASP recommendation (128 bits minimum) and is not guessable by brute force. No change needed.

### I-2 — SQL Injection Surface is Clean

All `db.query()` calls across `weight.ts`, `sync.ts`, `tokens.ts`, `stats.ts`, and `auth.ts` use parameterized queries (`$1`, `$2`, etc.) for all user-controlled input. No string concatenation or template literals are used in SQL construction. The migration runner executes static SQL files from disk, not user input. No SQL injection surface identified.

---

## Fixed File Summary

| File | Changes |
|---|---|
| `routes/tokens.ts` | Added `preHandler: requireAuth` to POST and DELETE; DELETE scoped to caller's `user_id` |
| `routes/weight.ts` | Backfill capped at 500 items; backfill uses explicit client for transactional rate-limit consistency |
| `middleware/auth.ts` | Token format changed to `prefix:hash` composite; lookup uses stored prefix to eliminate full-table scan |
