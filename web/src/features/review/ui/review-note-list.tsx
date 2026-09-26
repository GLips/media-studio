import { Badge, Box, Button, Group, Paper, Stack, Text } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import { useState } from 'react';
import { reviewNoteRenderOf, type ReviewNote, type ReviewRenderStamp } from '#models/review/review-notes.ts';
import { Readout } from '#web/shared/ui/readout.tsx';
import { Textarea } from '#web/shared/ui/textarea.tsx';
import { colors, radius, spacing } from '#web/shared/ui/theme.stylex.ts';
import { formatReviewNotePlace, reviewNoteCovers } from './review-note-format.ts';
import { ReviewNoteContextLines } from './review-note-context-lines.tsx';
import { ReviewNoteNumber } from './review-note-number.tsx';

const styles = stylex.create({
  list: { listStyle: 'none', margin: 0, padding: 0 },
  note: { borderRadius: radius.surface, padding: `${spacing.gap} ${spacing.gap}`, borderColor: 'transparent', cursor: 'pointer' },
  onScreen: { borderColor: colors.accent },
  text: { whiteSpace: 'pre-wrap', marginBlock: spacing.tight },
});

type ReviewNoteListProps = {
  /** In frame order, numbered as the pins and the storyboard number them. */
  readonly notes: readonly ReviewNote[];
  readonly render: ReviewRenderStamp;
  readonly fps: number;
  /** The frame on screen, for a video; null for a still. */
  readonly frame: number | null;
  readonly onSeek: (frame: number) => void;
  readonly onUpdateNotes: (change: (notes: ReviewNote[]) => ReviewNote[]) => void;
};

/** The saved notes: a click seeks to one, and each says when it was written on another render or moved here. */
export function ReviewNoteList({ notes, render, fps, frame, onSeek, onUpdateNotes }: ReviewNoteListProps) {
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const commitEdit = () => {
    if (!editing?.text.trim()) return;
    onUpdateNotes((all) => all.map((m) => (m.id === editing.id ? { ...m, text: editing.text.trim() } : m)));
    setEditing(null);
  };
  return (
    <Stack gap="xs" component="ol" {...stylex.props(styles.list)}>
      {notes.map((note, i) => {
        const on = reviewNoteRenderOf(note, render);
        return (
          <Paper key={note.id} component="li" withBorder {...stylex.props(styles.note, frame !== null && reviewNoteCovers(note, frame) && styles.onScreen)}
            onClick={() => { if (note.frame !== undefined) onSeek(note.frame); }}>
            <Group gap="xs" wrap="nowrap">
              <ReviewNoteNumber n={i + 1} />
              <Readout>{formatReviewNotePlace(note, fps)}</Readout>
              <Group gap={4} ml="auto" wrap="nowrap">
                <Button variant="subtle" size="compact-xs" onClick={(e) => { e.stopPropagation(); setEditing({ id: note.id, text: note.text }); }}>Edit</Button>
                <Button variant="subtle" size="compact-xs" color="red" onClick={(e) => { e.stopPropagation(); onUpdateNotes((all) => all.filter((m) => m.id !== note.id)); }}>Delete</Button>
              </Group>
            </Group>
            {(on !== 'this' || note.movedFrom) && (
              <Group gap={4} mt={4}>
                {on !== 'this' && (
                  <Badge size="xs" color="yellow" title={note.unplaced ? `Its moment isn't in this render: ${note.unplaced}` : 'This note may not be about the render on screen'}>
                    {on === 'other' ? `render ${note.render}${note.unplaced ? ', moment gone' : ''}` : 'render unknown'}
                  </Badge>
                )}
                {note.movedFrom && (
                  <Badge size="xs" color="indigo" title={`Written on render ${note.movedFrom.render} at f${note.movedFrom.frame}, and moved to its moment here`}>
                    moved from f{note.movedFrom.frame}
                  </Badge>
                )}
              </Group>
            )}
            {editing?.id === note.id ? (
              <Box onClick={(e) => e.stopPropagation()}>
                <Textarea autoFocus autosize minRows={2} value={editing.text} onChange={(e) => setEditing({ id: note.id, text: e.currentTarget.value })}
                  onEnter={commitEdit} onEscape={() => setEditing(null)} />
              </Box>
            ) : <Text {...stylex.props(styles.text)}>{note.text}</Text>}
            <ReviewNoteContextLines context={note.context} />
          </Paper>
        );
      })}
    </Stack>
  );
}
