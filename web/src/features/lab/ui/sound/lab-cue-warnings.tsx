import { Anchor, Box, Paper, Stack, Text } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import { formatLabCueSeconds, sfxEventShortWords, sfxRuleWords } from '#models/lab/lab-sound-cue-words.ts';
import { Readout } from '#web/shared/ui/readout.tsx';
import { colors } from '#web/shared/ui/theme.stylex.ts';
import { LabNote } from '../lab-note.tsx';
import type { LabCueEditorState } from './use-lab-cue-editor.ts';

const styles = stylex.create({
  panel: { borderLeftWidth: '3px', borderLeftStyle: 'solid', borderLeftColor: colors.accent, padding: '12px 16px' },
  list: { listStyle: 'none', margin: 0, padding: 0 },
  item: { display: 'grid', gridTemplateColumns: 'minmax(200px, auto) 1fr', gap: '12px' },
  link: { textAlign: 'left', textUnderlineOffset: '3px', color: colors.cream },
});

/** Every rule the edits break, each a link to its cue. A warning stops nothing: breaking a rule is a choice here. */
export function LabCueWarnings({ editor }: { readonly editor: LabCueEditorState }) {
  const { warnings, events } = editor;
  if (warnings.length === 0) return null;
  return (
    <Paper {...stylex.props(styles.panel)}>
      <Stack gap="xs">
        <Readout label>Rules your edits break</Readout>
        <Stack gap="tight" component="ul" {...stylex.props(styles.list)}>
          {warnings.map((w) => (
            <Box key={`${w.id}|${w.problem}`} component="li" {...stylex.props(styles.item)}>
              <Anchor component="button" type="button" underline="always" onClick={() => editor.setSelectedId(w.id)} {...stylex.props(styles.link)}>
                <b>{formatLabCueSeconds(w.at)}</b> {sfxEventShortWords(events.get(w.id), w.id)}
              </Anchor>
              <Text>{sfxRuleWords(w.problem, events)}</Text>
            </Box>
          ))}
        </Stack>
        <LabNote>A warning doesn't stop anything: the video plays your edit. It's there so breaking a rule is a choice, not an accident.</LabNote>
      </Stack>
    </Paper>
  );
}
