import { useEffect, useState, useCallback } from 'react';
import { TOKENS, FONTS } from '../tokens';
import { apiFetch } from '../auth';
import Icon from './Icon';
import type { SyncStatusResponse, WeightRangeResponse } from '../lib/api/health';
import { Button, StatusBadge } from './ui';

// Local aliases for readability
type SyncStatus = SyncStatusResponse;
type WeightData = Pick<WeightRangeResponse, 'current' | 'stats'>;

export default function MobileWeightChip() {
  const [sync, setSync] = useState<SyncStatus | null>(null);
  const [weight, setWeight] = useState<WeightData | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const [syncRes, weightRes] = await Promise.all([
        apiFetch('/api/health/sync/status'),
        apiFetch('/api/health/weight?range=7d'),
      ]);
      if (!syncRes.ok || !weightRes.ok) throw new Error('health data unavailable');
      const s: SyncStatus = await syncRes.json();
      const w: WeightData = await weightRes.json();
      setSync(s);
      setWeight(w);
      setLoadError(false);
    } catch {
      setLoadError(true);
    }
  }, []);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const stateColor = sync
    ? sync.state === 'fresh'
      ? TOKENS.good
      : sync.state === 'stale'
        ? TOKENS.warn
        : TOKENS.danger
    : TOKENS.textMute;

  const formatTime = (isoString: string | null) => {
    if (!isoString) return '';
    const d = new Date(isoString);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const trend = weight?.stats?.trend_7d_lbs ?? null;

  async function saveManualWeight(event: React.FormEvent) {
    event.preventDefault();
    const value = Number(draft);
    if (!Number.isFinite(value) || value < 50 || value > 600) {
      setError('Enter a weight from 50.0 to 600.0 lb.');
      return;
    }
    const now = new Date();
    const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
      now.getDate(),
    ).padStart(2, '0')}`;
    const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(
      2,
      '0',
    )}:${String(now.getSeconds()).padStart(2, '0')}`;
    setSaving(true);
    setError(null);
    try {
      const response = await apiFetch('/api/health/weight', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ weight_lbs: value, date, time, source: 'Manual' }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? 'The measurement was not accepted.');
      }
      await fetchData();
      setDraft('');
      setEditing(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Weight could not be saved. Try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="repos-card"
      style={{
        width: '100%',
        display: 'grid',
        gap: 12,
        padding: 14,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span
          aria-hidden="true"
          style={{
            width: 36,
            height: 36,
            display: 'grid',
            placeItems: 'center',
            borderRadius: 9,
            background: TOKENS.accentGlow,
          }}
        >
          <Icon name="heart" size={16} color={TOKENS.accent} />
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ color: TOKENS.textDim, fontSize: 12 }}>Current bodyweight</div>
          <div
            style={{
              marginTop: 2,
              fontFamily: FONTS.mono,
              fontSize: 20,
              fontWeight: 700,
              color: TOKENS.text,
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {weight?.current?.weight_lbs.toFixed(1) ?? '—'}{' '}
            <span style={{ color: TOKENS.textMute, fontSize: 10 }}>lb</span>
          </div>
        </div>
        <StatusBadge
          tone={
            !sync
              ? 'neutral'
              : sync.state === 'fresh'
                ? 'good'
                : sync.state === 'stale'
                  ? 'warning'
                  : 'danger'
          }
        >
          {sync?.state ?? 'unknown'}
        </StatusBadge>
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 10,
          color: TOKENS.textDim,
          fontFamily: FONTS.mono,
          fontSize: 10,
        }}
      >
        <span>
          {trend === null
            ? '7-day trend unavailable'
            : `${trend < 0 ? '↓' : '↑'} ${Math.abs(trend).toFixed(1)} lb · 7 days`}
        </span>
        <span style={{ color: stateColor }}>
          {sync?.last_success_at ? `Updated ${formatTime(sync.last_success_at)}` : 'Not synced'}
        </span>
      </div>

      {loadError ? (
        <div
          role="status"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 10,
            color: TOKENS.warn,
            fontSize: 12,
          }}
        >
          <span>Bodyweight data is unavailable.</span>
          <Button variant="warning" onClick={() => void fetchData()}>
            Retry
          </Button>
        </div>
      ) : null}

      {editing ? (
        <form
          noValidate
          onSubmit={(event) => void saveManualWeight(event)}
          style={{ display: 'grid', gap: 10 }}
        >
          <label className="repos-field">
            Today's weight in pounds
            <input
              autoFocus
              inputMode="decimal"
              type="number"
              min="50"
              max="600"
              step="0.1"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
            />
          </label>
          {error ? (
            <div role="alert" style={{ color: TOKENS.danger, fontSize: 12 }}>
              {error}
            </div>
          ) : null}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <Button type="button" variant="quiet" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={saving}>
              {saving ? 'Saving…' : 'Save weight'}
            </Button>
          </div>
        </form>
      ) : (
        <Button variant="secondary" onClick={() => setEditing(true)}>
          Add manual measurement
        </Button>
      )}
    </div>
  );
}
