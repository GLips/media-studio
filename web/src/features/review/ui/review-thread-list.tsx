import { Box, Group, Stack, Text, UnstyledButton } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import { formatForDisplay } from '@tanstack/react-hotkeys';
import { useEffect, useRef, type ReactNode } from 'react';
import { type PlacedReviewThread, reviewThreadFrameOf, reviewThreadsInScope, sortReviewThreadsByPlace } from '#lib/output/review/models/review-placement.ts';
import { countReviewThreadTones, reviewThreadTone, type ReviewAnchor, type ReviewThreadTone } from '#lib/output/review/models/review-threads.ts';
import { FadeScroll } from '#web/shared/ui/fade-scroll.tsx';
import { HotkeyTooltip } from '#web/shared/ui/hotkey-tooltip.tsx';
import { Readout } from '#web/shared/ui/readout.tsx';
import { colors, radius, spacing } from '#web/shared/ui/theme.stylex.ts';
import type { ReviewSearch } from '../controllers/review-search.ts';
import { useReviewThreadScope, type ReviewThreadScope } from './review-thread-scope.tsx';
import { ReviewThreadUnplaced } from './review-thread-unplaced.tsx';
import type { ReviewThreadActions, useReviewThreadLive } from './use-review-thread-panel.ts';

const styles = stylex.create({
  list: { flex: 1, minHeight: 0 },
  foldRow: {
    height: spacing.row, paddingInlineStart: spacing.inset, paddingInlineEnd: spacing.tight, color: colors.dim,
    backgroundColor: { default: 'transparent', ':hover': colors.raised },
  },
  fold: { flex: 1, textAlign: 'start', height: '100%', color: colors.dim },
  undo: { color: colors.cream },
  clear: {
    height: '20px', paddingInline: spacing.tight, borderRadius: radius.control, color: { default: colors.dim, ':hover': colors.cream },
    backgroundColor: { default: 'transparent', ':hover': colors.raised },
  },
});

type ReviewThreadFilterName = NonNullable<ReviewSearch['filter']>;

/** An open note waiting on the agent: the `●` the filter row counts and narrows to. */
const isOpenNote = (t: PlacedReviewThread) => reviewThreadTone(t) === 'open';

const LISTED_BY_FILTER: Readonly<Record<ReviewThreadFilterName, (t: PlacedReviewThread) => boolean>> = {
  active: (t) => t.state !== 'resolved',
  open: isOpenNote,
  all: () => true,
};

/** A row of the list: a note, or a deleted note's place offering Undo for a few seconds. */
type ReviewThreadListItem = { kind: 'thread'; thread: PlacedReviewThread; at: number } | { kind: 'undo'; key: number; ids: readonly number[]; at: number };

/** What the panel lists under its filter, worked out from its scope's threads alone. */
export type ReviewThreadListing = {
  /** The subject's threads, placed or not: what the bulk actions reach. */
  scoped: PlacedReviewThread[];
  /** Placed rows in list order, the shown resolved last: what the keys walk. */
  listed: PlacedReviewThread[];
  /** The resolved, listed under their fold row once `all` lets them in. */
  shownResolved: PlacedReviewThread[];
  unplaced: PlacedReviewThread[];
  counts: Record<ReviewThreadTone, number>;
  filter: ReviewThreadFilterName;
};

export function reviewThreadListingOf({ threads, subject, search }: Pick<ReviewThreadScope, 'threads' | 'subject' | 'search'>): ReviewThreadListing {
  const scoped = reviewThreadsInScope(threads ?? [], subject);
  const placed = sortReviewThreadsByPlace(scoped.filter((t) => !('unplaced' in t.placement)));
  const filter = search.filter ?? 'active';
  // Shown, the resolved stay under their fold row at the end, in time order there, and the keys walk them last.
  const shownResolved = filter === 'all' ? placed.filter((t) => t.state === 'resolved') : [];
  const listed = [...placed.filter(LISTED_BY_FILTER[filter]).filter((t) => filter !== 'all' || t.state !== 'resolved'), ...shownResolved];
  return { scoped, listed, shownResolved, unplaced: scoped.filter((t) => 'unplaced' in t.placement), counts: countReviewThreadTones(placed), filter };
}

/**
 * The keys written out, not read from the registry: a panel that stays mounted and reads it is updated while the
 * screen's keys re-register mid-render. Every screen with a thread binds `N` and `Mod+Z`.
 */
const REVIEW_UNDO_KEYS = formatForDisplay('Mod+Z');

