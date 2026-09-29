// recipes.ts: the sound recipes, after Andy Farnell's Designing Sound: each sound is modelled from what makes it (a
// contact exciting a body, air moving past, a struck bar), not sampled. Every recipe is a pure function of its
// parameters and a seed, and the seed only varies the fine detail, so two seeds of one preset are the same sound
// played twice.
//
// Parameters are all numbers with a range, so presets, overrides and mutate treat every recipe alike. Where recipes
// share an idea they share its name: `pitch`, `brightness`, `decay`, `duration`.
import { addShimmer, clamp01, fadeOutTail, lerp, smoothstep, logLerp, mixInto, onePole, pinkNoise, renderSfxLayers, samplesFor, SFX_RATE, stateVariableFilter, subSeed, whiteNoise, type SfxLayer } from './dsp.ts';
import { seededRandom } from '#lib/picture/motion/models/random.ts';

/** How loud a sound sits under the voice: ui for clicks and ticks, accent for whooshes, hits and chimes. */
export type SfxCategory = 'ui' | 'accent';

export type SfxParamSpec = {
  min: number; max: number; doc: string;
  /** mutate on a log scale */
  log?: boolean;
  /** Left alone by mutate: it decides what kind of sound this is (a toggle's direction, a chime's melody). */
  fixed?: boolean;
};

export type SfxRender = {
  samples: Float64Array;
  /** Seconds into the sound where the event it marks lands: 0 for a click, the pass of a whoosh, a riser's peak. */
  landsAt: number;
};

/**
 * Every recipe also takes `room`: the library puts the sound in a small room after rendering it dry, so a recipe
 * only sets how roomy it is by default.
 */
export const SFX_ROOM_PARAM: SfxParamSpec = { min: 0, max: 1, doc: 'How much small room is around it, from dry (0) to roomy (1)' };

export type SfxRecipe<P extends Record<string, number> = Record<string, number>> = {
  doc: string;
  category: SfxCategory;
  /** Its own parameters; `room` is every recipe's, from SFX_ROOM_PARAM. */
  params: { readonly [K in keyof P as K extends 'room' ? never : K]: SfxParamSpec };
  defaults: P & { room: number };
  /** Named variations: `chime.soft` is `defaults` with `presets.soft` over it. */
  presets: Readonly<Record<string, Partial<P & { room: number }>>>;
  render: (params: P, seed: number) => SfxRender;
};

const defineSfxRecipe = <P extends Record<string, number>>(recipe: SfxRecipe<P>) => recipe;

/** ±`spread` around 1, drawn from `random`. */
const jitter = (random: () => number, spread: number) => 1 + (random() * 2 - 1) * spread;

// ——— Strikes: a noise burst into decaying resonances ———————————————————————————————————————————————————————————

type Strike = { at: number; gain: number; noiseHz: number; noiseQ: number; noiseTau: number; tones: readonly { hz: number; tau: number; gain: number }[] };

/**
 * One contact as layers: a short band of noise for the snap and a few decaying sines for the body that rings. The
 * seed nudges every frequency and level a little, so repeats of one sound aren't identical.
 */
function strikeLayers({ at, gain, noiseHz, noiseQ, noiseTau, tones }: Strike, random: () => number): SfxLayer[] {
  return [
    { kind: 'noise', at, filter: 'bp', hz: noiseHz * jitter(random, 0.08), q: noiseQ, attack: 0.0003, tau: noiseTau, gain: gain * 2.2 * jitter(random, 0.1) },
    ...tones.map(({ hz, tau, gain: g }): SfxLayer => ({ kind: 'tone', at, hz: hz * jitter(random, 0.03), attack: 0.0004, tau, gain: gain * g * jitter(random, 0.12) })),
  ];
}

const strikeParams = {
  pitch: { min: 0.5, max: 2, log: true, doc: 'Scales every resonance; 1 is the preset' },
  brightness: { min: 0, max: 1, doc: 'How much high snap there is in the contact noise' },
  decay: { min: 0.5, max: 2.5, log: true, doc: 'Scales how long the body rings' },
  release: { min: 0, max: 1, doc: 'Level of the release (the switch coming back up) against the press' },
  releaseAfter: { min: 0.02, max: 0.2, doc: 'Seconds from press to release' },
} as const;

type StrikeParams = { pitch: number; brightness: number; decay: number; release: number; releaseAfter: number };

/** A press and a softer, slightly higher release, like a real switch. */
function pressAndRelease(p: StrikeParams, seed: number, noiseTau: number, tones: Strike['tones']): SfxRender {
  const random = seededRandom(subSeed(seed, 'strike'));
  const scaled = tones.map((t) => ({ ...t, hz: t.hz * p.pitch, tau: t.tau * p.decay }));
  const noiseHz = logLerp(1500, 9000, p.brightness);
  const layers = [
    ...strikeLayers({ at: 0, gain: 1, noiseHz, noiseQ: 0.9, noiseTau, tones: scaled }, random),
    ...(p.release > 0
      ? strikeLayers({ at: p.releaseAfter, gain: p.release, noiseHz: noiseHz * 1.15, noiseQ: 0.9, noiseTau, tones: scaled.map((t) => ({ ...t, hz: t.hz * 1.08 })) }, random)
      : []),
  ];
  return { samples: fadeOutTail(renderSfxLayers(layers, seed)), landsAt: 0 };
}

export const click = defineSfxRecipe({
  doc: 'A mouse button: a sharp snap and a small plastic body, then a quieter release',
  category: 'ui',
  params: strikeParams,
  defaults: { pitch: 1, brightness: 0.6, decay: 1, release: 0.45, releaseAfter: 0.07, room: 0.3 },
  presets: { soft: { brightness: 0.3, release: 0.3, pitch: 0.85 }, crisp: { brightness: 0.9, decay: 0.7 }, trackpad: { pitch: 0.7, brightness: 0.25, release: 0, decay: 0.8 } },
  render: (p, seed) => pressAndRelease(p, seed, 0.0008, [{ hz: 3400, tau: 0.0025, gain: 0.5 }, { hz: 1150, tau: 0.004, gain: 0.35 }]),
});

