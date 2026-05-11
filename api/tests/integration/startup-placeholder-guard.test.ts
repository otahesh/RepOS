/**
 * Beta W0.3 integration test for the placeholder-purge runtime guard.
 *
 * The guard in api/src/bootstrap-runtime.ts refuses to boot in production
 * when a `users` row with id = PLACEHOLDER_UUID exists. This test covers:
 *   - placeholder present + NODE_ENV=production → process.exit(1)
 *   - placeholder absent + NODE_ENV=production → returns normally
 *   - placeholder present + NODE_ENV=test → returns normally (no exit)
 *
 * Cleans up after itself; does not touch other test fixtures.
 */

import 'dotenv/config';
import { describe, it, expect, afterAll, afterEach, vi } from 'vitest';
import { db } from '../../src/db/client.js';
import { validatePlaceholderPurge } from '../../src/bootstrap-runtime.js';

const PLACEHOLDER_UUID = '00000000-0000-0000-0000-000000000001';

async function insertPlaceholderUser() {
  await db.query(
    `INSERT INTO users (id, email, timezone) VALUES ($1, $2, 'UTC')
     ON CONFLICT (id) DO NOTHING`,
    [PLACEHOLDER_UUID, 'placeholder-test@local'],
  );
}

async function removePlaceholderUser() {
  await db.query(`DELETE FROM users WHERE id = $1`, [PLACEHOLDER_UUID]);
}

describe('validatePlaceholderPurge', () => {
  afterEach(async () => {
    await removePlaceholderUser();
  });
  afterAll(async () => {
    await db.end();
  });

  it('exits non-zero in production when a placeholder user row exists', async () => {
    await insertPlaceholderUser();
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('exit-called');
    }) as never);
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await expect(
        validatePlaceholderPurge({ NODE_ENV: 'production' } as NodeJS.ProcessEnv),
      ).rejects.toThrow('exit-called');
      expect(errSpy).toHaveBeenCalled();
    } finally {
      exitSpy.mockRestore();
      errSpy.mockRestore();
    }
  });

  it('returns normally in production when no placeholder user row exists', async () => {
    await removePlaceholderUser();
    await expect(
      validatePlaceholderPurge({ NODE_ENV: 'production' } as NodeJS.ProcessEnv),
    ).resolves.toBeUndefined();
  });

  it('returns normally in test env even when placeholder is present', async () => {
    await insertPlaceholderUser();
    await expect(
      validatePlaceholderPurge({ NODE_ENV: 'test' } as NodeJS.ProcessEnv),
    ).resolves.toBeUndefined();
  });

  it('returns normally in development even when placeholder is present', async () => {
    await insertPlaceholderUser();
    await expect(
      validatePlaceholderPurge({ NODE_ENV: 'development' } as NodeJS.ProcessEnv),
    ).resolves.toBeUndefined();
  });
});
