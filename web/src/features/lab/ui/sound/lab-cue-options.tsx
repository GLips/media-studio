import { ActionIcon, Box, Button, Text } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import type { SfxCue } from '#sfx/cues.ts';
import type { SfxRequest } from '#sfx/library.ts';
import { sfxSoundWords } from '#models/lab/lab-sound-words.ts';
import { colors, fonts, radius } from '#web/shared/ui/theme.stylex.ts';
import { sameSfxRequest } from './lab-cue-state.ts';
import { previewLabCueSound } from './lab-cue-sounds.ts';

const styles = stylex.create({
  list: { listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '4px' },
  option: {
    display: 'grid', gridTemplateColumns: '30px 1fr auto', gap: '8px', alignItems: 'center', padding: '4px 8px',
    borderWidth: '1px', borderStyle: 'solid', borderColor: colors.line, borderRadius: radius.control,
  },
  on: { borderColor: colors.cream },
  name: { display: 'block', fontFamily: fonts.mono, color: colors.dim },
  pick: { marginLeft: '6px', fontStyle: 'normal', textTransform: 'uppercase' },
});

/** What choosing an option would do: nothing (it's playing), swap the sound, or give a silent cue one. */
function labCueOptionAction(on: boolean, now: SfxRequest | null): string {
  if (on) return 'Playing';
  return now ? 'Swap to this' : 'Fill with this';
}

type LabCueOptionsProps = {
  readonly cue: SfxCue;
  /** What the cue plays now, lit in the list. */
  readonly now: SfxRequest | null;
  /** The cue's volume, which a preview plays at. */
  readonly volume: number;
  readonly onChoose: (sound: SfxRequest) => void;
};

/** The draft's pick and its alternatives: each to hear on its own, and to swap (or fill) the cue with. */
export function LabCueOptions({ cue, now, volume, onChoose }: LabCueOptionsProps) {
  const options = [...(cue.draft.sound ? [cue.draft.sound] : []), ...cue.alternatives];
  return (
    <Box component="ul" {...stylex.props(styles.list)}>
      {options.map((o) => {
        const on = sameSfxRequest(o, now);
        return (
          <Box component="li" key={JSON.stringify(o)} {...stylex.props(styles.option, on && styles.on)}>
            <ActionIcon radius="xl" size="lg" onClick={() => previewLabCueSound(o, volume)} aria-label={`Hear ${sfxSoundWords(o)}`}>▶</ActionIcon>
            <Box>
              <Text fw={700}>{sfxSoundWords(o)}</Text>
              <Text component="small" size="xs" {...stylex.props(styles.name)}>
                {o.sound}{o === cue.draft.sound && <Text component="em" inherit {...stylex.props(styles.pick)}>the draft's pick</Text>}
              </Text>
            </Box>
            <Button disabled={on} onClick={() => onChoose(o)}>{labCueOptionAction(on, now)}</Button>
          </Box>
        );
      })}
    </Box>
  );
}
