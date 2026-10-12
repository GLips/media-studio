// route-search.ts: what every screen's URL search is made of. A param is optional and cleared when it doesn't decode,
// so a link edited by hand into nonsense (`?f=-3`, `?cmp=zoom`) opens the screen without that param, the rest kept,
// instead of the route's error page.
import { Effect, Schema } from 'effect';
import { useCallback, useEffect, useRef } from 'react';

/**
 * An optional search param, undefined when the URL's value doesn't decode as `schema`. Undefined, not left out: the
 * router lays the validated search over the raw one, so a key left out would keep its raw nonsense.
 */
export const optionalSearchParam = <S extends Schema.Top>(schema: S) =>
  Schema.optionalKey(Schema.UndefinedOr(schema).pipe(Schema.catchDecoding(() => Effect.succeedSome(undefined))));

/** How a screen's search is written: which keys are places, which settle, and what absence already means. */
export type RouteSearchWriting<S> = {
  /** Keys that are places the reviewer went: setting one pushes history, so Back returns; clearing one replaces. */
  pushed: readonly (keyof S)[];
  /** Keys written as something settles (a playhead, a drag): replaced, once, a beat after the last change. */
  debounced?: readonly (keyof S)[];
  /** The search without what the screen assumes when a key is absent, so links stay plain. */
  withoutDefaults: (search: S) => S;
};

const ROUTE_SEARCH_DEBOUNCE_MS = 150;

/**
 * A screen's search writer over its route's `navigate`. Clearing a pushed key replaces: Back would land on it and it'd
 * let go again. A pending debounced write rides along with any other write rather than being lost.
 */
export function useRouteSearchWriter<S extends object>(
  navigate: (options: { search: (prev: S) => S; replace: boolean }) => Promise<void>,
  { pushed, debounced = [], withoutDefaults }: RouteSearchWriting<S>,
): (patch: S) => void {
  const pending = useRef<Partial<S>>({});
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const write = useCallback((patch: Partial<S>, replace: boolean) => {
    clearTimeout(timer.current);
    const merged = { ...pending.current, ...patch };
    pending.current = {};
    void navigate({ search: (prev) => withoutDefaults({ ...prev, ...merged }), replace });
  }, [navigate, withoutDefaults]);
  useEffect(() => () => clearTimeout(timer.current), []);
  return useCallback((patch: S) => {
    const keys = Object.keys(patch);
    const isPushed = (k: string) => pushed.some((p) => p === k), isDebounced = (k: string) => debounced.some((d) => d === k);
    if (Object.entries(patch).some(([k, v]) => isPushed(k) && v !== undefined)) return write(patch, false);
    if (keys.some((k) => !isDebounced(k))) return write(patch, true);
    pending.current = { ...pending.current, ...patch };
    clearTimeout(timer.current);
    timer.current = setTimeout(() => write({}, true), ROUTE_SEARCH_DEBOUNCE_MS);
    return undefined;
  }, [pushed, debounced, write]);
}
