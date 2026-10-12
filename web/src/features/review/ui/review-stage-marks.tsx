import { Box, Text, UnstyledButton } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import { useEffect, useRef, useSyncExternalStore } from 'react';
import type { PlacedReviewThread } from '#lib/output/review/models/review-placement.ts';
import type { ReviewMark, ReviewPoint } from '#lib/output/review/models/review-threads.ts';
import { shadows } from '#web/shared/ui/shadows.ts';
import { colors, fonts, radius, spacing, typography } from '#web/shared/ui/theme.stylex.ts';
import { drawReviewMarks, reviewTokenColorOf } from './review-frame-image.ts';
import { useReviewPlaybackState } from './review-playback-store.ts';
import { useReviewFrame, useReviewScreen } from './review-screen-context.tsx';
import { REVIEW_COMPOSER_ATTRIBUTE } from './review-thread-composer.tsx';
import { useReviewThreads } from './use-review-threads.ts';

/** A saved note's state as its marks show it: colour means state, and nothing else. */
type ReviewMarkTone = 'open' | 'addressed' | 'asks' | 'resolved';

const REVIEW_MARK_TONE_COLORS: Record<ReviewMarkTone, string> = {
  open: colors.accent, addressed: colors.pass, asks: colors.caution, resolved: colors.dim,
};

/**
 * A draft pinned on another frame than the one shown, or left standing (`Escape` from the composer), is kept faint:
 * not mistaken for this frame's, nor for the note being written.
 */
const FAINT_DRAFT_ALPHA = 0.35;
/** Stroke width on the stage, in CSS pixels: wide enough that its ground halo holds on a saturated frame. */
const STAGE_MARK_WIDTH = 3;

const styles = stylex.create({
  layer: { position: 'absolute', inset: 0, pointerEvents: 'none' },
  canvas: { position: 'absolute', inset: 0, width: '100%', height: '100%' },
  pinAt: (x: number, y: number) => ({ left: `${x * 100}%`, top: `${y * 100}%` }),
  pin: {
    position: 'absolute', transform: 'translate(-50%, -50%)', minWidth: spacing.rowDense, height: spacing.rowDense, paddingInline: spacing.tight,
    borderRadius: radius.pill, borderWidth: spacing.hairline, borderStyle: 'solid', boxSizing: 'border-box',
    fontFamily: fonts.mono, lineHeight: typography.lineHeight, textAlign: 'center',
    pointerEvents: 'auto', cursor: 'pointer', backgroundColor: colors.ground,
  },
  // Hollow at rest, filled under the pointer: the marks' "you can click this".
  open: { borderColor: colors.accent, color: { default: colors.accent, ':hover': colors.ground }, backgroundColor: { default: colors.ground, ':hover': colors.accent } },
  addressed: { borderColor: colors.pass, color: { default: colors.pass, ':hover': colors.ground }, backgroundColor: { default: colors.ground, ':hover': colors.pass } },
  asks: { borderColor: colors.caution, color: { default: colors.caution, ':hover': colors.ground }, backgroundColor: { default: colors.ground, ':hover': colors.caution } },
  resolved: { borderColor: colors.dim, color: { default: colors.dim, ':hover': colors.ground }, backgroundColor: { default: colors.ground, ':hover': colors.dim } },
  focused: { outlineWidth: spacing.hairline, outlineStyle: 'solid', outlineColor: colors.cream, outlineOffset: '1px' },
  draftPin: {
    position: 'absolute', transform: 'translate(-50%, -50%)', width: spacing.inset, height: spacing.inset, borderRadius: radius.pill,
    backgroundColor: colors.cobalt, pointerEvents: 'none',
  },
  faint: { opacity: FAINT_DRAFT_ALPHA },
});

const subscribeToFocus = (onChange: () => void) => {
  document.addEventListener('focusin', onChange);
  document.addEventListener('focusout', onChange);
  return () => {
    document.removeEventListener('focusin', onChange);
    document.removeEventListener('focusout', onChange);
  };
};

/** Whether the composer holds the focus: the draft is being written, not left standing. */
function useReviewComposerFocused(): boolean {
  return useSyncExternalStore(subscribeToFocus, () => Boolean(document.activeElement?.closest(`[${REVIEW_COMPOSER_ATTRIBUTE}]`)), () => false);
}