export const key = defineSfxRecipe({
  doc: 'A keyboard key: a duller contact, a lower body, and the keycap springing back',
  category: 'ui',
  params: strikeParams,
  defaults: { pitch: 1, brightness: 0.4, decay: 1, release: 0.35, releaseAfter: 0.08, room: 0.3 },
  presets: { mechanical: { brightness: 0.8, pitch: 1.25, release: 0.6, releaseAfter: 0.05 }, soft: { brightness: 0.15, pitch: 0.8, release: 0.2 }, space: { pitch: 0.65, decay: 1.6, release: 0.5 } },
  render: (p, seed) => {
    const random = seededRandom(subSeed(seed, 'key'));
    // No ringing tones: a keycap is plastic on a spring over a board, all damped, so its body is bands of noise
    // (a low thock, a mid clack) that die within a few cycles. A tone that rings reads as a hollow wood block.
    const hit = (at: number, gain: number, shift: number): SfxLayer[] => [
      { kind: 'noise', at, filter: 'bp', hz: 260 * p.pitch * shift * jitter(random, 0.08), q: 1.6, attack: 0.0005, tau: 0.004 * p.decay, gain: gain * 4 },
      { kind: 'noise', at, filter: 'bp', hz: 1700 * p.pitch * shift * jitter(random, 0.08), q: 1.1, attack: 0.0003, tau: 0.0025 * p.decay, gain: gain * 2.4 },
      { kind: 'noise', at, filter: 'hp', hz: logLerp(2500, 7000, p.brightness), q: 0.7, attack: 0.0002, tau: 0.0008, gain: gain * lerp(0.4, 1.8, p.brightness) },
    ];
    const layers = [...hit(0, 1, 1), ...(p.release > 0 ? hit(p.releaseAfter, p.release, 1.3) : [])];
    return { samples: fadeOutTail(renderSfxLayers(layers, seed)), landsAt: 0 };
  },
});

export const toggle = defineSfxRecipe({
  doc: 'A switch flipping: a click then a clack, the second a few semitones up (on) or down (off)',
  category: 'ui',
  params: {
    pitch: strikeParams.pitch, brightness: strikeParams.brightness, decay: strikeParams.decay,
    step: { min: -12, max: 12, fixed: true, doc: 'Semitones from the first click to the second: up for on, down for off' },
    gap: { min: 0.01, max: 0.08, doc: 'Seconds between the two clicks' },
  },
  defaults: { pitch: 1, brightness: 0.55, decay: 1, step: 5, gap: 0.028, room: 0.3 },
  presets: { on: { step: 5 }, off: { step: -5 }, soft: { brightness: 0.25, pitch: 0.8, gap: 0.035 } },
  render: (p, seed) => {
    const random = seededRandom(subSeed(seed, 'toggle'));
    const body = (shift: number) => [{ hz: 2600 * p.pitch * shift, tau: 0.003 * p.decay, gain: 0.45 }, { hz: 900 * p.pitch * shift, tau: 0.006 * p.decay, gain: 0.4 }];
    const noiseHz = logLerp(1500, 8000, p.brightness), up = 2 ** (p.step / 12);
    const layers = [
      ...strikeLayers({ at: 0, gain: 0.8, noiseHz, noiseQ: 1.4, noiseTau: 0.001, tones: body(1) }, random),
      ...strikeLayers({ at: p.gap, gain: 1, noiseHz: noiseHz * up, noiseQ: 1.4, noiseTau: 0.0012, tones: body(up) }, random),
    ];
    return { samples: fadeOutTail(renderSfxLayers(layers, seed)), landsAt: p.gap };
  },
});

/**
 * A kick's body, peaking at 1: a sine falling from `from` toward `to` Hz (1/e every `drop` s), held `hold`, then dying
 * by 1/e every `tau`. Clipped by `drive` at full level, so its harmonics carry on small speakers and a limiter pulls
 * less on it; cleaner as it dies, so a long tail stays a sub, not a low-mid drone.
 */
function kickBody({ from, to, drop, hold, tau, drive }: { from: number; to: number; drop: number; hold: number; tau: number; drive: number }): Float64Array {
  const attack = 0.0015, out = samplesFor(attack + hold + tau * 6.9);
  let phase = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / SFX_RATE;
    phase += (2 * Math.PI * (to + (from - to) * Math.exp(-t / drop))) / SFX_RATE;
    const level = t < attack ? t / attack : Math.exp(-Math.max(0, t - attack - hold) / tau);
    const clip = drive * Math.max(level, 1e-4);
    out[i] = (level * Math.tanh(clip * Math.sin(phase))) / Math.tanh(clip);
  }
  return out;
}

/** Sums sounds that start together into one buffer as long as the longest. */
function mixed(...parts: readonly (readonly [Float64Array, number])[]): Float64Array {
  const out = new Float64Array(Math.max(...parts.map(([s]) => s.length)));
  for (const [samples, gain] of parts) mixInto(out, samples, 0, gain);
  return out;
}

/**
 * `x` through a 4th-order Butterworth lowpass at `hz`. A hit's edge over 16 kHz is barely heard, but it's where a
 * delivery's AAC encode overshoots a mastered peak: cutting it halves how often a hit's encode peaks over −1 dBTP.
 */
function lowpassed(x: Float64Array, hz: number): Float64Array {
  const first = stateVariableFilter(), second = stateVariableFilter();
  return x.map((v) => second(first(v, hz, 0.5412).lp, hz, 1.3066).lp);
}

