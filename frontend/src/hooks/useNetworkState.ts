import { useEffect, useState } from 'react';

export interface NetworkState {
  online: boolean;
  /** ms epoch of the last online↔offline transition (or initial mount). */
  transitionedAt: number;
}

/**
 * Tracks the browser's online/offline state via the window 'online'/'offline'
 * events. On an offline→online transition, dispatches a 'reconnect' CustomEvent
 * on window with `detail: { transitionedAt }` for app-internal coordination
 * (logBuffer.onReconnect also listens on the native 'online' event directly).
 */
export function useNetworkState(): NetworkState {
  const [state, setState] = useState<NetworkState>(() => ({
    online: typeof navigator !== 'undefined' ? navigator.onLine : true,
    transitionedAt: Date.now(),
  }));

  useEffect(() => {
    const handleOnline = (): void => {
      const transitionedAt = Date.now();
      setState({ online: true, transitionedAt });
      window.dispatchEvent(
        new CustomEvent('reconnect', { detail: { transitionedAt } }),
      );
    };

    const handleOffline = (): void => {
      setState({ online: false, transitionedAt: Date.now() });
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return state;
}
