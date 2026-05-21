import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    // jsdom defaults to an opaque origin (`about:blank`) where Web Storage is
    // disabled and throws SecurityError. The W1.3.7 SessionExpiredBanner uses
    // localStorage as its synchronous "we have unflushed work" signal — give
    // jsdom a non-opaque URL so Storage works under test.
    environmentOptions: {
      jsdom: { url: 'https://repos.jpmtech.com/' },
    },
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    css: false,
    restoreMocks: true,
    // Playwright specs live under playwright/ and src/components/programs/__offline__/.
    // Both import from @playwright/test which is not available under jsdom; exclude
    // them from the Vitest sweep — Playwright runs them via `npx playwright test`.
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      'playwright/**',
      'src/components/programs/__offline__/**',
    ],
  },
});