export const impact = defineSfxRecipe({
  doc: 'Something landing hard, dry and punchy: a few ms of bright crack, a thwack of noise bands that die within a few cycles (no tone rings, so it never reads hollow), and a kick drum’s body under it, its pitch dropping. `impact.lock` strikes twice, a latch catching `latchAfter` after the hit',
  category: 'accent',
  params: {
    pitch: { min: 0.5, max: 2, log: true, doc: 'Scales the body and the kick: a smaller or a bigger thing' },
    brightness: { min: 0, max: 1, doc: 'How much crack is in the hit, and how high it sits' },
    decay: { min: 0.3, max: 3, log: true, doc: 'Scales how long the body and the kick last' },
    weight: { min: 0, max: 1, doc: 'Level of the kick under the hit: its low end' },
    latch: { min: 0, max: 1, doc: 'Level of a second, lighter strike, higher and with no kick: a bolt catching, a lock seating. 0 strikes once' },
    latchAfter: { min: 0.015, max: 0.08, doc: 'Seconds from the hit to its latch' },
  },
  defaults: { pitch: 1, brightness: 0.5, decay: 1, weight: 0.7, latch: 0, latchAfter: 0.03, room: 0.12 },
  presets: {
    soft: { brightness: 0, weight: 0.6, decay: 0.9 },
    heavy: { pitch: 0.75, weight: 1, decay: 1.6, brightness: 0.35 },
    slam: { pitch: 1.15, brightness: 0.85, decay: 0.75, weight: 0.85 },
    lock: { pitch: 1, brightness: 1, decay: 0.8, weight: 0.7, latch: 1, latchAfter: 0.032, room: 0.08 },
  },
  render: (p, seed) => {
    const random = seededRandom(subSeed(seed, 'impact'));
    const strike = (at: number, gain: number, shift: number, low: boolean): SfxLayer[] => [
      // The crack, then the slap: a snare's few ms of noise, held long enough to fill the ear's first moments of the
      // hit (a sub-ms tick peaks high and says little). Band-passed: the octave above adds nothing a listener needs,
      // and it's what an AAC encode overshoots on.
      { kind: 'noise', at, filter: 'bp', hz: logLerp(2500, 6500, p.brightness) * shift * jitter(random, 0.08), q: 0.8, attack: 0.001, tau: 0.0045, gain: gain * lerp(0.4, 1.6, p.brightness) },
      { kind: 'noise', at, filter: 'bp', hz: logLerp(1400, 4000, p.brightness) * shift * jitter(random, 0.08), q: 0.6, attack: 0.001, tau: 0.014 * p.decay, gain: gain * lerp(0.5, 1.2, p.brightness) },
      { kind: 'noise', at, filter: 'bp', hz: 650 * p.pitch * shift * jitter(random, 0.08), q: 1.2, attack: 0.0006, tau: 0.006 * p.decay, gain: gain * 2 },
      ...(low ? [{ kind: 'noise', at, filter: 'bp', hz: 190 * p.pitch * shift * jitter(random, 0.08), q: 1.4, attack: 0.001, tau: 0.012 * p.decay, gain: gain * 3 } as const] : []),
    ];
    const layers = [...strike(0, 1, 1, true), ...(p.latch > 0 ? strike(p.latchAfter, p.latch, 1.35, false) : [])];
    const kick = kickBody({ from: 160 * p.pitch, to: 50 * p.pitch, drop: 0.012, hold: 0.03 * p.decay, tau: 0.024 * p.decay, drive: 2 });
    return { samples: fadeOutTail(lowpassed(mixed([renderSfxLayers(layers, seed), 1], [kick, 0.8 * p.weight]), 16000)), landsAt: 0 };
  },
});

// ——— Air: noise bands that move ————————————————————————————————————————————————————————————————————————————————

export const whoosh = defineSfxRecipe({
  doc: "Something passing close: band-passed pink noise that swells and brightens at the closest pass (`landsAt`), with a slight Doppler fall after it. Faster moves are narrower and higher. A whip pan is `whoosh.whip`",
  category: 'accent',
  params: {
    approach: { min: 0.05, max: 2, log: true, doc: 'Seconds from the start to the closest pass, where it lands' },
    recede: { min: 0.1, max: 2, log: true, doc: 'Seconds it takes to die away after the pass' },
    speed: { min: 0, max: 1, doc: 'How fast the thing passes: a narrower, higher, more sudden band' },
    brightness: { min: 0, max: 1, doc: 'Where the band sits, from a low rush to a hiss' },
  },
  defaults: { approach: 0.38, recede: 0.5, speed: 0.5, brightness: 0.5, room: 0.3 },
  presets: {
    soft: { approach: 0.55, recede: 0.7, speed: 0.25, brightness: 0.3 },
    fast: { approach: 0.2, recede: 0.3, speed: 0.8, brightness: 0.6 },
    whip: { approach: 0.09, recede: 0.22, speed: 1, brightness: 0.85 },
    swell: { approach: 1.3, recede: 1.2, speed: 0.15, brightness: 0.4 },
  },
  render: (p, seed) => {
    const tp = p.approach, out = samplesFor(p.approach + p.recede);
    // How close the pass comes, on each side of it. Each side's width is a share of its own length, so a long build
    // never has to fall away in a short recede; faster moves are more sudden.
    const before = p.approach * lerp(0.35, 0.15, p.speed), after = p.recede * lerp(0.4, 0.2, p.speed);
    const noise = pinkNoise(seededRandom(subSeed(seed, 'air'))), turbulence = seededRandom(subSeed(seed, 'turbulence'));
    const band = stateVariableFilter(), body = stateVariableFilter(), air = stateVariableFilter(), wobble = onePole();
    const centre = logLerp(350, 2600, p.brightness) * logLerp(0.8, 1.5, p.speed);
    for (let i = 0; i < out.length; i++) {
      const t = i / SFX_RATE, d = (t - tp) / (t < tp ? before : after);
      const near = 1 / (1 + d * d);
      // Turbulence: a slow random wander of the band, so the air isn't a clean sweep.
      const drift = 1 + 0.25 * wobble(turbulence() * 2 - 1, 12);
      const doppler = 1 + 0.18 * (0.4 + p.speed) * Math.tanh(-d);
      const hz = centre * (0.45 + near) * doppler * drift;
      const q = lerp(0.7, 2.6, p.speed * near);
      const n = noise();
      const v = band(n, hz, q).bp + 0.5 * body(n, hz * 0.45, 0.8).bp + 0.35 * p.brightness * near * air(n, 5500, 0.7).hp;
      // The pass alone never reaches silence inside the sound, so it's tapered to nothing at both ends: the thing
      // arrives from, and leaves into, the distance.
      const taper = t < tp ? smoothstep(t / tp) : 1 - smoothstep((t - tp) / p.recede);
      out[i] = v * near ** 1.6 * taper;
    }
    return { samples: out, landsAt: tp };
  },
});

