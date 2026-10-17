import { Box, Group, Text, UnstyledButton } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import { CornerDownLeft, X } from 'lucide-react';
import { useRef } from 'react';
import { reviewAnchorOnLaidSlice, reviewCueNameOf, reviewVideoAnchorAt } from '#lib/output/review/models/review-placement.ts';
import { formatReviewClock } from '#lib/output/review/models/review-timeline-geometry.ts';
import type { NewAnchor } from '#lib/output/review/models/review-ops.ts';
import { HotkeyTooltip } from '#web/shared/ui/hotkey-tooltip.tsx';
import { IconButton } from '#web/shared/ui/icon-button.tsx';
import { Readout } from '#web/shared/ui/readout.tsx';
import { Textarea } from '#web/shared/ui/textarea.tsx';
import { colors, radius, spacing } from '#web/shared/ui/theme.stylex.ts';
import { useReviewThreadScope, type ReviewThreadScope } from './review-thread-scope.tsx';
import type { ReviewDraft } from './use-review-draft.ts';
import { useReviewComposerHotkeys } from './use-review-composer-hotkeys.ts';
import { REVIEW_THREAD_KINDS, ReviewThreadKindIcon } from './review-thread-kind.tsx';
import { composeShownReviewFrame } from './review-mark-paint.ts';
import { shownReviewSlicesOf } from './review-slice-layer.tsx';

const styles = stylex.create({
  composer: {
    flexShrink: 0, padding: spacing.gap, backgroundColor: colors.panel,
    borderTopWidth: '1px', borderTopStyle: 'solid', borderTopColor: colors.line,
  },
  field: {
    marginTop: spacing.tight, paddingInline: spacing.gap, paddingBlock: spacing.tight,
    borderRadius: radius.control, borderWidth: '1px', borderStyle: 'solid', backgroundColor: colors.ground,
    borderColor: { default: colors.line, ':focus-within': colors.cream },
  },
  kinds: { borderRadius: radius.control, borderWidth: '1px', borderStyle: 'solid', borderColor: colors.line, padding: '1px' },
  kind: {
    display: 'inline-flex', alignItems: 'center', gap: spacing.tight, paddingInline: spacing.tight, height: spacing.rowDense,
    color: { default: colors.dim, ':hover': colors.cream },
    borderRadius: radius.control, backgroundColor: { default: 'transparent', ':hover': colors.raised },
  },
  kindPicked: { color: colors.cream, backgroundColor: colors.raised },
  pin: { color: colors.cobalt },
  // The stage pin's own mark, solid: a glyph this small in cobalt on the panel can't be seen.
  pinDot: { width: '10px', height: '10px', flexShrink: 0, borderRadius: radius.pill, backgroundColor: colors.cobalt },
});

/** Nothing worth keeping: no words, no strokes. A pin alone is one click to set again, so Escape throws it away too. */
const isEmptyDraft = (draft: ReviewDraft) => !draft.text.trim() && draft.marks.length === 0;

/**
 * The draft as a whole anchor. A video note without a pin is on the playhead, on the slice laid in there if any, with
 * the moment that carries it on. A decision's note is on its candidate, at the transport's time if it plays. Null for
 * a plan note, whose target the plan page sets.
 */
function anchorOfDraft({ subject, media, draft, timeNow }: ReviewThreadScope): NewAnchor | null {
  const { anchor, marks } = draft;
  const strokes = marks.length ? { marks } : {};
  switch (subject.on) {
    case 'video': {
      if (!media) return null;
      const pinned = anchor.on === 'video' ? anchor : {};
      // Read at save, as the frame image is: on a slice only while its picture is the one on screen.
      return reviewAnchorOnLaidSlice({ ...pinned, ...reviewVideoAnchorAt(media.artifact, pinned.frame ?? media.playback.frameNow()), ...strokes }, shownReviewSlicesOf(media.splices.laid));
    }
    case 'still': {
      if (!media) return null;
      const pinned = anchor.on === 'still' ? anchor : {};
      return { ...pinned, on: 'still', writtenOn: { path: media.artifact.path, hash: media.artifact.render.hash }, ...strokes };
    }
    case 'decision': {
      if (subject.decision === undefined) return null;
      // To the hundredth, as the transport's clock reads it.
      const at = timeNow && { at: Math.round(timeNow() * 100) / 100 };
      return { on: 'decision', decision: subject.decision, ...(subject.candidate && { candidate: subject.candidate }), ...at };
    }
    case 'plan': return anchor.on === 'plan' && anchor.field ? { ...anchor, on: 'plan', field: anchor.field } : null;
    case 'project': return { on: 'project' };
  }
  return null;
}

