import { useEffect, useState } from 'react';

const QUERY = '(max-width: 767px)';
const BELOW_TABLET_QUERY = '(max-width: 1023px)';

// SSR-safe: guard window even though we're CSR-only.
function readMatch(query: string): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia(query).matches;
}

function useBreakpoint(query: string): boolean {
  const [matches, setMatches] = useState<boolean>(() => readMatch(query));

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia(query);
    const handler = (e: MediaQueryListEvent) => setMatches(e.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, [query]);

  return matches;
}

export function useIsMobile(): boolean {
  return useBreakpoint(QUERY);
}

export function useIsBelowTablet(): boolean {
  return useBreakpoint(BELOW_TABLET_QUERY);
}
