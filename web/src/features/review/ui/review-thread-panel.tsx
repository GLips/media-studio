import { Group, Stack, Text } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import { useRef, type ReactNode } from 'react';
import type { PlacedReviewThread } from '#lib/output/review/models/review-placement.ts';
import { Readout } from '#web/shared/ui/readout.tsx';
import { colors, spacing } from '#web/shared/ui/theme.stylex.ts';
import { ReviewThreadComposer } from './review-thread-composer.tsx';
import { ReviewThreadFilter } from './review-thread-filter.tsx';
import { ReviewThreadList, reviewThreadListEmpty, reviewThreadListingOf } from './review-thread-list.tsx';
import { ReviewThreadRow } from './review-thread-row.tsx';
import { useReviewThreadScope } from './review-thread-scope.tsx';
import { REVIEW_THREAD_ATTRIBUTE, useReviewThreadHotkeys } from './use-review-thread-hotkeys.ts';
import { useReviewNoteFocusRelease, useReviewThreadActions, useReviewThreadLive } from './use-review-thread-panel.ts';

const styles = stylex.create({
  panel: { height: '100%', minHeight: 0, backgroundColor: colors.panel, outlineWidth: 0 },
  // Top-left, where the first note will land, and dim. Hidden while a note is being written. The panel carries
  // `stylex.defaultMarker()`; the attribute is REVIEW_COMPOSER_ATTRIBUTE, spelled out as the compiler needs.
  empty: {
    flex: 1, minHeight: 0, alignItems: 'flex-start', alignContent: 'flex-start', padding: spacing.inset, color: colors.dim,
    visibility: { default: 'visible', [stylex.when.ancestor(':has([data-review-composer] textarea:focus)')]: 'hidden' },
  },
  hidden: { visibility: 'hidden' },
});

/**
 * The full-height thread of its scope's subject: filter chips, the notes and their replies, the resolved folded at
 * the end, the unplaced group, and the composer at its foot. The list follows the playhead; `G N` puts the keys in it.
 * `head` leads the filter row: which thread this is, where a screen has several (a decision's candidates).
 */
export function ReviewThreadPanel({ head }: { readonly head?: ReactNode }) {
  const scope = useReviewThreadScope();
  const { subject, threads, media, search, setSearch, draft } = scope;
  const threadRef = useRef<HTMLDivElement>(null);
  const listing = reviewThreadListingOf(scope);
  const { listed, unplaced, counts, filter } = listing;
  const actions = useReviewThreadActions(listing.scoped);
  const live = useReviewThreadLive(listed, media?.playback);
  useReviewNoteFocusRelease(threads && [...listed, ...unplaced]);
  // Only a file's thread (a render, a still, the script) binds the screen-wide keys: there's one per screen.
  const screenThread = subject.on === 'video' || subject.on === 'still' || subject.on === 'script';
  const screenPlayback = subject.on === 'video' || subject.on === 'still' ? media?.playback : undefined;
  useReviewThreadHotkeys({ threadRef, listed, actions, currentId: search.note ?? live.currentId, screenThread, screenPlayback,
    noteStepGroup: subject.on === 'still' ? 'still' : 'playback' });

  const place = media && {
    fps: media.timing.fps, renderHash: media.artifact.render.hash, scenes: media.artifact.scenes ?? [], versions: media.versions,
    lines: media.artifact.timing?.lines.map((line) => line.id) ?? [],
  };
  const rowOf = (thread: PlacedReviewThread) => (
    <ReviewThreadRow
      key={thread.id}
      thread={thread}
      place={place}
      actions={actions}
      look={{
        current: live.currentId === thread.id, selected: actions.selected.has(thread.id),
        flashing: live.flashing.has(thread.id), expanded: search.note === thread.id, inline: actions.inline,
      }}
    />
  );

  return (
    <Stack ref={threadRef} gap={0} tabIndex={-1} aria-label="Thread" {...{ [REVIEW_THREAD_ATTRIBUTE]: subject.on }} {...stylex.props(styles.panel, stylex.defaultMarker())}>
      <ReviewThreadFilter head={head} counts={counts} filter={filter} onFilter={(next) => setSearch({ filter: next })} actions={actions} />
      {reviewThreadListEmpty(listing, actions) ? (
        <Group gap="tight" wrap="nowrap" {...stylex.props(styles.empty, draft.isOpen && styles.hidden)}>
          <Text component="span" size="sm" inherit>New note</Text>
          <Readout>N</Readout>
        </Group>
      ) : <ReviewThreadList listing={listing} actions={actions} live={live} rowOf={rowOf} />}
      <ReviewThreadComposer />
    </Stack>
  );
}
