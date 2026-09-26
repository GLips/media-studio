import { Button, Code, Group, Kbd, List, Stack, Text } from '@mantine/core';
import { SFX_RATE } from '#sfx/dsp.ts';
import { sfxParamSpecs, SFX_LOUDNESS_UNDER_VOICE } from '#sfx/library.ts';
import { SFX_RECIPE_WORDS } from '#models/lab/lab-sound-words.ts';
import { Readout } from '#web/shared/ui/readout.tsx';
import { LabBench } from '../lab-bench.tsx';
import { LabChoice } from '../lab-choice.tsx';
import { LabControls } from '../lab-controls.tsx';
import { LabNote } from '../lab-note.tsx';
import { LabSlider } from '../lab-slider.tsx';
import { LabSfxDocText } from './lab-sfx-doc-text.tsx';
import { LabSfxParamName } from './lab-sfx-param-name.tsx';
import { LabSfxParamSlider } from './lab-sfx-param-slider.tsx';
import { LabSfxWaveform } from './lab-sfx-waveform.tsx';
import { LabForAgents } from '../lab-for-agents.tsx';
import { LabForAgentsCode } from '../lab-for-agents-code.tsx';
import { LabSoundPart } from './lab-sound-part.tsx';
import { useLabPlayhead } from './use-lab-playhead.ts';
import { LAB_SFX_PLAYER_ID, LAB_SFX_RECIPE_NAMES, LAB_SFX_STANDARD_PRESET, useLabSfxTake } from './use-lab-sfx-take.ts';

/** The Sound tab's sound effects: lib/sfx's renderSfx called in the browser, exactly as a render does, played and drawn. */
export function LabSfxPanel() {
  const take = useLabSfxTake();
  const playhead = useLabPlayhead(LAB_SFX_PLAYER_ID);
  const { recipe, recipeName, rendered } = take;
  const specs = sfxParamSpecs(recipe);

  const stage = (
    <Stack gap="sm">
      <LabSfxWaveform samples={rendered.floats} ghost={take.ghost} rate={SFX_RATE} landsAt={rendered.landsAt} playhead={playhead} />
      <Group gap="sm">
        <Button variant="filled" radius="xl" size="sm" onClick={take.play} rightSection={<Kbd size="xs">P</Kbd>}>▶ Play</Button>
        <Button radius="xl" size="sm" onClick={take.nextTake} rightSection={<Kbd size="xs">⇧P</Kbd>}>↻ Same sound, played again</Button>
        <Readout label>
          take {take.seed} · {rendered.seconds.toFixed(2)} s · {recipe.category === 'ui' ? 'a small sound: set well under the voice' : 'an accent: set a little quieter than the voice'}
        </Readout>
      </Group>
      <LabNote>
        <b>Played again</b> is the same sound with new tiny random details (the exact grain of the noise, a hair of pitch),
        the way no two real clicks match, so ten clicks in a row don't sound like a machine gun. The faint grey wave is the
        previous take. The red line marks where the hit lands: a video lines that moment up with what you see (a click
        with the cursor press, a whoosh's loudest point with the fastest part of a move), even when the sound starts earlier.
      </LabNote>
    </Stack>
  );

  return (
    <LabSoundPart kicker="01 — Sound effects" title="Clicks, whooshes and chimes, made from scratch">
      <LabBench stage={stage}>
        <LabControls stacked>
          <LabChoice label="Sound" value={recipeName} options={LAB_SFX_RECIPE_NAMES.map((n) => ({ value: n, label: n }))}
            onChange={take.chooseRecipe} hint={SFX_RECIPE_WORDS[recipeName]} />
          <LabChoice label="Preset" value={take.preset}
            options={[{ value: LAB_SFX_STANDARD_PRESET, label: 'standard' }, ...Object.keys(recipe.presets).map((p) => ({ value: p, label: p }))]}
            onChange={take.choosePreset} hint="A named starting point for the settings below." />
          {Object.entries(specs).map(([name, spec]) => (
            <LabSfxParamSlider key={`${take.sound}/${name}`} recipe={recipeName} name={name} spec={spec} value={rendered.params[name]}
              changed={name in take.set} onChange={(v) => take.setParam(name, v)} />
          ))}
          <LabSlider label="Variation" value={take.vary} min={0} max={1} step={0.01} onChange={take.setVary} format={(v) => v.toFixed(2)}
            hint={<>Lets each take also nudge the settings above (the ones without a •) by up to this much of their range. For sounds that repeat a lot. <LabSfxParamName>mutate</LabSfxParamName></>} />
          <Stack gap="tight" align="flex-start">
            <Button radius="xl" size="sm" disabled={Object.keys(take.set).length === 0} onClick={take.resetParams}>Reset to the preset</Button>
            <Text size="xs" c="dimmed">A • marks a setting you've moved.</Text>
          </Stack>
        </LabControls>
        <LabForAgents>
          <Text size="xs" c="dimmed">What a video asks lib/sfx for, to get this exact sound:</Text>
          <LabForAgentsCode>{JSON.stringify(take.request, null, 1).replace(/\n\s*/g, ' ')}</LabForAgentsCode>
          <Text size="xs" c="dimmed">
            {rendered.lufs.toFixed(1)} LUFS: the {recipe.category} category sits {-SFX_LOUDNESS_UNDER_VOICE[recipe.category]} LU under
            the voice (ui {SFX_LOUDNESS_UNDER_VOICE.ui}, accent {SFX_LOUDNESS_UNDER_VOICE.accent}). The seed is the take number here;
            in a video it's the event's id.
          </Text>
          <Text size="xs" c="dimmed"><LabSfxDocText doc={recipe.doc} /></Text>
          <List size="xs" c="dimmed">
            {Object.entries(specs).map(([name, spec]) => (
              <List.Item key={name}><Code>{name}</Code> {spec.min}–{spec.max}: <LabSfxDocText doc={spec.doc} /></List.Item>
            ))}
          </List>
        </LabForAgents>
      </LabBench>
      <LabNote>
          <b>Why make sounds instead of downloading them?</b> A sample library gives you one fixed recording per sound. Here
          each sound is a small recipe: a model of what makes it (a plastic switch snapping, air rushing past, a struck
          glass). So the studio can make a click a little different every time, stretch a whoosh to exactly the length of a
          move, put a riser's peak right on a reveal, and set every sound at the same level quieter than the voice (small
          sounds like clicks well under it, accents like whooshes and chimes a little under). No licences, no hunting for
          files, and the same request always makes the same sound.
      </LabNote>
    </LabSoundPart>
  );
}
