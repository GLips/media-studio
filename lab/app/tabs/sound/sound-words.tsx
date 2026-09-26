// sound-words.tsx: the Sound tab's plain words for lib/sfx. The recipes document themselves for agents (semitones,
// partials, Hz); these say the same for someone who has never touched a synth, and the tab shows the real names beside.
import type { ReactNode } from 'react';
import type { SfxRequest } from '#sfx/library.ts';
import type { SfxRecipeName } from '#sfx/recipes.ts';

/** Code, CLI names and raw numbers, folded away under the plain words. */
export function SoundForAgents({ children }: { children: ReactNode }) {
  return (
    <details className="sound-agents">
      <summary>For agents</summary>
      {children}
    </details>
  );
}

/** What each recipe makes, in a sentence. */
export const SFX_RECIPE_WORDS: Record<SfxRecipeName, string> = {
  click: 'A mouse button: a sharp snap, then a quieter one as the button springs back up.',
  key: 'A keyboard key: a duller tap, and the key springing back.',
  toggle: 'A switch flipping: one click then a second, higher for on and lower for off.',
  impact: 'Something landing: a low thump, a crack and a short ring.',
  whoosh: 'Something flying close past you: rushing air that swells as it passes and falls away after. The “whip” preset is the fast camera swing between two shots.',
  riser: 'Tension building to a reveal: rushing air and a tone climbing together to a peak, then a short breath out. Its peak goes right on the reveal.',
  chime: 'A notification: up to three notes with a soft echo. “success” climbs, “error” falls.',
  ding: 'One struck bell, metal bar or glass, ringing out.',
  pop: 'A blip that bends in pitch as it dies: a bubble popping, or a drop of water.',
  typing: 'A burst of typing: keys in little words, with a space bar between them.',
  scroll: 'A scroll wheel: small ticks, steady, or a flick that rushes and then settles.',
  buzz: 'A tattoo machine: a hard, rattling buzz that runs up to speed, drops a little lower and duller as the needles go into skin, then winds down. The “rotary” preset is a smoother motor hum.',
};

type SfxParamWords = { label: string; hint: string };
const PIANO_KEYS = 'in piano keys, counting black ones (12 is an octave; below 0 goes down)';

/** Each parameter's plain label and hint, the same across recipes unless a recipe means something else by it. */
const SFX_PARAM_WORDS: Record<string, SfxParamWords> = {
  pitch: { label: 'Pitch', hint: 'Higher or lower, like a smaller or bigger object.' },
  brightness: { label: 'Brightness', hint: 'From dull and soft to sharp and crisp.' },
  decay: { label: 'Ring', hint: 'How long it rings on after the hit.' },
  release: { label: 'Spring-back click', hint: 'How loud the second click is, when the button comes back up.' },
  releaseAfter: { label: 'Spring-back delay', hint: 'Seconds until the button comes back up.' },
  room: { label: 'Room', hint: 'How much room you hear around it: 0 is dry, right at your ear; 1 is a small room.' },
  step: { label: 'Second click', hint: `How far the second click is from the first, ${PIANO_KEYS}.` },
  gap: { label: 'Gap', hint: 'Seconds between the two clicks.' },
  weight: { label: 'Thump', hint: 'How much low thump sits under the hit: the part you feel more than hear.' },
  approach: { label: 'Build-up', hint: 'Seconds until it passes closest to you, which is where it lands.' },
  recede: { label: 'Fade away', hint: 'Seconds it takes to fade after passing.' },
  speed: { label: 'Speed', hint: 'How fast it flies past: faster is thinner, higher and more sudden.' },
  duration: { label: 'Length', hint: 'Seconds.' },
  sweep: { label: 'Climb', hint: 'How far the tone climbs, in octaves (one octave is from one “do” to the next).' },
  tone: { label: 'Air or tone', hint: 'From all rushing air (0) to all musical tone (1).' },
  tail: { label: 'Tail', hint: 'Seconds it takes to fade after the peak; 0 stops dead on it.' },
  notes: { label: 'Notes', hint: 'How many notes: one, two or three.' },
  step2: { label: 'Third note', hint: `How far the third note is from the second, ${PIANO_KEYS}.` },
  shimmer: { label: 'Echo', hint: 'How loud the soft echo after the notes is.' },
  inharmonic: { label: 'Bell to glass', hint: 'From a tuned bar with one clear note (0) to glass or a wind chime (1).' },
  glide: { label: 'Bend', hint: 'How far the pitch bends as it dies, in octaves: up for a bubble, down for a water drop.' },
  rate: { label: 'Speed', hint: 'Keys per second while typing.' },
  jitter: { label: 'Unevenness', hint: 'How unevenly the keys fall: 0 is a metronome.' },
  flick: { label: 'Flick', hint: 'From a steady turn (0) to a flick that rushes, then slows (1).' },
};

