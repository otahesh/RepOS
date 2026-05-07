/**
 * Vitest config for integration tests.
 *
 * Integration tests (tests/integration/) exercise the full Fastify app
 * against a real Postgres database. They are kept separate from the unit
 * test suite (npm test) because:
 *
 *   1. They require DATABASE_URL to point at a live Postgres instance.
 *      (api/.env → repos_test on localhost; in Docker the monolithic
 *      container's internal PG is used.)
 *   2. They are heavier (~1–3s per test due to app boot + DB round-trips)
 *      and would slow down the fast unit loop unnecessarily.
 *   3. They need a longer timeout to accommodate app startup + materialize.
 *
 * Run command: npm run test:integration
 * Or directly: npx vitest run --config vitest.integration.config.ts
 *
 * To run in CI/Docker: set DATABASE_URL before invoking.
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/integration/**/*.test.ts'],
    // Longer timeouts: app boot (~200ms) + materializeMesocycle (SERIALIZABLE
    // tx + UNNEST inserts) can spike to ~500ms on cold connections.
    testTimeout: 60_000,
    hookTimeout: 60_000,
    // Integration tests must run serially — they share DB state and the
    // beforeAll/afterAll cleanup must complete before the next suite starts.
    pool: 'forks',
    singleFork: true,
  },
});
