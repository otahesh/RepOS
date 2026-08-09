// frontend/src/components/feedback/FeedbackForm.tsx
// Beta W7 — shared feedback form (textarea + char counter + Send). Used by both
// the Topbar FeedbackSheet and the /settings/feedback page. Design-system
// styled (Inter Tight, surface inputs, all-caps accent CTA).
import { useState } from 'react';
import { TOKENS, FONTS } from '../../tokens';
import { submitFeedback } from '../../lib/api/feedback';
import { pushToast } from '../common/ToastHost';

const MAX = 4000;

export function FeedbackForm({
  initialRoute,
  onSubmitted,
}: {
  initialRoute?: string;
  onSubmitted?: () => void;
}) {
  const [body, setBody] = useState('');
  const [saving, setSaving] = useState(false);
  const canSend = body.trim().length > 0 && body.length <= MAX && !saving;

  async function handleSend(): Promise<void> {
    setSaving(true);
    try {
      await submitFeedback({ body: body.trim(), ...(initialRoute ? { route: initialRoute } : {}) });
      pushToast({ severity: 'success', body: 'Thanks — feedback sent.' });
      setBody('');
      onSubmitted?.();
    } catch (err) {
      pushToast({
        severity: 'error',
        body: 'Could not send. ' + (err instanceof Error ? err.message : 'Try again.'),
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <textarea
        aria-label="Feedback"
        placeholder="What's working, what's broken, what's missing?"
        value={body}
        maxLength={MAX}
        rows={5}
        onChange={(e) => setBody(e.target.value)}
        style={{
          padding: '10px 12px',
          background: TOKENS.bg,
          color: TOKENS.text,
          border: `1px solid ${TOKENS.lineStrong}`,
          borderRadius: 8,
          fontSize: 14,
          fontFamily: FONTS.ui,
          resize: 'vertical',
          minHeight: 96,
        }}
      />
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontFamily: FONTS.mono, fontSize: 11, color: TOKENS.textMute }}>
          {body.length}/{MAX}
        </span>
        <button
          type="button"
          onClick={() => void handleSend()}
          disabled={!canSend}
          style={{
            padding: '8px 18px',
            borderRadius: 6,
            border: 'none',
            background: canSend ? TOKENS.accent : TOKENS.surface,
            color: canSend ? '#fff' : TOKENS.textMute,
            fontFamily: FONTS.ui,
            fontSize: 13,
            fontWeight: 600,
            letterSpacing: 0.6,
            cursor: canSend ? 'pointer' : 'not-allowed',
          }}
        >
          {saving ? 'SENDING…' : 'SEND'}
        </button>
      </div>
    </div>
  );
}
