# Beta Scope — Design

> Sibling specs in this folder cover backend, mobile, library, programs, ops. This doc is the **visual + voice contract** for everything new in Beta. It does not specify implementation; it specifies what the user sees, reads, and clicks.

## Reference anchors

- Tokens: `frontend/src/tokens.ts` (the only source). Surfaces `surface2 #161C26`, `surface3 #1E2632` exist for layered cards — use them, don't invent shades.
- Type: Inter Tight (UI) + JetBrains Mono (every number, every label, every status pill caption).
- Voice: short sentences, verbs first, all-caps for CTAs ("START LIFT", "RESTORE BACKUP", "DELETE ACCOUNT"). No emoji. No "please." No exclamation marks except on PR celebrations.
- Established components to **reuse, not re-skin**:
  - `<Term k="…">` — every term-of-art (`frontend/src/components/Term.tsx`, dictionary at `lib/terms.ts`). The `abbr` variant is the inline default; `button` is for term-as-CTA.
  - `<GenerateTokenModal>` — the canonical destructive/one-shot modal pattern (backdrop blur, `surface` body, `lineStrong` border, mono eyebrow, 480px width on desktop). New modals copy this skeleton.
  - `<EquipmentWizard>` — the established wizard-card pattern (mono eyebrow → big H2 → muted subtitle → grid of accent-bordered preset cards → tiny muted "Skip" link). Onboarding inherits it.
  - Sidebar avatar block (`Sidebar.tsx` lines 222–265) is the canonical account chip; the account menu hangs off it.
  - Sync-pill in `Topbar.tsx` is the canonical state-color contract (good=fresh, warn=stale, danger=broken). Re-use color logic for landmark zones and backup health.

---

## Auth screens — spec

The login page is the user's first impression. Anchor the brand: this is RepOS, opinionated, monospace, dark.

### Layout — `/sign-in`

Full-viewport centered card on `bg #0A0D12`. Card: 420px wide (mobile: 100% — 32px gutter), `surface #10141C`, 16px radius, 1px `lineStrong` border, 32px padding. Vertical stack, 20px gap.

```
[ R-monogram tile, 40px, accent gradient, glowing ]   ← same gradient as Sidebar logo, 1.5x size
REPOS                                                 ← JetBrains Mono, 16px, letter-spacing 1.4
                                                      ← 24px gap
Sign in.                                              ← Inter Tight 28px / 700 / -0.5 letter-spacing
                                                      ← 4px gap
Cloudflare Access handles the door.                   ← textDim, 14px, the only body copy
                                                      ← 28px gap
[ CONTINUE WITH CLOUDFLARE ACCESS ]                   ← full-width primary button, accent fill, 44px tall, mono 12px / 1.4 letter-spacing
                                                      ← 16px gap
[ SIGN IN WITH EMAIL ]   (only if/when local auth lands; hidden in Beta if CF Access is sole provider)
                                                      ← 24px gap, dotted divider
Trouble? Check the deploy doc or your access policy.  ← textMute, 12px, link styled mono on "deploy doc"
```

The "REPOS" wordmark is the only branding above the fold — no tagline, no marketing copy. The voice telegraphs the rest of the app.

### Layout — `/sign-up`

If self-serve sign-up lands in Beta: identical card chrome, with `Create your account.` headline. Form fields use the existing field style (visible in `EquipmentEditor` ItemRow): 36px height, `surface2` background, 1px `line` border, mono input text 13px. Field labels: mono 10px / textMute / letter-spacing 1.2 / uppercase.

Required fields:
- Email (mono)
- Display name (Inter Tight)
- Timezone (auto-detected from `Intl.DateTimeFormat().resolvedOptions().timeZone`, displayed as a read-only mono pill with a "change" link)

CTA: `[ CREATE ACCOUNT ]`. Below the button, a single sentence: `Already lifting with us? Sign in.` (the word "Sign in" is the link, accent-colored, no underline).