/** Marks the composer, so the stage can tell a draft being written from one left standing. */
export const REVIEW_COMPOSER_ATTRIBUTE = 'data-review-composer';

/**
 * The draft's field, docked at the thread's foot so the list never jumps. A click picks the kind and `Tab` cycles it,
 * either one the next note's too; `Mod+Enter` saves with the frame as seen, `Escape` leaves the draft standing (its
 * pin dims on the stage) and discards only an empty one.
 */
export function ReviewThreadComposer() {
  const scope = useReviewThreadScope();
  const { media, draft, ops } = scope;
  const composerRef = useRef<HTMLDivElement>(null);
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const pinned = draft.anchor.on === 'video' ? draft.anchor : undefined;

  const leave = () => {
    if (isEmptyDraft(draft)) draft.discard();
    fieldRef.current?.blur();
  };
  const save = async () => {
    if (!draft.text.trim()) return;
    media?.playback.pause();
    const anchor = anchorOfDraft(scope);
    if (!anchor) return;
    const point = 'point' in anchor ? anchor.point : undefined;
    const { kind, text, marks } = draft;
    // The frame is drawn at once but encodes for a while: the draft goes first, so a note begun meanwhile is the
    // reviewer's next one, not wiped by this one's discard.
    const encoding = media && (anchor.on === 'video' || anchor.on === 'still')
      ? composeShownReviewFrame({ point, marks, transparent: media.artifact.transparent })
      : undefined;
    // A failed save says so in the bar, with retry: the draft has done its job.
    draft.discard();
    fieldRef.current?.blur();
    const image = await encoding;
    await ops.apply([{ op: 'thread.add', kind, anchor, text, ...(image && { image }) }]);
  };
  // While drawing there's no pin to type at yet: once drawing is done, the pin is new to the field and takes the cursor.
  useReviewComposerHotkeys(composerRef, fieldRef, !media?.drawing && draft.isOpen && Object.keys(draft.anchor).length ? draft.anchor : null, {
    save: () => void save(), cycleKind: draft.cycleKind, leave,
  });

  return (
    <Box ref={composerRef} {...{ [REVIEW_COMPOSER_ATTRIBUTE]: true }} {...stylex.props(styles.composer)}>
      <Group gap="tight" wrap="nowrap" justify="space-between">
        <Group gap="tight" wrap="nowrap">
          <Group gap={0} wrap="nowrap" role="radiogroup" aria-label="Kind" {...stylex.props(styles.kinds)}>
            {REVIEW_THREAD_KINDS.map((kind) => (
              <HotkeyTooltip key={kind} name="Kind" hotkey="Kind">
                <UnstyledButton role="radio" aria-checked={draft.kind === kind} onClick={() => draft.setKind(kind)}
                  {...stylex.props(styles.kind, draft.kind === kind && styles.kindPicked)}>
                  <ReviewThreadKindIcon kind={kind} />
                  <Text component="span" size="sm" inherit>{kind}</Text>
                </UnstyledButton>
              </HotkeyTooltip>
            ))}
          </Group>
          {media && pinned?.frame !== undefined && (
            <Readout>{formatReviewClock(pinned.frame / media.timing.fps)}{pinned.end !== undefined && `–${formatReviewClock(pinned.end / media.timing.fps)}`}</Readout>
          )}
          {pinned?.point && <Box aria-label="Pinned on the frame" {...stylex.props(styles.pinDot)} />}
          {pinned?.cue && <Text component="span" size="xs" {...stylex.props(styles.pin)}>♪ {reviewCueNameOf(pinned.cue)}</Text>}
          {draft.marks.length > 0 && <Readout>✎{draft.marks.length > 1 && draft.marks.length}</Readout>}
        </Group>
        <Group gap="hairline" wrap="nowrap">
          {draft.isOpen && <IconButton name="Discard note" onClick={draft.discard}><X size={14} /></IconButton>}
          <IconButton name="Save note" onClick={() => void save()} disabled={!draft.text.trim()}><CornerDownLeft size={14} /></IconButton>
        </Group>
      </Group>
      <Box {...stylex.props(styles.field)}>
        <Textarea
          ref={fieldRef}
          aria-label="Note"
          autosize
          minRows={1}
          maxRows={8}
          variant="unstyled"
          size="md"
          value={draft.text}
          onChange={(event) => draft.setText(event.currentTarget.value)}
        />
      </Box>
    </Box>
  );
}