/** `Deleted #12 · Undo ⌘Z`, or `Deleted 3 · Undo` for a batch: what went, and the way back. */
function ReviewThreadUndoRow({ ids, onUndo }: { readonly ids: readonly number[]; readonly onUndo: () => void }) {
  return (
    <Group wrap="nowrap" {...stylex.props(styles.foldRow)}>
      <UnstyledButton onClick={onUndo} {...stylex.props(styles.fold)}>
        <Text component="span" size="sm" inherit>
          Deleted {ids.length > 1 ? ids.length : `#${ids[0]}`} · <Text component="span" inherit {...stylex.props(styles.undo)}>Undo</Text>
          {' '}<Readout>{REVIEW_UNDO_KEYS}</Readout>
        </Text>
      </UnstyledButton>
    </Group>
  );
}

/**
 * The listed notes with the Undo of each delete still showing, at its note's old place: just ahead of any note at the
 * same frame, so the rows under the pointer don't shift.
 */
const deletedAtOf = (t: { anchor: ReviewAnchor }) => (t.anchor.on === 'video' ? t.anchor.frame - 0.5 : Number.POSITIVE_INFINITY);

function listItemsOf(listed: readonly PlacedReviewThread[], deleted: ReviewThreadActions['deleted']): ReviewThreadListItem[] {
  const undos = deleted.filter((b) => b.shown && !b.resolvedGroup).map((b): ReviewThreadListItem => ({ kind: 'undo', key: b.key, ids: b.threads.map((t) => t.thread.id), at: deletedAtOf(b.threads[0].thread) }));
  const threads = listed.map((thread): ReviewThreadListItem => ({ kind: 'thread', thread, at: reviewThreadFrameOf(thread) ?? Number.POSITIVE_INFINITY }));
  return [...undos, ...threads].toSorted((a, b) => a.at - b.at);
}

/** True when the list would show nothing at all, and the panel shows its empty hint in its place. */
export const reviewThreadListEmpty = ({ listed, counts, unplaced }: ReviewThreadListing, actions: ReviewThreadActions) =>
  listed.length === 0 && counts.resolved === 0 && unplaced.length === 0 && !actions.deleted.some((b) => b.shown);

type ReviewThreadListProps = {
  readonly listing: ReviewThreadListing;
  readonly actions: ReviewThreadActions;
  readonly live: ReturnType<typeof useReviewThreadLive>;
  readonly rowOf: (thread: PlacedReviewThread) => ReactNode;
};

/** The notes and each delete's Undo in time order, the resolved under their fold row, and the unplaced group last. */
export function ReviewThreadList({ listing, actions, live, rowOf }: ReviewThreadListProps) {
  const { project, setSearch } = useReviewThreadScope();
  const { listed, shownResolved, unplaced, counts, filter } = listing;
  // Unfolded from its row, the resolved are brought into view: they open under the row, often below the fold.
  const revealResolved = useRef(false);
  const lastResolved = shownResolved.at(-1)?.id;
  useEffect(() => {
    if (!revealResolved.current || lastResolved === undefined) return;
    revealResolved.current = false;
    live.viewportRef.current?.querySelector(`[data-thread-id="${lastResolved}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [lastResolved, live.viewportRef]);

  const items = listItemsOf(listed.slice(0, listed.length - shownResolved.length), actions.deleted);
  const cleared = actions.deleted.findLast((b) => b.shown && b.resolvedGroup);
  return (
    <Box {...stylex.props(styles.list)} onWheel={live.markManualScroll} onPointerDown={live.markManualScroll}>
      <FadeScroll viewportRef={live.viewportRef}>
        <Stack gap={0} role="list">
          {items.map((item) => (item.kind === 'undo'
            ? <ReviewThreadUndoRow key={`undo-${item.key}`} ids={item.ids} onUndo={() => actions.restore(item.key)} />
            : rowOf(item.thread)))}
          {cleared && <ReviewThreadUndoRow ids={cleared.threads.map((t) => t.thread.id)} onUndo={() => actions.restore(cleared.key)} />}
          {counts.resolved > 0 && filter !== 'open' && (
            <Group gap="tight" wrap="nowrap" {...stylex.props(styles.foldRow)}>
              <UnstyledButton
                aria-expanded={filter === 'all'}
                onClick={() => {
                  revealResolved.current = filter !== 'all';
                  setSearch({ filter: filter === 'all' ? 'active' : 'all' });
                }}
                {...stylex.props(styles.fold)}
              >
                <Text component="span" size="sm" inherit>✓ {counts.resolved} resolved {filter === 'all' ? '▾' : '▸'}</Text>
              </UnstyledButton>
              <HotkeyTooltip name="Clear resolved" hotkey="Clear resolved">
                <UnstyledButton onClick={actions.clearResolved} {...stylex.props(styles.clear)}>
                  <Text component="span" size="sm" inherit>Clear</Text>
                </UnstyledButton>
              </HotkeyTooltip>
            </Group>
          )}
          {shownResolved.map(rowOf)}
          <ReviewThreadUnplaced threads={unplaced} project={project} actions={actions} />
        </Stack>
      </FadeScroll>
    </Box>
  );
}
