import { type ReactNode } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { TERMS, type TermKey } from '../lib/terms';

export function Term({ k, children, compact = false }: { k: TermKey; children?: ReactNode; compact?: boolean }) {
  const term = TERMS[k];
  if (!term) {
    if (import.meta.env.DEV) console.warn(`<Term k="${k}"> — unknown term key`);
    return <>{children ?? k}</>;
  }
  const label = children ?? term.short;
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
          style={{
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
          }}
        >
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
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
