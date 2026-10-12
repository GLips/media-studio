import { Box, Group, Text } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import { useHotkey } from '@tanstack/react-hotkeys';
import { useMemo, useRef, useState } from 'react';
import type { PlacedReviewThread } from '#lib/output/review/models/review-placement.ts';
import { ReviewThreadPanel, ReviewThreadScopeProvider, useReviewDraft, type ReviewThreadScope } from '#web/features/review/index.ts';
import { Readout } from '#web/shared/ui/readout.tsx';
import { focusNoteFieldAtEnd } from '#web/shared/ui/textarea.tsx';
import { colors, spacing } from '#web/shared/ui/theme.stylex.ts';
import { useDecisionScreen } from './decision-screen-context.tsx';

const styles = stylex.create({
  thread: { height: '100%', minHeight: 0 },
  // Set in from the filter row's own start to the rows' text, with room before the counts that follow it.
  head: { paddingInlineStart: spacing.tight, marginInlineEnd: spacing.gap, minWidth: 0 },
  label: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: colors.cream },
});

/**
 * The focused candidate's thread, headed `B  drive`, with the whole decision's notes beside its own; a new note is on
 * the candidate, and `N` puts the cursor in it. Mounted per candidate (keyed by it), so each keeps its own draft. Its
 * filter lives on the page: the URL's is `F`'s.
 */
export function DecisionThread() {
  const { project, view, decision, focused, ops, search, setSearch, playback } = useDecisionScreen();
  const draft = useReviewDraft(`${project}/decisions/${decision.id}/${focused ?? ''}`);
  const [filter, setFilter] = useState<ReviewThreadScope['search']['filter']>();
  const box = useRef<HTMLDivElement>(null);
  // The composer is the review's: its field is reached through the DOM, as the panel offers no ref to it.
  useHotkey('N', () => focusNoteFieldAtEnd(box.current?.querySelector('textarea')), { meta: { group: 'decision', name: 'Note' } });
  // A decision's notes are about no frame or file, so each is placed as it stands.
  const threads = useMemo(() => view.threads.map((t): PlacedReviewThread => ({ ...t, placement: { shifted: false } })), [view.threads]);
  const candidate = decision.candidates.find((c) => c.key === focused);
  // A note on something that plays is pinned to the time it was heard at; a still or text candidate has no time.
  const timed = candidate?.media?.kind === 'audio' || candidate?.media?.kind === 'video';
  const scope: ReviewThreadScope = {
    project, subject: { on: 'decision', decision: decision.id, ...(focused !== null && { candidate: focused }) }, threads, ops, draft, media: null,
    ...(timed && { timeNow: playback.timeNow }),
    search: { ...(search.note !== undefined && { note: search.note }), ...(filter && { filter }) },
    setSearch: (patch) => {
      if ('filter' in patch) setFilter(patch.filter);
      if ('note' in patch) setSearch({ note: patch.note });
    },
  };
  return (
    <Box ref={box} {...stylex.props(styles.thread)}>
      <ReviewThreadScopeProvider value={scope}>
        <ReviewThreadPanel head={candidate && (
          <Group gap="gap" wrap="nowrap" {...stylex.props(styles.head)}>
            <Readout bright>{candidate.key.toUpperCase()}</Readout>
            <Text component="span" size="sm" {...stylex.props(styles.label)}>{candidate.label}</Text>
          </Group>
        )} />
      </ReviewThreadScopeProvider>
    </Box>
  );
}
