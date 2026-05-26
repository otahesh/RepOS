import { test, expect } from '@playwright/test';

test('G7: /settings/account reachable from / in ≤2 clicks', async ({ page }) => {
  await page.route('**/api/me', async (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ id: 'u1', email: 'a@b', display_name: 'X', timezone: 'UTC' }),
  }));
  await page.route('**/api/equipment/profile', async (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ _v: 1, barbell: { available: true } }),
  }));
  await page.route('**/api/account/sessions', async (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ sessions: [] }),
  }));
  await page.route('**/api/account/events', async (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ events: [] }),
  }));

  await page.goto('/');
  await page.getByRole('link', { name: /^settings$/i }).click();
  await page.getByRole('link', { name: /^account$/i }).click();

  // /^account$/ pins the page-title <h2>Account</h2> and excludes the
  // <h3>Delete account</h3> further down the page (strict-mode safe).
  await expect(page.getByRole('heading', { name: /^account$/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /sign out everywhere/i })).toBeVisible();
});
