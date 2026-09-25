// mix.ts: the levels of the voice and the music bed. Pure.
//
// Levels are loudness, not gain: every voice line is brought to VOICE_LUFS, and music is set in LU relative to the
// voice, so a quiet track and a hot one sit the same under the same words. The composition can only attenuate
// (Remotion clamps anything over 1), so sources must be at least as loud as their targets; lib/render-pipeline.ts then lifts
// the finished mix to delivery loudness in one pass.

/** Where every voice line sits in the mix, before mastering. Below every TTS line we've had (−11 to −16 LUFS). */
export const VOICE_LUFS = -20;

export const dbToGain = (db: number) => 10 ** (db / 20);

/** The gain that brings a source measured at `lufs` to `targetLufs`; throws if that would need a boost. */
export function levelGain(lufs: number, targetLufs: number, what: string): number {
  const gain = dbToGain(targetLufs - lufs);
  if (gain > 1.0001) throw new Error(`${what} measures ${lufs} LUFS, quieter than the ${targetLufs} LUFS it has to reach`);
  return Math.min(1, gain);
}

export type MusicTrack = {
  src: string;
  /** Seconds. */
  duration: number;
  /** Integrated loudness, measured as it plays in the mix. */
  lufs: number;
  bpm: number;
  /** Beat times in the track, in seconds. */
  beats: readonly number[];
  /** Set when `studio music fit` rebuilt the track to a video's length. */
  fit?: MusicFit;
  /** Set when `studio music gen` made the track. Lyria is in preview, so the model id traces a change in its output. */
  generated?: { model: string; prompt: string };
};

/** How a fitted track was cut from its source, so the seams can be found by ear and a refit compared against it. */
export type MusicFit = {
  /** The track it was cut from: music.<source>. */
  source: string;
  /** Stretches of the source, in its seconds, played end to end with a short crossfade at each join. */
  spans: readonly { from: number; to: number }[];
  /** Where each join falls in this track, in seconds: just before a downbeat. */
  seams: readonly number[];
  /** Beat 1 of each bar in this track, as the fit guessed it from bass hits and chord changes. */
  downbeats: readonly number[];
};

export type MusicBed = {
  track: MusicTrack;
  /** Where in the track the video starts, in seconds. */
  sourceStartSeconds?: number;
  /** Music level between lines, in LU relative to the voice. Default −8. */
  bedRelativeLu?: number;
  /** Music level under a line, in LU relative to the voice. Default −18. */
  duckedRelativeLu?: number;
};

// The music dips just before a line so the first word lands clear, and comes back after a breath.
const DUCK_ATTACK = 0.25;
const DUCK_RELEASE = 0.5;
const MUSIC_FADE_IN = 1;
const MUSIC_FADE_OUT = 2.5;

/** Spans the music is ducked for, with gaps too short to come back up in merged away. */
export function duckSpans(cues: readonly { start: number; end: number }[]): { start: number; end: number }[] {
  const spans: { start: number; end: number }[] = [];
  for (const { start, end } of [...cues].sort((a, b) => a.start - b.start)) {
    const last = spans.at(-1);
    if (last && start - last.end < DUCK_ATTACK + DUCK_RELEASE) last.end = Math.max(last.end, end);
    else spans.push({ start, end });
  }
  return spans;
}

/** The music's gain in dB between lines and under them; throws if the track is too quiet to reach the bed level. */
export function musicLevels(bed: MusicBed): { bedDb: number; duckedDb: number } {
  const bedDb = VOICE_LUFS + (bed.bedRelativeLu ?? -8) - bed.track.lufs;
  if (bedDb > 0.0001) throw new Error(`the music measures ${bed.track.lufs} LUFS, too quiet for a bed at ${VOICE_LUFS + (bed.bedRelativeLu ?? -8)} LUFS`);
  return { bedDb, duckedDb: VOICE_LUFS + (bed.duckedRelativeLu ?? -18) - bed.track.lufs };
}

/**
 * The music's gain at video time `t`: the bed level, dipping to the ducked level around each span (eased in dB,
 * since that's how loudness is heard), faded in at the start and out at the end where `fades` asks.
 */
export function musicGainAt(t: number, spans: readonly { start: number; end: number }[], levels: { bedDb: number; duckedDb: number }, videoDuration: number, fades: { in: boolean; out: boolean }): number {
  let duck = 0;
  for (const s of spans) {
    const into = (t - (s.start - DUCK_ATTACK)) / DUCK_ATTACK, outOf = (s.end + DUCK_RELEASE - t) / DUCK_RELEASE;
    duck = Math.max(duck, Math.min(1, into, outOf));
  }
  const fade = Math.max(0, Math.min(1, fades.in ? t / MUSIC_FADE_IN : 1, fades.out ? (videoDuration - t) / MUSIC_FADE_OUT : 1));
  return dbToGain(levels.bedDb + (levels.duckedDb - levels.bedDb) * smooth(duck)) * fade;
}

/**
 * The bed's gain at video time `t`, as the video plays it: ducked around the voice lines (each starting on the frame
 * it's rounded to), faded in and out where the track asks for it.
 */
export function musicBedGainAt(bed: MusicBed, cues: readonly { start: number; end: number }[], fps: number, videoSeconds: number): (t: number) => number {
  const spans = duckSpans(cues.map((c) => {
    const start = Math.round(c.start * fps) / fps;
    return { start, end: start + (c.end - c.start) };
  }));
  // A track played from its own start opens as it was written to (a music-led piece starts on its first hit), so only
  // one started partway through fades in. A track fitted to this video's length ends on its own ending, so it isn't
  // faded out; after a retime it no longer fits, and fades like any other until `studio music fit` runs again.
  const endsWithVideo = !!bed.track.fit && !bed.sourceStartSeconds && Math.abs(bed.track.duration - videoSeconds) < 0.5 / fps;
  const fades = { in: !!bed.sourceStartSeconds, out: !endsWithVideo };
  const levels = musicLevels(bed);
  return (t) => musicGainAt(t, spans, levels, videoSeconds, fades);
}

const smooth = (k: number) => {
  const x = Math.max(0, Math.min(1, k));
  return x * x * (3 - 2 * x);
};
