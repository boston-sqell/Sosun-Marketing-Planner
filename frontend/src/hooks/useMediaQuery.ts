import { useSyncExternalStore } from 'react';

/**
 * Subscribes to a CSS media query and returns whether the query matches.
 * Utilizes useSyncExternalStore to ensure synchronization safety in React 18/19.
 *
 * @param query CSS media query string (e.g. '(max-width: 768px)')
 * @param defaultValue Default value to return if window is undefined (e.g. SSR)
 */
export function useMediaQuery(query: string, defaultValue = false): boolean {
  return useSyncExternalStore(
    (callback) => {
      if (typeof window === 'undefined') return () => {};
      const mql = window.matchMedia(query);
      mql.addEventListener('change', callback);
      return () => mql.removeEventListener('change', callback);
    },
    () => {
      if (typeof window === 'undefined') return defaultValue;
      return window.matchMedia(query).matches;
    },
    () => defaultValue
  );
}
