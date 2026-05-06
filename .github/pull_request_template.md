<!--
Replace the section comments with content. Keep the headers — they keep PR
descriptions consistent and reviewable.

If the PR is a no-UI-impact chore (docs, types, internal refactor with no
new pages), keep the User-flow section but write "n/a — no user-visible
changes" so it is intentional, not forgotten.
-->

## Summary

<!-- 1–3 bullets: what changed and why. Audience is a reviewer who hasn't
seen the spec yet. Lead with the "why," not the "what." -->

-

## User-flow click path

<!-- REQUIRED for any PR that adds or changes a user-visible feature.
Verb-by-verb path a logged-in user takes to reach the new behavior — start
from the home page (`/`). Each step must be testable.

Example:
1. Load `/` → click "Programs" in the Sidebar
2. Land on `/programs` → see the catalog (3 templates)
3. Click "Full Body 3-Day Foundation" → see template detail
4. Click "Fork" → ForkWizard modal opens

If the feature has no user-facing surface (backend-only, internal tool,
infrastructure), write: "n/a — no user-visible changes" and explain why
in one sentence. Do not delete the section.

Why this section exists: Phase A-E (PR #1) shipped 22 frontend components
that were unreachable in production because the integration layer (router
+ sidebar) was unowned. A user-flow click path forces the author and
reviewer to confirm the wiring exists before code review begins.
-->

1.

## Test plan

<!-- Bulleted markdown checklist. CI checks (typecheck, build, validate-frontend,
typecheck-api) are assumed; list the manual or scenario-level checks here. -->

- [ ]

## Notes

<!-- Optional: deploy steps, follow-ups, known limitations, screenshots. -->
