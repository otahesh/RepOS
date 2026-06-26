// frontend/src/lib/api/backups.ts
//
// W5 — typed client for /api/backups/* + /api/maintenance/*. Mirrors
// api/src/schemas/backups.ts and api/src/routes/maintenance.ts.
import { apiFetch } from '../../auth';
import { ApiError, jsonOrThrow } from './_http';

export interface BackupItem {
  id: string;
  trigger: 'manual' | 'auto' | 'pre_restore' | 'restore';
  size_bytes: number;
  verified_restorable: 'good' | 'warn' | 'danger';
  created_at: string;
}
export interface BackupListResponse {
  items: BackupItem[];
}
export interface MaintenanceStatus {
  active: boolean;
  restore: {
    status: 'running' | 'ok' | 'failed';
    error_message?: string | null;
    file_path?: string;
  } | null;
  recovery_available: boolean;
}

export async function listBackups(): Promise<BackupListResponse> {
  return jsonOrThrow<BackupListResponse>(await apiFetch('/api/backups'));
}
export async function createBackup(): Promise<BackupItem> {
  return jsonOrThrow<BackupItem>(await apiFetch('/api/backups', { method: 'POST' }));
}
export async function deleteBackup(id: string): Promise<void> {
  const res = await apiFetch(`/api/backups/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (!res.ok) throw new ApiError(res.status, undefined, await res.text());
}
export async function restoreBackup(id: string): Promise<void> {
  const res = await apiFetch(`/api/backups/${encodeURIComponent(id)}/restore`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ confirm: 'RESTORE' }),
  });
  if (!res.ok) throw new ApiError(res.status, undefined, await res.text());
}
export async function getMaintenanceStatus(): Promise<MaintenanceStatus> {
  return jsonOrThrow<MaintenanceStatus>(await apiFetch('/api/maintenance/status'));
}
export async function restorePreSnapshot(): Promise<void> {
  const res = await apiFetch('/api/maintenance/restore-pre-snapshot', { method: 'POST' });
  if (!res.ok) throw new ApiError(res.status, undefined, await res.text());
}
