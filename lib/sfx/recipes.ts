// recipes.ts: the sound recipes, after Andy Farnell's Designing Sound: each sound is modelled from what makes it (a
// contact exciting a body, air moving past, a struck bar), not sampled. Every recipe is a pure function of its
// parameters and a seed, and the seed only varies the fine detail, so two seeds of one preset are the same sound
// played twice.
//
// Parameters are all numbers with a range, so presets, overrides and mutate treat every recipe alike. Where recipes
// share an idea they share its name: `pitch`, `brightness`, `decay`, `duration`.
import {
  addShimmer, fadeOutTail, lerp, smoothstep, logLerp, mixInto, onePole, pinkNoise, renderSfxLayers,
  samplesFor, seededRandom, SFX_RATE, stateVariableFilter, subSeed, type SfxLayer,
} from './dsp.ts';

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

export const impact = defineSfxRecipe({
  doc: 'Something landing: a low thump that drops in pitch, a burst of darker noise, and a short ring',
  category: 'accent',
  params: {
    pitch: { min: 0.5, max: 2, log: true, doc: 'Scales the thump and the ring' },
    brightness: { min: 0, max: 1, doc: 'How much crack is in the hit' },
    decay: { min: 0.3, max: 3, log: true, doc: 'Scales how long the body rings' },
    weight: { min: 0, max: 1, doc: 'Level of the sub thump under the hit' },
  },
  defaults: { pitch: 1, brightness: 0.45, decay: 1, weight: 0.7, room: 0.45 },
  presets: { soft: { brightness: 0.2, weight: 0.5, decay: 0.7 }, heavy: { pitch: 0.7, weight: 1, decay: 1.8, brightness: 0.35 }, slam: { brightness: 0.85, pitch: 1.3, decay: 0.6, weight: 0.6 } },
  render: (p, seed) => {
    const random = seededRandom(subSeed(seed, 'impact'));
    const layers: SfxLayer[] = [
      { kind: 'tone', at: 0, hz: 120 * p.pitch, glideTo: 42 * p.pitch, glide: 0.12 * p.decay, attack: 0.001, tau: 0.16 * p.decay, gain: 1.1 * p.weight },
      { kind: 'noise', at: 0, filter: 'lp', hz: logLerp(400, 6000, p.brightness), q: 0.8, attack: 0.0005, tau: 0.035 * p.decay, gain: 1.6 },
      { kind: 'noise', at: 0, filter: 'bp', hz: logLerp(1500, 7000, p.brightness), q: 1.2, attack: 0.0003, tau: 0.006, gain: 1.4 * p.brightness },
      ...[190, 430, 910].map((hz, i): SfxLayer => ({ kind: 'tone', at: 0, hz: hz * p.pitch * jitter(random, 0.04), attack: 0.001, tau: (0.09 / (i + 1)) * p.decay, gain: 0.25 / (i + 1) })),
    ];
    return { samples: fadeOutTail(renderSfxLayers(layers, seed)), landsAt: 0 };
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

export const SFX_RECIPES = { click, key, toggle, impact, whoosh, riser, chime, ding, pop, typing, scroll } as const satisfies Record<string, SfxRecipe<any>>;
export type SfxRecipeName = keyof typeof SFX_RECIPES;

