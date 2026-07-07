import { describe, it, expect, vi, afterEach } from 'vitest';
import { getExerciseGuide } from './exerciseGuide';

const GUIDE = {
  slug: 'incline-dumbbell-bench-press',
  setup_callout: 'Bench: 30°.',
  setup_facts: { bench_angle_deg: 30 },
  cues: ['a', 'b', 'c'],
  donts: ['x', 'y'],
  media: {},
};

afterEach(() => vi.restoreAllMocks());

function mockFetch(status: number, body: unknown) {
  return vi
    .spyOn(globalThis, 'fetch')
    .mockResolvedValue(new Response(JSON.stringify(body), { status }));
}

describe('getExerciseGuide', () => {
  it('fetches the guide from the guide endpoint', async () => {
    const spy = mockFetch(200, GUIDE);
    const guide = await getExerciseGuide('incline-dumbbell-bench-press');
    expect(guide).toEqual(GUIDE);
    const url = String(spy.mock.calls[0][0]);
    expect(url).toContain('/api/exercises/incline-dumbbell-bench-press/guide');
  });

  it('returns null on 404 (no guide → UI hides the button)', async () => {
    mockFetch(404, { error: 'guide not found' });
    await expect(getExerciseGuide('no-guide')).resolves.toBeNull();
  });

  it('throws on non-404 errors', async () => {
    mockFetch(500, { error: 'boom' });
    await expect(getExerciseGuide('x')).rejects.toThrow();
  });

  it('URL-encodes the slug', async () => {
    const spy = mockFetch(200, GUIDE);
    await getExerciseGuide('a b');
    expect(String(spy.mock.calls[0][0])).toContain('/api/exercises/a%20b/guide');
  });
});
