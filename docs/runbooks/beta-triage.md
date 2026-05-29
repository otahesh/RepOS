# Beta Feedback Triage Runbook (G12)

## Channel
In-app feedback (W7) → `feedback` table → Discord webhook (`FEEDBACK_WEBHOOK_URL`).
This is the documented Beta contact path (contributes to G14).

## Privacy note
The Discord payload's "From" field carries the submitter's **account email** (the
CF-Access identity). The webhook channel therefore contains tester PII — keep it
private to the engineering operator. The full email is also retained in the
`feedback` table (read via `GET /api/admin/feedback` over CF Access). This is an
accepted Beta decision (N≤10 trusted testers, operator's own Discord); revisit a
pseudonymous identifier at GA.

## Delivery is advisory — the table row is the source of truth
The webhook is fired fire-and-forget after the row is committed; it is NOT the
durable record. If the process restarts between insert and send, or all retries
fail (Discord outage), `webhook_delivered_at` stays NULL and there is no
auto-resend. The admin page's "not delivered" indicator is the manual backstop —
see the daily-review step below.

## Severity tiers + target time-to-acknowledge
- **Sev-1** (data loss, can't log a set, auth lockout): ack ≤ 1h, cross-ref `docs/runbooks/bug-triage.md`.
- **Sev-2** (feature broken, no data loss): ack ≤ 1 business day.
- **Sev-3** (cosmetic / idea): ack ≤ 1 week.

## Cadence
Review `GET /api/admin/feedback` (or `/admin/feedback` page) **daily** during Beta.
Mark each row triaged once routed to a fix/issue/won't-do.
Also scan for rows showing **"not delivered"** (NULL `webhook_delivered_at`) — those
never reached Discord (restart or exhausted retries). The DB row is intact, so just
triage them from the admin page directly; no signal is lost.

## Pull via API (engineer)
```bash
curl -s -H "X-Admin-Key: $ADMIN_API_KEY" https://repos.jpmtech.com/api/admin/feedback | jq '.items[] | {id, body, route, triaged_at}'
```

## G12 pre-cutover prod smoke (no staging — runs against prod in the cutover window)
1. Ensure `FEEDBACK_WEBHOOK_URL` is set in `/mnt/user/appdata/repos/.env` to the Discord webhook.
2. As a CF-Access-provisioned non-admin test user, open the app → Topbar "Send feedback" → submit "G12 prod smoke <timestamp>".
3. Confirm within 5s: a row appears via `GET /api/admin/feedback` (admin key), and the message arrives in the Discord channel.
4. Record the pass (timestamp + Discord message link) in PASSDOWN.
