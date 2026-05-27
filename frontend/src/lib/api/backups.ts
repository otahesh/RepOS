// frontend/src/lib/api/backups.ts
//
// W5 — typed client for /api/backups/* + /api/maintenance/*. Mirrors
// api/src/schemas/backups.ts and api/src/routes/maintenance.ts.
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
  const res = await fetch('/api/backups', { credentials: 'include' });
  if (!res.ok) throw new Error(`listBackups ${res.status}`);
  return res.json();
}
export async function createBackup(): Promise<BackupItem> {
  const res = await fetch('/api/backups', { method: 'POST', credentials: 'include' });
  if (!res.ok) throw new Error(`createBackup ${res.status}`);
  return res.json();
}
export async function deleteBackup(id: string): Promise<void> {
  const res = await fetch(`/api/backups/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    credentials: 'include',
  });
  if (!res.ok && res.status !== 204) throw new Error(`deleteBackup ${res.status}`);
}
export async function restoreBackup(id: string): Promise<void> {
  const res = await fetch(`/api/backups/${encodeURIComponent(id)}/restore`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ confirm: 'RESTORE' }),
  });
  if (!res.ok && res.status !== 202) throw new Error(`restoreBackup ${res.status}`);
}
export async function getMaintenanceStatus(): Promise<MaintenanceStatus> {
  const res = await fetch('/api/maintenance/status', { credentials: 'include' });
  if (!res.ok) throw new Error(`getMaintenanceStatus ${res.status}`);
  return res.json();
}
export async function restorePreSnapshot(): Promise<void> {
  const res = await fetch('/api/maintenance/restore-pre-snapshot', {
    method: 'POST',
    credentials: 'include',
  });
  if (!res.ok && res.status !== 202) throw new Error(`restorePreSnapshot ${res.status}`);
}
