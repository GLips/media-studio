// sound-check.ts: each sound a video plays on its own clock (`defineVideo({ sounds })`) against its music, as the mix
// plays them before mastering (which moves both together): how far the sound's attack lands from the music's nearest
// one, and how loud it plays against the music there. Then the beats where the music leaves no attack, where a sound
// can speak for the picture. `studio mix` prints it. Node only: ffmpeg decodes and measures the files.
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readProjectHostSpec } from '#engine/host/project-host-spec.ts';
import { beatGrid, type BeatGrid } from '#models/timeline/beat-grid.ts';
import { musicBedGainAt, type MusicBed } from '#studio/mix/mix.ts';
import type { SfxSound } from '#studio/sfx/sfx.tsx';
import { layoutVideo, totalFrames, videoFormatOf, type VideoDef } from '#studio/composition/timeline.ts';
import { sfxSeedFromId } from './dsp.ts';
import { runFfmpeg } from '#engine/ffmpeg/ffmpeg.ts';

// Attacks are found at 16 kHz in two bands: above 1.5 kHz, where a hit's attack is sharpest, and the full band, which
// hears a kick's boom. An attack is a jump of at least MIN_RISE_DB in either.
const ANALYSIS_RATE = 16000;
const ATTACK_BAND_HZ = 1500;
const MIN_RISE_DB = { high: 12, full: 8 };
// Level in 8 ms windows every 2 ms. A window's jump is over the loudest of those starting 8, 12 and 16 ms before it.
const HOP_SECONDS = 0.002, WINDOW_SECONDS = 0.008;
const LOOKBACK_HOPS = [4, 6, 8];
const LOOKBACK_SECONDS = Math.max(...LOOKBACK_HOPS) * HOP_SECONDS;
// Under the music, a level 40 dB below a file's loudest goes unheard, and from digital silence any first sample of a
// swell would read as a jump; so the envelope goes no lower.
const ENVELOPE_RANGE_DB = 40;

/** How far from its landing a sound's attack is looked for, and a swell's peak. */
const SOUND_ATTACK_REACH = 0.05, SWELL_PEAK_REACH = 0.1;
/** How far from a sound the music's nearest attack can be and still count as its neighbour. */
const MUSIC_ATTACK_REACH = 0.15;
/** Two attacks this far apart are heard as two hits, not one: closer fuse, further are separate events. */
const FLAM_MS = { min: 15, max: 100 };
const BURIED_LU = -8, OVER_LU = 3;
/** ebur128's absolute gate: momentary loudness under it is silence. */
const SILENT_LUFS = -70;
/**
 * An empty beat has no attack within this of it, either side: the tracker hears a hit about 20 ms late, so a track's
 * hits sit just before its grid's beats. Well inside a sixteenth, even at 180 BPM.
 */
const EMPTY_BEAT_REACH = 0.04;

/** A jump in level: when it starts, in seconds, and how far it rose over the level 8–16 ms before, in dB. */
export type AudioAttack = { t: number; riseDb: number };

export type SoundCheckFlag = 'FLAM' | 'BURIED' | 'OVER';

/** One of `VideoDef.sounds` against the music. */
export type SoundAgainstMusic = {
  id: string;
  /** Video seconds it lands (its `at`). */
  at: number;
  /**
   * An attack if it jumps 12 dB above 1.5 kHz (8 dB in the full band) within 50 ms of its landing; else a swell, timed
   * by its peak.
   */
  lands: 'attack' | 'swell';
  /**
   * Ms from the music's nearest attack to the sound's attack (a swell's peak), positive when the sound comes after.
   * Null when the music has no attack within 150 ms.
   */
  gapMs: number | null;
  /** Momentary loudness (400 ms) where it lands, in LUFS, as the mix plays it before mastering: the sound's and the music's. */
  soundLufs: number;
  musicLufs: number;
  /** soundLufs − musicLufs; null where the music is silent. */
  lu: number | null;
  flags: SoundCheckFlag[];
};