If Beta defers self-serve sign-up (CF Access invite-only), the route still exists but renders: a card with the eyebrow `INVITE-ONLY · BETA` and copy `Beta is closed-list. Ask Jason for an invite.` — no form. Status: this is the v1 reality and likely the Beta reality too.

### Sign-out confirmation

Not a full screen — a 320px modal anchored from the account-menu trigger. Copy:

```
SIGN OUT                                              ← mono eyebrow, textMute
End this session?                                     ← Inter Tight 18px / 600
                                                      ← 4px gap
You'll need to sign back in to log a set.             ← textDim, 13px
                                                      ← 20px gap
[ CANCEL ]   [ SIGN OUT ]                             ← right-aligned, secondary + primary
```

Primary button is `accent`, not `danger` — sign-out is reversible. (Account deletion below is `danger`.)

### Error states

Auth surfaces produce three error shapes — all share the same compact pattern: `danger`-colored 12px mono eyebrow → 14px Inter Tight description → optional retry button.

| Trigger | Eyebrow | Body |
|---|---|---|
| `/api/me` returned 5xx | `AUTH ERROR` | `Couldn't reach the server. {error message}` + `[ RETRY ]` |
| CF Access redirect failed | `ACCESS BLOCKED` | `Cloudflare Access denied this session. Check the policy on /api/me.` |
| `cf_access_disabled` (transitional) | `PLACEHOLDER MODE` | `Auth is off — you're signed in as the dev placeholder. Don't ship like this.` Persistent banner across the top of the app, dismissible per-session. |

Today's `AuthGate` error page (`auth.tsx` line 156–177) already follows this; Beta keeps it but adds the retry button.

---

## Onboarding flow — spec

Entered the first time `/api/me` returns a user with `onboarding_complete: false` (new user signal — backend spec to confirm). Multi-step, full-viewport, modal-style. Cannot be navigated away from via the sidebar — the AppShell suppresses navigation chrome until onboarding completes or skips.

### Progress indicator

A single horizontal track at the top of every onboarding step, 4px tall, full-width minus 64px gutters. Filled segments use `accent`, unfilled use `lineStrong`. Above it, a mono 10px caption: `STEP 02 / 05 · GOAL`.

Each step's label is part of the caption — users always know where they are by name, not just position.

### Steps

| # | Label | Purpose | Card content |
|---|---|---|---|
| 1 | `WELCOME` | Anchor the voice and surface what's coming | Mono eyebrow `BETA · WELCOME`, H1 `Lift smarter.`, body: `Five steps. Two minutes. Then we move.` Single primary CTA `[ START ]`. No skip — this is just a hello. |
| 2 | `EQUIPMENT` | Equipment profile | Re-use `<EquipmentWizard>` exactly as it exists. The "Skip & edit later" link stays — equipment is editable any time. |
| 3 | `GOAL` | Pick a training goal | Three goal cards, same accent-bordered preset pattern: `HYPERTROPHY` (recommended badge in `good`), `STRENGTH`, `MAINTAIN`. Each card: 16px label, 13px description in textDim, mono fine-print on training week structure (e.g. `4–6 sessions/wk · 2–4 working sets per exercise`). |
| 4 | `PROGRAM` | Program pick | Renders the existing `<ProgramCatalog>` filtered to `recommended_for: <goal_picked>`. Primary CTA on hover/select: `[ START THIS PROGRAM ]`. Secondary: `Browse the full catalog →` (accent link, opens unfiltered catalog inline). |
| 5 | `READY` | First-workout handoff | Mono eyebrow `READY`, H1 mirrors today's program: `Day 1: {workout_label}.` Body: `{n} exercises, ~{minutes} min. Phone in your bag — we go mobile from here.` Primary CTA `[ OPEN TODAY ]` routes to `/`. |

### Skip affordance

Steps 2–4 expose a `Skip & edit later →` link in the same position as the existing `<EquipmentWizard>` (bottom-left, textMute, 13px). Skipping any step records `null` for that profile field; subsequent steps adapt (skip equipment → goal step still works; skip goal → program step shows the unfiltered catalog).

