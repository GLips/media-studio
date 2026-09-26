import { Anchor, Button, Group, SimpleGrid, Stack, Text } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import { isSfxCueEdited, sfxCueOwnVolume, type SfxCue, type SfxCueList } from '#sfx/cues.ts';
import type { SfxRequest } from '#sfx/library.ts';
import { labCueEditWords } from '#models/lab/lab-sound-cue-words.ts';
import { sfxSoundWords } from '#models/lab/lab-sound-words.ts';
import { Readout } from '#web/shared/ui/readout.tsx';
import { colors, fonts } from '#web/shared/ui/theme.stylex.ts';
import { LabNote } from '../lab-note.tsx';
import { LabSlider } from '../lab-slider.tsx';
import { labCueSoundNow, sameSfxRequest, withoutLabCueEdits } from './lab-cue-state.ts';
import { LabCueOptions } from './lab-cue-options.tsx';
import { previewLabCueSound } from './lab-cue-sounds.ts';

const styles = stylex.create({
  editTag: { marginLeft: '8px', fontFamily: fonts.mono, textTransform: 'uppercase', color: colors.accent },
});

// Sliders stay well inside what a save accepts (nudge −2..2 s, volume 0..4): the server's schema refuses past those.
const NUDGE_RANGE = 0.5, VOLUME_MAX = 2;

type LabCueEditProps = {
  readonly cue: SfxCue;
  readonly list: SfxCueList;
  readonly onEdit: (edit: (c: SfxCue) => SfxCue) => void;
};

/**
 * A cue's edits: what it plays now, the draft's pick and its alternatives to hear and swap to, mute, reset, nudge and
 * volume. A scene's own sound isn't the list's to change, so it only says so.
 */
export function LabCueEdit({ cue, list, onEdit }: LabCueEditProps) {
  const now = labCueSoundNow(cue, list), own = sfxCueOwnVolume(cue);
  const volume = cue.volume ?? own;
  if (cue.event.kind === 'placed') {
    return (
      <LabNote>
        This sound isn't the list's to change: the {cue.event.scene} scene's own code plays it. It's listed so the list's big
        sounds keep clear of it.
        {now && <> <Anchor component="button" type="button" c="var(--mantine-color-text)" underline="always" onClick={() => previewLabCueSound(now)}>▶ hear it</Anchor></>}
      </LabNote>
    );
  }
  // Choosing the draft's own sound, a nudge of nothing or the cue's own level is no edit at all, so it's taken off.
  const choose = (sound: SfxRequest) => onEdit((c) => (sameSfxRequest(sound, cue.draft.sound) ? withoutLabCueEdits(c, 'sound') : { ...c, sound }));
  const mute = () => onEdit((c) => (cue.draft.sound ? { ...c, sound: null } : withoutLabCueEdits(c, 'sound')));
  const reset = () => onEdit((c) => withoutLabCueEdits(c, 'sound', 'nudge', 'volume'));
  const setNudge = (nudge: number) => onEdit((c) => (Math.abs(nudge) < 0.005 ? withoutLabCueEdits(c, 'nudge') : { ...c, nudge }));
  const setVolume = (v: number) => onEdit((c) => (Math.abs(v - own) < 0.005 ? withoutLabCueEdits(c, 'volume') : { ...c, volume: v }));
  return (
    <>
      <Stack gap={4}>
        <Readout label>Plays now</Readout>
        <Text>
          <b>{now ? sfxSoundWords(now) : 'Nothing: silent'}</b>
          {isSfxCueEdited(cue) && <Text component="span" size="xs" {...stylex.props(styles.editTag)}>{labCueEditWords(cue)}</Text>}
        </Text>
      </Stack>
      <LabCueOptions cue={cue} now={now} volume={volume} onChoose={choose} />
      <Group gap="tight">
        <Button disabled={!now} onClick={mute}>Mute</Button>
        <Button disabled={!isSfxCueEdited(cue)} onClick={reset}>Reset to the draft</Button>
      </Group>
      <SimpleGrid cols={2} spacing="sm">
        <LabSlider label="Nudge" value={cue.nudge ?? 0} min={-NUDGE_RANGE} max={NUDGE_RANGE} step={0.01} onChange={setNudge}
          format={(v) => `${v > 0 ? '+' : ''}${v.toFixed(2)} s`} hint="Earlier or later than its moment." />
        <LabSlider label="Volume" value={volume} min={0} max={VOLUME_MAX} step={0.05} onChange={setVolume}
          format={(v) => `${Math.round(v * 100)}%`} hint="100% is the studio's level, quieter than the voice." />
      </SimpleGrid>
    </>
  );
}
