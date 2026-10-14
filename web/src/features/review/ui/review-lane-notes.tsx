import { Box, Group, Text, Tooltip, UnstyledButton } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import { useEffect, useRef, useState } from 'react';
import { reviewThreadTone } from '#lib/output/review/models/review-threads.ts';
import { REVIEW_READOUT_CHAR_PX, reviewTimelineFramePx, reviewTimelineSpan, type ReviewTimelineView } from '#lib/output/review/models/review-timeline-geometry.ts';
import { colors, fonts, radius, typography } from '#web/shared/ui/theme.stylex.ts';
import { useReviewScreen } from './review-screen-context.tsx';
import { ReviewThreadKindIcon } from './review-thread-kind.tsx';
import type { ReviewTimelineNote } from './use-review-dock-lanes.ts';

/** A moment note's dot, and a range note's bar height. */
const REVIEW_NOTE_DOT_PX = 10;
/** A bar this wide has room for its id inside. */
const REVIEW_NOTE_ID_ROOM_PX = 22;
/** The draft's ring: a size up from a note's dot, so it reads around the playhead. */
const REVIEW_DRAFT_PX = 12;
/** The least gap between two dots or pills, else they'd read as one smear. */
const REVIEW_NOTE_GAP_PX = 4;
/** A counted pill's padding, both sides together. */
const REVIEW_NOTE_PILL_PAD_PX = 6;
/** How long a reply landing makes its note pulse. */
const REVIEW_NOTE_PULSE_MS = 1000;

const pulse = stylex.keyframes({
  '0%': { transform: 'scale(1)' },
  '40%': { transform: 'scale(1.5)' },
  '100%': { transform: 'scale(1)' },
});

const styles = stylex.create({
  lane: { position: 'relative', height: '100%', overflow: 'hidden' },
  note: {
    position: 'absolute', top: '3px', height: `${REVIEW_NOTE_DOT_PX}px`, minWidth: `${REVIEW_NOTE_DOT_PX}px`, cursor: 'pointer',
    borderRadius: radius.pill, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
    fontFamily: fonts.mono, lineHeight: typography.lineHeight, color: colors.ground,
    outlineColor: colors.cream, outlineStyle: 'solid', outlineOffset: '1px',
    outlineWidth: { default: 0, ':hover': '1px', ':focus-visible': '1px' },
  },
  // Several notes on one spot: a pill a size up, over all their marks and wide enough for their count.
  counted: { height: '12px', top: '2px', paddingInline: '3px' },
  // Selected: a 2px cream edge drawn inside the mark, as every selected thing has.
  selected: { outlineWidth: '2px', outlineOffset: '-2px' },
  pulsing: { animationName: pulse, animationDuration: `${REVIEW_NOTE_PULSE_MS}ms`, animationTimingFunction: 'ease-out' },
  open: { backgroundColor: colors.accent },
  addressed: { backgroundColor: colors.pass },
  asks: { backgroundColor: colors.caution },
  settled: { backgroundColor: colors.dim },
  // Over the playhead, which it sits on whenever `N` pinned it: a cobalt-washed ring with a dashed edge.
  draft: {
    position: 'absolute', zIndex: 1, top: '2px', height: `${REVIEW_DRAFT_PX}px`, minWidth: `${REVIEW_DRAFT_PX}px`, pointerEvents: 'none', boxSizing: 'border-box',
    borderRadius: radius.pill, borderWidth: '2px', borderStyle: 'dashed', borderColor: colors.cobalt, backgroundColor: colors.flash,
  },
  span: (left: string, width: string) => ({ left, width }),
});

/** A note's state, most pressing first: open on the agent, asked or addressed on you, or settled (resolved, `keep`). */
const REVIEW_NOTE_STATES = ['open', 'asks', 'addressed', 'settled'] as const;

function reviewNoteStateOf(note: ReviewTimelineNote): (typeof REVIEW_NOTE_STATES)[number] {
  const tone = reviewThreadTone(note);
  return tone === 'resolved' || tone === 'keep' ? 'settled' : tone;
}

/**
 * Notes whose marks would touch, as one: a moment's dot, a range's bar (or a dot at its start, when too short to hold
 * its id). Two or more draw as one pill over their whole reach, counted, in the most pressing one's colour; the count
 * widens the pill, so it swallows any mark that would land on the count.
 */
type ReviewNoteCluster = { left: number; right: number; notes: ReviewTimelineNote[] };

/** A range note drawn as a bar: one too short to hold its id is a dot at its start. */
const isBarNote = (note: ReviewTimelineNote, view: ReviewTimelineView) =>
  note.placement.end !== undefined && (note.placement.end + 1 - note.placement.frame) * reviewTimelineFramePx(view) >= REVIEW_NOTE_ID_ROOM_PX;

/** The span a note's own mark covers: its bar, or a dot centred on its frame. */
function reviewNoteMarkOf(note: ReviewTimelineNote, view: ReviewTimelineView): { left: number; right: number } | null {
  if (isBarNote(note, view)) {
    const span = reviewTimelineSpan(view, note.placement.frame, (note.placement.end ?? note.placement.frame) + 1);
    return span && { left: span.x, right: span.x + span.w };
  }
  const span = reviewTimelineSpan(view, note.placement.frame, note.placement.frame + 1);
  if (!span) return null;
  // A dot on the first frame would be half off the lane.
  const x = Math.max(REVIEW_NOTE_DOT_PX / 2, span.x + span.w / 2);
  return { left: x - REVIEW_NOTE_DOT_PX / 2, right: x + REVIEW_NOTE_DOT_PX / 2 };
}

/** A counted pill's width: its count's digits and padding, never under a dot. */
const reviewNoteCountPx = (count: number) => Math.max(REVIEW_NOTE_DOT_PX, REVIEW_NOTE_PILL_PAD_PX + String(count).length * REVIEW_READOUT_CHAR_PX);

