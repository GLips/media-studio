import { Button, Group, Paper, Stack } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import type { ReviewNoteContext } from '#models/review/review-notes.ts';
import { Readout } from '#web/shared/ui/readout.tsx';
import { Textarea } from '#web/shared/ui/textarea.tsx';
import { colors, radius, spacing } from '#web/shared/ui/theme.stylex.ts';
import { formatReviewNotePlace, type ReviewNoteDraft } from './review-note-format.ts';
import { ReviewNoteContextLines } from './review-note-context-lines.tsx';

const styles = stylex.create({
  composer: { borderColor: colors.cobalt, borderRadius: radius.surface, padding: spacing.gap },
});

type ReviewComposerProps = {
  readonly draft: ReviewNoteDraft;
  readonly fps: number;
  readonly context: ReviewNoteContext;
  readonly onChange: (draft: ReviewNoteDraft) => void;
  readonly onSave: () => void;
  readonly onCancel: () => void;
};

/** The note being written: its place, its text, and the context it'll be saved with. */
export function ReviewComposer({ draft, fps, context, onChange, onSave, onCancel }: ReviewComposerProps) {
  return (
    <Paper withBorder {...stylex.props(styles.composer)}>
      <Stack gap="xs">
        <Readout label>new note · {formatReviewNotePlace(draft, fps)}{draft.cue ? ` · aimed at ${draft.cue}` : ''}</Readout>
        <Textarea
          autoFocus
          autosize
          minRows={3}
          placeholder="What feels off? (Enter saves, Shift-Enter for a new line, Esc cancels)"
          value={draft.text}
          onChange={(event) => onChange({ ...draft, text: event.currentTarget.value })}
          onEnter={onSave}
          onEscape={onCancel}
        />
        <ReviewNoteContextLines context={context} />
        <Group gap="xs" justify="flex-end">
          <Readout>click the frame to {draft.x === undefined ? 'add' : 'move'} its point</Readout>
          <Button variant="default" size="xs" onClick={onCancel}>Cancel</Button>
          <Button size="xs" onClick={onSave} disabled={!draft.text.trim()}>Save note</Button>
        </Group>
      </Stack>
    </Paper>
  );
}
