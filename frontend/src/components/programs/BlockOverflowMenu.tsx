import { useEffect, useRef, useState } from 'react';
import { TOKENS } from '../../tokens';

export function BlockOverflowMenu({
  blockName,
  onGotATweak,
}: {
  blockName: string;
  onGotATweak: () => void;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const firstItemRef = useRef<HTMLButtonElement>(null);
  // Tracks whether the menu has been opened at least once. Without this, the
  // initial-mount effect (open=false) would steal focus to the trigger when
  // multiple BlockOverflowMenu instances render in a list (T16 review finding).
  const hasOpenedRef = useRef(false);

  // [FIX-21] focus on open, return focus on close
  useEffect(() => {
    if (open) {
      hasOpenedRef.current = true;
      firstItemRef.current?.focus();
    } else if (hasOpenedRef.current) {
      // Only restore focus to trigger if menu was previously open
      triggerRef.current?.focus({ preventScroll: true });
    }
  }, [open]);

  // ESC + click-outside
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    const onClick = (e: MouseEvent) => {
      if (!menuRef.current || !triggerRef.current) return;
      const t = e.target as Node;
      if (!menuRef.current.contains(t) && !triggerRef.current.contains(t)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClick);
    };
  }, [open]);

  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <button
        ref={triggerRef}
        type="button"
        aria-label={`More options for ${blockName}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
        style={{
          background: 'transparent', border: 0,
          color: 'rgba(255,255,255,0.5)',
          fontSize: 18, padding: '4px 8px', cursor: 'pointer', borderRadius: 4,
        }}
      >
        ⋯
      </button>
      {open && (
        <div
          ref={menuRef}
          role="menu"
          style={{
            position: 'absolute', top: 'calc(100% + 4px)', right: 0, minWidth: 160,
            background: TOKENS.surface,
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: 8, padding: 4, zIndex: 10,
            boxShadow: '0 12px 32px rgba(0,0,0,0.5)',
          }}
        >
          <button
            ref={firstItemRef}
            type="button"
            role="menuitem"
            onClick={() => { onGotATweak(); setOpen(false); }}
            style={{
              display: 'block', width: '100%', textAlign: 'left',
              background: 'transparent', border: 0,
              color: TOKENS.accent,
              padding: '8px 12px', fontSize: 13, fontWeight: 600,
              borderRadius: 4, cursor: 'pointer',
            }}
          >
            Got a tweak?
          </button>
        </div>
      )}
    </div>
  );
}
