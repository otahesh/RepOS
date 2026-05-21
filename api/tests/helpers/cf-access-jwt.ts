// Beta W1.4.0 — CF Access JWT test helper.
//
// Stands up a local HTTP JWKS server, points CF_ACCESS_* env vars at it,
// and returns a `mintJwt(email)` closure that signs RS256 JWTs which the
// production cfAccess middleware will verify successfully.
//
// Extracted from api/tests/integration/jwks-rotation.test.ts so the JWKS
// setup pattern is reusable across the scope-enforcement test (W1.4.0)
// and the W1.4.5 workouts cross-scope test. The original jwks-rotation
// test is intentionally left alone — migrating it is out of scope for
// this commit.
//
// The cfAccess module caches the JWKS client at module-scope; teardown()
// resets that cache and restores any env vars we touched so back-to-back
// suites can use the helper without leaking state.

import { createServer, type Server } from 'node:http';
import {
  generateKeyPair,
  exportJWK,
  SignJWT,
  type KeyLike,
  type JWK,
} from 'jose';
import { resetJwksCacheForTesting } from '../../src/middleware/cfAccess.js';

export interface TestJwksHandle {
  /** Sign an RS256 JWT with the active key, email claim, correct iss/aud. */
  mintJwt: (email: string) => Promise<string>;
  /** Shut down the HTTP server and restore touched env vars. */
  teardown: () => Promise<void>;
  /** The CF Access AUD value the harness configured (handy for assertions). */
  aud: string;
}

interface SavedEnv {
  CF_ACCESS_ENABLED: string | undefined;
  CF_ACCESS_AUD: string | undefined;
  CF_ACCESS_TEAM_DOMAIN: string | undefined;
  CF_ACCESS_ALLOWED_EMAILS: string | undefined;
}

export async function setupTestJwks(opts: {
  /** AUD value the issued JWTs claim; default unique per call to avoid bleed. */
  aud?: string;
  /** Comma-separated allowed email list; default empty (= allow all). */
  allowedEmails?: string;
} = {}): Promise<TestJwksHandle> {
  const aud = opts.aud ?? `test-aud-${Math.random().toString(36).slice(2, 10)}`;

  // 1. Generate an RS256 key pair and the matching public JWK.
  const { publicKey, privateKey } = await generateKeyPair('RS256', {
    extractable: true,
  });
  const jwk = (await exportJWK(publicKey)) as JWK;
  jwk.kid = 'kid-test';
  jwk.alg = 'RS256';
  jwk.use = 'sig';

  // 2. Stand up an HTTP server that serves the JWK at the CF Access path.
  const server: Server = createServer((req, res) => {
    if (req.url === '/cdn-cgi/access/certs') {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Cache-Control', 'max-age=1');
      res.end(JSON.stringify({ keys: [jwk] }));
      return;
    }
    res.statusCode = 404;
    res.end();
  });
  await new Promise<void>((resolve) =>
    server.listen(0, '127.0.0.1', resolve),
  );
  const port = (server.address() as { port: number }).port;
  const teamDomain = `127.0.0.1:${port}`;

  // 3. Save + override env vars so the cfAccess middleware points at us.
  const saved: SavedEnv = {
    CF_ACCESS_ENABLED: process.env.CF_ACCESS_ENABLED,
    CF_ACCESS_AUD: process.env.CF_ACCESS_AUD,
    CF_ACCESS_TEAM_DOMAIN: process.env.CF_ACCESS_TEAM_DOMAIN,
    CF_ACCESS_ALLOWED_EMAILS: process.env.CF_ACCESS_ALLOWED_EMAILS,
  };
  process.env.CF_ACCESS_ENABLED = 'true';
  process.env.CF_ACCESS_AUD = aud;
  process.env.CF_ACCESS_TEAM_DOMAIN = teamDomain;
  if (opts.allowedEmails !== undefined) {
    process.env.CF_ACCESS_ALLOWED_EMAILS = opts.allowedEmails;
  } else {
    delete process.env.CF_ACCESS_ALLOWED_EMAILS;
  }
  // Reset the cached JWKS client so the new CF_ACCESS_TEAM_DOMAIN is picked up.
  resetJwksCacheForTesting();

  const mintJwt = async (email: string): Promise<string> => {
    return new SignJWT({ email })
      .setProtectedHeader({ alg: 'RS256', kid: jwk.kid! })
      .setIssuer(`https://${teamDomain}`)
      .setAudience(aud)
      .setExpirationTime('5m')
      .sign(privateKey as KeyLike);
  };

  const teardown = async (): Promise<void> => {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
    // Restore env vars. `undefined` means "the var was unset before"; use
    // `delete` to put it back to that state rather than the literal string
    // "undefined".
    for (const [k, v] of Object.entries(saved) as [keyof SavedEnv, string | undefined][]) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    resetJwksCacheForTesting();
  };

  return { mintJwt, teardown, aud };
}
