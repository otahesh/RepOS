// frontend/src/components/onboarding/ParQGate.tsx
//
// W2.3 — PAR-Q-lite 9-question soft gate. Reads getParQStatus; if
// needs_prompt=false AND not forced (re-review mode), renders nothing.
//
// A11y baseline (panel C-A11Y) matches MidSessionSwapPicker: focus trap,
// initial focus on first question (re-focus when the async question list
// arrives), return-focus on close, ESC closes in re-review mode (first-prompt
// mode has no Cancel — the gate must be acknowledged).
//
// Q5 (index 4) reveals ParQJointPicker (user decision D1). Q8 (index 7,
// chronic) appends an extra soft-gate line (user decision D2).
//
// Soft gate: a "yes" never hard-blocks — it persists par_q_advisory_active=true
// server-side and shows advisory copy; the user clicks through to continue.
import { useEffect, useRef, useState } from 'react';
import { TOKENS, FONTS } from '../../tokens';
import { Term } from '../Term';
import { ParQJointPicker } from './ParQJointPicker';
import {
  getParQStatus,
  acceptParQ,
  type ParQStatus,
  type ParQ5Joint,
  type ParQAcceptResult,
} from '../../lib/api/parQ';

const Q5_INDEX = 4;
const Q8_CHRONIC_INDEX = 7;

export function ParQGate({
  onComplete,
  forceReview = false,
  onClose,
}: {
  onComplete: () => void;
  // Settings → Health re-review mode: render even if needs_prompt=false, and
  // allow ESC/Cancel to close without acknowledging.
  forceReview?: boolean;
  onClose?: () => void;
}) {
  const [status, setStatus] = useState<ParQStatus | null>(null);
  const [answers, setAnswers] = useState<boolean[]>([]);
  const [q5Joints, setQ5Joints] = useState<ParQ5Joint[]>([]);
  const [result, setResult] = useState<ParQAcceptResult | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const dialogRef = useRef<HTMLDivElement | null>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    previouslyFocusedRef.current = (document.activeElement as HTMLElement) ?? null;
    let cancelled = false;
    getParQStatus()
      .then((s) => {
        if (cancelled) return;
        setStatus(s);
        setAnswers(new Array(s.questions.length).fill(false));
      })
      .catch((e) => {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
      previouslyFocusedRef.current?.focus?.();
    };
  }, []);

  // Re-focus the first question once the async question list arrives. Scope to
  // the questions list so focus lands on the first answer control — NOT on the
  // inline help terms (PAR-Q / soft gate), which precede it in the DOM and would
  // otherwise grab initial focus and auto-open their hover tooltip on mount.
  useEffect(() => {
    if (!status || !dialogRef.current) return;
    const first = dialogRef.current.querySelector<HTMLElement>(
      '[data-testid="parq-questions"] button:not([disabled])',
    );
    first?.focus();
  }, [status]);

  // ESC (re-review only) + focus trap.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && (forceReview || onClose)) {
        e.preventDefault();
        onClose?.();
        return;
      }
      if (e.key !== 'Tab' || !dialogRef.current) return;
      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [forceReview, onClose]);

  if (err) {
    return (
      <Shell labelledById="parq-title">
        <h2 id="parq-title" style={titleStyle}>
          Couldn't load the health screen
        </h2>
        <p style={{ color: TOKENS.danger, fontSize: 14 }}>{err}</p>
      </Shell>
    );
  }
  if (!status) {
    return (
      <Shell labelledById="parq-title">
        <h2 id="parq-title" style={titleStyle}>
          Loading health screen…
        </h2>
      </Shell>
    );
  }
  // In non-review mode, if the server says no prompt is needed, render nothing.
  if (!forceReview && !status.needs_prompt && !result) {
    return null;
  }

  const q5Yes = answers[Q5_INDEX] === true;
  const q8Yes = answers[Q8_CHRONIC_INDEX] === true;

  function setAnswer(i: number, val: boolean) {
    setAnswers((prev) => {
      const next = [...prev];
      next[i] = val;
      return next;
    });
    if (i === Q5_INDEX && !val) setQ5Joints([]);
  }

  async function submit() {
    if (!status) return;
    setSubmitting(true);
    setErr(null);
    try {
      const r = await acceptParQ(status.current_version, answers, q5Yes ? q5Joints : []);
      setResult(r);
      if (!r.any_yes) {
        // Clean bill → dismiss immediately.
        onComplete();
      }
      // any_yes → keep the banner visible; user clicks Continue.
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  }

  function continueAfterBanner() {
    onComplete();
  }

  // ── Soft-gate banner (any_yes) ──────────────────────────────────────────────
  if (result?.any_yes) {
    return (
      <Shell labelledById="parq-title" dialogRef={dialogRef}>
        <h2 id="parq-title" style={titleStyle}>
          Before you ramp up
        </h2>
        <div
          role="alert"
          style={{
            border: `1px solid ${TOKENS.warn}`,
            background: 'rgba(245,181,68,0.10)',
            borderRadius: 12,
            padding: '14px 16px',
            marginBottom: 16,
            fontSize: 14,
            lineHeight: 1.6,
            color: TOKENS.text,
          }}
        >
          Based on your answers, talk to a clinician before increasing training load. You can keep
          using RepOS — your program will stay at conservative volume (<Term k="MEV" /> with{' '}
          <Term k="RIR" /> 3) in <Term k="advisory_mode" /> until your status is cleared.
          {q8Yes && (
            <div style={{ marginTop: 8 }}>
              Discuss this with your clinician before increasing volume.
            </div>
          )}
        </div>
        {result.injuries_created > 0 && (
          <p style={{ fontSize: 13, color: TOKENS.textDim, margin: '0 0 16px' }}>
            Noted {result.injuries_created} joint{result.injuries_created === 1 ? '' : 's'} — RepOS
            will steer exercise suggestions around {result.injuries_created === 1 ? 'it' : 'them'}.
          </p>
        )}
        <button type="button" onClick={continueAfterBanner} style={primaryBtn}>
          CONTINUE
        </button>
      </Shell>
    );
  }

  // ── Question screen ─────────────────────────────────────────────────────────
  return (
    <Shell labelledById="parq-title" dialogRef={dialogRef}>
      <div
        style={{
          fontFamily: FONTS.mono,
          fontSize: 11,
          letterSpacing: 1.4,
          color: TOKENS.accent,
          marginBottom: 8,
        }}
      >
        HEALTH SCREEN
      </div>
      <h2 id="parq-title" style={titleStyle}>
        Quick <Term k="PAR_Q" variant="abbr" /> before we start
      </h2>
      <p style={{ color: TOKENS.textDim, fontSize: 13, lineHeight: 1.6, margin: '0 0 16px' }}>
        Answer honestly. A "yes" is a <Term k="soft_gate" variant="abbr" /> — it never locks you
        out, it just keeps your program conservative until a clinician clears you.
      </p>
      <ol
        data-testid="parq-questions"
        style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 12 }}
      >
        {status.questions.map((q, i) => (
          <li key={i} style={{ borderBottom: `1px solid ${TOKENS.line}`, paddingBottom: 12 }}>
            <div style={{ fontSize: 14, color: TOKENS.text, marginBottom: 8, lineHeight: 1.5 }}>
              {q}
            </div>
            <div
              role="radiogroup"
              aria-label={`Question ${i + 1}`}
              style={{ display: 'flex', gap: 8 }}
            >
              <YesNo
                label="No"
                selected={answers[i] === false}
                onClick={() => setAnswer(i, false)}
              />
              <YesNo
                label="Yes"
                selected={answers[i] === true}
                onClick={() => setAnswer(i, true)}
                danger
              />
            </div>
            {i === Q5_INDEX && q5Yes && (
              <ParQJointPicker selected={q5Joints} onChange={setQ5Joints} />
            )}
          </li>
        ))}
      </ol>
      {err && <p style={{ color: TOKENS.danger, fontSize: 13, marginTop: 12 }}>{err}</p>}
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 20 }}>
        <button
          type="button"
          onClick={submit}
          disabled={submitting}
          style={{ ...primaryBtn, opacity: submitting ? 0.6 : 1 }}
        >
          {submitting ? 'SAVING…' : 'CONFIRM'}
        </button>
        {(forceReview || onClose) && (
          <button type="button" onClick={() => onClose?.()} style={cancelBtn}>
            Cancel
          </button>
        )}
      </div>
    </Shell>
  );
}

