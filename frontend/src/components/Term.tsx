import { type ReactNode, useState, useId, useCallback, useRef } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { TERMS, type TermKey } from '../lib/terms';

// Shared popover body — used by both variants so content stays consistent.
// role is NOT a prop here — it's set on the outer Popover.Content wrapper.
function PopoverBody({ term }: { term: NonNullable<typeof TERMS[TermKey]> }) {
  return (
    <>
      <div style={{ fontWeight: 600, marginBottom: 4, fontSize: 12, letterSpacing: 0.5, color: '#4D8DFF', textTransform: 'uppercase' }}>
        {term.full}
      </div>
      <div style={{ marginBottom: 8 }}>{term.plain}</div>
      <div style={{ color: 'rgba(255,255,255,0.7)', fontStyle: 'italic' }}>{term.whyMatters}</div>
      {term.citation ? (
        <div style={{ marginTop: 10, fontSize: 11 }}>
          <a href={term.citation.url} target="_blank" rel="noopener noreferrer" style={{ color: '#4D8DFF' }}>
            {term.citation.label} ↗
          </a>
        </div>
      ) : null}
      <Popover.Arrow style={{ fill: '#10141C' }} />
    </>
  );
}

const popoverContentStyle: React.CSSProperties = {
  maxWidth: 320,
  padding: 12,
  borderRadius: 8,
  background: '#10141C',
  border: '1px solid rgba(255,255,255,0.1)',
  color: '#fff',
  fontFamily: 'Inter Tight',
  fontSize: 13,
  lineHeight: 1.4,
  boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
  zIndex: 100,
};

/**
 * Interactive button variant — click to open/close.
 * Original behaviour, unchanged.
 */
function TermButton({
  term,
  label,
  compact,
}: {
  term: NonNullable<typeof TERMS[TermKey]>;
  label: ReactNode;
  compact: boolean;
}) {
  const role = term.citation ? 'dialog' : 'tooltip';
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label={`${term.full} — definition`}
          style={{
            background: 'transparent',
            border: 'none',
            borderBottom: compact ? 'none' : '1px dotted rgba(255,255,255,0.5)',
            borderBottomStyle: compact ? 'none' : 'dotted',
            padding: 0,
            color: 'inherit',
            cursor: 'help',
            font: 'inherit',
          }}
        >
          {label}
          {compact ? <span style={{ marginLeft: 4, color: 'rgba(255,255,255,0.5)', fontSize: '0.85em' }}>ⓘ</span> : null}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          role={role}
          aria-modal={role === 'dialog' ? 'false' : undefined}
          side="top"
          align="center"
          sideOffset={8}
          style={popoverContentStyle}
        >
          <PopoverBody term={term} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/**
 * Non-interactive abbr variant — hover, focus, or tap to reveal.
 * Renders <abbr> for screen-reader semantics. The popover is controlled
 * manually so we can open on hover/focus without click (which would be
 * wrong UX for inline abbreviations that aren't interactive buttons).
 *
 * Touch: a pointerdown on a touch device shows the popover; a second tap
 * anywhere outside dismisses it (Radix handles outside-click dismiss).
 * Escape also dismisses.
 */
function TermAbbr({
  term,
  label,
  tooltipId,
}: {
  term: NonNullable<typeof TERMS[TermKey]>;
  label: ReactNode;
  tooltipId: string;
}) {
  const [open, setOpen] = useState(false);
  const role = term.citation ? 'dialog' : 'tooltip';

  // Track whether the popover content itself is hovered so we don't close
  // when the user moves the mouse from the abbr into the tooltip.
  const overContent = useRef(false);
  // Debounce close so a fast mouse move from abbr→content doesn't flicker.
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleClose = useCallback(() => {
    closeTimer.current = setTimeout(() => {
      if (!overContent.current) setOpen(false);
    }, 80);
  }, []);

  const cancelClose = useCallback(() => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }, []);

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Anchor asChild>
        <abbr
          title={term.full}
          aria-describedby={open ? tooltipId : undefined}
          style={{
            textDecoration: 'underline dotted rgba(255,255,255,0.5)',
            textDecorationThickness: '1px',
            textUnderlineOffset: '2px',
            cursor: 'help',
            // Remove default browser tooltip — we're providing our own.
            WebkitTextDecorationStyle: 'dotted',
          }}
          // Hover
          onMouseEnter={() => { cancelClose(); setOpen(true); }}
          onMouseLeave={scheduleClose}
          // Keyboard focus / blur
          onFocus={() => { cancelClose(); setOpen(true); }}
          onBlur={scheduleClose}
          // Touch — pointerdown fires on first tap before any mouse events
          onPointerDown={(e) => {
            if (e.pointerType === 'touch') {
              e.preventDefault(); // prevent synthesized mouse events
              setOpen((prev) => !prev);
            }
          }}
          tabIndex={0}
          role="term"
        >
          {label}
        </abbr>
      </Popover.Anchor>
      <Popover.Portal>
        <Popover.Content
          id={tooltipId}
          role={role}
          aria-modal={false}
          side="top"
          align="center"
          sideOffset={8}
          style={popoverContentStyle}
          // Keep popover open while mouse is inside it
          onMouseEnter={() => { overContent.current = true; cancelClose(); }}
          onMouseLeave={() => { overContent.current = false; scheduleClose(); }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setOpen(false);
          }}
          // Prevent focus moving to popover on open (no focus steal)
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <PopoverBody term={term} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

type TermProps = {
  k: TermKey;
  children?: ReactNode;
  compact?: boolean;
  /** 'button' (default) — click-to-open interactive trigger.
   *  'abbr' — hover/focus/tap non-button trigger rendered as <abbr>. */
  variant?: 'button' | 'abbr';
};

export function Term({ k, children, compact = false, variant = 'button' }: TermProps) {
  const tooltipId = useId();
  const term = TERMS[k];
  if (!term) {
    if (import.meta.env.DEV) console.warn(`<Term k="${k}"> — unknown term key`);
    return <>{children ?? k}</>;
  }
  const label = children ?? term.short;

  if (variant === 'abbr') {
    return <TermAbbr term={term} label={label} tooltipId={tooltipId} />;
  }

  return <TermButton term={term} label={label} compact={compact} />;
}
