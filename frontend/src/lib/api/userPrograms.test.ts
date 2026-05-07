import { describe, it, expect, beforeEach, vi } from 'vitest';
import { listMyPrograms, getUserProgram, patchUserProgram, startUserProgram } from './userPrograms';

describe('userPrograms API client', () => {
  beforeEach(() => { globalThis.fetch = vi.fn(); });

  it('lists mine — unwraps { programs: [...] } envelope', async () => {
    (fetch as any).mockResolvedValueOnce({ ok: true, json: async () => ({ programs: [{ id: 'up-1', status: 'draft' }] }) });
    const rows = await listMyPrograms();
    expect(rows.length).toBe(1);
    expect(rows[0].id).toBe('up-1');
  });

  it('listMyPrograms with includePast=true appends ?include=past', async () => {
    (fetch as any).mockResolvedValueOnce({ ok: true, json: async () => ({ programs: [{ id: 'up-2', status: 'abandoned' }] }) });
    const rows = await listMyPrograms({ includePast: true });
    expect(rows.length).toBe(1);
    expect(rows[0].status).toBe('abandoned');
    const calledUrl = (fetch as any).mock.calls[0][0] as string;
    expect(calledUrl).toContain('include=past');
  });
  it('GET detail returns effective_structure with customizations resolved', async () => {
    (fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: 'up-1',
        name: 'My Program',
        effective_name: 'My Program',
        effective_structure: { _v: 1, days: [] },
        customizations: {},
      }),
    });
    const r = await getUserProgram('up-1');
    expect(r.effective_structure._v).toBe(1);
  });
  it('PATCH applies customizations', async () => {
    (fetch as any).mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'up-1', customizations: { renamed: true } }) });
    const out = await patchUserProgram('up-1', { op: 'rename', name: 'New Name' });
    expect(out.customizations).toEqual({ renamed: true });
  });
  it('start materializes', async () => {
    (fetch as any).mockResolvedValueOnce({ ok: true, json: async () => ({ mesocycle_run_id: 'mr-1' }) });
    const r = await startUserProgram('up-1', { start_date: '2026-05-05', start_tz: 'America/Indiana/Indianapolis' });
    expect(r.mesocycle_run_id).toBe('mr-1');
  });
  it('start surfaces template_outdated 409 with must_refork payload', async () => {
    (fetch as any).mockResolvedValueOnce({
      ok: false, status: 409, text: async () => JSON.stringify({ error: 'template_outdated', latest_version: 3, must_refork: true }),
    });
    await expect(startUserProgram('up-1', { start_date: '2026-05-05', start_tz: 'America/Indiana/Indianapolis' })).rejects.toThrow(/template_outdated|409/);
  });
});
