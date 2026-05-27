// frontend/src/pages/SettingsHealthPage.tsx
// W2 — Settings → Health. PAR-Q re-review + advisory-mode management.
//   • Shows current vs acknowledged PAR-Q version.
//   • "Re-review PAR-Q" opens the ParQGate in forceReview mode (force-show
//     even when needs_prompt=false).
//   • When advisory_active: shows the advisory banner + a "Mark cleared"
//     affordance (POST /api/me/par-q/mark-cleared).
//
// Per memory feedback_user_reachability_dod.md, this is the reachable home for
// the PAR-Q re-review path (/ → Settings → Health, ≤3 clicks). Term wrappers on
// every term-of-art.
import { useCallback, useEffect, useState } from 'react';
import { TOKENS, FONTS } from '../tokens';
import { Term } from '../components/Term';
import { ParQGate } from '../components/onboarding/ParQGate';
import { getParQStatus, markPARQCleared, type ParQStatus } from '../lib/api/parQ';
import { pushToast } from '../components/common/ToastHost';

export default function SettingsHealthPage(): JSX.Element {
  const [status, setStatus] = useState<ParQStatus | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [clearing, setClearing] = useState(false);

  const load = useCallback(() => {
    getParQStatus().then(setStatus).catch(() => setStatus(null));
  }, []);

  useEffect(() => { load(); }, [load]);

  async function markCleared() {
    setClearing(true);
    try {
      await markPARQCleared();
      pushToast({ severity: 'success', body: 'Advisory cleared. Your program resumes normal progression.' });
      load();
    } catch {
      pushToast({ severity: 'error', body: "Couldn't clear advisory mode. Try again." });
    } finally {
      setClearing(false);
    }
  }

  return (
    <main style={{ padding: 16, color: TOKENS.text, fontFamily: FONTS.ui, maxWidth: 720 }}>
      <h1 style={{ fontSize: 22, marginBottom: 8 }}>Health</h1>
      <p style={{ color: TOKENS.textDim, fontSize: 14, marginBottom: 20, lineHeight: 1.6 }}>
        Your <Term k="PAR_Q" /> acknowledgment and clinical <Term k="advisory_mode" /> status. It
        is a <Term k="soft_gate" /> — answering "yes" never blocks training, it just keeps your program
        conservative until a clinician clears you.
      </p>

      {status && (
        <section style={card}>
          <div style={{ fontFamily: FONTS.mono, fontSize: 11, letterSpacing: 1.2, color: TOKENS.accent, marginBottom: 8 }}>
            READINESS SCREEN
          </div>
          <div style={{ fontSize: 14, color: TOKENS.text, marginBottom: 4 }}>
            Current version: <strong>{status.current_version}</strong>
          </div>
          <div style={{ fontSize: 14, color: TOKENS.textDim, marginBottom: 16 }}>
            You last acknowledged:{' '}
            <strong style={{ color: TOKENS.text }}>
              {status.acknowledged_version > 0 ? `v${status.acknowledged_version}` : 'never'}
            </strong>
            {status.needs_prompt && status.acknowledged_version < status.current_version && (
              <span style={{ color: TOKENS.warn }}> — a newer version is available.</span>
            )}
          </div>
          <button type="button" onClick={() => setReviewing(true)} style={secondaryBtn}>
            Re-review questionnaire
          </button>
        </section>
      )}

      {status?.advisory_active && (
        <section style={{ ...card, borderColor: TOKENS.warn, background: 'rgba(245,181,68,0.08)' }}>
          <div style={{ fontFamily: FONTS.mono, fontSize: 11, letterSpacing: 1.2, color: TOKENS.warn, marginBottom: 8 }}>
            ADVISORY ACTIVE
          </div>
          <p style={{ fontSize: 14, color: TOKENS.text, lineHeight: 1.6, margin: '0 0 16px' }}>
            You're in <Term k="advisory_mode" /> (volume capped at <Term k="MEV" /> with <Term k="RIR" /> 3).
            If you've spoken with a clinician and they've cleared you, mark yourself cleared to resume
            normal progression.
          </p>
          <button type="button" onClick={markCleared} disabled={clearing} style={{ ...primaryBtn, opacity: clearing ? 0.6 : 1 }}>
            {clearing ? 'CLEARING…' : 'Mark cleared'}
          </button>
        </section>
      )}

      {reviewing && (
        <ParQGate
          forceReview
          onClose={() => { setReviewing(false); load(); }}
          onComplete={() => { setReviewing(false); load(); }}
        />
      )}
    </main>
  );
}

const card: React.CSSProperties = {
  border: `1px solid ${TOKENS.line}`, borderRadius: 14, padding: '18px 20px',
  marginBottom: 16, background: TOKENS.surface,
};
const primaryBtn: React.CSSProperties = {
  background: TOKENS.warn, color: '#0A0D12', border: 'none', borderRadius: 10,
  padding: '10px 18px', fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: FONTS.ui,
};
const secondaryBtn: React.CSSProperties = {
  background: 'transparent', color: TOKENS.accent, border: `1px solid ${TOKENS.accent}`,
  borderRadius: 10, padding: '10px 18px', fontWeight: 600, fontSize: 13, cursor: 'pointer', fontFamily: FONTS.ui,
};
