import { Text } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import { useEffect, useRef, type RefObject } from 'react';
import type { PlacedReviewThread } from '#lib/output/review/models/review-placement.ts';
import { useReviewScreen, useReviewThreads } from '#web/features/review/index.ts';
import { FadeScroll } from '#web/shared/ui/fade-scroll.tsx';
import { spacing } from '#web/shared/ui/theme.stylex.ts';
import type { ReviewScriptRead } from '../controllers/review-script.ts';
import { useScriptSearch } from '../controllers/script-search.ts';
import { ScriptLineRow, type ScriptLineActions, type ScriptLineThread } from './script-line-row.tsx';
import { scriptNotePlaceOf, scriptThreadMarkOf, type ScriptTimedLine } from './script-read-along.ts';
import { useScriptCurrentLine } from './use-script-current-line.ts';
import { useScriptFollow } from './use-script-follow.ts';

const styles = stylex.create({
  // A reading column, centred: 84ch of the script's size is about 72 of words beside the number and time.
  list: { paddingBlock: spacing.inset, maxWidth: '84ch', marginInline: 'auto' },
});

/** The open script threads by line, each with its mark and the words it's on. Resolved ones leave the lines. */
function scriptThreadsByLine(threads: readonly PlacedReviewThread[], lines: ReviewScriptRead['lines']): Map<string, ScriptLineThread[]> {
  const byLine = new Map<string, ScriptLineThread[]>();
  for (const thread of threads) {
    const { anchor, placement } = thread;
    if (anchor.on !== 'script' || thread.state === 'resolved' || 'unplaced' in placement) continue;
    const word = 'word' in placement ? placement.word : undefined;
    const wordEnd = 'wordEnd' in placement ? placement.wordEnd : undefined;
    const mark = scriptThreadMarkOf(thread);
    const label = `${scriptNotePlaceOf(lines, anchor)} · ${mark.glyph === '?' ? 'question' : thread.state}`;
    const entry = { id: thread.id, label, mark, run: word === undefined ? null : { word, wordEnd: wordEnd ?? word } };
    byLine.set(anchor.line, [...(byLine.get(anchor.line) ?? []), entry]);
  }
  return byLine;
}

/**
 * Opening a note, from its mark or the thread, takes the playhead to its words (or its line), and with it the line in
 * focus and the scroll. Once per opening: the threads' polls don't pull the playhead back.
 */
function useScriptNoteSeek(script: ReviewScriptRead, timed: readonly (ScriptTimedLine | null)[], threads: readonly PlacedReviewThread[] | undefined, note: number | undefined) {
  const { playback } = useReviewScreen();
  const sought = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (note === undefined) sought.current = undefined;
    if (note === undefined || note === sought.current) return;
    const anchor = threads?.find((t) => t.id === note)?.anchor;
    if (anchor?.on !== 'script') return;
    sought.current = note;
    const line = timed[script.lines.findIndex((l) => l.id === anchor.line)];
    if (line) playback.seek(anchor.word === undefined ? line.from : line.words[anchor.word]?.from ?? line.from);
  }, [note, threads, timed, script.lines, playback]);
}

type ScriptLinesProps = {
  readonly script: ReviewScriptRead;
  readonly timed: readonly (ScriptTimedLine | null)[];
  /** The scrolled list, where the follow scrolls and `N` looks for selected words. */
  readonly viewportRef: RefObject<HTMLDivElement | null>;
};

/**
 * The script, line under line, read along: the line being read in cream, its word swept in cobalt, the list keeping it
 * in view; the line in focus (the URL's) carries the cream rule.
 */
export function ScriptLines({ script, timed, viewportRef }: ScriptLinesProps) {
  const { playback, draft, setSearch: setReviewSearch } = useReviewScreen();
  const [search] = useScriptSearch();
  const current = useScriptCurrentLine(playback, timed);
  const placed = useReviewThreads();
  const readerScroll = useScriptFollow(viewportRef, script.lines[current]?.id ?? search.line);
  const byLine = scriptThreadsByLine(placed?.threads ?? [], script.lines);
  useScriptNoteSeek(script, timed, placed?.threads, search.note);
  const draftAnchor = draft.anchor.on === 'script' ? draft.anchor : null;
  const actions: ScriptLineActions = { seek: playback.seek, openThread: (id) => setReviewSearch({ note: id }) };
  return (
    <FadeScroll viewportRef={viewportRef}>
      <Text component="div" size="lg" {...readerScroll} {...stylex.props(styles.list)}>
        {script.lines.map((line, i) => (
          <ScriptLineRow
            key={line.id} line={line} index={i} timed={timed[i]} threads={byLine.get(line.id) ?? []} actions={actions}
            highlight={{ current: i === current, focused: line.id === search.line }}
            draftRun={draftAnchor?.line === line.id && draftAnchor.word !== undefined ? { word: draftAnchor.word, wordEnd: draftAnchor.wordEnd ?? draftAnchor.word } : null}
          />
        ))}
      </Text>
    </FadeScroll>
  );
}
