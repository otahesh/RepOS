// frontend/src/components/feedback/FeedbackSheet.tsx
// Beta W7 — modal wrapper around FeedbackForm, opened from the Topbar bug-button.
// Autofills the current route so the engineer sees where the user was.
import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { TOKENS, FONTS } from '../../tokens';
import { FeedbackForm } from './FeedbackForm';

export function FeedbackSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const location = useLocation();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Send feedback"
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '12vh 16px 16px',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 460, background: TOKENS.surface,
          border: `1px solid ${TOKENS.line}`, borderRadius: 14, padding: 20,
          display: 'flex', flexDirection: 'column', gap: 14,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h2 style={{ margin: 0, fontSize: 16, fontFamily: FONTS.ui, color: TOKENS.text }}>Send feedback</h2>
          <button type="button" aria-label="Close" onClick={onClose}
            style={{ background: 'none', border: 'none', color: TOKENS.textMute, cursor: 'pointer', fontSize: 18 }}>×</button>
        </div>
        <FeedbackForm initialRoute={location.pathname} onSubmitted={onClose} />
      </div>
    </div>
  );
}
