# RepOS responsive visual system

**Status:** implementation reference  
**Principle:** same capability, different composition

RepOS is a calm, precise training instrument. It uses restrained dark surfaces,
Inter Tight for interface language, JetBrains Mono for measurements and compact
metadata, and semantic blue/green/amber/red accents. Responsive changes alter
composition and density, never business behavior or feature reachability.

## Layout modes

| Mode          |     Width | Shell                                                         | Typical content                              |
| ------------- | --------: | ------------------------------------------------------------- | -------------------------------------------- |
| Phone         |     0–767 | Top bar + four-item bottom nav; drawer for deep settings      | Full-screen flows and stacked cards          |
| Tablet        |  768–1023 | Desktop shell where space permits; management data uses cards | One- or two-column adaptive layouts          |
| Desktop       | 1024–1439 | Persistent 232px sidebar                                      | Standard, wide, table, and split workspaces  |
| Large desktop |     1440+ | Persistent sidebar                                            | Split workspaces and high-density comparison |

Content-width patterns are narrow form (560px), standard content (880px), wide
dashboard (1120px), full data (1360px), and split workspace (full available
width, capped at 1360px). Page padding is 16px on phone, 20–24px on tablet, and
24–32px on desktop.

## Shared interaction rules

- Phone targets are at least 44×44px, including inline definitions and overflow
  triggers.
- Every control uses a visible `:focus-visible` ring. Focus returns to the
  invoking control after sheets and dialogs close.
- Motion is removed or reduced when `prefers-reduced-motion` is active.
- Status always combines color with text, iconography, or shape.
- Primary actions use sentence case except compact instrumentation labels.
- Loading reserves the loaded surface's dimensions. Errors explain impact and
  offer Retry. Partial failures say what succeeded, what failed, and the next
  recovery action.

## 1. Application shell and navigation

**Phone.** The top bar contains menu, route title, feedback, and a compact sync
summary. Bottom navigation exposes Today, Programs, History, and Settings and is
hidden during workout logging. The drawer contains account controls and deeper
settings destinations.

**Desktop.** The existing sidebar remains persistent. The top bar uses
“Let’s move.” only for Today and names every other workspace. Date and sync time
are secondary metadata.

**Parity.** All routes remain directly reachable. Keyboard order follows the
visual order; Escape closes the drawer. Shell failures preserve the current
route and expose a retryable message.

## 2. Today overview

**Phone.** The page reads in the order Next Workout, Recovery, Progress. The
exercise list remains the primary scan surface. Start Workout dominates;
deload, skip, and backfill are secondary 44px controls. Acknowledged recovery
advisories collapse to a compact persistent summary. Bodyweight belongs to
Progress rather than floating as an unrelated chip.

**Desktop.** Next Workout is a compact launch panel. Recovery occupies only the
space its current signal warrants. Progress uses a wide analytical surface with
range controls, summary metrics, and an honestly labeled chart.

**Parity and states.** Both compositions support start, skip, deload,
substitution, backfill, and recovery actions. Empty Today directs the user to
Programs; failed workout or health reads fail independently so one does not
erase the other.

## 3. Active workout logger

**Phone.** Preserve the hub → exercise-focus flow for one-handed use. Set inputs
use the correct numeric keyboard, Log advances focus, and the rest timer remains
visible across hub/focus transitions. Bottom navigation is hidden.

**Desktop.** Use three functional regions: exercise sequence and progress on
the left, active exercise and set entry in the center, and targets/history/setup
context on the right. A sticky action bar exposes Skip exercise and Finish
workout. At narrower desktop widths, context moves below the two primary
columns; at tablet widths all regions stack without losing actions.

**Parity and states.** Both use the same validation, offline queue, history
prefill, rest timer, partial-completion confirmation, backfill date, and finish
mutation. A failed log stays editable; queue-full and finish failures remain
visible until recovered. Device handoff can be added later as a convenience.

## 4. Programs and template browsing

**Phone.** Track filters precede a single-column catalog. Program construction
is a stepped editor: Identity → Days → Review and start. Exercise substitutions
and set changes stay within the Days step, and sticky navigation keeps the next
valid action thumb-reachable.

**Desktop.** Templates use a two- or three-column comparable grid. Track,
duration, days/week, and equipment are compact attributes. The active program
adds current week, completion, and next workout. Authoring uses schedule and
exercise panels side by side.

**Parity and states.** Create, fork, edit, archive, delete, and recovery actions
exist in both layouts. Empty tracks explain availability; template-load errors
retry in place; incompatible equipment is an explicit warning, not a hidden
filter.

## 5. History and workout detail

**Phone.** Search, range, and completion filters wrap above readable cards.
Tapping a workout drills into exercise progression; tables do not compress
into the viewport.

**Desktop.** Persistent date, exercise, and completion filters sit above weekly
groups. Expanded workouts can compare current and prior performance side by
side. Load, reps, effort, and personal records use monospace values and textual
change indicators.

**Parity and states.** Both can inspect and reopen completed or skipped work.
Empty filtered results offer Clear filters. Reopen keeps its confirmation and
preserves logged sets on partial failure.

## 6. Account and session management

**Phone.** Account cards stack; long forms use sticky Save. Active sessions and
backups become labeled cards below tablet width. Destructive account actions
remain isolated in a danger zone.

**Desktop.** Account cards use a standard-width two-column layout where fields
can be compared. Sessions and backups retain dense tables with clear current-
device and status markers.

**Parity and states.** Revoke, sign out everywhere, restore, download, and
delete remain available everywhere with identical confirmation tiers. A
partial sign-out or restore names the completed security action before its
failed follow-up.

## 7. User administration

**Phone and tablet.** Each user is a card showing email, display name, status,
role, sync state, last seen, and inviter. One contextual action is primary;
remaining resend, retry sync, suspend, reinstate, and delete actions live in a
44px overflow control.

**Desktop.** Keep the high-density table. Row actions remain inline and the
signed-in administrator cannot target their own row.

**Parity and states.** Confirmation tiers remain action-specific; delete still
requires the email. Unknown sync state reads “Sync pending,” never “drift.” A
mutation disables only its row, and partial Cloudflare failures retain the
existing explicit recovery copy.

## 8. Shared loading, empty, error, and partial-failure states

| State           | Visual contract                                              | Interaction contract                                 |
| --------------- | ------------------------------------------------------------ | ---------------------------------------------------- |
| Loading         | Skeleton matches final geometry; one concise status message  | No fake disabled controls in tab order               |
| Empty           | Plain-language reason plus one useful next action            | Action routes to the exact setup surface             |
| Error           | Human-readable impact, semantic alert, Retry                 | Existing stable data remains visible when safe       |
| Partial failure | Amber/red advisory lists succeeded and failed portions       | Recovery action targets only the failed portion      |
| Disabled        | Reduced emphasis plus adjacent reason where ambiguity exists | Native `disabled`/`aria-disabled`; no color-only cue |
| Loaded          | Stable dimensions and explicit provenance                    | Keyboard, pointer, and touch paths are equivalent    |

## Responsive verification

Visual coverage uses 390×844, 768×900, 1280×900, and 1440×960. Tests assert
that each capability's control or recovery route is reachable at every width;
they do not require identical markup. Critical keyboard checks cover shell
navigation, set entry, overflow actions, dialogs, sheets, and restoration of
focus. Reduced-motion runs verify drawers, backdrops, sheets, and fades.
