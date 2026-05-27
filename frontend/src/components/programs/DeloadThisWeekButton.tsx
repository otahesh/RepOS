// frontend/src/components/programs/DeloadThisWeekButton.tsx
// W2.6 — "Deload this week" button. Opens DeloadThisWeekSheet (button → sheet
// handover, mirroring W3's MidSessionSwapPicker → MidSessionSwapSheet pattern
// per panel I-DELOAD-A11Y). Mounted on MyProgramPage (desktop) and in the
// TodayPage overflow menu (mobile).
import { useState } from 'react';
import { TOKENS, FONTS } from '../../tokens';
import { Term } from '../Term';
import { DeloadThisWeekSheet } from './DeloadThisWeekSheet';

export function DeloadThisWeekButton({
  runId,
  onChanged,
  variant = 'button',
}: {
  runId: string;
  onChanged?: () => void;
  // 'menuitem' renders a plain row for use inside an overflow menu (mobile).
  variant?: 'button' | 'menuitem';
}) {
  const [open, setOpen] = useState(false);

  const baseStyle: React.CSSProperties = variant === 'menuitem'
    ? { background: 'transparent', border: 'none', color: TOKENS.text, padding: '12px 16px', textAlign: 'left', width: '100%', cursor: 'pointer', fontFamily: FONTS.ui, fontSize: 14 }
    : { background: 'transparent', border: `1px solid ${TOKENS.warn}`, color: TOKENS.warn, borderRadius: 10, padding: '10px 16px', cursor: 'pointer', fontFamily: FONTS.ui, fontSize: 13, fontWeight: 600, letterSpacing: 0.3 };

  return (
    <>
      <button
        type="button"
        aria-label="Deload this week"
        onClick={() => setOpen(true)}
        style={baseStyle}
      >
        <Term k="manual_deload" variant="abbr">Deload</Term> this week
      </button>
      {open && (
        <DeloadThisWeekSheet
          runId={runId}
          onClose={(changed) => {
            setOpen(false);
            if (changed) onChanged?.();
          }}
        />
      )}
    </>
  );
}
