// dsp.ts: the small toolkit the sound recipes are built from: a seeded PRNG, pink noise, a state-variable filter,
// envelopes, layers and a feedback-delay tail. Pure: no clock and no Math.random, so a seed always gives the same
// samples.

export const SFX_RATE = 48000;

/** Hashes an event id (or any string) to a 32-bit seed, so a sound can be seeded from what it marks. */
export function sfxSeedFromId(id: string | number): number {
  if (typeof id === 'number') return id >>> 0;
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

/** mulberry32: uniform in [0, 1). */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A fresh seed derived from `seed` and a label, so each part of a sound draws from its own stream. */
export const subSeed = (seed: number, label: string) => sfxSeedFromId(`${seed}:${label}`);

export const whiteNoise = (random: () => number) => () => random() * 2 - 1;

/** Paul Kellet's pink-noise filter over white noise: −3 dB/octave, near unit loudness. */
export function pinkNoise(random: () => number): () => number {
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  return () => {
    const w = random() * 2 - 1;
    b0 = 0.99886 * b0 + w * 0.0555179;
    b1 = 0.99332 * b1 + w * 0.0750759;
    b2 = 0.969 * b2 + w * 0.153852;
    b3 = 0.8665 * b3 + w * 0.3104856;
    b4 = 0.55 * b4 + w * 0.5329522;
    b5 = -0.7616 * b5 - w * 0.016898;
    const out = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362;
    b6 = w * 0.115926;
    return out * 0.11;
  };
}

export type SvfOut = { lp: number; bp: number; hp: number };

/**
 * A topology-preserving state-variable filter (Simper's form). It stays stable while its cutoff and Q move every
 * sample, which a biquad doesn't, and that's what a whoosh's swept band needs.
 */
export function stateVariableFilter() {
  let ic1 = 0, ic2 = 0;
  const out: SvfOut = { lp: 0, bp: 0, hp: 0 };
  return (x: number, hz: number, q: number): SvfOut => {
    const g = Math.tan((Math.PI * Math.min(hz, SFX_RATE * 0.45)) / SFX_RATE), k = 1 / q;
    const a1 = 1 / (1 + g * (g + k)), a2 = g * a1, a3 = g * a2;
    const v3 = x - ic2, v1 = a1 * ic1 + a2 * v3, v2 = ic2 + a2 * ic1 + a3 * v3;
    ic1 = 2 * v1 - ic1;
    ic2 = 2 * v2 - ic2;
    out.lp = v2; out.bp = v1; out.hp = x - k * v1 - v2;
    return out;
  };
}

/** A one-pole lowpass, for smoothing and gentle darkening. */
export function onePole() {
  let y = 0;
  return (x: number, hz: number) => (y += (1 - Math.exp((-2 * Math.PI * hz) / SFX_RATE)) * (x - y));
}

/** Rises linearly over `attack`, then decays exponentially with time constant `tau`. */
export const attackDecay = (t: number, attack: number, tau: number) =>
  t < 0 ? 0 : t < attack ? t / attack : Math.exp(-(t - attack) / tau);

/** 0 → 1 → 0 over [0, 1], smooth at both ends. */
export const hann = (x: number) => (x <= 0 || x >= 1 ? 0 : 0.5 - 0.5 * Math.cos(2 * Math.PI * x));

export const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
export const lerp = (a: number, b: number, x: number) => a + (b - a) * x;
/** Interpolates on a log scale, which is how pitch and cutoff are heard. */
export const logLerp = (a: number, b: number, x: number) => a * (b / a) ** x;

export const samplesFor = (seconds: number) => new Float64Array(Math.max(1, Math.round(seconds * SFX_RATE)));

// Layers, as cuelume shapes its cues: a tone or a band of noise, each with its own offset and envelope. The recipes
// below are parametric functions that emit these, plus the few sounds (whoosh, riser, bed) that need a moving filter.

export type ToneLayer = {
  kind: 'tone';
  at: number;
  hz: number;
  /** Glides exponentially from `hz` to this over `glide` seconds. */
  glideTo?: number;
  glide?: number;
  attack: number;
  tau: number;
  gain: number;
  /** Adds odd harmonics at 1/n², a triangle's spectrum, for a woodier tone than a sine. */
  triangle?: boolean;
};
export type NoiseLayer = {
  kind: 'noise';
  at: number;
  filter: 'lp' | 'bp' | 'hp';
  hz: number;
  q: number;
  attack: number;
  tau: number;
  gain: number;
};
export type SfxLayer = ToneLayer | NoiseLayer;

/** Seconds until an attack-decay envelope is 60 dB down. */
const layerEnd = (l: SfxLayer) => l.at + l.attack + l.tau * 6.9;

export function renderSfxLayers(layers: readonly SfxLayer[], seed: number, pad = 0.01): Float64Array {
  const out = samplesFor(Math.max(...layers.map(layerEnd)) + pad);
  layers.forEach((layer, index) => {
    const start = Math.round(layer.at * SFX_RATE), end = Math.min(out.length, Math.ceil(layerEnd(layer) * SFX_RATE));
    if (layer.kind === 'tone') {
      let phase = 0;
      const harmonics = layer.triangle ? [1, 3, 5, 7] : [1];
      for (let i = start; i < end; i++) {
        const t = (i - start) / SFX_RATE;
        const hz = layer.glideTo && layer.glide ? logLerp(layer.hz, layer.glideTo, clamp01(t / layer.glide)) : layer.hz;
        phase += (2 * Math.PI * hz) / SFX_RATE;
        let v = 0;
        for (const n of harmonics) if (hz * n < SFX_RATE * 0.45) v += ((n % 4 === 1 ? 1 : -1) * Math.sin(n * phase)) / (n * n);
        out[i] += layer.gain * v * attackDecay(t, layer.attack, layer.tau);
      }
    } else {
      const noise = whiteNoise(seededRandom(subSeed(seed, `layer${index}`))), svf = stateVariableFilter();
      for (let i = start; i < end; i++) {
        const t = (i - start) / SFX_RATE;
        out[i] += layer.gain * svf(noise(), layer.hz, layer.q)[layer.filter] * attackDecay(t, layer.attack, layer.tau);
      }
    }
  });
  return out;
}

export type Shimmer = { delay: number; feedback: number; wet: number; lowpassHz: number };

/**
 * A lowpassed feedback delay mixed under the dry sound: a soft tail for chimes without a reverb. cuelume's idea.
 * Extends the buffer until the echoes are 60 dB down.
 */
export function addShimmer(dry: Float64Array, { delay, feedback, wet, lowpassHz }: Shimmer): Float64Array {
  const echoes = Math.ceil(Math.log(0.001) / Math.log(feedback));
  const out = new Float64Array(dry.length + Math.round(delay * echoes * SFX_RATE));
  out.set(dry);
  const d = Math.max(1, Math.round(delay * SFX_RATE)), line = new Float64Array(out.length), lp = onePole();
  for (let i = 0; i < out.length; i++) {
    const echo = lp(i >= d ? line[i - d] : 0, lowpassHz);
    line[i] = (i < dry.length ? dry[i] : 0) + echo * feedback;
    out[i] += wet * echo;
  }
  return out;
}

/** Fades the last `seconds` to silence, so a sound never ends on a click. */
export function fadeOutTail(samples: Float64Array, seconds = 0.005): Float64Array {
  const n = Math.min(samples.length, Math.round(seconds * SFX_RATE));
  for (let i = 0; i < n; i++) samples[samples.length - 1 - i] *= i / n;
  return samples;
}

/** Mixes `src` into `into` starting at `atSeconds`, scaled by `gain`. */
export function mixInto(into: Float64Array, src: Float64Array, atSeconds: number, gain = 1) {
  const start = Math.round(atSeconds * SFX_RATE);
  for (let i = 0; i < src.length && start + i < into.length; i++) into[start + i] += src[i] * gain;
}
