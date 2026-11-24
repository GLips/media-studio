import { useHotkeys, type UseHotkeyDefinition } from '@tanstack/react-hotkeys';
import { libraryFlagBeside, type LibraryFlagFilter } from '#lib/footage/library/models/library-flags.ts';
import type { LibraryItemScreenValue } from './library-item-context.tsx';
import { LIBRARY_VOLUME_STEP } from './library-item-playback.ts';

const libraryKey = (hotkey: UseHotkeyDefinition['hotkey'], name: string, callback: () => void, ignoreInputs?: boolean): UseHotkeyDefinition =>
  ({ hotkey, callback, options: { ...(ignoreInputs !== undefined && { ignoreInputs }), meta: { group: 'library', name } } });

const FILTER_CYCLE: readonly LibraryFlagFilter[] = ['all', 'agent', 'reviewer'];

/** How far ← and → move the playhead, and with Shift. */
const LIBRARY_NUDGE_SECONDS = 2, LIBRARY_JUMP_SECONDS = 10;

/**
 * The item screen's keys: Space plays, ← → move, M mutes, Alt+↑ ↓ set the volume; I and O mark a range, F flags it;
 * N and Shift+N step through the flags, each looping; E edits its note, Mod+Backspace removes it, Mod+Z puts it
 * back; A cycles whose flags show; Esc lets go of the flag, then the range.
 */
export function useLibraryItemHotkeys(screen: LibraryItemScreenValue) {
  const { playback, queue, focused, focusFlag, marked, setMarked, composing, setComposing, removeFlag, undoRemove, filter, setFilter } = screen;
  const step = (direction: -1 | 1) => () => {
    const to = libraryFlagBeside(queue, { ...(focused && { flag: focused.id }), seconds: playback.timeNow() }, direction);
    if (to) focusFlag(to);
  };
  const mark = (end: 'start' | 'end') => () => {
    const now = playback.timeNow();
    const other = marked ? marked[end === 'start' ? 'end' : 'start'] : now;
    const [start, stop] = end === 'start' ? [now, Math.max(now, other)] : [Math.min(now, other), now];
    setMarked({ start, end: stop });
  };
  const defs: UseHotkeyDefinition[] = [
    libraryKey('Space', 'Play', playback.toggle),
    libraryKey('ArrowLeft', 'Back 2 s', () => playback.seek(playback.timeNow() - LIBRARY_NUDGE_SECONDS)),
    libraryKey('ArrowRight', 'On 2 s', () => playback.seek(playback.timeNow() + LIBRARY_NUDGE_SECONDS)),
    libraryKey('Shift+ArrowLeft', 'Back 10 s', () => playback.seek(playback.timeNow() - LIBRARY_JUMP_SECONDS)),
    libraryKey('Shift+ArrowRight', 'On 10 s', () => playback.seek(playback.timeNow() + LIBRARY_JUMP_SECONDS)),
    libraryKey('M', 'Mute', () => playback.setMuted(!playback.getState().muted)),
    libraryKey('Alt+ArrowUp', 'Louder', () => playback.setVolume(playback.getState().volume + LIBRARY_VOLUME_STEP)),
    libraryKey('Alt+ArrowDown', 'Quieter', () => playback.setVolume(playback.getState().volume - LIBRARY_VOLUME_STEP)),
    libraryKey('I', 'Mark in', mark('start')),
    libraryKey('O', 'Mark out', mark('end')),
    libraryKey('N', 'Next flag', step(1)),
    libraryKey('Shift+N', 'Previous flag', step(-1)),
    libraryKey('A', 'Whose flags', () => setFilter(FILTER_CYCLE[(FILTER_CYCLE.indexOf(filter) + 1) % FILTER_CYCLE.length])),
  ];
  if (marked && !composing) defs.push(libraryKey('F', 'Flag range', () => setComposing({ kind: 'new', range: marked })));
  if (focused && !composing) {
    defs.push(
      libraryKey('E', 'Edit note', () => setComposing({ kind: 'note', flag: focused.id })),
      libraryKey('Mod+Backspace', 'Remove flag', () => {
        removeFlag(focused);
        focusFlag(undefined);
      }),
    );
  }
  if (undoRemove && !composing) defs.push(libraryKey('Mod+Z', 'Undo remove', undoRemove));
  // Not from a field: there Escape is the composer's.
  if (focused) defs.push(libraryKey('Escape', 'Leave flag', () => focusFlag(undefined), true));
  else if (marked) defs.push(libraryKey('Escape', 'Clear range', () => setMarked(null), true));
  useHotkeys(defs);
}
