import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import * as processes from 'node:child_process';
import { runGit, GIT_HARDENING } from '../../src/reposGit/git.js';

vi.mock('node:child_process', () => ({ spawn: vi.fn() }));

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllEnvs();
});
function fakeChild() {
  const child = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: vi.fn(() => {
      queueMicrotask(() => child.emit('close', null));
      return true;
    }),
  });
  const spy = vi
    .mocked(processes.spawn)
    .mockReturnValue(child as unknown as processes.ChildProcessWithoutNullStreams);
  return { child, spy };
}

describe('bounded Git subprocess runner', () => {
  it('hardens every invocation and excludes ambient config and unrelated credentials', async () => {
    vi.stubEnv('GIT_CONFIG_COUNT', '1');
    vi.stubEnv('GIT_TRACE', '/tmp/ambient-trace');
    vi.stubEnv('DATABASE_URL', 'private');
    vi.stubEnv('RESEND_API_KEY', 'private');
    const { child, spy } = fakeChild();
    const result = runGit('/trusted', ['rev-parse', 'HEAD']);
    child.stdout.write('a'.repeat(40));
    child.emit('close', 0);
    expect(await result).toEqual({ code: 0, stdout: 'a'.repeat(40) });
    expect(spy.mock.calls[0][1]).toEqual([...GIT_HARDENING, 'rev-parse', 'HEAD']);
    const options = spy.mock.calls[0][2];
    expect(options).not.toHaveProperty('shell');
    expect(options?.env).toMatchObject({
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_NO_REPLACE_OBJECTS: '1',
    });
    for (const key of ['GIT_CONFIG_COUNT', 'GIT_TRACE', 'DATABASE_URL', 'RESEND_API_KEY'])
      expect(options?.env).not.toHaveProperty(key);
  });

  it('kills a hung process at the finite deadline', async () => {
    vi.useFakeTimers();
    const { child } = fakeChild();
    const result = runGit('/trusted', ['fetch', 'origin']);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
    expect((await result).code).toBe(1);
  });

  it.each(['stdout', 'stderr'] as const)(
    'kills excess %s output without disclosing stderr',
    async (stream) => {
      const { child } = fakeChild();
      const result = runGit('/trusted', ['fetch', 'origin']);
      child[stream].write(Buffer.alloc(2 * 1024 * 1024 + 1, 'x'));
      expect((await result).code).toBe(1);
      expect(child.kill).toHaveBeenCalledWith('SIGKILL');
    },
  );

  it('handles stdin EPIPE as a controlled failure instead of an uncaught event', async () => {
    const { child } = fakeChild();
    const result = runGit('/trusted', ['apply', '--cached', '-'], { input: 'diff' });
    child.stdin.emit('error', Object.assign(new Error('secret'), { code: 'EPIPE' }));
    expect(await result).toEqual({ code: 1, stdout: '' });
  });

  it('sanitizes process start failures', async () => {
    const { child } = fakeChild();
    const result = runGit('/trusted', ['status']);
    child.emit('error', new Error('credential contents'));
    await expect(result).rejects.toThrow('git could not start');
  });
});
