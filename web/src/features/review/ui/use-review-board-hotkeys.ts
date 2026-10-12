import { useHotkeys, type UseHotkeyDefinition } from '@tanstack/react-hotkeys';
import { useReviewScreen } from './review-screen-context.tsx';
import { useReviewStillSiblings } from './review-still-siblings.ts';

/** One key of the Board or the stills: its binding, its name (the cheatsheet's and the tooltip's), what it does. */
export type ReviewBoardKey = { readonly hotkey: UseHotkeyDefinition['hotkey']; readonly name: string; readonly run: () => void };

/** A step through tiles: along the reading order, or a row up or down. */
export type ReviewTileStep = { readonly along: -1 | 0 | 1; readonly rows: -1 | 0 | 1 };

/** The arrows over tiles, each a step; `Enter` and `Escape` are the caller's, as what they open differs. */
export function reviewTileArrowKeys(step: (by: ReviewTileStep) => void): ReviewBoardKey[] {
  return [
    { hotkey: 'ArrowLeft', name: 'Previous tile', run: () => step({ along: -1, rows: 0 }) },
    { hotkey: 'ArrowRight', name: 'Next tile', run: () => step({ along: 1, rows: 0 }) },
    { hotkey: 'ArrowUp', name: 'Row up', run: () => step({ along: 0, rows: -1 }) },
    { hotkey: 'ArrowDown', name: 'Row down', run: () => step({ along: 0, rows: 1 }) },
  ];
}

/**
 * `B` and whatever the Board (the `board` group), the stills grid or a single still (`still`) binds while it shows.
 * The caller passes only the keys that apply now: one left out is free for the stage's keys, where a disabled one
 * would still hold its binding.
 */
export function useReviewBoardHotkeys(keys: readonly ReviewBoardKey[], group: 'board' | 'still') {
  useHotkeys(keys.map(({ hotkey, name, run }) => ({ hotkey, callback: run, options: { meta: { group, name } } })));
}

/**
 * `B`, "the grid" on every screen: a video's Board in the stage's place and back, a folder of stills' grid and back.
 * The screen calls it whatever shows, since the stage it toggles from isn't this group's. Unbound while drawing, and
 * on a still with no others beside it.
 */
export function useReviewBoardToggleHotkey() {
  const { artifact, mode, setMode, search, setSearch } = useReviewScreen();
  const stills = useReviewStillSiblings();
  const toggle: ReviewBoardKey | null = artifact.kind === 'video'
    ? (mode !== 'draw' && { hotkey: 'B', name: 'Board', run: () => setMode(mode === 'board' ? 'stage' : 'board') }) || null
    : (stills.length > 1 && { hotkey: 'B', name: 'Grid', run: () => setSearch({ view: search.view === 'grid' ? 'stage' : 'grid' }) }) || null;
  useReviewBoardHotkeys(toggle ? [toggle] : [], artifact.kind === 'video' ? 'board' : 'still');
}