function YesNo({
  label,
  selected,
  onClick,
  danger,
}: {
  label: string;
  selected: boolean;
  onClick: () => void;
  danger?: boolean;
}) {
  const accent = danger ? TOKENS.danger : TOKENS.accent;
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onClick}
      style={{
        padding: '8px 18px',
        borderRadius: 8,
        fontSize: 13,
        fontWeight: 600,
        border: `1px solid ${selected ? accent : TOKENS.line}`,
        background: selected ? (danger ? 'rgba(255,106,106,0.12)' : TOKENS.accentGlow) : TOKENS.bg,
        color: TOKENS.text,
        cursor: 'pointer',
        fontFamily: FONTS.ui,
      }}
    >
      {label}
    </button>
  );
}

function Shell({
  children,
  labelledById,
  dialogRef,
}: {
  children: React.ReactNode;
  labelledById: string;
  dialogRef?: React.Ref<HTMLDivElement>;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={labelledById}
      ref={dialogRef}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(10,13,18,0.92)',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        zIndex: TOKENS.zModal.zOverlay,
        padding: 24,
        overflowY: 'auto',
      }}
    >
      <div
        style={{
          background: TOKENS.surface,
          border: `1px solid ${TOKENS.line}`,
          borderRadius: 16,
          padding: '28px 32px',
          maxWidth: 640,
          width: '100%',
          margin: '24px 0',
          fontFamily: FONTS.ui,
        }}
      >
        {children}
      </div>
    </div>
  );
}

const titleStyle: React.CSSProperties = {
  fontSize: 22,
  fontWeight: 700,
  color: TOKENS.text,
  margin: '0 0 12px',
  letterSpacing: -0.4,
};
const primaryBtn: React.CSSProperties = {
  background: TOKENS.accent,
  color: '#0A0D12',
  border: 'none',
  borderRadius: 10,
  padding: '12px 22px',
  fontWeight: 700,
  fontSize: 14,
  cursor: 'pointer',
  fontFamily: FONTS.ui,
  letterSpacing: 0.4,
};
const cancelBtn: React.CSSProperties = {
  background: 'transparent',
  color: TOKENS.textDim,
  border: 'none',
  fontSize: 13,
  cursor: 'pointer',
  fontFamily: FONTS.ui,
  textDecoration: 'underline',
};
