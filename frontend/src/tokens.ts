// RepOS design tokens — dark theme
// Mirrors REPOS_TOKENS from the prototype exactly.

export const TOKENS = {
  bg: '#0A0D12',
  surface: '#10141C',
  surface2: '#161C26',
  surface3: '#1E2632',
  line: 'rgba(255,255,255,0.08)',
  lineStrong: 'rgba(255,255,255,0.14)',
  text: '#E8EEF7',
  textDim: '#9BA7BA',
  textMute: '#5A6577',
  accent: '#4D8DFF',
  accentGlow: 'rgba(77,141,255,0.18)',
  accentDim: 'rgba(77,141,255,0.45)',
  good: '#6BE28B',
  warn: '#F5B544',
  danger: '#FF6A6A',
  heat0: '#10141C',
  heat1: '#1A2840',
  heat2: '#254472',
  heat3: '#3166AB',
  heat4: '#4D8DFF',
  heat5: '#7FB0FF',
  // W2 (panel C-Z) — explicit modal z-index stack. Every overlay references
  // a token here, NEVER an inline zIndex literal. Auth tier is the highest
  // *modal surface* because a session-expired prompt must obscure even
  // onboarding. zPopover sits above all modal surfaces: contextual-help popovers
  // (Term) portal to <body>, so they must out-rank whatever modal hosts their
  // trigger or they paint behind the modal's opaque backdrop and vanish.
  // (Transient toasts in ToastHost render higher still, by design.)
  zModal: {
    zSheet: 100, // BlockOverflowMenu, MidSessionSwapSheet, DeloadThisWeekSheet
    zBanner: 1000, // LogBufferRecovery
    zOverlay: 1500, // OnboardingOverlay, ParQGate
    zAuth: 2000, // SessionExpiredBanner
    zPopover: 2500, // Term help popover — above every modal surface, below toasts
  },
} as const;

export const FONTS = {
  ui: '"Inter Tight", "Inter", -apple-system, BlinkMacSystemFont, system-ui, sans-serif',
  mono: '"JetBrains Mono", "SF Mono", ui-monospace, monospace',
} as const;

export const API_BASE: string =
  (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:3001';
