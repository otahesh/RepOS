// Q23 — audit rows carry both actor and target. user_id is ALWAYS the target
// (so the event lands in that user's AccountEventsTimeline); the actor lives
// in meta under a discriminated shape. Round 7 unified three competing
// formats into these two.
import { describe, it, expect } from 'vitest';
import { humanActor, systemActor } from '../../src/services/accountEvents.js';

describe('event actor shapes (Q23)', () => {
  it('human actor carries kind, id and email — and nothing else', () => {
    const a = humanActor('11111111-1111-1111-1111-111111111111', 'admin@repos.test');
    expect(a).toEqual({
      actor_kind: 'user',
      actor_user_id: '11111111-1111-1111-1111-111111111111',
      actor_email: 'admin@repos.test',
    });
  });

  it('system actor carries kind, name and the run source', () => {
    expect(systemActor('cf_reconciliation', 'restore')).toEqual({
      actor_kind: 'system',
      actor_name: 'cf_reconciliation',
      source: 'restore',
    });
  });

  it('the two shapes never mix — a system actor has no actor_user_id', () => {
    const s = systemActor('cf_reconciliation', 'cutover') as Record<string, unknown>;
    expect(s.actor_user_id).toBeUndefined();
    expect(s.actor_email).toBeUndefined();
    const h = humanActor('x', 'y@z.test') as Record<string, unknown>;
    expect(h.actor_name).toBeUndefined();
    expect(h.source).toBeUndefined();
  });
});
