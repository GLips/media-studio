import { useCallback, useSyncExternalStore } from 'react';

/** The `storage` event only reaches other tabs, so this tab's own writes are announced to its subscribers here. */
const sameTabListeners = new Set<() => void>();

function subscribeToStudioStorage(onChange: () => void): () => void {
  window.addEventListener('storage', onChange);
  sameTabListeners.add(onChange);
  return () => {
    window.removeEventListener('storage', onChange);
    sameTabListeners.delete(onChange);
  };
}

/**
 * One of the studio's remembered choices (the list-or-grid view, a grid's grouping), kept in localStorage under `key`
 * and in step across tabs and every component reading it. Anything saved that isn't one of `values` reads as
 * `fallback`, which is also what the server's render shows before the saved choice can be read.
 */
export function useStudioStoredChoice<T extends string>(key: string, values: readonly T[], fallback: T): [T, (next: T) => void] {
  const read = useCallback((): T => {
    const saved = localStorage.getItem(key);
    return values.find((value) => value === saved) ?? fallback;
  }, [key, values, fallback]);
  const choice = useSyncExternalStore(subscribeToStudioStorage, read, () => fallback);
  const setChoice = useCallback((next: T) => {
    localStorage.setItem(key, next);
    for (const listener of sameTabListeners) listener();
  }, [key]);
  return [choice, setChoice];
}