export const riser = defineSfxRecipe({
  doc: 'Tension into a reveal: a noise band and a detuned tone climbing together and swelling to a peak (`landsAt`, at `duration`), then a short breath out over `tail`. Place it with its peak on the reveal',
  category: 'accent',
  params: {
    duration: { min: 0.4, max: 5, log: true, doc: 'Seconds' },
    brightness: { min: 0, max: 1, doc: 'How high the noise climbs' },
    pitch: { min: 60, max: 400, log: true, doc: 'The tone’s starting Hz' },
    sweep: { min: 0.5, max: 4, doc: 'Octaves the tone climbs' },
    tone: { min: 0, max: 1, doc: 'Mix from all air (0) to all tone (1)' },
    tail: { min: 0, max: 1.5, fixed: true, doc: 'Seconds it takes to die away after the peak; 0 stops on it, leaving only the room' },
  },
  defaults: { duration: 1.5, brightness: 0.6, pitch: 110, sweep: 2, tone: 0.45, tail: 0.35, room: 0.35 },
  presets: {
    short: { duration: 0.7, sweep: 1.5, tail: 0.25 },
    cut: { tail: 0, room: 0 },
    long: { duration: 3, sweep: 3 },
    airy: { tone: 0.08, brightness: 0.75 },
    tonal: { tone: 0.85, brightness: 0.4 },
  },
  render: (p, seed) => {
    const out = samplesFor(p.duration + p.tail), peak = Math.round(p.duration * SFX_RATE);
    const noise = pinkNoise(seededRandom(subSeed(seed, 'air'))), random = seededRandom(subSeed(seed, 'detune'));
    const band = stateVariableFilter(), toneFilter = stateVariableFilter();
    const detunes = [-1, 0, 1].map((k) => 2 ** ((k * 9 * jitter(random, 0.3)) / 1200));
    const phases = detunes.map(() => random() * 2 * Math.PI);
    for (let i = 0; i < out.length; i++) {
      // After the peak the pitch holds and the level falls away, the tone faster than the air.
      const x = Math.min(1, i / peak), after = Math.max(0, i - peak) / SFX_RATE;
      const fall = p.tail > 0 ? Math.exp(-after / (p.tail / 6.9)) : after > 0 ? 0 : 1;
      const hz = logLerp(p.pitch, p.pitch * 2 ** p.sweep, x ** 1.4);
      let saw = 0;
      detunes.forEach((d, k) => {
        phases[k] += (2 * Math.PI * hz * d) / SFX_RATE;
        for (let n = 1; n <= 6 && n * hz * d < SFX_RATE * 0.45; n++) saw += Math.sin(n * phases[k]) / n;
      });
      const tone = toneFilter(saw / 3, hz * lerp(2, 6, x), 0.9).lp;
      const air = band(noise(), logLerp(250, logLerp(2500, 9000, p.brightness), x ** 1.2), lerp(0.8, 3.5, x)).bp;
      out[i] = (x ** 2.2) * (lerp(1.6, 0, p.tone) * air * fall + p.tone * 0.9 * tone * fall * fall);
    }
    return { samples: fadeOutTail(out, 0.004), landsAt: p.duration };
  },
});

// ——— Resonant bodies: inharmonic partials, each with its own decay ——————————————————————————————————————————————

/** A struck body's partials: harmonic at 0, a free bar's (Farnell's glass and chime model) at 1. */
const partialRatios = (inharmonic: number) => [1, 2, 3, 4].map((h, i) => lerp(h, [1, 2.756, 5.404, 8.933][i], inharmonic));

/** A struck note. Each partial is a pair of sines a hair apart, so it beats slowly as a real bell does. */
function struckNote(at: number, hz: number, p: { brightness: number; decay: number; inharmonic: number }, random: () => number): SfxLayer[] {
  return partialRatios(p.inharmonic).flatMap((ratio, i) => {
    const gain = i === 0 ? 1 : 0.55 * p.brightness ** (0.6 + i * 0.5) / i;
    const tau = (p.decay / 6.9) / ratio ** 0.7, beat = 0.4 + random() * 1.2;
    return [-0.5, 0.5].map((side): SfxLayer => ({ kind: 'tone', at, hz: hz * ratio + side * beat, attack: 0.0015, tau, gain: gain / 2 }));
  });
}

