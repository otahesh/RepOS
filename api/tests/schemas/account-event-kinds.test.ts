// Regression guard for the W9 wire-schema gap.
//
// `GET /api/account/events` runs every row through
// AccountEventListResponseSchema.parse() (routes/account.ts). `.parse` THROWS,
// so a kind the zod enum does not know is not a soft degradation — it is a 500
// on that user's account-events page. When W9 extended the service-side union
// without extending the enum, the first `user_invited` row would have done
// exactly that.
import { describe, it, expect } from 'vitest';
import {
  AccountEventItemSchema,
  AccountEventListResponseSchema,
} from '../../src/schemas/account.js';
import { ACCOUNT_EVENT_KINDS } from '../../src/constants/accountEvents.js';

function row(kind: string) {
  return {
    id: '1',
    kind,
    ip: null,
    user_email_at_event: 'someone@repos.test',
    meta: {},
    occurred_at: '2026-07-27T00:00:00Z',
  };
}

describe('account-event wire schema accepts every canonical kind', () => {
  it.each(ACCOUNT_EVENT_KINDS)('accepts %s', (kind) => {
    expect(AccountEventItemSchema.safeParse(row(kind)).success).toBe(true);
  });

  it('covers all eight W9 lifecycle kinds specifically', () => {
    for (const kind of [
      'user_invited',
      'user_activated',
      'user_suspended',
      'user_reinstated',
      'role_changed',
      'user_delete_requested',
      'user_deleted',
      'user_imported',
    ]) {
      expect(ACCOUNT_EVENT_KINDS).toContain(kind);
    }
  });

  it('does not throw when the LIST response carries a lifecycle row', () => {
    // The actual 500 path: .parse, not .safeParse.
    expect(() =>
      AccountEventListResponseSchema.parse({
        events: [row('user_invited'), row('role_changed')],
        next_cursor: null,
      }),
    ).not.toThrow();
  });

  it('still rejects an unknown kind — the enum stays defensive', () => {
    expect(AccountEventItemSchema.safeParse(row('not_a_real_kind')).success).toBe(false);
  });
});
