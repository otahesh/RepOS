// RepOS design tokens — "tech-forward dark blue" with light/dark modes.
// Blue accent shared across themes; chroma held steady across accents.

const REPOS_TOKENS = {
  dark: {
    bg: '#0A0D12',            // deeper than navy — near-black cool
    surface: '#10141C',        // card bg
    surface2: '#161C26',       // raised
    surface3: '#1E2632',       // hover
    line: 'rgba(255,255,255,0.08)',
    lineStrong: 'rgba(255,255,255,0.14)',
    text: '#E8EEF7',
    textDim: '#9BA7BA',
    textMute: '#5A6577',
    accent: '#4D8DFF',         // primary blue
    accentGlow: 'rgba(77,141,255,0.18)',
    accentDim: 'rgba(77,141,255,0.45)',
    good: '#6BE28B',           // PR / success
    warn: '#F5B544',           // approaching MRV
    danger: '#FF6A6A',         // deload needed
    heat0: '#10141C',
    heat1: '#1A2840',
    heat2: '#254472',
    heat3: '#3166AB',
    heat4: '#4D8DFF',
    heat5: '#7FB0FF',
  },
  light: {
    bg: '#F5F7FB',
    surface: '#FFFFFF',
    surface2: '#F0F3F9',
    surface3: '#E6EBF3',
    line: 'rgba(10,20,40,0.08)',
    lineStrong: 'rgba(10,20,40,0.16)',
    text: '#0A1220',
    textDim: '#4B5A72',
    textMute: '#8795AE',
    accent: '#1F5FDB',
    accentGlow: 'rgba(31,95,219,0.12)',
    accentDim: 'rgba(31,95,219,0.35)',
    good: '#1E9B4A',
    warn: '#B77A00',
    danger: '#C43B3B',
    heat0: '#EEF2F8',
    heat1: '#D7E3F6',
    heat2: '#A9C5EF',
    heat3: '#6E9EE3',
    heat4: '#2F6FD6',
    heat5: '#0F3FA0',
  },
};

const REPOS_FONTS = {
  ui: '"Inter Tight", "Inter", -apple-system, BlinkMacSystemFont, system-ui, sans-serif',
  mono: '"JetBrains Mono", "SF Mono", ui-monospace, monospace',
};

// Small shared atoms
function Chip({ children, color, bg, style = {} }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      padding: '3px 8px', borderRadius: 4,
      fontFamily: REPOS_FONTS.mono, fontSize: 10,
      letterSpacing: 0.6, textTransform: 'uppercase',
      color, background: bg, fontWeight: 500,
      whiteSpace: 'nowrap',
      ...style,
    }}>{children}</span>
  );
}

// Minimal iconography — hairline strokes, no filled/emoji
function Icon({ name, size = 16, color = 'currentColor', strokeWidth = 1.5 }) {
  const p = {
    fill: 'none', stroke: color, strokeWidth,
    strokeLinecap: 'round', strokeLinejoin: 'round',
  };
  const paths = {
    barbell: <g {...p}><line x1="2" y1="12" x2="22" y2="12"/><rect x="5" y="7" width="3" height="10" rx="0.5"/><rect x="16" y="7" width="3" height="10" rx="0.5"/><line x1="3" y1="9" x2="3" y2="15"/><line x1="21" y1="9" x2="21" y2="15"/></g>,
    plus: <g {...p}><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></g>,
    check: <g {...p}><polyline points="4 12 10 18 20 6"/></g>,
    chevron: <g {...p}><polyline points="9 6 15 12 9 18"/></g>,
    chevronDown: <g {...p}><polyline points="6 9 12 15 18 9"/></g>,
    arrowUp: <g {...p}><line x1="12" y1="19" x2="12" y2="5"/><polyline points="6 11 12 5 18 11"/></g>,
    arrowRight: <g {...p}><line x1="5" y1="12" x2="19" y2="12"/><polyline points="13 6 19 12 13 18"/></g>,
    flame: <g {...p}><path d="M12 3c0 4-4 6-4 10a4 4 0 008 0c0-2-1-3-2-5 0 2-1 3-2 3 0-3 0-5 0-8z"/></g>,
    timer: <g {...p}><circle cx="12" cy="13" r="8"/><line x1="12" y1="13" x2="12" y2="9"/><line x1="9" y1="2" x2="15" y2="2"/></g>,
    dots: <g {...p}><circle cx="5" cy="12" r="0.5"/><circle cx="12" cy="12" r="0.5"/><circle cx="19" cy="12" r="0.5"/></g>,
    bars: <g {...p}><line x1="4" y1="20" x2="4" y2="10"/><line x1="10" y1="20" x2="10" y2="4"/><line x1="16" y1="20" x2="16" y2="13"/><line x1="22" y1="20" x2="22" y2="7"/></g>,
    swap: <g {...p}><polyline points="17 3 21 7 17 11"/><line x1="21" y1="7" x2="8" y2="7"/><polyline points="7 13 3 17 7 21"/><line x1="3" y1="17" x2="16" y2="17"/></g>,
    minus: <g {...p}><line x1="5" y1="12" x2="19" y2="12"/></g>,
    heart: <g {...p}><path d="M20.5 8.5a5 5 0 00-8.5-3 5 5 0 00-8.5 3c0 6 8.5 11 8.5 11s8.5-5 8.5-11z"/></g>,
    walk: <g {...p}><circle cx="13" cy="4" r="1.5"/><path d="M10 22l2-7-3-3 1-5 4 2 3 4"/><path d="M13 13l3 3v5"/></g>,
    trend: <g {...p}><polyline points="3 17 9 11 13 15 21 6"/><polyline points="15 6 21 6 21 12"/></g>,
    calendar: <g {...p}><rect x="3" y="5" width="18" height="16" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="8" y1="3" x2="8" y2="7"/><line x1="16" y1="3" x2="16" y2="7"/></g>,
    dumbbell: <g {...p}><path d="M6 9v6M2 11v2M10 7v10M14 7v10M18 9v6M22 11v2M10 12h4"/></g>,
    sparkline: <g {...p}><polyline points="2 14 6 10 10 13 14 7 18 11 22 5"/></g>,
    info: <g {...p}><circle cx="12" cy="12" r="9"/><line x1="12" y1="8" x2="12" y2="8"/><polyline points="11 12 12 12 12 16 13 16"/></g>,
    clock: <g {...p}><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 14"/></g>,
    pause: <g {...p}><rect x="6" y="5" width="4" height="14"/><rect x="14" y="5" width="4" height="14"/></g>,
    play: <g {...p}><polygon points="6 4 20 12 6 20"/></g>,
    settings: <g {...p}><circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 00-0.2-1.7l2-1.5-2-3.4-2.3 1a7 7 0 00-3-1.7L13 2h-2l-0.5 2.7a7 7 0 00-3 1.7l-2.3-1-2 3.4 2 1.5A7 7 0 005 12c0 0.6 0.1 1.1 0.2 1.7l-2 1.5 2 3.4 2.3-1a7 7 0 003 1.7L11 22h2l0.5-2.7a7 7 0 003-1.7l2.3 1 2-3.4-2-1.5c0.1-0.6 0.2-1.1 0.2-1.7z"/></g>,
  };
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ display: 'block', flexShrink: 0 }}>
      {paths[name]}
    </svg>
  );
}

Object.assign(window, { REPOS_TOKENS, REPOS_FONTS, Chip, Icon });