export const chime = defineSfxRecipe({
  doc: 'A notification: up to three struck notes stepping by musical intervals, with a soft echo tail. `chime.success` climbs a major triad, `chime.error` falls',
  category: 'accent',
  params: {
    pitch: { min: 300, max: 2200, log: true, doc: 'Hz of the first note' },
    brightness: { min: 0, max: 1, doc: 'Level of the upper partials' },
    decay: { min: 0.2, max: 4, log: true, doc: 'Seconds for each note to die away (60 dB)' },
    notes: { min: 1, max: 3, fixed: true, doc: 'How many notes (rounded)' },
    step: { min: -12, max: 12, fixed: true, doc: 'Semitones from the first note to the second' },
    step2: { min: -12, max: 12, fixed: true, doc: 'Semitones from the second note to the third' },
    gap: { min: 0.03, max: 0.25, doc: 'Seconds between notes' },
    shimmer: { min: 0, max: 0.5, doc: 'Level of the echo tail' },
  },
  // C6 up to G6, then an E7 if a third is asked for: the two-note "tink" of cuelume's chime.
  defaults: { pitch: 1046.5, brightness: 0.35, decay: 1.4, notes: 2, step: 7, step2: 5, gap: 0.09, shimmer: 0.2, room: 0.45 },
  presets: {
    soft: { pitch: 784, brightness: 0.15, decay: 1.8, shimmer: 0.25 },
    bright: { pitch: 1318.5, brightness: 0.7, decay: 1.1 },
    success: { pitch: 880, notes: 3, step: 4, step2: 3, gap: 0.06, decay: 1.2 },
    error: { pitch: 440, notes: 2, step: -4, gap: 0.08, brightness: 0.55, decay: 0.8, shimmer: 0.08 },
  },
  render: (p, seed) => {
    const random = seededRandom(subSeed(seed, 'chime'));
    const count = Math.round(p.notes), steps = [0, p.step, p.step + p.step2];
    const layers = steps.slice(0, count).flatMap((semitones, i) =>
      struckNote(i * p.gap, p.pitch * 2 ** (semitones / 12), { brightness: p.brightness, decay: p.decay, inharmonic: 0.15 }, random));
    const dry = renderSfxLayers(layers, seed);
    return { samples: fadeOutTail(p.shimmer > 0 ? addShimmer(dry, { delay: 0.11, feedback: 0.3, wet: p.shimmer, lowpassHz: 3800 }) : dry), landsAt: 0 };
  },
});

export const ding = defineSfxRecipe({
  doc: 'One struck bell, bar or glass, ringing out. `inharmonic` moves it from a tuned bar toward glass',
  category: 'accent',
  params: {
    pitch: { min: 200, max: 3500, log: true, doc: 'Hz of the fundamental' },
    brightness: { min: 0, max: 1, doc: 'Level of the upper partials, and how hard it’s struck' },
    decay: { min: 0.3, max: 6, log: true, doc: 'Seconds to die away (60 dB)' },
    inharmonic: { min: 0, max: 1, doc: 'From harmonic partials (a tuned bar) to a free bar’s (glass, a chime tube)' },
  },
  defaults: { pitch: 1320, brightness: 0.45, decay: 2.2, inharmonic: 0.6, room: 0.45 },
  presets: {
    soft: { brightness: 0.2, pitch: 990 },
    glass: { pitch: 2350, inharmonic: 1, decay: 1.6, brightness: 0.6 },
    bell: { pitch: 520, decay: 4.5, inharmonic: 0.85, brightness: 0.55 },
  },
  render: (p, seed) => {
    const random = seededRandom(subSeed(seed, 'ding'));
    const layers: SfxLayer[] = [
      ...struckNote(0, p.pitch, p, random),
      { kind: 'noise', at: 0, filter: 'bp', hz: p.pitch * 3, q: 2, attack: 0.0003, tau: 0.002, gain: 0.5 * p.brightness },
    ];
    return { samples: fadeOutTail(renderSfxLayers(layers, seed)), landsAt: 0 };
  },
});

export const pop = defineSfxRecipe({
  doc: 'A blip that bends in pitch as it dies: a bubble rising (Farnell’s bubble), or a falling droplet with a negative `glide`',
  category: 'ui',
  params: {
    pitch: { min: 150, max: 2500, log: true, doc: 'Hz it starts at' },
    glide: { min: -2, max: 2, fixed: true, doc: 'Octaves it bends through: up for a pop or bubble, down for a droplet' },
    decay: { min: 0.02, max: 0.35, log: true, doc: 'Seconds to die away (60 dB)' },
    brightness: { min: 0, max: 1, doc: 'Level of the lip click and the second partial' },
  },
  defaults: { pitch: 520, glide: 0.6, decay: 0.12, brightness: 0.4, room: 0.35 },
  presets: {
    soft: { brightness: 0.1, pitch: 400, decay: 0.09 },
    bubble: { pitch: 380, glide: 1.1, decay: 0.1, brightness: 0.2 },
    droplet: { pitch: 1200, glide: -1.1, decay: 0.2, brightness: 0.15 },
  },
  render: (p, seed) => {
    const tau = p.decay / 6.9, glideTo = p.pitch * 2 ** p.glide, glide = p.decay * 0.6;
    const layers: SfxLayer[] = [
      { kind: 'tone', at: 0, hz: p.pitch, glideTo, glide, attack: 0.002, tau, gain: 1 },
      { kind: 'tone', at: 0, hz: p.pitch * 2, glideTo: glideTo * 2, glide, attack: 0.002, tau: tau * 0.5, gain: 0.2 * p.brightness },
      { kind: 'noise', at: 0, filter: 'bp', hz: 3500, q: 1, attack: 0.0002, tau: 0.0007, gain: 0.8 * p.brightness },
    ];
    return { samples: fadeOutTail(renderSfxLayers(layers, seed)), landsAt: 0 };
  },
});

// ——— Trains: seeded, jittered ticks ————————————————————————————————————————————————————————————————————————————————