Step 1 (welcome) and step 5 (ready) have no skip. Step 5 because completing onboarding by tapping `OPEN TODAY` is the skip.

### Voice

- Step headlines are 4 words or fewer. `Pick your equipment.`, `Pick a goal.`, `Pick your program.`, `You're up.`
- Every step subtitle is one sentence, verb-first.
- No "Awesome!", no "Great choice!" — RepOS doesn't praise the user for picking a radio button.
- Recommended badges use mono 10px / `good` color / letter-spacing 1.0 / uppercase: `RECOMMENDED`. Same pattern as `MesocycleRecap`.

### Layout chrome

Each step is a centered card, max-width 720px, `surface` background, 16px radius. On mobile, card becomes full-width minus 16px gutter. Vertical rhythm uses 24px gaps between header → body → CTA row.

---

## Account / Settings — spec

### Account-menu position

The Sidebar's existing avatar block (`Sidebar.tsx` lines 222–265) becomes a clickable trigger. Clicking it opens a popover anchored above-right (desktop) or a bottom sheet (mobile, 320px tall). Popover content:

```
{primary name}                                        ← Inter Tight 14px / 600
{email}                                               ← mono 11px / textMute, ellipsis if long
                                                      ← 1px line divider
Account settings           →                          ← row, 13px, hover surface2
Sign out                                              ← row, 13px, danger color
```

Settings sub-routes already exist in the Sidebar (`Integrations`, `Units & equipment`, `Account`). Beta adds two more:
- `Backups` (per Restore-from-backup section below)
- `Volume landmarks` (if it ships Beta — see below)

Settings sub-nav order, post-Beta:

```
Integrations
Units & equipment
Volume landmarks       ← NEW (if Beta)
Backups                ← NEW
Account
```

Account is last because it's the heaviest — destructive actions live there and shouldn't be one-tap-away.

### `Settings → Account` Beta additions

Today's `<SettingsAccount>` shows EMAIL / DISPLAY NAME / AUTH MODE as read-only rows. Beta makes display name and timezone editable, and adds a danger zone.

```
SETTINGS                                              ← existing eyebrow
Account                                               ← existing H2

[ Profile card — surface, 12px radius ]
  EMAIL              jason@jpmtech.com                ← read-only, mono
  DISPLAY NAME       [ editable input ]
  TIMEZONE           [ select, 50 IANA zones ]
  AUTH MODE          Cloudflare Access                ← read-only, mono
  [ SAVE CHANGES ]   ← only visible when dirty

[ Sessions card ]                                     ← optional, if backend exposes session list
  Last sign-in: Apr 28, 9:14 AM · Phoenix, AZ
  [ SIGN OUT EVERYWHERE ]                             ← warn-bordered button

[ Danger zone — 1px danger border, surface, separate card ]
  DANGER ZONE                                         ← mono eyebrow, danger color
  Delete account                                      ← H3, 16px / 600
  Permanently removes your data, programs, and PRs. Cannot be undone.
  [ DELETE ACCOUNT ]                                  ← danger fill button, right-aligned
```

### Account deletion confirmation

Heavy enough to need a two-step modal (same pattern as the Restore-from-backup confirmation below — they share a component).

**Step 1 — Confirmation modal (480px, surface, lineStrong border, danger eyebrow):**

```
DELETE ACCOUNT                                        ← danger eyebrow
Delete this account?                                  ← H2, Inter Tight 20px / 700
This wipes your programs, sets, weights, and tokens.
There is no recovery.

To confirm, type your email below.
[ jason@jpmtech.com  ___________________________ ]    ← 36px input, must match exactly

[ CANCEL ]                                [ DELETE ]   ← DELETE is danger fill, disabled until email matches
```

The typed-confirmation-string pattern is borrowed from GitHub's repo-delete and Stripe's account-close flows — chosen over checkboxes because it forces a deliberate keystroke rather than a habituated click.

**Step 2 — Outcome:**

