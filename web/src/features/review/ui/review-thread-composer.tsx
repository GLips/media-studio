import { Box, Button, Group, Text, UnstyledButton } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import { useHotkeys } from '@tanstack/react-hotkeys';
import { CornerDownLeft, X } from 'lucide-react';
import { useRef } from 'react';
import { reviewAnchorOnLaidSlice, reviewCueNameOf, reviewNoteImageFrameOf, reviewVideoAnchorAt } from '#lib/output/review/models/review-placement.ts';
import { formatReviewClock } from '#lib/output/review/models/review-timeline-geometry.ts';
import type { NewAnchor } from '#lib/output/review/models/review-ops.ts';
import { HotkeyTooltip } from '#web/shared/ui/hotkey-tooltip.tsx';
import { IconButton } from '#web/shared/ui/icon-button.tsx';
import { Readout } from '#web/shared/ui/readout.tsx';
import { Textarea } from '#web/shared/ui/textarea.tsx';
import { colors, radius, spacing } from '#web/shared/ui/theme.stylex.ts';
import { useReviewPlaybackState } from './review-playback-store.ts';
import { useReviewThreadScope, type ReviewThreadMedia, type ReviewThreadScope } from './review-thread-scope.tsx';
import type { ReviewDraft } from './use-review-draft.ts';
import { useReviewComposerHotkeys } from './use-review-composer-hotkeys.ts';
import { REVIEW_THREAD_KINDS, ReviewThreadKindIcon } from './review-thread-kind.tsx';
import { composeShownReviewFrame } from './review-mark-paint.ts';
import { shownReviewSlicesOf } from './review-slice-layer.tsx';