export const typing = defineSfxRecipe({
  doc: 'A burst of typing: key strikes in words, with a space bar and a short pause between them. For a take, TakeCursor already plays its logged keys',
  category: 'ui',
  params: {
    duration: { min: 0.3, max: 8, log: true, doc: 'Seconds' },
    rate: { min: 3, max: 14, doc: 'Keys per second while typing' },
    jitter: { min: 0, max: 1, doc: 'How unevenly the keys fall' },
    pitch: strikeParams.pitch,
    brightness: strikeParams.brightness,
  },
  defaults: { duration: 2, rate: 8, jitter: 0.5, pitch: 1, brightness: 0.4, room: 0.3 },
  presets: { fast: { rate: 12, jitter: 0.35 }, slow: { rate: 4.5, jitter: 0.7 }, mechanical: { pitch: 1.25, brightness: 0.8 } },
  render: (p, seed) => {
    const out = samplesFor(p.duration + 0.15), random = seededRandom(subSeed(seed, 'typing'));
    let t = 0.01, left = 2 + Math.floor(random() * 6);
    for (let n = 0; t < p.duration; n++) {
      const space = left-- === 0;
      const params = { pitch: p.pitch * (space ? 0.65 : jitter(random, 0.06)), brightness: p.brightness, decay: space ? 1.6 : 1, release: 0.3, releaseAfter: 0.06 + random() * 0.03, room: 0 };
      mixInto(out, key.render(params, subSeed(seed, `key${n}`)).samples, t, space ? 0.9 : 0.55 + random() * 0.45);
      t += (1 / p.rate) * jitter(random, 0.6 * p.jitter) * (space ? 1.8 : 1);
      if (space) left = 2 + Math.floor(random() * 6);
    }
    return { samples: fadeOutTail(out), landsAt: 0 };
  },
});

export const scroll = defineSfxRecipe({
  doc: 'A scroll wheel: small detent ticks, steady or a flick that speeds up and settles',
  category: 'ui',
  params: {
    duration: { min: 0.2, max: 4, log: true, doc: 'Seconds' },
    rate: { min: 4, max: 40, log: true, doc: 'Ticks per second at the fastest' },
    flick: { min: 0, max: 1, doc: 'From a steady turn (0) to a flick that rushes then slows (1)' },
    pitch: strikeParams.pitch,
    brightness: strikeParams.brightness,
  },
  defaults: { duration: 1, rate: 18, flick: 0.6, pitch: 1, brightness: 0.55, room: 0.3 },
  presets: { steady: { flick: 0, rate: 10 }, flick: { flick: 1, rate: 32, duration: 0.8 } },
  render: (p, seed) => {
    const out = samplesFor(p.duration + 0.03), random = seededRandom(subSeed(seed, 'scroll'));
    for (let t = 0.005, n = 0; t < p.duration; n++) {
      const x = t / p.duration;
      const speed = lerp(1, 0.2 + 0.8 * Math.min(1, x * 6) * (1 - x) ** 1.5, p.flick);
      const tick: SfxLayer[] = [
        { kind: 'noise', at: 0, filter: 'bp', hz: logLerp(2500, 7500, p.brightness) * p.pitch, q: 2, attack: 0.0002, tau: 0.0006, gain: 1.6 },
        { kind: 'tone', at: 0, hz: 2300 * p.pitch * jitter(random, 0.04), attack: 0.0002, tau: 0.0012, gain: 0.35 },
      ];
      mixInto(out, renderSfxLayers(tick, subSeed(seed, `tick${n}`)), t, (0.6 + 0.4 * speed) * jitter(random, 0.15));
      t += 1 / (p.rate * Math.max(speed, 0.08)) * jitter(random, 0.08);
    }
    return { samples: fadeOutTail(out), landsAt: 0 };
  },
});

// ——— Machines: a mechanism cycling fast enough to be heard as a pitch ——————————————————————————————————————————————

/**
 * One mode of a body: a two-pole resonator ringing at `hz` and falling by 1/e every `tau` seconds, either of which
 * may move every sample, so a body can be damped while it rings. Zeros at DC and Nyquist keep it to its ring. An
 * impulse of 1 rings at amplitude 1.
 */
function modalResonator() {
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  return (x: number, hz: number, tau: number) => {
    const w = (2 * Math.PI * hz) / SFX_RATE, r = Math.exp(-1 / (tau * SFX_RATE));
    const y = 2 * r * Math.cos(w) * y1 - r * r * y2 + (x - x2) / 2;
    x2 = x1;
    x1 = x;
    y2 = y1;
    y1 = y;
    return y;
  };
}

// A coil machine's frame, cast iron or brass, as [ratio over its lowest mode, level]. A frame is no bar or plate, so
// its modes fall at no neat ratio, and that's what makes its ring metallic rather than tuned.
const TATTOO_FRAME_HZ = 1150;
const TATTOO_FRAME_MODES = [[1, 1], [1.53, 0.85], [2.11, 0.75], [2.87, 0.6], [3.64, 0.5]] as const;
// The frame's lowest bending, which the hand holding it damps to a thock under each slap.
const TATTOO_BODY = { hz: 440, tau: 0.0018 };
/** Seconds a machine takes to come up to speed: under the least `lead`, so it's at speed when the needles touch. */
const TATTOO_REV_UP = 0.045;