function reviewNoteClustersOf(notes: readonly ReviewTimelineNote[], view: ReviewTimelineView): ReviewNoteCluster[] {
  const marks = notes.flatMap((note) => {
    const mark = reviewNoteMarkOf(note, view);
    return mark ? [{ ...mark, note }] : [];
  }).toSorted((a, b) => a.left - b.left);
  const clusters: ReviewNoteCluster[] = [];
  for (const { left, right, note } of marks) {
    const last = clusters.at(-1);
    // The last cluster's reach once it counts one more: its pill may widen past its marks.
    const reach = last && Math.max(last.right, last.left + reviewNoteCountPx(last.notes.length + 1));
    if (last && reach !== undefined && left < reach + REVIEW_NOTE_GAP_PX) {
      last.notes.push(note);
      last.right = Math.max(last.right, right, last.left + reviewNoteCountPx(last.notes.length));
    } else clusters.push({ left, right, notes: [note] });
  }
  return clusters;
}

// A function, not `noteStateStyle(state)`: StyleX compiles only plain member access on its styles.
function noteStateStyle(state: (typeof REVIEW_NOTE_STATES)[number]) {
  if (state === 'open') return styles.open;
  if (state === 'asks') return styles.asks;
  return state === 'addressed' ? styles.addressed : styles.settled;
}

const reviewNoteSummary = (note: ReviewTimelineNote) => `#${note.id} ${(note.entries[0]?.text ?? '').split('\n')[0]}`;

/** A note's line in the mark's tooltip: its kind's icon, then its id and first line. */
function ReviewNoteSummaryLine({ note }: { readonly note: ReviewTimelineNote }) {
  return (
    <Group gap="tight" wrap="nowrap" align="center">
      <ReviewThreadKindIcon kind={note.kind} />
      <Text component="span" size="sm">{reviewNoteSummary(note)}</Text>
    </Group>
  );
}

/** The ids of notes that just took an agent's reply, pulsing for a second as the thread's row flashes. */
function useReviewNotesPulsing(notes: readonly ReviewTimelineNote[]): ReadonlySet<number> {
  const seen = useRef<Map<number, number> | null>(null);
  const [pulsing, setPulsing] = useState<ReadonlySet<number>>(new Set());
  useEffect(() => {
    const before = seen.current;
    seen.current = new Map(notes.map((n) => [n.id, n.entries.length]));
    if (!before) return undefined;
    const replied = notes.filter((n) => n.entries.length > (before.get(n.id) ?? n.entries.length) && n.entries.at(-1)?.author === 'agent');
    if (!replied.length) return undefined;
    setPulsing(new Set(replied.map((n) => n.id)));
    const timer = setTimeout(() => setPulsing(new Set()), REVIEW_NOTE_PULSE_MS);
    return () => clearTimeout(timer);
  }, [notes]);
  return pulsing;
}

/**
 * The notes on this render, the only colour in the dock: a dot for a moment, a bar for a range, in its state's colour.
 * Marks that would touch are one, counted, in the most pressing state's colour; a click selects the next of them
 * and seeks to it. The draft's pin or range is a dashed cobalt outline.
 */
export function ReviewLaneNotes({ view, notes }: { readonly view: ReviewTimelineView; readonly notes: readonly ReviewTimelineNote[] }) {
  const { draft, search, setSearch, playback } = useReviewScreen();
  const pulsing = useReviewNotesPulsing(notes);
  const pinned = draft.anchor.on === 'video' && draft.anchor.frame !== undefined
    ? reviewTimelineSpan(view, draft.anchor.frame, (draft.anchor.end ?? draft.anchor.frame) + 1)
    : null;
  const select = (note: ReviewTimelineNote) => {
    setSearch({ note: note.id });
    playback.seek(note.placement.frame);
  };
  return (
    <Box data-review-lane="notes" {...stylex.props(styles.lane)}>
      {reviewNoteClustersOf(notes, view).map(({ left, right, notes: here }) => {
        const state = REVIEW_NOTE_STATES.find((s) => here.some((n) => reviewNoteStateOf(n) === s)) ?? 'settled';
        const at = here.findIndex((n) => n.id === search.note);
        const counted = here.length > 1;
        const width = right - left;
        const roomy = width >= REVIEW_NOTE_ID_ROOM_PX;
        const label = counted ? here.length : (roomy && here[0].id) || null;
        return (
          // Beside the mark, over the lanes: above, it'd cover the transport and the hover preview, and the dock's foot
          // leaves no room below.
          <Tooltip key={here[0].id} label={<Box>{here.map((n) => <ReviewNoteSummaryLine key={n.id} note={n} />)}</Box>}
            openDelay={300} withinPortal multiline maw={320} position="right">
            <UnstyledButton aria-label={here.map((n) => `note ${n.id}`).join(', ')} onClick={() => select(here[(at + 1) % here.length])}
              fz="xs" {...stylex.props(styles.note, counted && styles.counted, noteStateStyle(state), at >= 0 && styles.selected,
                here.some((n) => pulsing.has(n.id)) && styles.pulsing, styles.span(`${left}px`, `${width}px`))}>
              {label !== null && <Text component="span" inherit>{label}</Text>}
            </UnstyledButton>
          </Tooltip>
        );
      })}
      {pinned && <Box {...stylex.props(styles.draft, styles.span(`${pinned.w > REVIEW_DRAFT_PX ? pinned.x : pinned.x + pinned.w / 2 - REVIEW_DRAFT_PX / 2}px`, `${Math.max(pinned.w, REVIEW_DRAFT_PX)}px`))} />}
    </Box>
  );
}
