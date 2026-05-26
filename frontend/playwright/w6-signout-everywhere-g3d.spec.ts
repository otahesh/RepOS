// frontend/playwright/w6-signout-everywhere-g3d.spec.ts
// G3.d — Sign out everywhere revokes ALL bearers cross-device.
//
// Scenario:
//   1. "device A": browser context with no bearer (drives the UI click).
//   2. "device B": separate browser context carrying bearer B.
//   3. From device A's browser context, navigate to /settings/account,
//      click "Sign out everywhere", confirm the medium-tier dialog.
//   4. The signout-everywhere mock adds both bearers to the shared `revoked`
//      set.
//   5. Device B's next /api/account/sessions fetch (carrying bearer B) must
//      return 401.
//
// Hermetic via ctx.route()-level mocks — same pattern as
// w3-injury-swap-flow.spec.ts. No real backend is contacted; no DB state is
// required. The dev vite server is enough because requests are intercepted in
// the browser before they hit the proxy. The two "devices" are two distinct
// browser contexts created from the same playwright `browser` (NEW context per
// device → independent cookie jars + localStorage). The bearer-token state is
// held in-memory in the route mocks via the shared `revoked` set.
//
// Hosted here (not tests/e2e/) per the W3 docblock: tests/e2e/ does not resolve
// `@playwright/test` because node_modules only resolves under frontend/.
//
// Adjustments vs the plan stub (plan lines 3752–3835):
//   - No `units` in the /api/me mock — units was CUT (D6). AuthProvider only
//     reads { id, email, display_name, timezone }.
//   - The sessions mock returns `last_used_ip_24: '1.2.3.0/24'` (the real
//     server /24-truncates server-side, per I-LAST-IP-TRUNCATE) — NOT
//     `last_used_ip`, which is what ActiveSessionsTable reads. A bare
//     `last_used_ip` would render "—" and, more importantly, drift the mock
//     from the real SessionRow shape.
//   - Device B does a `goto('/')` before the in-page fetch so the document has
//     a real origin (a relative `fetch('/api/...')` from about:blank has no
//     base URL).
//   - The dialog confirm is awaited via the signout-everywhere response so the
//     shared `revoked` set is guaranteed populated before device B probes.

import { test, expect, type BrowserContext, type Route } from '@playwright/test';

const USER = {
  id: 'user-1',
  email: 'tester@example.com',
  display_name: 'Tester',
  timezone: 'UTC',
};
const TOKEN_A = 'aaaaaaaaaaaaaaaa.' + 'a'.repeat(64);
const TOKEN_B = 'bbbbbbbbbbbbbbbb.' + 'b'.repeat(64);

test('G3.d: sign-out-everywhere revokes all bearers across devices', async ({ browser }) => {
  // Shared in-memory state — both contexts see the same revoked-set.
  const revoked = new Set<string>();

  const wireMocks = async (ctx: BrowserContext): Promise<void> => {
    // /api/me — exact AuthProvider/ProfileResponse shape (no `units`, per D6).
    await ctx.route('**/api/me', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(USER),
      });
    });

    // /api/equipment/profile — non-empty so the EquipmentWizard modal stays
    // hidden (mirrors the W3 spec + W1.3.6 offline helper).
    await ctx.route('**/api/equipment/profile', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ _v: 1, barbell: { available: true } }),
      });
    });

    // /api/account/sessions — the bearer-aware surface. If the presented
    // bearer is in `revoked`, return 401; otherwise return one live session.
    // Field is `last_used_ip_24` (already /24-truncated server-side) to match
    // the real SessionRow that ActiveSessionsTable renders.
    await ctx.route('**/api/account/sessions', async (route: Route) => {
      const auth = route.request().headers().authorization ?? '';
      const token = auth.replace(/^Bearer /, '');
      if (revoked.has(token)) {
        await route.fulfill({ status: 401, contentType: 'application/json', body: '{}' });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          sessions: [
            {
              id: 's1',
              label: 'iOS Shortcut',
              created_at: '2026-05-01T00:00:00Z',
              last_used_at: '2026-05-25T07:30:00Z',
              last_used_ip_24: '1.2.3.0/24',
            },
          ],
        }),
      });
    });

    // /api/account/events — empty audit feed (keyset shape; no next_cursor).
    await ctx.route('**/api/account/events', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ events: [], next_cursor: null }),
      });
    });

    // /api/auth/signout-everywhere — bulk-revoke every bearer minted in this
    // run + clear the CF Access cookie (per C-SIGNOUT-CFACCESS-ONLY). 204.
    await ctx.route('**/api/auth/signout-everywhere', async (route: Route) => {
      revoked.add(TOKEN_A);
      revoked.add(TOKEN_B);
      await route.fulfill({
        status: 204,
        headers: { 'Set-Cookie': 'CF_Authorization=; Max-Age=0; Path=/' },
      });
    });
  };

  // ── Device A — drives the click. No bearer header (UI uses the CF Access
  //    cookie, not a bearer); its sessions call returns 200. ─────────────────
  const ctxA = await browser.newContext();
  await wireMocks(ctxA);
  const pageA = await ctxA.newPage();
  await pageA.goto('/settings/account');

  // Account page mounted past AuthGate once the SignOutEverywhere control is
  // visible (it lives in the Security section below the sessions table).
  const signOutBtn = pageA.getByRole('button', { name: /sign out everywhere/i });
  await expect(signOutBtn).toBeVisible();
  await signOutBtn.click();

  // The medium-tier ConfirmDialog opens. Its accessible name is the title
  // "End this session on every device?" (via aria-labelledby). Confirm.
  const confirmDialog = pageA.getByRole('dialog', {
    name: /end this session on every device/i,
  });
  await expect(confirmDialog).toBeVisible();

  // Wait for the POST to land so the shared `revoked` set is populated before
  // we probe device B. The button redirects to /cdn-cgi/access/logout right
  // after, so we capture the response rather than chasing the navigation.
  const signoutResp = pageA.waitForResponse('**/api/auth/signout-everywhere');
  await confirmDialog.getByRole('button', { name: /^confirm$/i }).click();
  const resp = await signoutResp;
  expect(resp.status()).toBe(204);

  // ── Device B — independent context carrying bearer B. Token B was minted
  //    before sign-out-everywhere fired; after A confirms, B's next API call
  //    must return 401. ───────────────────────────────────────────────────────
  const ctxB = await browser.newContext({
    extraHTTPHeaders: { authorization: `Bearer ${TOKEN_B}` },
  });
  await wireMocks(ctxB);
  const pageB = await ctxB.newPage();
  // Establish a real document origin so the relative in-page fetch resolves.
  await pageB.goto('/');
  const status = await pageB.evaluate(async () => {
    const r = await fetch('/api/account/sessions');
    return r.status;
  });
  expect(status).toBe(401);

  await ctxA.close();
  await ctxB.close();
});
