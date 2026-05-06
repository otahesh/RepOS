import { useState } from 'react';
import { substitutePlannedSet } from '../../lib/api/plannedSets';

export function MidSessionSwapSheet({
  plannedSetId,
  fromName,
  toSlug,
  toName,
  onClose,
}: {
  plannedSetId: string;
  fromName: string;
  toSlug: string;
  toName: string;
  onClose: (changed: boolean) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function confirm() {
    setBusy(true);
    try {
      await substitutePlannedSet(plannedSetId, { to_exercise_slug: toSlug });
      onClose(true);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <div role="dialog" aria-modal="true" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'flex-end', zIndex: 100 }}>
      <div style={{ background: '#10141C', borderRadius: '16px 16px 0 0', padding: 24, width: '100%', maxWidth: 480, margin: '0 auto', color: '#fff', fontFamily: 'Inter Tight' }}>
        <h3 style={{ marginTop: 0, fontSize: 16 }}>Swap exercise?</h3>
        <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.7)' }}>{fromName}{' → '}<strong>{toName}</strong></p>
        {err ? <div style={{ color: '#FF6A6A', fontSize: 13, marginBottom: 12 }}>{err}</div> : null}
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => onClose(false)} style={btnSecondary}>Cancel</button>
          <button onClick={confirm} disabled={busy} style={btnPrimary}>{busy ? 'Swapping…' : 'Confirm Swap'}</button>
        </div>
      </div>
    </div>
  );
}

const btnSecondary: React.CSSProperties = {
  flex: 1, padding: '12px', background: 'transparent', border: '1px solid rgba(255,255,255,0.2)',
  borderRadius: 6, color: '#fff', fontFamily: 'Inter Tight', cursor: 'pointer',
};
const btnPrimary: React.CSSProperties = {
  flex: 1, padding: '12px', background: '#4D8DFF', border: 'none',
  borderRadius: 6, color: '#fff', fontFamily: 'Inter Tight', fontWeight: 600, letterSpacing: 1, textTransform: 'uppercase', cursor: 'pointer',
};
