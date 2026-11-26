// pause-rig-pick-panel.tsx: what "1 or 2?" shows: the turn and its two versions, the picks and how the picked one
// felt, each knob's best so far and how consistent repeated pairs were; then, once tuned, each whole line to confirm.
import { Button, Group, Stack, Text } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import { TextInput } from '#web/shared/ui/text-input.tsx';
import { colors, fonts } from '#web/shared/ui/theme.stylex.ts';
import { PAUSE_RIG_CONFIRM_LINES, PAUSE_RIG_LINES } from './pause-rig-lines.ts';
import { PAUSE_RIG_FEELS, PAUSE_RIG_TUNED_KNOBS, pauseRigKnobSettled } from './pause-rig-tuner.ts';
import type { usePauseRigPick } from './use-pause-rig-pick.ts';

const styles = stylex.create({
  on: { borderColor: colors.accent, color: colors.accent },
  mono: { fontFamily: fonts.mono, color: colors.dim },
  settled: { color: colors.cream },
});

const FEEL_KEYS = { rushed: 'q', draggy: 'w', choppy: 'e', fine: 'f' } as const;
const FEEL_LABELS = { rushed: 'rushed', draggy: 'draggy', choppy: 'choppy / robotic', fine: 'fine' } as const;

type PauseRigPickPanelProps = {
  pick: ReturnType<typeof usePauseRigPick>;
  confirmNote: string;
  onConfirmNote: (note: string) => void;
  /** Runs one of the page's actions, as its key would. */
  act: (name: string) => void;
};

export function PauseRigPickPanel({ pick, confirmNote, onConfirmNote, act }: PauseRigPickPanelProps) {
  const { trial, playing, session, confirmLine } = pick;
  const { tuner } = session;
  const { asked, agreed } = tuner.repeats;
  return (
    <Stack gap="tight">
      {confirmLine !== undefined && (
        <>
          <Text size="sm">
            Confirming, line {session.confirmed.length + 1} of {PAUSE_RIG_CONFIRM_LINES.length}: {PAUSE_RIG_LINES[confirmLine].about}. Does it sound natural?
          </Text>
          <Group gap="gap">
            <Button onClick={() => pick.play('line')} {...stylex.props(playing === 'line' && styles.on)}>Play the line (space)</Button>
            <Button onClick={() => act('natural')}>Natural (y)</Button>
            <Button onClick={() => act('unnatural')}>Not natural (n)</Button>
            <TextInput size="xs" flex={1} placeholder="What's off, if anything (goes with the answer)" value={confirmNote} onChange={(event) => onConfirmNote(event.currentTarget.value)} />
          </Group>
        </>
      )}
      {confirmLine === undefined && session.confirming && (
        <Text size="sm">
          Done: {session.confirmed.filter((c) => c.natural).length} of {session.confirmed.length} lines sounded natural. Copy the values, or restart.
        </Text>
      )}
      {!session.confirming && trial && (
        <>
          <Text size="sm">
            {trial.repeatOf === undefined ? `Turn ${tuner.answers.length + 1}` : 'A pair again, to check consistency'}: {trial.clip.about}, {trial.knob} at 1 = {trial.first} or 2 = {trial.second}.
            Which sounds more natural?
          </Text>
          <Group gap="gap">
            <Button onClick={pick.playBoth}>Play 1 then 2 (space)</Button>
            <Button onClick={() => pick.play('first')} {...stylex.props(playing === 'first' && styles.on)}>Play 1 (a)</Button>
            <Button onClick={() => pick.play('second')} {...stylex.props(playing === 'second' && styles.on)}>Play 2 (b)</Button>
            <Button onClick={() => act('first')}>1 (1)</Button>
            <Button onClick={() => act('second')}>2 (2)</Button>
            <Button onClick={() => act('same')}>Can't tell (3)</Button>
          </Group>
          <Group gap="gap">
            <Text size="xs" {...stylex.props(styles.mono)}>The one you pick felt:</Text>
            {PAUSE_RIG_FEELS.map((feel) => (
              <Button key={feel} onClick={() => act(feel)} {...stylex.props(pick.feel === feel && styles.on)}>{FEEL_LABELS[feel]} ({FEEL_KEYS[feel]})</Button>
            ))}
          </Group>
        </>
      )}
      <Group gap="gap">
        <Button onClick={pick.undo} disabled={session.history.length === 0}>Undo (u)</Button>
        {!session.confirming && <Button onClick={pick.confirmNow}>Confirm these values now</Button>}
        <Button onClick={pick.restart}>Restart from the knobs</Button>
        <Text size="xs" {...stylex.props(styles.mono)}>
          {asked ? `repeats agreed ${agreed} of ${asked}` : 'no repeats yet'} · {tuner.answers.length} picks
        </Text>
      </Group>
      <Group gap="gap">
        {PAUSE_RIG_TUNED_KNOBS.map((knob) => {
          const settled = pauseRigKnobSettled(tuner, knob), { value, step } = tuner.stairs[knob];
          return (
            <Text key={knob} size="xs" {...stylex.props(styles.mono, settled && styles.settled)}>
              {knob} {value}{settled ? ' (settled)' : ` ±${step.toFixed(3)}`}
            </Text>
          );
        })}
      </Group>
    </Stack>
  );
}
