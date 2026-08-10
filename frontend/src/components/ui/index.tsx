import type { ButtonHTMLAttributes, CSSProperties, HTMLAttributes, ReactNode } from 'react';
import { FONTS, TOKENS } from '../../tokens';

export type PageWidth = 'narrow' | 'standard' | 'wide' | 'data' | 'split';

export function Page({
  width = 'standard',
  className = '',
  children,
  ...props
}: HTMLAttributes<HTMLDivElement> & { width?: PageWidth }) {
  return (
    <div className={`repos-page repos-page--${width} ${className}`.trim()} {...props}>
      {children}
    </div>
  );
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="repos-page-header">
      <div className="repos-page-header__copy">
        {eyebrow ? <div className="repos-eyebrow">{eyebrow}</div> : null}
        <h1 className="repos-page-title">{title}</h1>
        {description ? <p className="repos-page-description">{description}</p> : null}
      </div>
      {actions ? <div className="repos-page-header__actions">{actions}</div> : null}
    </header>
  );
}

export function SectionHeader({
  title,
  description,
  actions,
  id,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  id?: string;
}) {
  return (
    <header className="repos-section-header">
      <div>
        <h2 id={id} className="repos-section-title">
          {title}
        </h2>
        {description ? <p className="repos-section-description">{description}</p> : null}
      </div>
      {actions}
    </header>
  );
}

export function Card({
  interactive = false,
  className = '',
  children,
  style,
  ...props
}: HTMLAttributes<HTMLElement> & { interactive?: boolean }) {
  return (
    <section
      className={`repos-card ${interactive ? 'repos-card--interactive' : ''} ${className}`.trim()}
      style={style}
      {...props}
    >
      {children}
    </section>
  );
}

export type ButtonVariant = 'primary' | 'secondary' | 'quiet' | 'warning' | 'danger';

export function Button({
  variant = 'secondary',
  iconOnly = false,
  className = '',
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  iconOnly?: boolean;
}) {
  return (
    <button
      className={`repos-button repos-button--${variant} ${iconOnly ? 'repos-icon-button' : ''} ${className}`.trim()}
      {...props}
    >
      {children}
    </button>
  );
}

export type BadgeTone = 'neutral' | 'accent' | 'good' | 'warning' | 'danger';

const badgePalette: Record<BadgeTone, CSSProperties> = {
  neutral: {},
  accent: {
    '--badge-color': TOKENS.accent,
    '--badge-border': TOKENS.accentDim,
    '--badge-bg': TOKENS.accentGlow,
  } as CSSProperties,
  good: {
    '--badge-color': TOKENS.good,
    '--badge-border': 'rgba(107,226,139,0.42)',
    '--badge-bg': 'rgba(107,226,139,0.1)',
  } as CSSProperties,
  warning: {
    '--badge-color': TOKENS.warn,
    '--badge-border': 'rgba(245,181,68,0.42)',
    '--badge-bg': 'rgba(245,181,68,0.1)',
  } as CSSProperties,
  danger: {
    '--badge-color': TOKENS.danger,
    '--badge-border': 'rgba(255,106,106,0.42)',
    '--badge-bg': 'rgba(255,106,106,0.1)',
  } as CSSProperties,
};

export function StatusBadge({
  tone = 'neutral',
  children,
}: {
  tone?: BadgeTone;
  children: ReactNode;
}) {
  return (
    <span className="repos-badge" style={badgePalette[tone]}>
      {children}
    </span>
  );
}

export function SegmentedControl<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange: (value: T) => void;
}) {
  return (
    <div className="repos-segmented" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className="repos-segmented__item"
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function DataState({
  kind = 'empty',
  title,
  body,
  action,
  busy = false,
  compact = false,
}: {
  kind?: 'loading' | 'empty' | 'error' | 'warning';
  title: ReactNode;
  body?: ReactNode;
  action?: ReactNode;
  busy?: boolean;
  compact?: boolean;
}) {
  if (kind === 'loading') {
    return (
      <div className="repos-state" role="status" aria-live="polite" aria-busy="true">
        <div className="repos-skeleton" aria-hidden="true" style={{ width: 148, height: 14 }} />
        <div className="repos-skeleton" aria-hidden="true" style={{ width: 230, height: 10 }} />
        <span className="sr-only">{title}</span>
      </div>
    );
  }

  return (
    <div
      className={`repos-state repos-state--${kind} ${compact ? 'repos-state--compact' : ''}`}
      role={kind === 'error' ? 'alert' : 'status'}
      aria-busy={busy || undefined}
    >
      <div className="repos-state__title">{title}</div>
      {body ? <div className="repos-state__body">{body}</div> : null}
      {action}
    </div>
  );
}

export function SkeletonCards({ count = 3 }: { count?: number }) {
  return (
    <div className="repos-grid-3" role="status" aria-label="Loading content" aria-busy="true">
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="repos-card" aria-hidden="true" style={{ padding: 18 }}>
          <div className="repos-skeleton" style={{ height: 13, width: '38%', marginBottom: 14 }} />
          <div className="repos-skeleton" style={{ height: 18, width: '72%', marginBottom: 10 }} />
          <div className="repos-skeleton" style={{ height: 10, width: '92%', marginBottom: 6 }} />
          <div className="repos-skeleton" style={{ height: 10, width: '64%' }} />
        </div>
      ))}
      <span className="sr-only">Loading content</span>
    </div>
  );
}

export const monoMetaStyle: CSSProperties = {
  fontFamily: FONTS.mono,
  fontSize: 10,
  color: TOKENS.textMute,
  letterSpacing: 0.8,
  textTransform: 'uppercase',
};
