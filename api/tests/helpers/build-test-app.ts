// Beta W1.2 — test app builder.
//
// Delegates to the production buildApp() factory so route registration stays
// in one place. Tests get a fully-wired Fastify instance (every route, the
// helmet/sensible plugins, the global error handler) without re-listing
// routes.
//
// Pair with cleanupSeeded() from ./seed-fixtures in afterEach/afterAll so
// every test wipes its own users (cascade clears child rows).
import { buildApp } from '../../src/app.js';

export type TestApp = Awaited<ReturnType<typeof buildApp>>;

export async function build(): Promise<TestApp> {
  // logger:false suppresses request-log noise during test runs. Production
  // index.ts passes logger:true; tests just don't need it.
  return buildApp({ logger: false });
}
