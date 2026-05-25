# Beta — User Reachability Audit (G7)

Per acceptance gate **G7** in `docs/superpowers/goals/beta.md`:

> Every Beta surface reachable from `/` in ≤3 clicks for a logged-in user; prior-mesocycle recap reachable; no surface requires URL knowledge.

Each row below documents one Beta-new user-facing surface and the shortest click-path from the home route `/`. Verified by walking the path in the live UI; verified copy of role/accessible-name selectors against component source.

---

## W3 — Clinical signals + injury swap

| Surface | Path from `/` | Click count |
|---|---|---|
| `/settings/injuries` — InjuryChipsEditor (add / remove joint chips, severity & notes) | `/` → "Settings" nav → "Injuries" sub-nav | **2 clicks** ✓ |
| Mid-session swap picker (per-block "Got a tweak?" with injury advisory copy on candidates) | `/` → today's program tile/card → block "⋯" menu → "Got a tweak?" | **3 clicks** ✓ |

### Source-of-truth selectors

The Playwright e2e spec `tests/e2e/w3-injury-swap-flow.spec.ts` exercises both paths and pins the selectors used here.

- "Settings" + "Injuries" nav items: `frontend/src/components/layout/Sidebar.tsx`. Route `settings/injuries` registered in `frontend/src/App.tsx` and rendered by `frontend/src/pages/SettingsInjuriesPage.tsx`, which mounts `frontend/src/components/settings/InjuryChipsEditor.tsx`.
- Per-block "⋯" menu: `frontend/src/components/programs/BlockOverflowMenu.tsx` (aria-label `More options for {blockName}`).
- "Got a tweak?" menuitem: same file, opens `MidSessionSwapSheet` which mounts `MidSessionSwapPicker`.

### G7 status for W3

Both surfaces are reachable inside the 3-click budget. **G7 ✓ for W3.**