export const buzz = defineSfxRecipe({
  doc: 'A tattoo machine: a coil machine’s armature slapping its cores `pitch` times a second, its contact spitting and its frame ringing, or `buzz.rotary`’s smoother motor hum. Already running before its event (at `air` of its level), it lands (`landsAt`) as the needles touch skin `lead` seconds in, biting with a `snap`, sags and dulls in the skin, runs on for `hold` and spins down. `buzz.strike` is one needle strike in under half a second: a whisper of the machine, then the bite over a kick’s thud, which `boom` lets ring on',
  category: 'accent',
  params: {
    pitch: { min: 60, max: 200, log: true, doc: 'Cycles a second at speed, heard as the buzz’s pitch: liners run fast (130–150), shaders slower (90–110)' },
    duty: { min: 0.4, max: 0.7, doc: 'Share of each cycle the coils pull (the front spring on the contact screw): near half, the hum’s harmonics are odd and reedy; higher, fuller' },
    brightness: { min: 0, max: 1, doc: 'How hard and bright each slap and spark is' },
    decay: { min: 0.008, max: 0.2, log: true, doc: 'Seconds the frame rings after each slap (60 dB) in the air; skin shortens it' },
    rotary: { min: 0, max: 1, fixed: true, doc: 'What drives the needles: a coil machine’s slapping armature (0) or a rotary’s motor and cam (1)' },
    load: { min: 0, max: 1, doc: 'How hard the skin drags on the needles from the touch: the sag and the dulling. 0 runs in the air' },
    weight: { min: 0, max: 1, doc: 'Its low end: the coils’ hum under the slaps, and a kick’s thud as the needles touch skin' },
    lead: { min: 0.05, max: 1, log: true, doc: 'Seconds it runs before the needles touch skin, where it lands' },
    air: { min: 0, max: 1, doc: 'Its level before the touch, as a share of its level in the skin: 1 runs as loud; 0.2 whispers 14 dB under, so the touch is where it starts' },
    snap: { min: 0, max: 1, doc: 'How hard the needles bite as they touch: a crack of 20–40 ms over the thud, the attack a hit needs. 0: the thud alone' },
    boom: { min: 0.1, max: 3, log: true, doc: 'Seconds the thud’s low body takes to die away (60 dB): 0.3 is a kick’s thud; 1.5 is an 808’s boom, to carry a held last shot' },
    hold: { min: 0, max: 4, doc: 'Seconds it runs on in the skin after the touch' },
    spinDown: { min: 0.03, max: 0.6, log: true, doc: 'Seconds it takes to stop after the hold, its pitch and level falling' },
  },
  defaults: { pitch: 120, duty: 0.55, brightness: 0.55, decay: 0.03, rotary: 0, load: 0.6, weight: 0.25, lead: 0.25, air: 1, snap: 0, boom: 0.3, hold: 0.8, spinDown: 0.15, room: 0.25 },
  presets: {
    liner: { pitch: 140, duty: 0.52, brightness: 0.75, decay: 0.025, load: 0.5, weight: 0.15 },
    shader: { pitch: 100, duty: 0.6, brightness: 0.4, decay: 0.04, load: 0.75, weight: 0.4 },
    rotary: { rotary: 1, pitch: 115, brightness: 0.35, decay: 0.02, spinDown: 0.3 },
    strike: { pitch: 112, duty: 0.55, brightness: 0.7, load: 0.7, weight: 0.85, lead: 0.1, air: 0.2, snap: 0.8, hold: 0.15, spinDown: 0.08, room: 0.1 },
  },
  render: (p, seed) => {
    const draw = seededRandom(subSeed(seed, 'cycles')), sputter = seededRandom(subSeed(seed, 'sparks')), drift = seededRandom(subSeed(seed, 'drift'));
    const noise = whiteNoise(seededRandom(subSeed(seed, 'contacts')));
    const touch = p.lead, stop = touch + p.hold, coil = 1 - p.rotary;
    const touched = needleTouch(p, seed);
    // After the spin-down, time for the frame's last ring, and the touch's thud, to die away.
    const out = samplesFor(Math.max(stop + p.spinDown + 0.02 + p.decay / 2, touch + touched.length / SFX_RATE));
    // The seed runs the same machine again: its speed moves under 1%, its frame never.
    const speed = p.pitch * jitter(draw, 0.008);
    const frame = TATTOO_FRAME_MODES.map(() => modalResonator()), body = modalResonator();
    const current = onePole(), wander = onePole(), crackBand = stateVariableFilter(), tickBand = stateVariableFilter(), hiss = stateVariableFilter();
    const tickFall = Math.exp(-1 / (0.00035 * SFX_RATE));
    let phase = 0, cycle = 1, slapAt = 0.7, crackLevel = 0, tick = 0, spark = 0, sparkLeft = 0, force = 0, forceLeft = 0, forceLength = 1, lastPush = 0;
    let leadEnergy = 0, leadSamples = 0;
    for (let i = 0; i < out.length; i++) {
      const t = i / SFX_RATE, up = clamp01(t / TATTOO_REV_UP), down = clamp01((t - stop) / p.spinDown);
      // The skin's drag takes hold within a couple of cycles of the touch.
      const loaded = t < touch ? 0 : p.load * (1 - Math.exp(-(t - touch) / 0.012));
      const level = smoothstep(up) * (1 - smoothstep(down));
      // Rising to speed, a few percent slower in skin, falling as it stops, and never quite periodic: each cycle runs
      // a little long or short, and the speed wanders.
      const hz = speed * cycle * lerp(0.55, 1, 1 - (1 - up) ** 2) * (1 - 0.07 * loaded) * lerp(1, 0.5, down) * (1 + 0.6 * wander(drift() * 2 - 1, 8));
      const from = phase;
      phase += hz / SFX_RATE;
      const reaches = (at: number) => from < at && phase >= at;
      if (phase >= 1) {
        // The front spring is back on the contact screw: the circuit closes and the coils pull again.
        phase -= 1;
        cycle = jitter(draw, lerp(0.006, 0.011, loaded));
        slapAt = p.duty + (1 - p.duty) * (0.3 + 0.03 * (draw() * 2 - 1));
      }
      // The needle bar turning at the top of its stroke ticks in its tube; skin muffles it.
      if (reaches(p.duty / 2)) tick += level * lerp(1, 0.3, loaded) * lerp(1, 0.4, p.rotary) * jitter(draw, 0.25);
      if (reaches(p.duty)) {
        // The contact opens under the coils' current, and a spark spits across the gap, never the same twice.
        spark = level * coil * (0.2 + draw()) ** 1.5;
        sparkLeft = Math.round(SFX_RATE * lerp(0.0003, 0.0012, draw()));
      }
      if (reaches(slapAt)) {
        // The armature slaps the coil cores. Skin slows it on the way, and a slower contact lasts longer: duller.
        force = level * coil * lerp(1, 0.8, loaded) * jitter(draw, 0.12);
        crackLevel += force;
        forceLength = forceLeft = Math.round(SFX_RATE * lerp(0.0004, 0.00012, p.brightness) * (1 + 0.5 * loaded));
      }

      // The slap's force as a half-sine of unit area, so a harder contact is briefer and rings the higher modes more.
      let push = 0;
      if (forceLeft > 0) {
        push = force * (Math.PI / (2 * forceLength)) * Math.sin((Math.PI * (forceLength - forceLeft + 0.5)) / forceLength);
        forceLeft--;
      }
      const ringTau = (p.decay / 6.9) * lerp(1, 0.35, loaded);
      let ring = 0;
      TATTOO_FRAME_MODES.forEach(([ratio, gain], k) => { ring += gain * frame[k](push, TATTOO_FRAME_HZ * ratio, ringTau / ratio ** 0.7); });
      // In skin, each downstroke meets it too, and that soft push reaches the frame's body with the slap.
      const thock = body(push * (1 + 1.5 * loaded), TATTOO_BODY.hz, TATTOO_BODY.tau);
      crackLevel *= Math.exp(-1 / (SFX_RATE * lerp(0.0009, 0.0004, p.brightness) * (1 + 0.5 * loaded)));
      tick *= tickFall;
      const crack = lerp(1, 0.7, loaded) * crackBand(noise() * crackLevel, logLerp(1800, 7000, p.brightness) * lerp(1, 0.6, loaded), 0.8).bp;
      const tock = tickBand(noise() * tick, 3200, 1.5).bp;
      let spit = 0;
      if (sparkLeft > 0) {
        sparkLeft--;
        if (sputter() < 0.15) spit = spark * (sputter() * 2 - 1);
      }
      // A rotary has no contact to spark, but its motor's brushes hiss, pulsing with the commutator.
      const brush = p.rotary * level * 0.03 * noise() * (0.6 + 0.4 * Math.cos(20 * Math.PI * phase));
      const sizzle = hiss(spit + brush, logLerp(2500, 6500, p.brightness), 0.7).hp;
      // The coils pull for `duty` of each cycle, their inductance smoothing the current, and the pull shakes the
      // frame: the buzz's fundamental and its reedy, mostly odd, low harmonics.
      const pull = current((phase < p.duty ? 1 : -1) - (2 * p.duty - 1), speed * 2.5);
      // A rotary's cam drives the needles on a near sine, but they only meet skin going down, so the motor's load is
      // lopsided and its hum carries a few falling harmonics. Its commutator whines ten times a turn.
      const cam = Math.sin(2 * Math.PI * phase) + 0.4 * Math.sin(4 * Math.PI * phase + 0.5) + 0.2 * Math.sin(6 * Math.PI * phase + 1.1)
        + 0.1 * Math.sin(8 * Math.PI * phase + 1.9) + 0.06 * Math.sin(20 * Math.PI * phase);
      const hum = level * lerp(pull, 0.8 * cam, p.rotary);
      // A small rigid body radiates the rate of change of the force on it, so the slap is heard as a click that's the
      // same every cycle, and so a comb of harmonics rather than noise.
      const thwack = push - lastPush;
      lastPush = push;
      // Balanced so the slap's click, crack and ring lead, as they do in a coil machine's loud, high buzz, and at the
      // default weight the hum's fundamental sits a few dB under them.
      const machine = 0.12 * p.weight * hum + 12 * thwack + 0.1 * thock + 1.3 * crack + 0.1 * ring + 0.35 * tock + 0.25 * sizzle;
      if (t < touch) {
        leadEnergy += machine * machine;
        leadSamples++;
      }
      out[i] = (t < touch ? p.air : 1) * machine;
    }
    // The touch is levelled against the machine at speed, whatever its `air`, so it stays in scale under a quiet
    // rotary as under a coil.
    mixInto(out, touched, touch, Math.sqrt(leadEnergy / leadSamples));
    return { samples: fadeOutTail(out, 0.01), landsAt: touch };
  },
});

