export type RecoveryFlag = {
  flag: 'bodyweight_crash' | 'overreaching' | 'stalled_pr';
  message: string;
  scheduled_date: string;
  week_idx?: number;
  dismissable: boolean;
};

async function jsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) { const body = await res.text(); throw new Error(`HTTP ${res.status}: ${body || res.statusText}`); }
  return res.json();
}

export async function listRecoveryFlags(): Promise<RecoveryFlag[]> {
  const res = await fetch('/api/recovery-flags', { credentials: 'same-origin' });
  return jsonOrThrow(res);
}

export async function dismissRecoveryFlag(flag: RecoveryFlag['flag']): Promise<{ ok: boolean }> {
  const res = await fetch('/api/recovery-flags/dismiss', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin', body: JSON.stringify({ flag }),
  });
  return jsonOrThrow(res);
}
