import { useHotkeys } from '@tanstack/react-hotkeys';
import type { RefObject } from 'react';
import { useReviewScreen } from '#web/features/review/index.ts';
import { hotkeySequencePending } from '#web/shared/ui/use-global-hotkeys.ts';
import type { ReviewScriptRead, ReviewScriptTakeRead } from '../controllers/review-script.ts';
import { useScriptSearch } from '../controllers/script-search.ts';
import { scriptLineIndexAt, scriptNoteAnchorOf, scriptSelectionIn, type ScriptTimedLine } from './script-read-along.ts';

type ScriptHotkeysOptions = {
  readonly script: ReviewScriptRead;
  readonly take: ReviewScriptTakeRead;
  readonly timed: readonly (ScriptTimedLine | null)[];
  /** The lines' list, where a selection of words is looked for. */
  readonly linesRef: RefObject<HTMLElement | null>;
};

/**
 * The read-along's keys: the arrows move the line in focus (and the playhead to it), `Space` plays from that line,
 * `N` notes the selected words or the line, `Escape` lets go of the note open. The line in focus is the URL's, else the one the playhead is on.
 */
export function useScriptHotkeys({ script, take, timed, linesRef }: ScriptHotkeysOptions) {
  const { playback, draft } = useReviewScreen();
  const [search, setSearch] = useScriptSearch();
  const focusedIndex = () => {
    const named = script.lines.findIndex((l) => l.id === search.line);
    return named >= 0 ? named : Math.max(0, scriptLineIndexAt(timed, playback.frameNow()));
  };
  const moveLine = (by: -1 | 1) => () => {
    const index = Math.max(0, Math.min(script.lines.length - 1, focusedIndex() + by));
    // The note and the selected words were elsewhere: left lit, they'd read as a second focus.
    window.getSelection()?.removeAllRanges();
    setSearch({ line: script.lines[index].id, ...(search.note !== undefined && { note: undefined }) });
    const line = timed[index];
    if (line) playback.seek(line.from);
  };
  const playFromLine = () => {
    if (playback.getState().playing) return playback.pause();
    const line = timed[focusedIndex()], frame = playback.frameNow();
    if (line && (frame < line.from || frame >= line.to)) playback.seek(line.from);
    return playback.play();
  };
  const note = () => {
    // The N of `G N` goes to the thread, not to a note.
    if (hotkeySequencePending()) return;
    const root = linesRef.current;
    const run = root ? scriptSelectionIn(root) : null;
    const line = script.lines.find((l) => l.id === run?.line) ?? script.lines[focusedIndex()];
    if (!line) return;
    playback.pause();
    window.getSelection()?.removeAllRanges();
    setSearch({ line: line.id });
    draft.setAnchor(scriptNoteAnchorOf(line, run, script.hash, take.hash));
  };
  const closeNote = () => {
    window.getSelection()?.removeAllRanges();
    if (search.note !== undefined) setSearch({ note: undefined });
  };
  useHotkeys([
    { hotkey: 'ArrowUp', callback: moveLine(-1), options: { meta: { group: 'script', name: 'Previous line' } } },
    { hotkey: 'ArrowDown', callback: moveLine(1), options: { meta: { group: 'script', name: 'Next line' } } },
    { hotkey: 'Space', callback: playFromLine, options: { meta: { group: 'script', name: 'Play' } } },
    { hotkey: 'N', callback: note, options: { meta: { group: 'script', name: 'Note' } } },
    { hotkey: 'Escape', callback: closeNote, options: { ignoreInputs: true, meta: { group: 'script', name: 'Close note' } } },
  ]);
}