function reviewMarkToneOf(thread: PlacedReviewThread): ReviewMarkTone {
  if (thread.state === 'resolved') return 'resolved';
  if (thread.entries.at(-1)?.asks) return 'asks';
  return thread.state === 'addressed' ? 'addressed' : 'open';
}

type ReviewNoteOnFrame = { id: number; tone: ReviewMarkTone; point?: ReviewPoint; marks: readonly ReviewMark[] };

/** The notes on the still, or the video notes covering `frame`; resolved ones left out unless it's the note in focus. */
function reviewNotesOnFrame(threads: readonly PlacedReviewThread[], frame: number, focused: number | undefined): ReviewNoteOnFrame[] {
  return threads.flatMap((thread) => {
    const { anchor, placement } = thread;
    if (anchor.on !== 'video' && anchor.on !== 'still') return [];
    if (anchor.on === 'video' && (!('frame' in placement) || frame < placement.frame || frame > (placement.end ?? placement.frame))) return [];
    if ('unplaced' in placement) return [];
    if (thread.state === 'resolved' && thread.id !== focused) return [];
    return [{ id: thread.id, tone: reviewMarkToneOf(thread), marks: anchor.marks ?? [], ...(anchor.point && { point: anchor.point }) }];
  });
}

type ReviewStageMarksProps = {
  /** The frame box's size in CSS pixels, which the canvas is drawn at. */
  readonly width: number;
  readonly height: number;
  /** The stroke being dragged out now, drawn with the draft's. */
  readonly live: ReviewMark | null;
};

/**
 * The notes on this frame over it: each one's strokes in its state's colour and its pin with its id (a click focuses
 * the note), then the draft's pin and strokes in cobalt. Shown on a settled frame only: while playing, nothing.
 */
export function ReviewStageMarks({ width, height, live }: ReviewStageMarksProps) {
  const { draft, search, setSearch, playback, mode } = useReviewScreen();
  const writing = useReviewComposerFocused();
  const data = useReviewThreads();
  const frame = useReviewFrame();
  const playing = useReviewPlaybackState(playback, (s) => s.playing);
  const canvas = useRef<HTMLCanvasElement>(null);
  const notes = playing ? [] : reviewNotesOnFrame(data?.threads ?? [], frame, search.note);
  const pinned = draft.anchor.on === 'video' || draft.anchor.on === 'still' ? draft.anchor : undefined;
  const draftShown = draft.isOpen && !playing;
  const draftHere = pinned?.on !== 'video' || pinned.frame === undefined || pinned.frame === frame;
  const draftFaint = !draftHere || (!writing && mode !== 'draw');
  const draftMarks = [...draft.marks, ...(live ? [live] : [])];

  // Redrawn on every render, which is a settle, a save or a stroke: never a played frame.
  useEffect(() => {
    const ctx = canvas.current?.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio, size = { w: width * dpr, h: height * dpr };
    ctx.clearRect(0, 0, size.w, size.h);
    const paintOf = (token: string) => ({ color: reviewTokenColorOf(token), halo: reviewTokenColorOf(colors.ground), width: STAGE_MARK_WIDTH * dpr, ring: 0 });
    for (const note of notes) drawReviewMarks(ctx, { marks: note.marks }, size, paintOf(REVIEW_MARK_TONE_COLORS[note.tone]));
    if (!draftShown) return;
    ctx.globalAlpha = draftFaint ? FAINT_DRAFT_ALPHA : 1;
    drawReviewMarks(ctx, { marks: draftMarks }, size, paintOf(colors.cobalt));
    ctx.globalAlpha = 1;
  });

  return (
    <Box {...stylex.props(styles.layer)}>
      <canvas ref={canvas} width={Math.round(width * window.devicePixelRatio)} height={Math.round(height * window.devicePixelRatio)} {...stylex.props(styles.canvas)} />
      {notes.map((note) => note.point && (
        <UnstyledButton key={note.id} aria-label={`note ${note.id}`} onPointerDown={(e) => e.stopPropagation()} onClick={() => setSearch({ note: note.id })}
          {...stylex.props(styles.pin, styles[note.tone], styles.pinAt(note.point.x, note.point.y), search.note === note.id && styles.focused)}>
          <Text component="span" size="xs" inherit>{note.id}</Text>
        </UnstyledButton>
      ))}
      {draftShown && pinned?.point && (
        <Box {...stylex.props(styles.draftPin, shadows.pinHalo, styles.pinAt(pinned.point.x, pinned.point.y), draftFaint && styles.faint)} />
      )}
    </Box>
  );
}
