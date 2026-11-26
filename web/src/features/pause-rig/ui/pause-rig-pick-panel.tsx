// pause-rig-pick-panel.tsx: what "1 or 2?" shows a listener, and nothing more: one instruction, Play, which version is
// playing, the three answers (open once both versions have played, changeable until Next), how the picked one felt and
// a note, Next, and how far along the session is. The tuner's numbers live behind the page's Details.
import { Box, Button, Group, Stack, Text, UnstyledButton } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import { useState } from 'react';
import { TextInput } from '#web/shared/ui/text-input.tsx';
import { colors, radius, spacing, typography } from '#web/shared/ui/theme.stylex.ts';
import { PAUSE_RIG_CONFIRM_LINES } from './pause-rig-lines.ts';
import { PAUSE_RIG_FEELS, PAUSE_RIG_TUNED_KNOBS, pauseRigKnobSettled, pauseRigTunerProgress } from './pause-rig-tuner.ts';
import type { PauseRigPick } from './pause-rig-tuner.ts';
import { PAUSE_RIG_LEAD_INS, type PauseRigVersion, type usePauseRigPick } from './use-pause-rig-pick.ts';

const styles = stylex.create({
  instruction: { textAlign: 'center' },
  hint: { color: colors.dim, textAlign: 'center', minHeight: typography.lineHeight },
  version: {
    display: 'grid', placeItems: 'center', width: '96px', height: '72px', borderRadius: radius.control,
    borderWidth: 1, borderStyle: 'solid', borderColor: colors.line, backgroundColor: colors.panel, color: colors.dim,
  },
  heard: { color: colors.cream },
  playing: { borderColor: colors.accent, color: colors.accent, backgroundColor: colors.raised },
  answer: { minWidth: '120px' },
  dot: { width: spacing.gap, height: spacing.gap, borderRadius: radius.pill, borderWidth: 1, borderStyle: 'solid', borderColor: colors.mark },
  settled: { backgroundColor: colors.cream, borderColor: colors.cream },
  muted: { color: colors.dim },
});

const FEEL_LABELS = { rushed: 'Rushed: pause too short', draggy: 'Draggy: pause too long', choppy: 'Choppy / robotic: sounds unnatural', fine: 'Fine' } as const;

/** A version's tile: lit while it plays, brighter once heard; a click plays it alone. */
function PauseRigVersionTile({ label, version, pick }: { label: string; version: PauseRigVersion; pick: ReturnType<typeof usePauseRigPick> }) {
  return (
    <UnstyledButton aria-label={`Play ${label} again`} onClick={() => pick.play(version)}
      {...stylex.props(styles.version, pick.heard.includes(version) && styles.heard, pick.playing === version && styles.playing)}>
      <Text component="span" size="heading">{label}</Text>
    </UnstyledButton>
  );
}

