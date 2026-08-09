import 'dotenv/config';
import { describe, it, expect, afterAll } from 'vitest';
import { db } from '../../src/db/client.js';

afterAll(async () => {
  await db.end();
});

describe('backup_runs schema (migration 050+051)', () => {
  it('has the expected columns + types', async () => {
    const { rows } = await db.query(
      `SELECT column_name, data_type, is_nullable
       FROM information_schema.columns
       WHERE table_name = 'backup_runs'
       ORDER BY ordinal_position`,
    );
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ column_name: 'id', data_type: 'bigint', is_nullable: 'NO' }),
        expect.objectContaining({ column_name: 'trigger', data_type: 'text', is_nullable: 'NO' }),
        expect.objectContaining({
          column_name: 'event_kind',
          data_type: 'text',
          is_nullable: 'NO',
        }), // C-DOWNLOAD-AUDIT
        expect.objectContaining({ column_name: 'status', data_type: 'text', is_nullable: 'NO' }),
        expect.objectContaining({ column_name: 'file_path', data_type: 'text' }),
        expect.objectContaining({ column_name: 'size_bytes', data_type: 'bigint' }),
        expect.objectContaining({ column_name: 'integrity_verified', data_type: 'boolean' }),
        expect.objectContaining({ column_name: 'error_message', data_type: 'text' }),
        expect.objectContaining({ column_name: 'admin_user_id', data_type: 'uuid' }), // C-ADMIN-USER-ID
        expect.objectContaining({ column_name: 'source_ip', data_type: 'text' }), // C-DOWNLOAD-AUDIT
        expect.objectContaining({
          column_name: 'started_at',
          data_type: 'timestamp with time zone',
          is_nullable: 'NO',
        }),
        expect.objectContaining({
          column_name: 'finished_at',
          data_type: 'timestamp with time zone',
        }),
      ]),
    );
  });

  it('rejects unknown trigger values via CHECK constraint', async () => {
    await expect(
      db.query(
        `INSERT INTO backup_runs (trigger, status, started_at) VALUES ('garbage', 'running', now())`,
      ),
    ).rejects.toThrow(/backup_runs_trigger_check/);
  });

  it('rejects unknown status values via CHECK constraint', async () => {
    await expect(
      db.query(
        `INSERT INTO backup_runs (trigger, status, started_at) VALUES ('manual', 'garbage', now())`,
      ),
    ).rejects.toThrow(/backup_runs_status_check/);
  });

  it('rejects unknown event_kind values via CHECK constraint', async () => {
    await expect(
      db.query(
        `INSERT INTO backup_runs (trigger, event_kind, status, started_at) VALUES ('manual', 'garbage', 'ok', now())`,
      ),
    ).rejects.toThrow(/backup_runs_event_kind_check/);
  });

  it('admin_user_id has FK to users(id)', async () => {
    const { rows } = await db.query(
      `SELECT constraint_name FROM information_schema.table_constraints
       WHERE table_name='backup_runs' AND constraint_type='FOREIGN KEY'`,
    );
    expect(rows.map((r: { constraint_name: string }) => r.constraint_name)).toEqual(
      expect.arrayContaining([expect.stringMatching(/admin_user/i)]),
    );
  });
});