export type EmptyBeats = {
  /** The grid the music's own attacks sit on (see beatGrid): its tracked beats, or one tempo fitted through them. */
  grid: 'tracked' | 'steady';
  /** Video seconds of beat 0, the track's first downbeat. */
  beat0: number;
  /** Beats the music plays under, and those with no attack near them. */
  count: number;
  empty: { beat: number; at: number }[];
};

/** `fps` is the video's frame rate, which the report's frame column counts in. */
export type VideoSoundCheck = { fps: number; sounds: SoundAgainstMusic[]; emptyBeats: EmptyBeats | null };

type LevelEnvelope = { db: Float32Array; floorDb: number };

function levelEnvelope(samples: Float32Array, rate: number): LevelEnvelope {
  const hop = Math.round(rate * HOP_SECONDS), win = Math.round(rate * WINDOW_SECONDS);
  const db = new Float32Array(Math.max(0, Math.floor((samples.length - win) / hop) + 1));
  let loudest = -Infinity;
  for (let i = 0; i < db.length; i++) {
    let sum = 0;
    for (let j = i * hop; j < i * hop + win; j++) sum += samples[j] * samples[j];
    db[i] = 10 * Math.log10(sum / win + 1e-12);
    loudest = Math.max(loudest, db[i]);
  }
  const floorDb = loudest - ENVELOPE_RANGE_DB;
  for (let i = 0; i < db.length; i++) db[i] = Math.max(db[i], floorDb);
  return { db, floorDb };
}

// Before the file starts is as quiet as its envelope goes, so an attack on its first sample counts.
function riseDb({ db, floorDb }: LevelEnvelope, i: number): number {
  if (i < 0 || i >= db.length) return -Infinity;
  return db[i] - Math.max(...LOOKBACK_HOPS.map((k) => (i >= k ? db[i - k] : floorDb)));
}

/** Each attack's time is the start of the window that jumps most, which is where a sharp attack begins. */
function attacksIn(env: LevelEnvelope, minRiseDb: number): AudioAttack[] {
  const attacks: AudioAttack[] = [];
  for (let i = 0; i < env.db.length; i++) {
    const rise = riseDb(env, i);
    if (rise < minRiseDb || rise < riseDb(env, i - 1) || rise <= riseDb(env, i + 1)) continue;
    const t = i * HOP_SECONDS, last = attacks.at(-1);
    // A jump can crest twice as the window slides through it; within the lookback it's one attack, the bigger crest.
    if (last && t - last.t < LOOKBACK_SECONDS) {
      if (rise > last.riseDb) attacks[attacks.length - 1] = { t, riseDb: rise };
    } else attacks.push({ t, riseDb: rise });
  }
  return attacks;
}

/** Every jump of at least `minRiseDb` over the level 8–16 ms before, in mono `samples` at `rate`. */
export function detectAudioAttacks(samples: Float32Array, rate: number, minRiseDb: number): AudioAttack[] {
  return attacksIn(levelEnvelope(samples, rate), minRiseDb);
}

/** The middle of the loudest window starting between `from` and `to` seconds. */
function peakIn({ db }: LevelEnvelope, from: number, to: number): number {
  let best = Math.max(0, Math.round(from / HOP_SECONDS));
  for (let i = best; i <= Math.min(db.length - 1, Math.round(to / HOP_SECONDS)); i++) if (db[i] > db[best]) best = i;
  return best * HOP_SECONDS + WINDOW_SECONDS / 2;
}

type AttackBands = { high: LevelEnvelope; full: LevelEnvelope };

// Timed above 1.5 kHz where it has an attack there; a low thud only jumps in the full band.
function soundLanding(bands: AttackBands, landsAt: number): { lands: 'attack' | 'swell'; t: number } {
  const biggestNear = (attacks: AudioAttack[]) =>
    attacks.filter((a) => Math.abs(a.t - landsAt) <= SOUND_ATTACK_REACH).sort((a, b) => b.riseDb - a.riseDb)[0];
  const attack = biggestNear(attacksIn(bands.high, MIN_RISE_DB.high)) ?? biggestNear(attacksIn(bands.full, MIN_RISE_DB.full));
  if (attack) return { lands: 'attack', t: attack.t };
  return { lands: 'swell', t: peakIn(bands.full, landsAt - SWELL_PEAK_REACH, landsAt + SWELL_PEAK_REACH) };
}

