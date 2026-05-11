/**
 * Beta W0.6 integration test for CF Access JWKS cache invalidation on
 * key rotation.
 *
 * Boots a local mock JWKS HTTP server, signs JWTs with kid-A, asserts they
 * verify. Rotates the server to serve kid-B only. Asserts kid-B JWTs verify
 * within a 60s budget AND kid-A JWTs subsequently 401. Validates the
 * cacheMaxAge + cooldownDuration tuning in api/src/middleware/cfAccess.ts.
 *
 * Mock server runs on http://127.0.0.1:<port>. The middleware is taught to
 * use http (instead of https) when teamDomain starts with 127.0.0.1 AND
 * NODE_ENV=test — see api/src/middleware/cfAccess.ts.
 */

import 'dotenv/config';
import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
} from 'vitest';
import { createServer, type Server } from 'node:http';
import { generateKeyPair, exportJWK, SignJWT, type KeyLike, type JWK } from 'jose';
import Fastify, { type FastifyInstance } from 'fastify';
import { db } from '../../src/db/client.js';
import {
  requireCfAccess,
  resetJwksCacheForTesting,
} from '../../src/middleware/cfAccess.js';

const AUD = 'test-aud-beta-w0-6';
const TEST_EMAIL = 'jwks-rotation-test@local';

let mockJwksServer: Server;
let mockJwksPort: number;
let activeJwk: JWK;

async function makeJwk(kid: string): Promise<{ jwk: JWK; privateKey: KeyLike }> {
  const { publicKey, privateKey } = await generateKeyPair('RS256', {
    extractable: true,
  });
  const jwk = await exportJWK(publicKey);
  jwk.kid = kid;
  jwk.alg = 'RS256';
  jwk.use = 'sig';
  return { jwk, privateKey };
}

beforeAll(async () => {
  // Bind to an ephemeral port. The handler serves `activeJwk` — whichever
  // key the test has most recently "rotated to."
  mockJwksServer = createServer((req, res) => {
    if (req.url === '/cdn-cgi/access/certs') {
      res.setHeader('Content-Type', 'application/json');
      // Short cache header so jose doesn't hold the response longer than our
      // own cacheMaxAge budget.
      res.setHeader('Cache-Control', 'max-age=1');
      res.end(JSON.stringify({ keys: [activeJwk] }));
      return;
    }
    res.statusCode = 404;
    res.end();
  });
  await new Promise<void>((resolve) => mockJwksServer.listen(0, '127.0.0.1', resolve));
  mockJwksPort = (mockJwksServer.address() as { port: number }).port;

  process.env.CF_ACCESS_ENABLED = 'true';
  process.env.CF_ACCESS_AUD = AUD;
  process.env.CF_ACCESS_TEAM_DOMAIN = `127.0.0.1:${mockJwksPort}`;
  process.env.CF_ACCESS_ALLOWED_EMAILS = TEST_EMAIL;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    mockJwksServer.close((err) => (err ? reject(err) : resolve())),
  );
  await db.query(`DELETE FROM users WHERE lower(email) = lower($1)`, [TEST_EMAIL]);
  await db.end();
});

beforeEach(() => {
  resetJwksCacheForTesting();
});

async function buildHarness(): Promise<FastifyInstance> {
  const app = Fastify();
  app.addHook('preHandler', requireCfAccess);
  app.get('/probe', async () => ({ ok: true }));
  return app;
}

async function signJwt(kid: string, privateKey: KeyLike): Promise<string> {
  return new SignJWT({ email: TEST_EMAIL })
    .setProtectedHeader({ alg: 'RS256', kid })
    .setIssuer(`https://127.0.0.1:${mockJwksPort}`)
    .setAudience(AUD)
    .setExpirationTime('5m')
    .sign(privateKey);
}

describe('CF Access JWKS rotation cache invalidation', () => {
  it(
    'accepts the rotated-in key within 60s and 401s the rotated-out key',
    async () => {
      // 1. Start with key-A.
      const a = await makeJwk('kid-A');
      activeJwk = a.jwk;

      const app = await buildHarness();
      const aJwt = await signJwt('kid-A', a.privateKey);

      const r1 = await app.inject({
        method: 'GET',
        url: '/probe',
        headers: { 'cf-access-jwt-assertion': aJwt },
      });
      expect(r1.statusCode).toBe(200);

      // 2. Rotate: server now serves key-B only. kid-A is gone from JWKS.
      const b = await makeJwk('kid-B');
      activeJwk = b.jwk;

      const bJwt = await signJwt('kid-B', b.privateKey);

      // 3. Poll: within 60s the cache must refresh and kid-B JWT must verify.
      const t0 = Date.now();
      let lastB = 401;
      while (Date.now() - t0 < 60_000) {
        const rB = await app.inject({
          method: 'GET',
          url: '/probe',
          headers: { 'cf-access-jwt-assertion': bJwt },
        });
        lastB = rB.statusCode;
        if (lastB === 200) break;
        await new Promise((r) => setTimeout(r, 2_000));
      }
      expect(lastB).toBe(200);

      // 4. After cache refresh, kid-A is no longer in JWKS → kid-A JWTs 401.
      const rA2 = await app.inject({
        method: 'GET',
        url: '/probe',
        headers: { 'cf-access-jwt-assertion': aJwt },
      });
      expect(rA2.statusCode).toBe(401);

      await app.close();
    },
    90_000,
  );
});
