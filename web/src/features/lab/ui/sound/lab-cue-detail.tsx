import { ActionIcon, Box, Button, Code, Group, Paper, Stack, Text, Title } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import type { SfxEvent } from '#sfx/cue-events.ts';
import type { SfxCue, SfxCueList, SfxCueProblem } from '#sfx/cues.ts';
import { formatLabCueSeconds, sfxEventWords, sfxRuleWords } from '#models/lab/lab-sound-cue-words.ts';
import { Readout } from '#web/shared/ui/readout.tsx';
import { colors, radius } from '#web/shared/ui/theme.stylex.ts';
import { labCueDraftHeadline, labCueDraftWords, labCueSoundNow } from './lab-cue-state.ts';
import { LabCueEdit } from './lab-cue-edit.tsx';
import { LabForAgents } from '../lab-for-agents.tsx';
import { LabForAgentsCode } from '../lab-for-agents-code.tsx';

const NARROW = '@media (max-width: 900px)';

const styles = stylex.create({
  detail: {
    display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '12px 20px', alignContent: 'start',
    padding: '12px 16px', overflowY: 'auto',
    // The panel takes the video's height and scrolls past it: `contain: size` keeps its content from growing the row.
    contain: { default: 'size', [NARROW]: 'none' },
  },
  column: { minWidth: 0 },
  warning: {
    backgroundColor: `color-mix(in srgb, ${colors.accent} 12%, transparent)`, borderLeftWidth: '3px', borderLeftStyle: 'solid', borderLeftColor: colors.accent,
    padding: '8px 10px', borderRadius: radius.control,
  },
});

type LabCueDetailProps = {
  readonly cue: SfxCue;
  readonly list: SfxCueList;
  readonly events: ReadonlyMap<string, SfxEvent>;
  readonly warnings: readonly SfxCueProblem[];
  readonly onEdit: (edit: (c: SfxCue) => SfxCue) => void;
  readonly onPlayMoment: () => void;
  readonly onStep: (dir: -1 | 1) => void;
};

/** The picked cue: what it is, what the draft chose and why, the rules it breaks, and its edits. */
export function LabCueDetail({ cue, list, events, warnings, onEdit, onPlayMoment, onStep }: LabCueDetailProps) {
  const { event } = cue, words = sfxEventWords(event), now = labCueSoundNow(cue, list);
  return (
    <Paper component="aside" {...stylex.props(styles.detail)}>
      <Stack gap="xs" {...stylex.props(styles.column)}>
        <Group justify="space-between">
          <Readout label>{event.kind === 'camera-move' ? 'camera move' : event.kind} · {formatLabCueSeconds(event.at)}</Readout>
          <Group gap={4}>
            <ActionIcon size="sm" onClick={() => onStep(-1)} aria-label="Previous cue">‹</ActionIcon>
            <ActionIcon size="sm" onClick={() => onStep(1)} aria-label="Next cue">›</ActionIcon>
          </Group>
        </Group>
        <Title order={4}>{words[0].toUpperCase() + words.slice(1)}</Title>
        <Box><Button variant="white" color="dark" radius="xl" size="xs" fw={700} onClick={onPlayMoment}>▶ Play this moment</Button></Box>

        <Stack gap={4}>
          <Readout label>The studio's draft</Readout>
          <Text>
            <b>{labCueDraftHeadline(cue)}</b>{' '}
            {labCueDraftWords(cue, list, events)}
          </Text>
        </Stack>

        {warnings.map((w) => (
          <Text key={w.problem} {...stylex.props(styles.warning)}><b>Breaks a rule:</b> {sfxRuleWords(w.problem, events)}</Text>
        ))}
        <LabForAgents>
          <Text size="xs" c="dimmed">Event <Code>{event.id}</Code>; the draft's reason: <Code>{cue.draft.why}</Code></Text>
          {now && <LabForAgentsCode>{JSON.stringify(now)}</LabForAgentsCode>}
        </LabForAgents>
      </Stack>

      <Stack gap="xs" {...stylex.props(styles.column)}>
        <LabCueEdit cue={cue} list={list} onEdit={onEdit} />
      </Stack>
    </Paper>
  );
}