const styles = stylex.create({
  composer: { flexShrink: 0, padding: spacing.gap, backgroundColor: colors.panel },
  foot: { borderTopWidth: '1px', borderTopStyle: 'solid', borderTopColor: colors.line },
  head: { borderBottomWidth: '1px', borderBottomStyle: 'solid', borderBottomColor: colors.line },
  on: { marginBottom: spacing.tight, paddingInline: spacing.gap, color: colors.dim, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  // On the field's first line, beside the words, as Frame.io sets a comment's timecode.
  pins: { flexShrink: 0, minHeight: '24px' },
  text: { flex: 1, minWidth: 0 },
  // What the note will pin to, as a chip: dim while it follows the playhead, cobalt once pinned, as the draft is.
  chip: {
    flexShrink: 0, paddingInline: spacing.tight, borderRadius: radius.control,
    borderWidth: '1px', borderStyle: 'solid', borderColor: colors.line,
  },
  chipPinned: { borderColor: colors.cobalt },
  field: {
    display: 'flex', alignItems: 'flex-start', gap: spacing.gap, paddingInline: spacing.gap, paddingBlock: spacing.tight,
    borderRadius: radius.control, borderWidth: '1px', borderStyle: 'solid', backgroundColor: colors.ground,
    borderColor: { default: colors.line, ':focus-within': colors.cream },
  },
  // At rest on a still, the composer is this one line, looking like the field it opens into.
  prompt: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', paddingInline: spacing.gap, paddingBlock: spacing.tight,
    borderRadius: radius.control, borderWidth: '1px', borderStyle: 'solid', backgroundColor: colors.ground,
    borderColor: { default: colors.line, ':hover': colors.dim }, color: colors.dim,
  },
  actions: { marginTop: spacing.tight },
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
 * The draft's field, at the thread's foot so the list never jumps (a still's, under its facts). A click picks the
 * kind and `Tab` cycles it, either one the next note's too; `Enter` saves with the frame as seen, `Shift+Enter`
 * breaks the line, `Escape` leaves the draft standing (its pin dims on the stage) and discards only an empty one.
 */
export function ReviewThreadComposer({ docked }: { readonly docked: 'head' | 'foot' }) {
  const scope = useReviewThreadScope();
  const { media, draft, ops } = scope;
  const composerRef = useRef<HTMLDivElement>(null);
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  // Set while a save waits for its frame to land, so a second Enter meanwhile doesn't post the note twice.
  const saving = useRef(false);
  const pinned = draft.anchor.on === 'video' ? draft.anchor : undefined;
  const onLabel = anchorOfDraft(scope) ? scope.draftOnLabel : scope.draftFallback?.label;

  const leave = () => {
    if (isEmptyDraft(draft)) draft.discard();
    fieldRef.current?.blur();
  };
  const save = async () => {
    if (!draft.text.trim() || saving.current) return;
    media?.playback.pause();
    if (media?.artifact.kind === 'video') {
      // The image is the note's own frame, and a laid slice's picture is shown only once its seek lands: the anchor
      // reads which picture that is, so both wait for it.
      const back = reviewNoteImageFrameOf(pinned ?? {}, media.playback.frameNow());
      if (back !== null) media.playback.seek(back);
      saving.current = true;
      await media.playback.settled();
      saving.current = false;
    }
    const anchor = anchorOfDraft(scope) ?? scope.draftFallback?.anchor;
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

  // A still's composer rests as a one-line prompt until `N` or a click opens a draft on the still.
  const collapsed = scope.subject.on === 'still' && !draft.isOpen;
  const openOnStill = () => draft.setAnchor({ on: 'still' });
  useHotkeys(collapsed ? [{ hotkey: 'N', callback: openOnStill, options: { meta: { group: 'still', name: 'New note' } } }] : []);
  const placeholder = REVIEW_COMPOSER_PROMPTS[scope.subject.on];
  // What the note will pin to leads the field, before a word is typed (the moment, a point, a cue, strokes).
  const pins = (media && scope.subject.on === 'video') || pinned?.point || pinned?.cue || draft.marks.length > 0;

  if (collapsed) {
    return (
      <Box ref={composerRef} {...{ [REVIEW_COMPOSER_ATTRIBUTE]: true }} {...stylex.props(styles.composer, styles[docked])}>
        <UnstyledButton onClick={openOnStill} {...stylex.props(styles.prompt)}>
          <Text component="span" size="md" inherit>{placeholder}</Text>
          <Readout>N</Readout>
        </UnstyledButton>
      </Box>
    );
  }
  return (
    <Box ref={composerRef} {...{ [REVIEW_COMPOSER_ATTRIBUTE]: true }} {...stylex.props(styles.composer, styles[docked])}>
      {onLabel !== undefined && <Text size="sm" {...stylex.props(styles.on)}>{onLabel}</Text>}
      <Box {...stylex.props(styles.field)}>
        {pins && (
          <Group gap="tight" wrap="nowrap" {...stylex.props(styles.pins)}>
            {media && scope.subject.on === 'video' && <ReviewComposerMoment media={media} pinned={pinned} />}
            {pinned?.point && <Box aria-label="Pinned on the frame" {...stylex.props(styles.pinDot)} />}
            {pinned?.cue && <Text component="span" size="xs" {...stylex.props(styles.pin)}>♪ {reviewCueNameOf(pinned.cue)}</Text>}
            {draft.marks.length > 0 && <Readout>✎{draft.marks.length > 1 && draft.marks.length}</Readout>}
          </Group>
        )}
        <Textarea
          // A plan note with nothing to be on can't be saved: no prompt invites one.
          placeholder={scope.subject.on === 'plan' && onLabel === undefined ? undefined : placeholder}
          ref={fieldRef}
          aria-label="Note"
          autosize
          minRows={1}
          maxRows={8}
          variant="unstyled"
          size="md"
          value={draft.text}
          onChange={(event) => draft.setText(event.currentTarget.value)}
          onEnter={() => void save()}
          {...stylex.props(styles.text)}
        />
      </Box>
      <Group gap="tight" wrap="nowrap" justify="space-between" {...stylex.props(styles.actions)}>
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
        <Group gap="tight" wrap="nowrap">
          {draft.isOpen && <IconButton name="Discard note" onClick={draft.discard}><X size={14} /></IconButton>}
          <HotkeyTooltip name="Save note">
            <Button size="compact-xs" onClick={() => void save()} disabled={!draft.text.trim()} rightSection={<CornerDownLeft size={12} />}>Post</Button>
          </HotkeyTooltip>
        </Group>
      </Group>
    </Box>
  );
}

/** The prompt in the empty field, by what the note is on. */
const REVIEW_COMPOSER_PROMPTS: Readonly<Record<ReviewThreadScope['subject']['on'], string>> = {
  video: 'Add a note at this moment…',
  still: 'Add a note on this still…',
  decision: 'Add a note…',
  plan: 'Add a note…',
  project: 'Add a note on the project…',
};

/**
 * `0:04.12`, or `0:07.00–0:08.10` for a range: the moment a video note will pin to, before a word is typed. Unpinned,
 * it follows the playhead as it settles, since that's where Enter saves it.
 */
function ReviewComposerMoment({ media, pinned }: { readonly media: ReviewThreadMedia; readonly pinned: { readonly frame?: number; readonly end?: number } | undefined }) {
  const settled = useReviewPlaybackState(media.playback, (s) => s.frame);
  const { fps } = media.timing;
  const frame = pinned?.frame ?? settled;
  return (
    <Box {...stylex.props(styles.chip, pinned?.frame !== undefined && styles.chipPinned)}>
      <Readout bright={pinned?.frame !== undefined}>
        {formatReviewClock(frame / fps)}{pinned?.end !== undefined && `–${formatReviewClock(pinned.end / fps)}`}
      </Readout>
    </Box>
  );
}
