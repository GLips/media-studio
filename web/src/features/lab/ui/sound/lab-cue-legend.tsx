import { Box, Group, Stack, Text } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import { formatLabCueSeconds, sfxEventWords } from '#models/lab/lab-sound-cue-words.ts';
import { colors, fonts } from '#web/shared/ui/theme.stylex.ts';
import { groupLabCues, LAB_CUE_STATE_MARK, LAB_CUE_STATE_WORDS, LAB_CUE_STATES, labCueState, labCueStateLine, type LabCueState } from './lab-cue-state.ts';
import type { LabCueEditorState } from './use-lab-cue-editor.ts';

const styles = stylex.create({
  readout: { minHeight: '1.6em' },
  swatch: { display: 'inline-block', width: '8px', height: '18px', borderRadius: '3px', borderWidth: '2px', borderStyle: 'solid' },
  warnSwatch: { backgroundColor: 'transparent', borderColor: colors.accent, borderStyle: 'dashed' },
  count: { fontFamily: fonts.mono, fontWeight: 500, color: colors.cream },
  mark: (fill: string, edge: string) => ({ backgroundColor: fill, borderColor: edge }),
  tone: (color: string) => ({ color }),
});

const STATE_TEXT: Record<LabCueState, string> = {
  sounding: colors.cream, silent: colors.dim, edited: colors.accent, placed: `color-mix(in srgb, ${colors.cobalt} 60%, ${colors.cream})`,
};

/** Under the timeline: the hovered (or picked) cue in a line, and a key to the markers with how many of each. */
export function LabCueLegend({ editor }: { readonly editor: LabCueEditorState }) {
  const { list, warnings } = editor;
  const shown = list.cues.find((c) => c.event.id === editor.hoverId) ?? list.cues.find((c) => c.event.id === editor.selectedId);
  const counts = groupLabCues(list.cues, labCueState);
  return (
    <Stack gap="tight">
      <Text {...stylex.props(styles.readout)}>
        {shown
          ? <><b>{formatLabCueSeconds(shown.event.at)}</b> · {sfxEventWords(shown.event)} · <Text component="span" inherit {...stylex.props(styles.tone(STATE_TEXT[labCueState(shown)]))}>{labCueStateLine(shown, list)}</Text></>
          : 'Hover a marker to see what it is.'}
      </Text>
      <Group gap="md">
        {LAB_CUE_STATES.map((s) => (
          <Group key={s} gap="tight">
            <Box component="i" {...stylex.props(styles.swatch, styles.mark(LAB_CUE_STATE_MARK[s].fill, LAB_CUE_STATE_MARK[s].edge))} />
            <Text size="xs" c="dimmed">{LAB_CUE_STATE_WORDS[s]} <Text component="b" inherit {...stylex.props(styles.count)}>{counts.get(s)?.length ?? 0}</Text></Text>
          </Group>
        ))}
        <Group gap="tight">
          <Box component="i" {...stylex.props(styles.swatch, styles.warnSwatch)} />
          <Text size="xs" c="dimmed">breaks a rule <Text component="b" inherit {...stylex.props(styles.count)}>{warnings.length}</Text></Text>
        </Group>
      </Group>
    </Stack>
  );
}
