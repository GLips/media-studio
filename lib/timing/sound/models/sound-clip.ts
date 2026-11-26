// sound-clip.ts: a sound as the video declares it, for the mix. Pure.
//
// Every sound a video plays is a clip: a stretch of a source placed on the video clock with a gain over it. A render
// walks the frames and gathers each frame's clips (sound-clip.tsx's marks); the mix (sound-mix.ts) plays them at the
// sample rate, so a gain changes per sample, never once a frame.

/**
 * A clip's gain over its seconds of playing: a constant, or points `[seconds, gain]` in time order joined by straight
 * lines, holding the first point's gain before it and the last's after it.
 */
export type SoundEnvelope = number | readonly (readonly [number, number])[];

/** A clip as one frame declares it: `fromNow` is seconds from that frame's instant to where the clip starts. */
export type SoundClipMark = {
  /** Names the clip in messages, and keeps two otherwise identical clips apart. */
  id: string;
  /** The source's absolute URL, as the page resolved it. */
  src: string;
  /** Seconds into the source where playing starts. */
  from: number;
  /** Seconds to play; null plays to the source's end. A looped clip gives one. */
  duration: number | null;
  /** Source seconds played a second, pitch moving with it; 1 when absent. */
  rate?: number;
  /** Plays the source from `from` to its end over and over, for `duration`. */
  loop: boolean;
  fromNow: number;
  gain: SoundEnvelope;
};

/** A clip placed on the video clock: `start` in video seconds, and the scene that declared it, if any. */
export type PlacedSoundClip = Omit<SoundClipMark, 'fromNow'> & { start: number; scene: string | null };

/** What one frame of a sound walk reports: the clips mounted on it. */
export type SoundClipFrameReport = { frame: number; clips: (SoundClipMark & { scene: string | null })[] };

export const soundClipArtifactName = (frame: number) => `sound-clips-${frame}.json`;

// 1 ms resolves a 30 ms fade into 30 straight pieces, which no ear tells from the curve.
const ENVELOPE_STEP = 0.001;
const ENVELOPE_TOLERANCE = 1e-4;

/**
 * `volume` over `duration` seconds as an envelope: a number stays one; a function of seconds into the clip is sampled
 * every millisecond, and the points a straight line between their neighbours already gives are dropped.
 */
export function soundEnvelopeOf(volume: number | ((seconds: number) => number), duration: number, what: string): SoundEnvelope {
  if (typeof volume === 'number') return checkedGain(volume, what, 0);
  const steps = Math.max(1, Math.ceil(duration / ENVELOPE_STEP));
  const samples = Array.from({ length: steps + 1 }, (_, i) => {
    const t = Math.min(duration, i * ENVELOPE_STEP);
    return [t, checkedGain(volume(t), what, t)] as const;
  });
  return swingDoor(samples, ENVELOPE_TOLERANCE);
}

function checkedGain(gain: number, what: string, t: number): number {
  if (!Number.isFinite(gain) || gain < 0) throw new Error(`${what}'s volume is ${gain} at ${t.toFixed(3)} s: give a gain of 0 or more`);
  return gain;
}

/**
 * The fewest of `samples` whose straight lines stay within about `tolerance` of every sample: each segment keeps the
 * corridor of slopes from its first point that passes every sample since, and ends when the corridor closes.
 */
function swingDoor(samples: readonly (readonly [number, number])[], tolerance: number): (readonly [number, number])[] {
  const kept = [samples[0]];
  let anchor = samples[0], low = -Infinity, high = Infinity;
  for (let i = 1; i < samples.length; i++) {
    const [t, g] = samples[i], dt = t - anchor[0];
    const nextLow = Math.max(low, (g - tolerance - anchor[1]) / dt), nextHigh = Math.min(high, (g + tolerance - anchor[1]) / dt);
    if (nextLow <= nextHigh) {
      [low, high] = [nextLow, nextHigh];
      continue;
    }
    anchor = samples[i - 1];
    kept.push(anchor);
    const span = t - anchor[0];
    [low, high] = [(g - tolerance - anchor[1]) / span, (g + tolerance - anchor[1]) / span];
  }
  const last = samples.at(-1)!;
  if (kept.at(-1) !== last) kept.push(last);
  return kept;
}

/** `envelope`'s gain `seconds` into its clip. */
export function soundEnvelopeGainAt(envelope: SoundEnvelope, seconds: number): number {
  if (typeof envelope === 'number') return envelope;
  if (seconds <= envelope[0][0]) return envelope[0][1];
  const last = envelope.at(-1)!;
  if (seconds >= last[0]) return last[1];
  let lo = 0, hi = envelope.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (envelope[mid][0] <= seconds) lo = mid;
    else hi = mid;
  }
  const [t0, g0] = envelope[lo], [t1, g1] = envelope[hi];
  return g0 + ((g1 - g0) * (seconds - t0)) / (t1 - t0);
}

// Placements a frame apart in float arithmetic agree to well under this; two plays of one sound are further apart.
const SAME_START = 0.001;

/**
 * The video's clips from every frame's report, each once: one clip is matched by scene, id, source, trim and a start
 * within a millisecond. Throws if a frame's report is missing, or a clip's gain differs between frames.
 *
 * Negative space: two clips alike in all of that are one; an id keeps them apart.
 */
export function placedSoundClipsOf(reports: readonly SoundClipFrameReport[], fps: number, frames: number): PlacedSoundClip[] {
  const reported = new Set(reports.map((r) => r.frame));
  if (reported.size !== frames) throw new Error(`the sound walk heard from ${reported.size} of ${frames} frames`);
  const groups = new Map<string, { frame: number; clip: PlacedSoundClip }[]>();
  for (const { frame, clips } of reports) {
    for (const { fromNow, ...rest } of clips) {
      const key = JSON.stringify([rest.scene, rest.id, rest.src, rest.from, rest.duration, rest.rate ?? 1, rest.loop]);
      const seen = groups.get(key) ?? [];
      seen.push({ frame, clip: { ...rest, start: frame / fps + fromNow } });
      groups.set(key, seen);
    }
  }
  const placed: PlacedSoundClip[] = [];
  for (const group of groups.values()) {
    const seen = group.toSorted((a, b) => a.clip.start - b.clip.start || a.frame - b.frame);
    let first = seen[0];
    for (const next of seen) {
      if (next.clip.start - first.clip.start > SAME_START) {
        placed.push(first.clip);
        first = next;
      } else if (JSON.stringify(next.clip.gain) !== JSON.stringify(first.clip.gain)) {
        throw new Error(`${first.clip.id}'s volume differs between frame ${first.frame} and ${next.frame}: give it as a function of seconds into the sound, not of the clock`);
      }
    }
    placed.push(first.clip);
  }
  // Summed in a fixed order, so a mix comes out the same to the bit each time.
  return placed.toSorted((a, b) => a.start - b.start || a.id.localeCompare(b.id) || a.src.localeCompare(b.src));
}