On success: brief "Account deleted." mono toast, then the window redirects to `/sign-in` (or the CF Access logout URL if applicable).
On failure: stay in the modal, show the error inline above the buttons in `danger` mono 12px, e.g. `DELETE FAILED · 500 — try again or contact support`.

---

## Landmarks editor — spec (if in Beta)

User-editable volume landmarks (MEV / MAV / MRV) per muscle group. Numbers-heavy → JetBrains Mono everywhere.

### Route

`/settings/volume-landmarks` (sub-nav of Settings).

### Layout

Single-column table on desktop (max-width 880px); on mobile, each muscle row collapses to a stacked card.

Header strip explains the feature in two sentences and links to a `<Term k="MEV" variant="abbr">`, `<Term k="MAV">`, `<Term k="MRV">` triple-tooltip primer. Then the table:

```
MUSCLE          MV    MEV   MAV   MRV    DEFAULTS
────────────────────────────────────────────────
Chest           [4]   [8]   [18]  [22]   [ RESET ]
Back            [6]   [10]  [20]  [25]   [ RESET ]
Shoulders       [4]   [8]   [18]  [22]   [ RESET ]
…
```

- Column headers: mono 10px / textMute / letter-spacing 1.4 / uppercase. `MV`, `MEV`, `MAV`, `MRV` are wrapped in `<Term>`.
- Inputs: 56px wide, mono 14px, right-aligned digits, `surface2` background, 1px `line` border. On focus: 1px `accent` border + `accentGlow` shadow.
- Color the filled background of each input to indicate the landmark zone — subtle, alpha 0.15:
  - MV → no fill (it's just the floor)
  - MEV → `accent` tint (productive zone start)
  - MAV → `warn` tint (the bell)
  - MRV → `danger` tint (the cliff)
- Each row has a `[ RESET ]` link (textMute, mono 11px) that restores RP defaults for that muscle.
- Bottom of the table: `[ RESET ALL TO DEFAULTS ]` warn-bordered button + `[ SAVE CHANGES ]` accent-fill primary, right-aligned, only visible when dirty.

### Validation

- All values must be `MV ≤ MEV < MAV < MRV`. Violations highlight the offending input with a `danger` border and show a single-line mono caption below: `MEV must be less than MAV.`
- Range guard: `MV ≥ 0`, `MRV ≤ 50`. Out-of-range values are rejected on input (input stops accepting characters).
- Save is disabled while any row is invalid.

### Why this is its own surface

Even if an opinionated user changes one value, the cascading volume-heatmap and mesocycle-ramp logic depend on monotonicity — putting it in a dedicated screen with explicit save-on-dirty (instead of inline edits scattered across the program page) keeps that contract visible.

### Empty state

There is no truly-empty state — every user starts with the RP defaults seeded. But: a "RESTORED FROM DEFAULTS" mono toast appears for 2s after `[ RESET ALL ]` to confirm the wipe.

---

## Restore-from-backup confirmation pattern

Per memory `project_arr_style_db_recovery.md`. Lives at `/settings/backups`.

### Page chrome

```
SETTINGS                                              ← eyebrow
Backups                                               ← H2

This database snapshots automatically.                ← textDim subtitle
Snapshots live in /mnt/user/appdata/repos/backups/
on the host and are covered by Unraid's host-level
backup. Restoring overwrites your current data.

[ BACKUP NOW ]                                        ← accent fill, right-aligned in a header row
```

### Snapshot list

Table, mono throughout. Columns: `WHEN` (relative + absolute), `SIZE` (e.g. `4.2 MB`), `STATE` (good/warn/danger pill — see below), `ACTIONS` (right-aligned: `[ RESTORE ]` warn outline, `[ DELETE ]` danger ghost).

`STATE` mirrors the sync-pill convention:
- `good` = checksum verified, written ≤ 24h ago
- `warn` = checksum verified, > 24h old
- `danger` = checksum mismatch or unreadable — the restore action is disabled and a tooltip explains why

### Restore confirmation modal

Same skeleton as account-deletion (so we build it once). Two-step gate:

```
RESTORE BACKUP                                        ← danger eyebrow
Restore from {timestamp}?                             ← H2

This wipes everything written after that snapshot.
Programs, sets, weights, tokens — gone.
You'll be signed out and the app will restart.

To confirm, type RESTORE below.
[ ___________________________ ]                       ← input must equal the literal string "RESTORE"

[ CANCEL ]                              [ RESTORE ]   ← danger fill, disabled until input matches
```

### Voice

The voice on destructive modals is **flat and factual**, not alarmist. We don't say "WARNING: This action is irreversible!!!" — we say `There is no recovery.` Once. Then we trust the typed-confirmation gate to do the work.

### Post-restore

- Modal locks into a "Restoring…" state (spinner + mono caption `RESTORING · 12 / 18 TABLES`) — restore is a multi-step DB op, surface progress.
- On success: full-page takeover with eyebrow `RESTORED`, H1 `Back online.`, body `Snapshot from {timestamp} is live. Sign in to continue.`, single CTA `[ SIGN IN ]`.
- On failure: modal stays open, replace progress with `danger` block — `RESTORE FAILED · {actionable error}` + `[ TRY AGAIN ]`.

---

## Empty-state catalog

Beta has more empty states than V1. Single voice contract: **mono eyebrow → one-sentence Inter Tight headline → one-sentence textDim explainer → primary CTA**. No illustrations, no mascot, no whitespace-as-art — RepOS shows you what to do next.

| Surface | Trigger | Eyebrow | Headline | Explainer | CTA |
|---|---|---|---|---|---|
| Today | No active mesocycle | `NO ACTIVE BLOCK` | `Pick a program.` | A mesocycle is a 4–6 week block. Pick one to start ramping. | `[ BROWSE PROGRAMS ]` |
| Today | Active mesocycle, today is rest day | `REST DAY` | `Recovery is the work.` | Tomorrow: {next workout label}. | `[ LOG WEIGHT ]` |
| Programs → My Library | No forked programs | `MY LIBRARY` | `No saved programs yet.` | Fork one from the catalog to customize it. | `[ OPEN CATALOG ]` |
| Programs → Catalog | All filters return 0 | `NO MATCHES` | `Nothing fits those filters.` | Try fewer filters or broader equipment. | `[ CLEAR FILTERS ]` |
| Library → My exercises | No saved exercises | `MY EXERCISES` | `No saved exercises yet.` | Save substitutions during a workout to build your shortlist. | (no CTA — the action lives elsewhere) |
| Settings → Backups | First boot, no snapshots | `BACKUPS` | `No snapshots yet.` | The first auto-backup runs after your first workout completes. | `[ BACKUP NOW ]` |
| Settings → Tokens | No tokens minted | `TOKENS` | `No tokens yet.` | Mint one to wire Apple Health. | `[ GENERATE TOKEN ]` |
| Progress (post-Beta route) | < 7 days of data | `EARLY DAYS` | `Trends need a week.` | Come back after a few sessions — we'll plot the first chart at 7 days. | (none) |
| PR feed | No PRs | `PR FEED` | `No PRs logged.` | Beat any working set's old top weight × reps to log one. | (none) |

All empty-state cards inherit the same chrome: 100% width of their container, `surface` background, 12px radius, 1px `line` border, 32px padding (24px on mobile), centered text, 16px gap between elements.

---

## Term tooltip audit (new Beta surfaces)

Every term-of-art that lands on a Beta surface must be wrapped in `<Term>`. The dictionary already lives at `frontend/src/lib/terms.ts`. The following terms are **new to Beta surfaces and must be added to TERMS** (or already exist there but appear on a new surface and need an audit):

| Key | Where it appears | Definition (plain) | Why it matters |
|---|---|---|---|
| `cf_access` *(NEW)* | Auth screens, AUTH MODE row, errors | Cloudflare Access — the login service Cloudflare runs in front of RepOS. | RepOS doesn't manage your password. Access does, and it can require 2FA, SSO, or single-use codes from your provider. |
| `placeholder_mode` *(NEW, dev-only)* | Auth banner, Sidebar avatar | A development bypass — you're signed in as a fake user. | Production should never run in this mode. If you see this banner on repos.jpmtech.com, file an incident. |
| `mesocycle` ✓ | Onboarding step 5, recap, empty states | (existing) | (existing) |
| `MEV` / `MAV` / `MRV` ✓ | Landmarks editor headers + inputs | (existing) | (existing) |
| `MV` *(NEW)* | Landmarks editor first column | Maintenance Volume — the weekly set count that holds size without growing it. | Below MV, you lose muscle. RepOS's deload weeks aim above MV but below MEV. |
| `working_set` ✓ | Landmarks editor explainer; recap | (existing — verify it appears on Settings) | (existing) |
| `hypertrophy` ✓ | Onboarding goal step | (existing) | (existing) |
| `strength` *(NEW)* | Onboarding goal step | Increase in maximum force production — typically 1–5 reps, longer rest, lower weekly volume than hypertrophy. | RepOS's strength goal picks programs with heavier loads and lower MEV/MAV per muscle. |
| `maintain` *(NEW)* | Onboarding goal step | Hold current size and strength on minimum effective volume. | For travel, injuries, or off-seasons — you keep what you've built without ramping. |
| `timezone` *(NEW abbr)* | Onboarding, account settings | Your local clock zone — affects which date a workout logs against. | RepOS stores wall-clock time; if your timezone is wrong, a 11pm workout could log on tomorrow's date. |
| `equipment_profile` *(NEW)* | Onboarding, settings | The list of gear you own. | Drives which exercises and substitutions appear. Gear you don't have, you don't see. |
| `backup_snapshot` *(NEW)* | Settings → Backups | A point-in-time copy of your database. | Restoring rolls all your data back to that moment. Use after corruption or accidental deletion. |
| `restore` *(NEW)* | Backup confirmation modal | The act of overwriting current data with a snapshot. | Destructive. Newer data is wiped. There's no undo. |
| `2FA` *(NEW abbr)* | Auth, account settings | Two-factor authentication — a second proof on top of your password. | Cloudflare Access can require it; RepOS itself doesn't manage this. |
| `IANA` *(NEW abbr)* | Onboarding timezone, account | Internet Assigned Numbers Authority — the timezone naming standard, e.g. `America/Phoenix`. | These names are unambiguous; abbreviations like "MST" aren't. |

**Audit rule for Beta-new code:** any new label, header, badge, chart axis, or modal copy that introduces a domain term must add the term to `lib/terms.ts` in the same PR and wrap the first appearance in `<Term k="…">`. Subsequent appearances on the same surface can be plain text.

---

## Voice & copy guidelines specific to Beta-new surfaces

These extend the parent voice contract; they don't override it.

1. **Auth voice is the brand voice's loudest moment.** Headlines are imperative ("Sign in.") with terminal periods. No "Welcome back!", no "Hey there 👋". The first time the user lands on RepOS they should feel the opinionated tone immediately.
2. **Onboarding micro-copy avoids progress flattery.** No "Nice!", "Great!", "You're crushing it." between steps. The progress bar advances; that's the feedback.
3. **Destructive copy is flat, not alarmist.** State the consequence once. Don't use ALL CAPS for fear or "⚠️" for emphasis — the danger color and the typed confirmation gate carry the weight.
4. **Settings explainer paragraphs are at most two sentences.** If a setting needs three, it needs a `<Term>` instead.
5. **Empty states never apologize.** No "Sorry, no data yet." The user didn't do anything wrong by being new.
6. **Time and counts always use mono.** "12 PRS · 5 WEEKS · 240 SETS" — never sans-serif numerals.
7. **CTAs in destructive modals don't use the verb in past tense.** `[ DELETE ACCOUNT ]`, not `[ I UNDERSTAND, DELETE MY ACCOUNT ]`. The typed gate already proves understanding.
8. **`<Term>` defaults to `abbr` variant inside body copy** (the dotted-underline) and to `button` variant in headers, table column captions, and CTAs (where the popover is the primary affordance, not a side-channel).

---

## Risks / unknowns

1. **CF Access vs. self-serve sign-up scope is unsettled.** This spec covers both shapes; pick one before implementation. If self-serve doesn't ship Beta, the `/sign-up` route should redirect to `/sign-in` with an `INVITE-ONLY` banner rather than 404.
2. **Onboarding gating signal.** Backend currently has no `onboarding_complete` field on `users`. Either it ships in Beta or onboarding is gated on `equipment_profile IS NULL` as a proxy — the latter forces step ordering (equipment must come early) which this spec already does.
3. **Landmarks editor: in-Beta or post-Beta?** This spec includes it because the mesocycle-ramp logic in Programs already references MEV/MAV/MRV per muscle. If the editor slips, the values are still set — just not user-editable. No UI surface change needed if it slips.
4. **Account deletion backend semantics.** Soft-delete vs. hard-delete matters for the modal copy. This spec assumes hard-delete ("There is no recovery."); if backend goes soft-delete with a 30-day window, the copy changes to `Deletes in 30 days. Sign back in to cancel.`
5. **Backup retention UI.** Per memory, retention is "TBD when sub-project is designed." This spec shows a flat list without retention configuration — Beta may need a retention selector. Default copy if it lands: `Keep last [7] snapshots.` mono input.
6. **Mobile auth.** The card width 420px works on phone landscape but is tight portrait. Card should collapse to `100% - 32px gutter` under 480px viewport — confirmed in spec but worth visual QA on a real iPhone before merge.
7. **`<Term>` performance on landmarks editor.** Eight muscles × four columns × tooltip = 32 popover roots on one page. Verify Radix popover virtualization or render only on hover/focus.

---

## Open questions for cross-team review

1. **Backend:** does the user model gain `onboarding_complete` and `display_name_changed_at`, or do we infer from existing fields?
2. **Backend:** does `/api/me` 401 redirect contract stay (CF Access via `WWW-Authenticate`), or do we add a JSON body so the auth screens can render their own login button instead of a hard redirect?
3. **Backend:** account deletion endpoint — `DELETE /api/me`? What's the response shape? Does it sign-out via `Set-Cookie: CF_Authorization=; Max-Age=0`?
4. **Backend:** restore endpoint long-poll vs. websocket vs. polling for progress (`12 / 18 tables` line)?
5. **Mobile:** does onboarding render on mobile, or do we steer first-run users to desktop with a friendly redirect? The user's own memory says desktop = data management — onboarding is data management. Proposed: render on both, but the program-pick step on mobile uses the existing mobile catalog pattern.
6. **Library / Programs:** the empty-state copy in this catalog assumes specific labels ("MY LIBRARY", "MY EXERCISES") — confirm those names with the Library/Programs spec authors.
7. **Ops / Backups:** is the auto-backup schedule fixed (e.g. nightly at 03:00 UTC) or user-configurable? If configurable, the Backups page needs a schedule editor and the empty-state copy changes.
8. **Cardio (per memory `feedback_cardio_first_class.md`):** does Beta surface a cardio empty state on Today? If so, copy: `NO CARDIO TODAY` / `Save it for tomorrow.` / `Z2 walk pairs well after upper days.` Pull `<Term k="Z2">`.
9. **Tooltip audit responsibility:** who owns auditing `lib/terms.ts` against this spec at implementation time? Proposed: each PR that adds a new Beta surface includes a checklist item `[ ] Terms audited against /docs/superpowers/specs/beta/05-design.md`.
10. **Brand assets:** the auth screen uses the existing R-monogram tile — do we want a wordmark SVG, or does mono "REPOS" suffice as the wordmark forever? Proposed: stay mono. The whole brand is the typeface.
