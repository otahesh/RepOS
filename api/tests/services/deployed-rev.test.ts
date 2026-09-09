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
  it('returns the SHA when container is running', async () => {
    __setDeployedRevRunnerForTesting(async () => `true\nAPP_SHA=${SHA}\n`);
    expect(await readDeployedRev()).toBe(SHA);
  });

  it('rejects when container is not running', async () => {
    __setDeployedRevRunnerForTesting(async () => `false\nAPP_SHA=${SHA}\n`);
    await expect(readDeployedRev()).rejects.toMatchObject({ code: 'unreadable' });
  });

  it('builds an argv array for docker inspect', async () => {
    let seen: string[] = [];
    __setDeployedRevRunnerForTesting(async (argv) => {
      seen = argv;
      return `true\nAPP_SHA=${SHA}\n`;
    });
    await readDeployedRev();

    expect(seen[0]).toBe('ssh');
    // Every argument is a separate array element: nothing is ever concatenated
    // into a string an interpreter could re-split.
    expect(seen).toContain('root@192.168.88.2');
    expect(seen).toContain('BatchMode=yes');
    expect(seen).toContain('docker');
    expect(seen).toContain('inspect');
    expect(seen).toContain('--format');
    expect(seen).toContain('RepOS');
    expect(seen).not.toContain('exec');
    // Format argument must include .State.Running and .Config.Env
    const formatArg = seen.find((a) => a.includes('.State.Running'));
    expect(formatArg).toBeDefined();
    expect(formatArg).toContain('.Config.Env');
    // Metacharacter check applies to host/user/container args, not format string
    const hostUserContainerArgs = [
      seen.find((a) => a.includes('@')),
      seen.find((a) => a === 'RepOS'),
    ];
    for (const arg of hostUserContainerArgs) {
      if (arg) expect(arg).not.toMatch(/[;&|`$(){}<>]/);
    }
  });

  it('rejects a malformed SHA rather than returning it', async () => {
    for (const bad of ['', 'unknown', 'C'.repeat(40), 'abc123', `${SHA} ${SHA}`]) {
      __setDeployedRevRunnerForTesting(async () => `true\nAPP_SHA=${bad}\n`);
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
    __setDeployedRevRunnerForTesting(async () => `true\nAPP_SHA=${SHA}\n`);
    await expect(readDeployedRev()).rejects.toMatchObject({ code: 'not_configured' });
  });
});