const SFX_RECIPE_PARAM_WORDS: Partial<Record<SfxRecipeName, Record<string, SfxParamWords>>> = {
  whoosh: { brightness: { label: 'Brightness', hint: 'From a low rush of air to a hiss.' } },
  riser: {
    duration: { label: 'Build-up', hint: 'Seconds of climbing before the peak.' },
    brightness: { label: 'Brightness', hint: 'How high the rushing air climbs.' },
    pitch: { label: 'Starting note', hint: 'How low the tone starts.' },
  },
  chime: {
    pitch: { label: 'Pitch', hint: 'How high the first note is.' },
    brightness: { label: 'Sparkle', hint: 'How much bright ring sits on top of each note.' },
    decay: { label: 'Ring', hint: 'Seconds each note rings before it has gone.' },
    step: { label: 'Second note', hint: `How far the second note is from the first, ${PIANO_KEYS}.` },
    gap: { label: 'Gap', hint: 'Seconds between notes.' },
  },
  ding: {
    pitch: { label: 'Pitch', hint: 'How high it rings.' },
    brightness: { label: 'Sparkle', hint: 'How hard it’s struck, and how much bright ring it has.' },
    decay: { label: 'Ring', hint: 'Seconds it rings before it has gone.' },
  },
  pop: {
    pitch: { label: 'Pitch', hint: 'How high it starts.' },
    decay: { label: 'Length', hint: 'Seconds before it has gone.' },
    brightness: { label: 'Click', hint: 'How much of a wet click starts it.' },
  },
  scroll: { rate: { label: 'Speed', hint: 'Ticks per second at the fastest.' } },
  buzz: {
    pitch: { label: 'Speed', hint: 'How many times a second the needles hammer, heard as the buzz’s pitch.' },
    duty: { label: 'Tuning', hint: 'How long the coils pull in each stroke: near half is reedy, higher is fuller.' },
    decay: { label: 'Ring', hint: 'How long the machine’s frame rings after each stroke.' },
    rotary: { label: 'Coil or rotary', hint: 'A coil machine’s hammering rattle (0) or a rotary’s smooth motor hum (1).' },
    load: { label: 'Skin', hint: 'How hard the skin drags once the needles are in: slower, duller and quieter.' },
    lead: { label: 'Run-up', hint: 'Seconds it runs before the needles touch, which is where it lands.' },
    air: { label: 'Run-up level', hint: 'How loud it runs before the needles touch: low, and the touch is where it starts.' },
    snap: { label: 'Bite', hint: 'A bright crack as the needles touch, which makes the touch a hit.' },
    hold: { label: 'Hold', hint: 'Seconds it runs on in the skin.' },
    spinDown: { label: 'Wind-down', hint: 'Seconds it takes to stop.' },
  },
};

export const sfxParamWords = (recipe: SfxRecipeName, param: string): SfxParamWords =>
  SFX_RECIPE_PARAM_WORDS[recipe]?.[param] ?? SFX_PARAM_WORDS[param] ?? { label: param, hint: '' };

const SFX_SOUND_WORDS: Record<SfxRecipeName, string> = {
  click: 'a mouse click', key: 'a key press', toggle: 'a switch flipping', impact: 'a soft thud', whoosh: 'a whoosh of air sweeping past',
  riser: 'a swell that rises into the moment', chime: 'a little chime', ding: 'a bell ding', pop: 'a bubbly pop', typing: 'a burst of typing', scroll: 'scroll-wheel ticks',
  buzz: 'a tattoo machine buzzing',
};
const SFX_PRESET_WORDS: Record<string, string> = {
  soft: 'gentler', fast: 'quicker', swell: 'slower and fuller', short: 'short', crisp: 'crisp', trackpad: 'a quiet trackpad tap',
  mechanical: 'clacky', heavy: 'heavy', slam: 'hard', whip: 'a whip pan', success: 'rising, for a success', error: 'falling, for an error',
  bright: 'bright', glass: 'glassy', bell: 'like a bell', bubble: 'a bubble', droplet: 'a water drop', on: 'switching on', off: 'switching off',
  space: 'the space bar', steady: 'a steady turn', flick: 'a flick', cut: 'stopping dead on its peak', long: 'long', airy: 'airy', tonal: 'musical', slow: 'slow',
  liner: 'a fast, crisp liner', shader: 'a slower, heavier shader', rotary: 'a smooth rotary', strike: 'one quick needle strike',
};

/** A sound as words: its recipe, and how its preset differs ("a whoosh of air sweeping past, gentler"). */
export function sfxSoundWords(sound: SfxRequest): string {
  const [recipe, preset] = sound.sound.split('.');
  const how = preset && SFX_PRESET_WORDS[preset];
  return `${SFX_SOUND_WORDS[recipe as SfxRecipeName] ?? recipe}${how ? `, ${how}` : ''}`;
}
