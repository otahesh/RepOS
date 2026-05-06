import { describe, it, expect, beforeEach, vi } from 'vitest';
import { listProgramTemplates, getProgramTemplate, forkProgramTemplate } from './programs';

describe('programs API client', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });
  it('GET /api/program-templates returns rows', async () => {
    (fetch as any).mockResolvedValueOnce({
      ok: true, json: async () => ([{ slug: 'full-body-3-day', name: 'Full Body 3-Day', weeks: 5 }]),
    });
    const rows = await listProgramTemplates();
    expect(rows[0].slug).toBe('full-body-3-day');
    expect(fetch).toHaveBeenCalledWith('/api/program-templates', expect.any(Object));
  });
  it('GET /api/program-templates/:slug returns detail', async () => {
    (fetch as any).mockResolvedValueOnce({
      ok: true, json: async () => ({ slug: 'full-body-3-day', structure: { _v: 1, days: [] } }),
    });
    const t = await getProgramTemplate('full-body-3-day');
    expect(t.structure?._v).toBe(1);
  });
  it('POST /api/program-templates/:slug/fork returns user_program', async () => {
    (fetch as any).mockResolvedValueOnce({
      ok: true, json: async () => ({ id: 'up-1', status: 'draft' }),
    });
    const up = await forkProgramTemplate('full-body-3-day', { name: 'My FB' });
    expect(up.status).toBe('draft');
    expect(fetch).toHaveBeenCalledWith(
      '/api/program-templates/full-body-3-day/fork',
      expect.objectContaining({ method: 'POST' })
    );
  });
  it('throws on non-OK', async () => {
    (fetch as any).mockResolvedValueOnce({ ok: false, status: 409, text: async () => 'conflict' });
    await expect(forkProgramTemplate('full-body-3-day', { name: 'x' })).rejects.toThrow(/409/);
  });
});
