import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  readDeployedRev,
  __setDeployedRevRunnerForTesting,
} from '../../src/services/deployedRev.js';

const SHA = 'c'.repeat(40);
const saved = { host: process.env.UNRAID_SSH_HOST, user: process.env.UNRAID_SSH_USER };

beforeEach(() => {
  process.env.UNRAID_SSH_HOST = '192.168.88.2';
  process.env.UNRAID_SSH_USER = 'root';
});

afterEach(() => {
  __setDeployedRevRunnerForTesting(null);
  if (saved.host === undefined) delete process.env.UNRAID_SSH_HOST;
  else process.env.UNRAID_SSH_HOST = saved.host;
  if (saved.user === undefined) delete process.env.UNRAID_SSH_USER;
  else process.env.UNRAID_SSH_USER = saved.user;
});

describe('readDeployedRev', () => {
  it('returns the trimmed SHA the container reports', async () => {
    __setDeployedRevRunnerForTesting(async () => `${SHA}\n`);
    expect(await readDeployedRev()).toBe(SHA);
  });

  it('builds an argv array with no shell metacharacter surface', async () => {
    let seen: string[] = [];
    __setDeployedRevRunnerForTesting(async (argv) => {
      seen = argv;
      return SHA;
    });
    await readDeployedRev();

    expect(seen[0]).toBe('ssh');
    // Every argument is a separate array element: nothing is ever concatenated
    // into a string an interpreter could re-split.
    expect(seen).toContain('root@192.168.88.2');
    expect(seen).toContain('BatchMode=yes');
    expect(seen).toContain('docker');
    expect(seen).toContain('RepOS');
    expect(seen.some((a) => a.includes('APP_SHA'))).toBe(true);
    for (const arg of seen) expect(arg).not.toMatch(/[;&|`$(){}<>]/);
  });

  it('rejects a malformed SHA rather than returning it', async () => {
    for (const bad of ['', 'unknown', 'C'.repeat(40), 'abc123', `${SHA} ${SHA}`]) {
      __setDeployedRevRunnerForTesting(async () => bad);
      await expect(readDeployedRev()).rejects.toMatchObject({ code: 'malformed' });
    }
  });

  it('surfaces an unreachable host as unreadable, never as a SHA', async () => {
    __setDeployedRevRunnerForTesting(async () => {
      throw new Error('ssh: connect to host 192.168.88.2 port 22: No route to host');
    });
    await expect(readDeployedRev()).rejects.toMatchObject({ code: 'unreadable' });
  });

  it('refuses when the host is not configured', async () => {
    delete process.env.UNRAID_SSH_HOST;
    __setDeployedRevRunnerForTesting(async () => SHA);
    await expect(readDeployedRev()).rejects.toMatchObject({ code: 'not_configured' });
  });
});
