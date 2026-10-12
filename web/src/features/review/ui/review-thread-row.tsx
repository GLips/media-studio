import { Box, Group, Stack, Text, Tooltip, UnstyledButton } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import { Bot, Check, CornerUpLeft, Pencil, RotateCcw, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import type { ReviewScene } from '#lib/output/review/models/review-context.ts';
import { type PlacedReviewThread, reviewCueNameOf, reviewThreadFrameOf } from '#lib/output/review/models/review-placement.ts';
import { formatReviewClock } from '#lib/output/review/models/review-timeline-geometry.ts';
import {
  REVIEW_THREAD_TONES, reviewThreadTone, type ReviewAnchor, type ReviewEntry, type ReviewThread, type ReviewThreadTone,
} from '#lib/output/review/models/review-threads.ts';
import { IconButton } from '#web/shared/ui/icon-button.tsx';
import { Readout } from '#web/shared/ui/readout.tsx';
import { Textarea } from '#web/shared/ui/textarea.tsx';
import { colors, fonts, radius, spacing, typography } from '#web/shared/ui/theme.stylex.ts';
import { ReviewThreadBody } from './review-thread-body.tsx';
import type { ReviewComparedVersion } from './use-review-compare-target.ts';
import type { ReviewThreadActions, ReviewThreadInline } from './use-review-thread-panel.ts';

const flashIn = stylex.keyframes({ from: { backgroundColor: colors.flash }, to: { backgroundColor: 'transparent' } });

const styles = stylex.create({
  row: {
    position: 'relative', paddingBlock: spacing.tight, paddingInlineStart: spacing.inset, paddingInlineEnd: spacing.gap,
    cursor: 'pointer', backgroundColor: { default: 'transparent', ':hover': colors.raised },
    borderLeftWidth: '2px', borderLeftStyle: 'solid', borderLeftColor: 'transparent',
    outlineColor: colors.cream, outlineStyle: 'solid', outlineWidth: { default: 0, ':focus-visible': '1px' }, outlineOffset: '-1px',
  },
  current: { borderLeftColor: colors.cream },
  asksEdge: { borderLeftColor: colors.caution },
  selected: { outlineWidth: '2px', outlineOffset: '-2px' },
  flash: { animationName: flashIn, animationDuration: '1s', animationTimingFunction: 'ease-out' },
  head: { height: spacing.rowDense, minWidth: 0 },
  glyph: { width: spacing.inset, flexShrink: 0, textAlign: 'center' },
  open: { color: colors.accent },
  addressed: { color: colors.pass },
  asks: { color: colors.caution },
  resolved: { color: colors.dim },
  keep: { color: colors.cream },
  scene: { color: colors.dim, whiteSpace: 'nowrap', overflow: 'hidden', minWidth: 0 },
  actions: { marginInlineStart: 'auto', flexShrink: 0 },
  body: { paddingInlineStart: spacing.inset },
  clamped: { maxHeight: `calc(${typography.lineHeight} * 4)`, overflow: 'hidden' },
  replies: { paddingInlineStart: spacing.inset, paddingTop: spacing.tight },
  author: { color: colors.cream, width: spacing.inset, flexShrink: 0 },
  reply: { minWidth: 0, flex: 1 },
  commit: {
    fontFamily: fonts.mono, color: colors.dim,
    paddingInline: spacing.hairline, borderRadius: radius.control, backgroundColor: { default: 'transparent', ':hover': colors.raised },
  },
  other: {
    paddingInlineStart: spacing.gap, borderLeftWidth: '2px', borderLeftStyle: 'solid', borderLeftColor: colors.caution,
  },
  field: {
    marginTop: spacing.tight, paddingInline: spacing.gap, paddingBlock: spacing.tight, borderRadius: radius.control,
    borderWidth: '1px', borderStyle: 'solid', borderColor: colors.cobalt, backgroundColor: colors.ground,
  },
});

type ReviewThreadGlyph = { glyph: string; style: ReviewThreadTone; word: string };

/** The row's one mark of state: its tone's glyph and colour, and the word for its tooltip. */
function reviewThreadGlyphOf(thread: ReviewThread): ReviewThreadGlyph {
  const tone = reviewThreadTone(thread);
  return { ...REVIEW_THREAD_TONES[tone], style: tone };
}

/** What a reply did, as the thread's own mark would show it: a reopen is open again. */
const REPLY_GLYPHS: Readonly<Record<NonNullable<ReviewEntry['transition']> | 'asks', ReviewThreadGlyph>> = {
  addressed: { ...REVIEW_THREAD_TONES.addressed, style: 'addressed' },
  resolved: { ...REVIEW_THREAD_TONES.resolved, style: 'resolved' },
  reopened: { glyph: REVIEW_THREAD_TONES.open.glyph, style: 'open', word: 'reopened' },
  asks: { ...REVIEW_THREAD_TONES.asks, style: 'asks' },
};

/** A script note's place as the script numbers it, `5 · ‘Snap the menu’`; a line the take doesn't voice by its id. */
function reviewScriptWhereOf(anchor: Extract<ReviewAnchor, { on: 'script' }>, lines: readonly string[]): string {
  const index = lines.indexOf(anchor.line);
  const line = index === -1 ? anchor.line : `${index + 1}`;
  return anchor.text ? `${line} · ‘${anchor.text}’` : line;
}

/**
 * `0:04.12`, `0:07.00–0:08.10`, or for a note off the timeline what it's on. A decision's note says nothing: its
 * thread is already the candidate's.
 */
function reviewThreadWhereOf(thread: PlacedReviewThread, place: ReviewThreadRowPlace): string | null {
  const { placement, anchor } = thread;
  if (anchor.on === 'script') return reviewScriptWhereOf(anchor, place?.lines ?? []);
  if ('frame' in placement && place) return `${formatReviewClock(placement.frame / place.fps)}${placement.end !== undefined && placement.end !== placement.frame ? `–${formatReviewClock(placement.end / place.fps)}` : ''}`;
  if (anchor.on === 'decision') return anchor.at === undefined ? null : formatReviewClock(anchor.at);
  return anchor.on === 'still' ? (anchor.cell ?? null) : null;
}

export type ReviewThreadRowLook = {
  current: boolean;
  selected: boolean;
  flashing: boolean;
  /** The note in focus (`?note=`): every reply shown, the body unclamped. */
  expanded: boolean;
  inline: ReviewThreadInline | null;
};

/** The open file the row is placed on: null on a decision, whose notes are on no file. */
export type ReviewThreadRowPlace = {
  fps: number;
  renderHash: string;
  scenes: readonly ReviewScene[];
  versions: readonly ReviewComparedVersion[];
  /** The voiced lines' ids in reading order, which number a script note's line. */
  lines: readonly string[];
} | null;

type ReviewThreadRowProps = {
  readonly thread: PlacedReviewThread;
  readonly look: ReviewThreadRowLook;
  readonly actions: ReviewThreadActions;
  readonly place: ReviewThreadRowPlace;
};

/**
 * One note: its state glyph, number, time and scene, then its words and the replies under it. A carried note shows
 * the render it was written on, dim. Its actions appear on hover or focus, never at rest.
 */
export function ReviewThreadRow({ thread, look, actions, place }: ReviewThreadRowProps) {
  const [hot, setHot] = useState(false);
  const [field, setField] = useState<{ key: string | null; text: string }>({ key: null, text: '' });
  const rowRef = useRef<HTMLDivElement>(null);
  const [note, ...replies] = thread.entries;
  const { glyph, style, word } = reviewThreadGlyphOf(thread);
  const frame = reviewThreadFrameOf(thread);
  const scene = frame === undefined ? undefined : place?.scenes.find((s) => s.from <= frame && frame < s.to);
  // On a file's thread, a note on the whole project says so where a time would be.
  const where = place && thread.anchor.on === 'project' ? 'whole project' : reviewThreadWhereOf(thread, place);
  const writtenOn = thread.anchor.on === 'video' || thread.anchor.on === 'still' ? thread.anchor.writtenOn : undefined;
  const carried = writtenOn && place && writtenOn.hash !== place.renderHash ? writtenOn : undefined;
  // `r11` when the note was written on a kept version of this path; another path's render (the animatic) by its hash.
  const carriedVersion = carried && place?.versions.find((v) => v.hash === carried.hash);
  const shown = (look.expanded ? replies : replies.slice(-1)).filter((r) => r.text.trim());
  const inline = look.inline?.id === thread.id ? look.inline : null;
  // The field's text belongs to its field: reopening the same one finds it as left, opening another starts afresh,
  // an edit from the note's words.
  const fieldKey = inline && `${inline.mode}:${inline.conflict?.rev ?? ''}`;
  const freshText = inline?.mode === 'edit' && !inline.conflict ? note.text : '';
  const fieldText = field.key === fieldKey ? field.text : freshText;
  const submit = () => {
    if (!inline || !fieldText.trim()) return;
    if (inline.mode === 'reply') {
      actions.sendReply(thread.id, fieldText);
      setField({ key: null, text: '' });
      return;
    }
    void actions.saveEdit(thread, fieldText).then((saved) => saved && setField({ key: null, text: '' }));
  };
  // Escape closes the field and keeps its words for the next `R`; focus goes back to the row, so the keys go on.
  const leave = () => {
    actions.endInline();
    rowRef.current?.focus();
  };

  return (
    <Box
      ref={rowRef}
      role="listitem"
      tabIndex={0}
      data-thread-id={thread.id}
      aria-current={look.current || undefined}
      onClick={(event) => (event.shiftKey ? actions.toggleSelected(thread.id) : actions.open(thread))}
      onMouseEnter={() => setHot(true)}
      onMouseLeave={() => setHot(false)}
      onFocus={() => setHot(true)}
      onBlur={(event) => !event.currentTarget.contains(event.relatedTarget) && setHot(false)}
      {...stylex.props(
        styles.row, style === 'asks' && styles.asksEdge,
        look.current && styles.current, look.selected && styles.selected, look.flashing && styles.flash,
      )}
    >
      <Group gap="tight" wrap="nowrap" {...stylex.props(styles.head)}>
        <Tooltip label={word} openDelay={400} withinPortal>
          <Text component="span" size="sm" {...stylex.props(styles.glyph, styles[style])}>{glyph}</Text>
        </Tooltip>
        <Readout bright>#{thread.id}</Readout>
        {where && <Readout>{where}</Readout>}
        {scene && <Text component="span" size="sm" {...stylex.props(styles.scene)}>{scene.id}</Text>}
        {thread.anchor.on === 'video' && thread.anchor.cue && <Text component="span" size="sm" {...stylex.props(styles.scene)}>♪ {reviewCueNameOf(thread.anchor.cue)}</Text>}
        {carried && (
          <Tooltip label={`written on ${carried.path}`} openDelay={400} withinPortal>
            <Readout>{carriedVersion ? `r${carriedVersion.r}` : carried.hash.slice(0, 7)}</Readout>
          </Tooltip>
        )}
        {(hot || look.selected) && (
          <Group gap={0} wrap="nowrap" {...stylex.props(styles.actions)} onClick={(event) => event.stopPropagation()}>
            <IconButton name="Reply" onClick={() => actions.startInline(thread.id, 'reply')}><CornerUpLeft size={14} /></IconButton>
            {thread.state === 'resolved' || <IconButton name="Resolve" onClick={() => actions.resolve([thread.id])}><Check size={14} /></IconButton>}
            {(thread.state === 'addressed' || thread.state === 'resolved') && (
              <IconButton name="Reopen" onClick={() => actions.reopen([thread.id])}><RotateCcw size={14} /></IconButton>
            )}
            {note.author === 'reviewer' && <IconButton name="Edit" onClick={() => actions.startInline(thread.id, 'edit')}><Pencil size={14} /></IconButton>}
            <IconButton name="Delete" onClick={() => actions.remove([thread.id])}><Trash2 size={14} /></IconButton>
          </Group>
        )}
      </Group>
      {inline?.mode === 'edit' || (
        <Box {...stylex.props(styles.body, !look.expanded && styles.clamped)}>
          <ReviewThreadBody text={note.text} dim={thread.state === 'resolved'} />
        </Box>
      )}
      {shown.length > 0 && (
        <Stack gap="tight" {...stylex.props(styles.replies)}>
          {shown.map((reply) => {
            const did = reply.asks ? REPLY_GLYPHS.asks : reply.transition && REPLY_GLYPHS[reply.transition];
            return (
              <Group key={reply.rev} gap="tight" wrap="nowrap" align="flex-start">
                <Text component="span" size="sm" {...stylex.props(styles.author)}>{reply.author === 'agent' && <Bot size={12} />}</Text>
                {did && (
                  <Tooltip label={did.word} openDelay={400} withinPortal>
                    <Text component="span" size="sm" {...stylex.props(styles[did.style])}>{did.glyph}</Text>
                  </Tooltip>
                )}
                <Box {...stylex.props(styles.reply, !look.expanded && styles.clamped)}>
                  <ReviewThreadBody text={reply.text} />
                </Box>
                {reply.commit && (
                  <Tooltip label="Copy commit" openDelay={400} withinPortal>
                    <UnstyledButton
                      aria-label="Copy commit"
                      onClick={(event) => {
                        event.stopPropagation();
                        void navigator.clipboard.writeText(reply.commit?.workspace ?? reply.commit?.engine ?? '');
                      }}
                      {...stylex.props(styles.commit)}
                    >
                      <Text component="span" size="xs" inherit>{(reply.commit.workspace ?? reply.commit.engine).slice(0, 7)}</Text>
                    </UnstyledButton>
                  </Tooltip>
                )}
              </Group>
            );
          })}
        </Stack>
      )}
      {inline && (
        <Box onClick={(event) => event.stopPropagation()} {...stylex.props(styles.body)}>
          {inline.conflict && (
            <Tooltip label="saved meanwhile elsewhere" openDelay={400} withinPortal>
              <Box {...stylex.props(styles.other)}><ReviewThreadBody text={inline.conflict.text} dim /></Box>
            </Tooltip>
          )}
          <Box {...stylex.props(styles.field)}>
            <Textarea
              aria-label={inline.mode === 'reply' ? 'Reply' : 'Edit'}
              autoFocus
              autosize
              minRows={1}
              maxRows={8}
              variant="unstyled"
              size="md"
              value={fieldText}
              onChange={(event) => setField({ key: fieldKey, text: event.currentTarget.value })}
              onEnter={submit}
              onEscape={leave}
            />
          </Box>
        </Box>
      )}
    </Box>
  );
}
