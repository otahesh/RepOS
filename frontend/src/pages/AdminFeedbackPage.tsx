// frontend/src/pages/AdminFeedbackPage.tsx
// Beta W7 — minimal admin triage list. The route is reachable but the API
// admin-gates it; a non-admin sees "Not authorized".
import { useEffect, useState } from 'react';
import { TOKENS, FONTS } from '../tokens';
import { listAdminFeedback, triageFeedback, type AdminFeedbackItem } from '../lib/api/feedback';
import { pushToast } from '../components/common/ToastHost';

export default function AdminFeedbackPage() {
  const [items, setItems] = useState<AdminFeedbackItem[] | null>(null);
  const [denied, setDenied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function load(): void {
    setError(null);
    setItems(null);
    listAdminFeedback()
      .then((r) => setItems(r.items))
      .catch((err: { status?: number }) => {
        if (err?.status === 403 || err?.status === 401) setDenied(true);
        // Anything else (5xx, network, parse) must surface an actionable,
        // retryable error — never a spinner that never resolves.
        else setError(`Could not load feedback — GET /api/admin/feedback${err?.status ? ` returned HTTP ${err.status}` : ' failed (network)'}.`);
      });
  }

  useEffect(() => { load(); }, []);

  async function handleTriage(id: string): Promise<void> {
    try {
      const updated = await triageFeedback(id);
      setItems((prev) => prev?.map((i) => (i.id === id ? updated : i)) ?? null);
    } catch (err) {
      const status = (err as { status?: number })?.status;
      pushToast({ severity: 'error', body: `Triage failed${status ? ` — HTTP ${status}` : ''}. Try again.` });
    }
  }

  if (denied) {
    return <div style={{ padding: 32, color: TOKENS.danger, fontFamily: FONTS.mono }}>Not authorized.</div>;
  }

  return (
    <div style={{ maxWidth: 760, margin: '0 auto', padding: '24px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
      <h1 style={{ margin: 0, fontSize: 20, fontFamily: FONTS.ui, color: TOKENS.text }}>Feedback triage</h1>
      {error && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 10, color: TOKENS.danger, fontFamily: FONTS.mono, fontSize: 12 }}>
          <span>{error}</span>
          <button type="button" onClick={load}
            style={{ padding: '6px 12px', borderRadius: 6, border: `1px solid ${TOKENS.line}`, background: TOKENS.bg, color: TOKENS.text, fontFamily: FONTS.ui, fontSize: 12, cursor: 'pointer' }}>Retry</button>
        </div>
      )}
      {!error && items === null && <div style={{ color: TOKENS.textMute, fontFamily: FONTS.mono, fontSize: 12 }}>Loading…</div>}
      {items?.length === 0 && <div style={{ color: TOKENS.textMute }}>No feedback yet.</div>}
      {items?.map((i) => (
        <div key={i.id} style={{
          background: TOKENS.surface, border: `1px solid ${TOKENS.line}`, borderRadius: 10, padding: 14,
          opacity: i.triaged_at ? 0.55 : 1, display: 'flex', flexDirection: 'column', gap: 8,
        }}>
          <div style={{ fontSize: 14, color: TOKENS.text, whiteSpace: 'pre-wrap' }}>{i.body}</div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', fontFamily: FONTS.mono, fontSize: 11, color: TOKENS.textMute }}>
            <span>{i.user_email_at_submit ?? 'unknown'}</span>
            <span>{i.route ?? '—'}</span>
            <span>{i.app_sha ?? 'dev'}</span>
            <span style={{ color: i.webhook_delivered_at ? TOKENS.good : TOKENS.warn }}>
              {i.webhook_delivered_at ? 'delivered' : 'not delivered'}
            </span>
            <span>{i.created_at}</span>
          </div>
          {!i.triaged_at && (
            <button type="button" onClick={() => void handleTriage(i.id)}
              style={{
                alignSelf: 'flex-start', padding: '6px 12px', borderRadius: 6, border: `1px solid ${TOKENS.line}`,
                background: TOKENS.bg, color: TOKENS.text, fontFamily: FONTS.ui, fontSize: 12, cursor: 'pointer',
              }}>Mark triaged</button>
          )}
        </div>
      ))}
    </div>
  );
}
