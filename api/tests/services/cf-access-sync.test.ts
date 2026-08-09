// Q36 — reconcile TO the row's status. Never blindly re-add.
import { describe, it, expect, beforeEach, afterEach, vi, type MockInstance } from 'vitest';
import * as policy from '../../src/services/cfAccessPolicy.js';
import { desiredPresence, syncEmail, syncEmailToStatus } from '../../src/services/cfAccessSync.js';

function snap(emails: string[]) {
  // `config` mirrors what fetchPolicy would have observed. Task 5's snapshot
  // carries the WHOLE writable policy; there are no top-level exclude/require.
  return {
    emails,
    name: 'Owner Only',
    decision: 'allow',
    config: {
      name: 'Owner Only',
      decision: 'allow',
      include: emails.map((e) => ({ email: { email: e } })),
      exclude: [],
      require: [],
    },
  };
}

let fetchSpy: MockInstance<typeof policy.fetchPolicy>;
let putSpy: MockInstance<typeof policy.putPolicyEmails>;

beforeEach(() => {
  // Belt and braces. These tests assert on spies attached to the module
  // namespace; if that interop ever stops taking effect, the REAL client would
  // run — and its PUT would land on the live `Owner Only` policy. Today the
  // local `.env` carries no CF_* vars so it would fail closed on
  // cf_not_configured, but that is an accident of configuration, not a
  // guarantee. Deny the network outright instead of relying on it.
  policy.__setFetchForTesting((() => {
    throw new Error('cf-access-sync tests must never issue a real HTTP request');
  }) as unknown as typeof fetch);
  fetchSpy = vi.spyOn(policy, 'fetchPolicy');
  putSpy = vi.spyOn(policy, 'putPolicyEmails').mockResolvedValue(undefined);
});
afterEach(() => {
  policy.__setFetchForTesting(null);
  vi.restoreAllMocks();
});

describe('desiredPresence', () => {
  it('grants for invited and active; revokes for suspended and deleting', () => {
    expect(desiredPresence('invited')).toBe('present');
    expect(desiredPresence('active')).toBe('present');
    expect(desiredPresence('suspended')).toBe('absent');
    expect(desiredPresence('deleting')).toBe('absent');
  });
});

describe('syncEmail', () => {
  it('adds a missing email, preserving the existing entries', async () => {
    fetchSpy.mockResolvedValue(snap(['a@repos.test']));
    const r = await syncEmail('New@Repos.test', 'present');
    expect(r.changed).toBe(true);
    expect(putSpy).toHaveBeenCalledWith(['a@repos.test', 'new@repos.test'], expect.anything());
  });

  it('is a no-op when the email is already present — no PUT at all', async () => {
    fetchSpy.mockResolvedValue(snap(['a@repos.test', 'b@repos.test']));
    const r = await syncEmail('b@repos.test', 'present');
    expect(r.changed).toBe(false);
    expect(putSpy).not.toHaveBeenCalled();
  });

  it('removes a present email', async () => {
    fetchSpy.mockResolvedValue(snap(['a@repos.test', 'b@repos.test']));
    const r = await syncEmail('a@repos.test', 'absent');
    expect(r.changed).toBe(true);
    expect(putSpy).toHaveBeenCalledWith(['b@repos.test'], expect.anything());
  });

  it('is a no-op when the email is already absent', async () => {
    fetchSpy.mockResolvedValue(snap(['a@repos.test']));
    const r = await syncEmail('gone@repos.test', 'absent');
    expect(r.changed).toBe(false);
    expect(putSpy).not.toHaveBeenCalled();
  });

  it('propagates a policy refusal untouched so it can surface as drift', async () => {
    fetchSpy.mockRejectedValue(new policy.CfPolicyError('app_count_not_one', 'nope'));
    await expect(syncEmail('x@repos.test', 'present')).rejects.toMatchObject({
      code: 'app_count_not_one',
    });
  });

  it('propagates a WRITE-side refusal too — the Q19 abort must not be swallowed', async () => {
    // The read succeeds and a change is genuinely needed, so the PUT is
    // attempted and it is putPolicyEmails' own compare-before-write that
    // aborts. Callers translate this into "sync pending"/drift; a syncEmail
    // that caught it and reported { changed: true } would report success for a
    // membership change Cloudflare never accepted.
    fetchSpy.mockResolvedValue(snap(['a@repos.test']));
    putSpy.mockRejectedValue(new policy.CfPolicyError('policy_changed', 'dashboard edit'));
    await expect(syncEmail('b@repos.test', 'present')).rejects.toMatchObject({
      code: 'policy_changed',
    });
  });
});

describe('syncEmailToStatus (Q36)', () => {
  it('REMOVES the email for a suspended row — never re-adds it', async () => {
    fetchSpy.mockResolvedValue(snap(['sus@repos.test', 'other@repos.test']));
    await syncEmailToStatus('sus@repos.test', 'suspended');
    expect(putSpy).toHaveBeenCalledWith(['other@repos.test'], expect.anything());
  });

  it('REMOVES the email for a deleting row', async () => {
    fetchSpy.mockResolvedValue(snap(['del@repos.test']));
    await syncEmailToStatus('del@repos.test', 'deleting');
    expect(putSpy).toHaveBeenCalledWith([], expect.anything());
  });

  it('ADDS the email for an invited row whose provisioning failed', async () => {
    fetchSpy.mockResolvedValue(snap([]));
    await syncEmailToStatus('inv@repos.test', 'invited');
    expect(putSpy).toHaveBeenCalledWith(['inv@repos.test'], expect.anything());
  });
});
