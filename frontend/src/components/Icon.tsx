// Hairline SVG icon set — mirrors tokens.jsx prototype exactly.

interface IconProps {
  name: IconName
  size?: number
  color?: string
  strokeWidth?: number
}

export type IconName =
  | 'barbell' | 'plus' | 'check' | 'chevron' | 'chevronDown'
  | 'arrowUp' | 'arrowRight' | 'flame' | 'timer' | 'dots'
  | 'bars' | 'menu' | 'close' | 'swap' | 'minus' | 'heart' | 'walk' | 'trend'
  | 'calendar' | 'dumbbell' | 'sparkline' | 'info' | 'clock'
  | 'pause' | 'play' | 'settings' | 'key' | 'trash' | 'copy' | 'eye' | 'eyeOff'

export default function Icon({ name, size = 16, color = 'currentColor', strokeWidth = 1.5 }: IconProps) {
  const p = {
    fill: 'none' as const,
    stroke: color,
    strokeWidth,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  }

  const paths: Record<IconName, React.ReactNode> = {
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
    menu: <g {...p}><line x1="4" y1="7" x2="20" y2="7"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="17" x2="20" y2="17"/></g>,
    close: <g {...p}><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></g>,
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
    settings: <g {...p}><circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 00-.2-1.7l2-1.5-2-3.4-2.3 1a7 7 0 00-3-1.7L13 2h-2l-.5 2.7a7 7 0 00-3 1.7l-2.3-1-2 3.4 2 1.5A7 7 0 005 12c0 .6.1 1.1.2 1.7l-2 1.5 2 3.4 2.3-1a7 7 0 003 1.7L11 22h2l.5-2.7a7 7 0 003-1.7l2.3 1 2-3.4-2-1.5c.1-.6.2-1.1.2-1.7z"/></g>,
    key: <g {...p}><circle cx="8" cy="15" r="5"/><line x1="12.5" y1="10.5" x2="21" y2="2"/><line x1="18" y1="5" x2="21" y2="8"/><line x1="15" y1="8" x2="17" y2="6"/></g>,
    trash: <g {...p}><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/></g>,
    copy: <g {...p}><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></g>,
    eye: <g {...p}><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></g>,
    eyeOff: <g {...p}><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></g>,
  }

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      style={{ display: 'block', flexShrink: 0 }}
    >
      {paths[name]}
    </svg>
  )
}