/** Every attack in the music, in track seconds, sorted. A hit that jumps in both bands is timed above 1.5 kHz. */
function musicAttackTimes(bands: AttackBands): number[] {
  const high = attacksIn(bands.high, MIN_RISE_DB.high);
  const fullOnly = attacksIn(bands.full, MIN_RISE_DB.full).filter((f) => !high.some((h) => Math.abs(h.t - f.t) < LOOKBACK_SECONDS));
  return [...high, ...fullOnly].map((a) => a.t).sort((a, b) => a - b);
}

function nearestAttack(times: readonly number[], t: number, reach: number): number | null {
  let best: number | null = null;
  for (const x of times) if (Math.abs(x - t) <= reach && (best === null || Math.abs(x - t) < Math.abs(best - t))) best = x;
  return best;
}

function soundCheckFlags(lands: SoundAgainstMusic['lands'], gapMs: number | null, lu: number | null): SoundCheckFlag[] {
  const flags: SoundCheckFlag[] = [];
  // A swell has no attack to flam with: its peak's gap is reported, not judged.
  if (lands === 'attack' && gapMs !== null && Math.abs(gapMs) >= FLAM_MS.min && Math.abs(gapMs) <= FLAM_MS.max) flags.push('FLAM');
  if (lu !== null && lu < BURIED_LU) flags.push('BURIED');
  if (lu !== null && lu > OVER_LU) flags.push('OVER');
  return flags;
}

/**
 * The beats the music plays under, on whichever grid its attacks sit on more steadily, each beat's nearest attack the
 * same few ms off: a track made on a grid sits on the steady fit, a played one on its tracked beats. Counting empty
 * beats can't choose: the tracker puts its beats on attacks, right or wrong.
 */
function emptyBeatsOf(bed: MusicBed, attacks: readonly number[], videoSeconds: number): EmptyBeats {
  const start = bed.sourceStartSeconds ?? 0, end = Math.min(videoSeconds, bed.track.duration - start);
  const attacksInVideo = attacks.map((a) => a - start);
  const on = (grid: BeatGrid) => {
    const beats: { beat: number; at: number; offset: number | null }[] = [];
    for (let n = Math.ceil(grid.beatOf(0)); grid.at(n) < end; n++) {
      const at = grid.at(n), nearest = nearestAttack(attacksInVideo, at, EMPTY_BEAT_REACH);
      beats.push({ beat: n, at, offset: nearest === null ? null : nearest - at });
    }
    const offsets = beats.flatMap((b) => (b.offset === null ? [] : [b.offset])).sort((a, b) => a - b);
    const median = offsets[offsets.length >> 1];
    return {
      beat0: grid.at(0), count: beats.length, empty: beats.filter((b) => b.offset === null).map(({ beat, at }) => ({ beat, at })),
      spread: offsets.length ? offsets.reduce((sum, o) => sum + Math.abs(o - median), 0) / offsets.length : Infinity,
    };
  };
  const { spread: trackedSpread, ...tracked } = on(beatGrid(bed.track, { sourceStartSeconds: start }));
  const { spread: steadySpread, ...steady } = on(beatGrid(bed.track, { sourceStartSeconds: start, steady: true }));
  return trackedSpread < steadySpread ? { grid: 'tracked', ...tracked } : { grid: 'steady', ...steady };
}

// ---------- measuring the files ----------

function decodeAttackBands(file: string): AttackBands {
  const pcm = runFfmpeg(['-v', 'error', '-i', file, '-filter_complex',
    `[0:a]aformat=sample_fmts=flt:sample_rates=${ANALYSIS_RATE}:channel_layouts=mono,asplit[full][h];[h]highpass=f=${ATTACK_BAND_HZ}[high];[full][high]amerge=inputs=2`,
    '-f', 'f32le', '-'], { maxBuffer: 1 << 30 });
  const both = new Float32Array(pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.byteLength));
  if (both.length < 2) throw new Error(`ffmpeg decoded no audio from ${file}`);
  const full = new Float32Array(both.length / 2), high = new Float32Array(both.length / 2);
  for (let i = 0; i < full.length; i++) [full[i], high[i]] = [both[2 * i], both[2 * i + 1]];
  return { full: levelEnvelope(full, ANALYSIS_RATE), high: levelEnvelope(high, ANALYSIS_RATE) };
}

