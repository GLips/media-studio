import { DEFAULT_SEQUENCE_TIMEOUT, getSequenceManager, useHotkeys, useHotkeySequences } from '@tanstack/react-hotkeys';
import { useLocation, useNavigate, useParams } from '@tanstack/react-router';

/**
 * Whether a `G` sequence has begun and waits for its next key, so a single key that ends one (`N` in `G N`) leaves
 * it be. Read in a single key's callback, it sees the sequence before it completes: the root registers its keys,
 * then its sequences, so the key manager's listener runs first.
 */
export function hotkeySequencePending(): boolean {
  const now = Date.now();
  return [...getSequenceManager().registrations.state.values()]
    .some((s) => s.matchedStepCount > 0 && now - s.partialMatchLastKeyTime <= (s.options.timeout ?? DEFAULT_SEQUENCE_TIMEOUT));
}

/** One level up from where the app is: a project's screens go to its page, its page to the dashboard. */
export type StudioUpTarget = { to: '/' } | { to: '/projects/$project'; params: { project: string } };

/** Null on the dashboard, which has nothing above it. */
export function studioUpOf(pathname: string, project: string | undefined): StudioUpTarget | null {
  if (project === undefined) return pathname === '/' ? null : { to: '/' };
  const projectPage = `/projects/${encodeURIComponent(project)}`;
  return pathname.replace(/\/$/, '') === projectPage ? { to: '/' } : { to: '/projects/$project', params: { project } };
}

/** Where `◂` and `Mod+ArrowUp` lead from the screen showing now. */
export function useStudioUp(): StudioUpTarget | null {
  const { pathname } = useLocation();
  const { project } = useParams({ strict: false });
  return studioUpOf(pathname, project);
}

type GlobalHotkeyActions = { readonly toggleCheatsheet: () => void; readonly openQuickOpen: () => void };

/**
 * The keys every screen has: the cheatsheet, quick-open, up a level, copy this page's link, and the `G` jumps. The
 * root registers them once (StudioOverlaysProvider); a screen's own global keys (`Mod+\`, copy notes, undo) register
 * with the screen.
 */
export function useGlobalHotkeys({ toggleCheatsheet, openQuickOpen }: GlobalHotkeyActions) {
  const navigate = useNavigate();
  const up = useStudioUp();
  const { project } = useParams({ strict: false });
  useHotkeys([
    // Raw: the typed spellings leave out shifted punctuation. Matched by key code, so `?` on any layout's `/` key.
    { hotkey: { key: '/', shift: true }, callback: toggleCheatsheet, options: { meta: { group: 'global', name: 'Keys' } } },
    { hotkey: 'Mod+K', callback: openQuickOpen, options: { meta: { group: 'global', name: 'Open…' } } },
    // Left out, not disabled, where there's no level up: a disabled registration still holds its key.
    ...(up ? [{ hotkey: 'Mod+ArrowUp' as const, callback: () => void navigate(up), options: { meta: { group: 'global' as const, name: 'Up a level' } } }] : []),
    { hotkey: 'Mod+L', callback: () => void navigator.clipboard.writeText(window.location.href), options: { meta: { group: 'global', name: 'Copy link' } } },
  ]);
  useHotkeySequences([
    { sequence: ['G', 'D'], callback: () => void navigate({ to: '/' }), options: { meta: { group: 'global', name: 'Dashboard' } } },
    ...(project === undefined ? [] : [
      { sequence: ['G', 'P'], callback: () => void navigate({ to: '/projects/$project', params: { project } }), options: { meta: { group: 'global', name: 'Project' } } },
      { sequence: ['G', 'S'], callback: () => void navigate({ to: '/projects/$project/script', params: { project } }), options: { meta: { group: 'global', name: 'Script' } } },
    ] satisfies Parameters<typeof useHotkeySequences>[0]),
  ]);
}