/** The needles touching skin, from that moment, scaled for a machine running at a level of 1. */
function needleTouch(p: { brightness: number; load: number; weight: number; snap: number; boom: number }, seed: number): Float64Array {
  // The needle grouping meeting skin: its soft slap, and under it a kick's thud, the weight of the hand behind it.
  const skin = renderSfxLayers([{ kind: 'noise', at: 0, filter: 'lp', hz: 900, q: 0.7, attack: 0.0015, tau: 0.006, gain: 0.8 }], subSeed(seed, 'thud'));
  const thud = kickBody({ from: 150, to: 48, drop: 0.014, hold: 0.012, tau: p.boom / 6.9, drive: 2.5 });
  // The bite: the points puncturing and the needle bar jarring in its tube, short so the touch is heard as a hit
  // rather than a swell of the buzz. Its top band rises over a whole millisecond: a sharper edge that high is what an
  // AAC encode overshoots on.
  const bite = renderSfxLayers([
    { kind: 'noise', at: 0, filter: 'bp', hz: logLerp(3000, 6500, p.brightness), q: 0.9, attack: 0.0008, tau: 0.009, gain: 1 },
    { kind: 'noise', at: 0, filter: 'bp', hz: 7500, q: 1.2, attack: 0.001, tau: 0.005, gain: 0.9 },
    { kind: 'tone', at: 0, hz: 2350, attack: 0.0006, tau: 0.006, gain: 0.25 },
  ], subSeed(seed, 'bite'));
  return mixed([skin, 3 * p.load], [thud, 4 * p.weight], [bite, 12 * p.snap]);
}

export const SFX_RECIPES = { click, key, toggle, impact, whoosh, riser, chime, ding, pop, typing, scroll, buzz } as const satisfies Record<string, SfxRecipe<any>>;
export type SfxRecipeName = keyof typeof SFX_RECIPES;