type MomentaryLoudness = { end: number; lufs: number }[];

/**
 * ebur128's momentary loudness (400 ms) every 100 ms, by the end of its window, with `padSeconds` of silence after the
 * file so windows run past its end. A mono file counts as it plays in the mix, from both speakers (lib/engine/ffmpeg/loudness.ts).
 */
function momentaryLoudness(file: string, padSeconds: number): MomentaryLoudness {
  const out = runFfmpeg(['-v', 'error', '-i', file, '-af',
    `apad=pad_dur=${padSeconds},ebur128=metadata=1:dualmono=true,ametadata=print:key=lavfi.r128.M:file=-`, '-f', 'null', '-'],
  { encoding: 'utf8', maxBuffer: 1 << 26 });
  const rows: MomentaryLoudness = [];
  let pts = NaN;
  for (const line of out.split('\n')) {
    const time = /pts_time:([\d.]+)/.exec(line);
    if (time) pts = Number(time[1]);
    const m = /lavfi\.r128\.M=(\S+)/.exec(line);
    // A reading stamped `pts` is of the 400 ms up to the end of the 100 ms block starting there.
    if (m) rows.push({ end: pts + 0.1, lufs: m[1].includes('inf') ? -Infinity : Number(m[1]) });
  }
  if (!rows.length || rows.some((r) => Number.isNaN(r.end) || Number.isNaN(r.lufs))) throw new Error(`couldn't read ffmpeg's momentary loudness of ${file}`);
  return rows;
}

/** The loudest 400 ms window that holds moment `t`. */
const loudestAround = (rows: MomentaryLoudness, t: number) =>
  Math.max(-Infinity, ...rows.filter((r) => r.end >= t - 1e-6 && r.end <= t + 0.4 + 1e-6).map((r) => r.lufs));

// The music plays from `sourceStartSeconds` and loops back to it at the track's end (see music.md).
function trackSecondsAt(bed: MusicBed, t: number): number {
  const start = bed.sourceStartSeconds ?? 0;
  return start + (t % (bed.track.duration - start));
}

/**
 * Measures each of the video's `sounds` against its music (see SoundAgainstMusic), and finds the music's empty beats.
 * Null unless the video has both. Sources are files: `src` is a file URL, as it is when the video loads in Node.
 */
export function checkVideoSoundsAgainstMusic(video: VideoDef): VideoSoundCheck | null {
  const bed = video.music, sounds = video.sounds ?? [];
  if (!bed || !sounds.length) return null;
  const { fps } = videoFormatOf(video);
  const tl = layoutVideo(video), videoSeconds = totalFrames(tl, fps) / fps;
  const musicFile = fileURLToPath(bed.track.src);
  const musicAttacks = musicAttackTimes(decodeAttackBands(musicFile));
  const musicLoudness = momentaryLoudness(musicFile, 0);
  const gainAt = musicBedGainAt(bed, tl.cues, fps, videoSeconds), gainDbAt = (t: number) => 20 * Math.log10(gainAt(t));
  const measured = new Map<string, { bands: AttackBands; loudness: MomentaryLoudness }>();
  const measure = (file: string) => {
    if (!measured.has(file)) measured.set(file, { bands: decodeAttackBands(file), loudness: momentaryLoudness(file, 0.5) });
    return measured.get(file)!;
  };

  const checked = sounds.map((sound, i): SoundAgainstMusic => {
    const id = sound.id ?? i;
    const takes: readonly SfxSound[] = Array.isArray(sound.sound) ? sound.sound : [sound.sound as SfxSound];
    const take = takes[sfxSeedFromId(id) % takes.length];
    const { bands, loudness } = measure(fileURLToPath(take.src));
    const landing = soundLanding(bands, take.landsAt);
    const landsInTrack = trackSecondsAt(bed, sound.at - take.landsAt + landing.t);
    const nearest = nearestAttack(musicAttacks, landsInTrack, MUSIC_ATTACK_REACH);
    const gapMs = nearest === null ? null : Math.round((landsInTrack - nearest) * 1000);
    const soundLufs = loudestAround(loudness, take.landsAt) + 20 * Math.log10(sound.volume ?? 1);
    const musicLufs = loudestAround(musicLoudness, trackSecondsAt(bed, sound.at)) + gainDbAt(sound.at);
    const lu = musicLufs > SILENT_LUFS && Number.isFinite(soundLufs) ? soundLufs - musicLufs : null;
    return { id: String(id), at: sound.at, lands: landing.lands, gapMs, soundLufs, musicLufs, lu, flags: soundCheckFlags(landing.lands, gapMs, lu) };
  });
  return { fps, sounds: checked, emptyBeats: bed.track.beats.length ? emptyBeatsOf(bed, musicAttacks, videoSeconds) : null };
}