export function PauseRigPickPanel({ pick }: { pick: ReturnType<typeof usePauseRigPick> }) {
  const { session, playing, ready, confirmLine } = pick;
  const [confirmNote, setConfirmNote] = useState('');
  const { done, about } = pauseRigTunerProgress(session.tuner, pick.unshown);

  if (session.confirming && confirmLine === undefined) {
    return <Text size="line" {...stylex.props(styles.instruction)}>All done, thank you. The values are in Details.</Text>;
  }
  const confirming = confirmLine !== undefined;
  let playLabel = 'Play';
  if (playing === 'line') playLabel = 'Playing…';
  else if (playing) playLabel = `Now playing ${playing === 'first' ? 1 : 2}`;
  else if (pick.heard.length) playLabel = 'Play again';
  let hint = '';
  if (!ready) hint = confirming ? 'Play the line to answer.' : 'Play both to pick.';
  else if (pick.playing === undefined && !confirming) hint = pick.draft.pick ? 'Next (or Enter) takes it.' : 'Click a tile to hear it again.';
  const answer = (choice: PauseRigPick, label: string) => (
    <Button size="md" disabled={!ready} variant={pick.draft.pick === choice ? 'filled' : 'default'} aria-pressed={pick.draft.pick === choice}
      onClick={() => pick.choose(choice)} {...stylex.props(styles.answer)}>{label}</Button>
  );

  return (
    <Stack align="center" gap="row">
      <Text size="line" {...stylex.props(styles.instruction)}>
        {confirming ? 'Last step: does this whole line sound natural?' : 'Listen to both, then pick the one that sounds more natural.'}
      </Text>
      {!confirming && (
        <Group gap="inset">
          <PauseRigVersionTile label="1" version="first" pick={pick} />
          <PauseRigVersionTile label="2" version="second" pick={pick} />
        </Group>
      )}
      <Button size="md" variant="filled" color="orange" onClick={pick.playBoth} disabled={playing !== undefined}>{playLabel}</Button>
      {confirming
        ? (
          <Stack align="center" gap="inset">
            <Group gap="inset">
              <Button size="md" disabled={!ready} onClick={() => {
                pick.confirm(true, confirmNote);
                setConfirmNote('');
              }} {...stylex.props(styles.answer)}>Yes, natural</Button>
              <Button size="md" disabled={!ready} onClick={() => {
                pick.confirm(false, confirmNote);
                setConfirmNote('');
              }} {...stylex.props(styles.answer)}>No</Button>
            </Group>
            <TextInput w={420} placeholder="What's off, if anything (optional)" value={confirmNote} onChange={(event) => setConfirmNote(event.currentTarget.value)} />
          </Stack>
        )
        : (
          <Stack align="center" gap="inset">
            <Group gap="inset">{answer('first', '1')}{answer('second', '2')}{answer('same', "Can't tell")}</Group>
            {pick.draft.pick && pick.draft.pick !== 'same' && (
              <Group gap="gap">
                <Text size="xs" {...stylex.props(styles.muted)}>Optional: the one you picked felt</Text>
                {PAUSE_RIG_FEELS.map((felt) => (
                  <Button key={felt} variant={pick.draft.feel === felt ? 'filled' : 'default'} aria-pressed={pick.draft.feel === felt} onClick={() => pick.feel(felt)}>{FEEL_LABELS[felt]}</Button>
                ))}
              </Group>
            )}
            <Group gap="inset">
              <TextInput w={420} placeholder="Anything to say about this clip? (optional)" value={pick.draft.note} onChange={(event) => pick.writeNote(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') pick.next();
                }} />
              <Button size="md" variant="filled" disabled={!pick.draft.pick} onClick={pick.next}>Next →</Button>
            </Group>
          </Stack>
        )}
      <Text size="xs" {...stylex.props(styles.hint)}>{hint}</Text>
      <Group gap="inset">
        <Text size="xs" {...stylex.props(styles.muted)}>
          {confirming ? `Line ${session.confirmed.length + 1} of ${PAUSE_RIG_CONFIRM_LINES.length}` : `${done + 1} of about ${Math.max(about, done + 1)}`}
        </Text>
        <Group gap="tight">
          {PAUSE_RIG_TUNED_KNOBS.map((knob) => <Box key={knob} title={knob} {...stylex.props(styles.dot, pauseRigKnobSettled(session.tuner, knob) && styles.settled)} />)}
        </Group>
        <Button variant="subtle" disabled={session.history.length === 0} onClick={pick.undo}>Undo last pick</Button>
        {!confirming && <Button variant="subtle" onClick={pick.skip}>Skip this pair</Button>}
      </Group>
      {!confirming && (
        <Group gap="tight">
          <Text size="xs" {...stylex.props(styles.muted)}>Lead-in:</Text>
          {PAUSE_RIG_LEAD_INS.map((seconds) => (
            <Button key={seconds} size="compact-xs" variant={pick.leadIn === seconds ? 'light' : 'subtle'} aria-pressed={pick.leadIn === seconds} onClick={() => pick.setLeadIn(seconds)}>{seconds} s</Button>
          ))}
        </Group>
      )}
    </Stack>
  );
}
