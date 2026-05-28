import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './',
  testMatch: ['playwright/**/*.spec.ts', 'src/components/programs/__offline__/*.spec.ts'],
  timeout: 30_000,
  // Retry in CI only — e2e timing (IDB polls, backoff windows, the build+preview
  // boot) is variance-prone on shared runners; a real regression fails all
  // attempts, while a transient hiccup recovers. trace is captured on retry.
  retries: process.env.CI ? 2 : 0,
  use: { baseURL: 'http://localhost:4173', trace: 'on-first-retry' },
  // Run e2e against the PRODUCTION build (vite preview), not the dev server.
  //
  // Why not `npm run dev`: the dev server runs React in StrictMode, whose
  // mount→unmount→remount double-invoke desyncs focus-trap-react@12's class
  // lifecycle — `<FocusTrap active>` ends up rendering nothing, so the
  // ConfirmDialog (sign-out-everywhere, delete-account) never appears. The
  // production build (no StrictMode double-invoke) renders it correctly. This
  // also matches how Beta actually ships (per project_beta_no_staging: e2e on
  // the prod build is the validation surface). Both the W3 and W6 specs are
  // verified green against this preview server.
  webServer: {
    command: 'npm run build && npm run preview -- --port 4173',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
  projects: [{ name: 'chromium', use: devices['Desktop Chrome'] }],
});