/** The report `studio mix` prints: a key to the columns, a row per sound, then the music's empty beats. */
export function formatVideoSoundCheck({ fps, sounds, emptyBeats }: VideoSoundCheck): string[] {
  const fixed = (x: number | null, digits: number, signed = false) =>
    x === null || !Number.isFinite(x) ? '—' : `${signed && x > 0 ? '+' : ''}${x.toFixed(digits)}`;
  // The id, then right-aligned numbers, then the flags.
  const widths = [Math.max('id'.length, ...sounds.map((s) => s.id.length)), 5, 5, 6, 6, 5, 5, 5];
  const row = (cells: string[]) => cells.map((c, i) => (i === 0 ? c.padEnd(widths[0]) : i < widths.length ? c.padStart(widths[i]) : c)).join('  ').trimEnd();
  const lines = [
    'Placed sounds against the music, where each lands, before mastering (which moves both together):',
    `  lands: on an attack, or a swell with none, timed by its peak · gap: ms after the music's nearest attack (— none within ${MUSIC_ATTACK_REACH * 1000} ms)`,
    '  sound, music: momentary loudness in LUFS (400 ms) · LU: sound − music',
    `  FLAM: ${FLAM_MS.min}–${FLAM_MS.max} ms off the music's attack, heard as two hits · BURIED: over ${-BURIED_LU} LU under · OVER: over ${OVER_LU} LU above`,
    row(['id', 'frame', 'at s', 'lands', 'gap ms', 'sound', 'music', 'LU', 'flags']),
    ...sounds.map((s) => row([
      s.id, String(Math.round(s.at * fps)), s.at.toFixed(2), s.lands, fixed(s.gapMs, 0, true), fixed(s.soundLufs, 1), fixed(s.musicLufs, 1), fixed(s.lu, 1, true), s.flags.join(' '),
    ])),
  ];
  if (!emptyBeats) return lines;
  const { grid, beat0, count, empty } = emptyBeats;
  const where = `no music attack within ${EMPTY_BEAT_REACH * 1000} ms, on its ${grid} grid, beat 0 at ${beat0.toFixed(2)} s`;
  lines.push(!empty.length ? `Empty beats (${where}): none`
    : empty.length > count / 2 ? `Empty beats (${where}): ${empty.length} of ${count}; the music doesn't mark its beats`
    : `Empty beats (${where}): ${empty.map((b) => `${b.beat} at ${b.at.toFixed(2)} s`).join(', ')}`);
  return lines;
}

/**
 * The sound check of `project`'s video, loaded in Node, as `studio mix` prints it: nothing unless the video plays
 * `sounds` over music.
 */
export async function videoSoundCheckReport(project: string): Promise<string[]> {
  // A video about a host imports its components as `@host/…`, which only its bundle resolves, so it can't load here
  // and goes unchecked.
  if (readProjectHostSpec(project)) return [];
  // Transpiles .tsx as it loads, and imports a sound or a track as its file URL.
  await import('#engine/bundle/tsx-test-hooks.ts');
  const video: VideoDef = (await import(pathToFileURL(join(project, 'video.tsx')).href)).default;
  const check = checkVideoSoundsAgainstMusic(video);
  return check ? formatVideoSoundCheck(check) : [];
}
