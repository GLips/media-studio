// timeline.ts: a timed video's schedule, stated once in its project's timeline.ts and resolved here into the one result
// the render, `studio clock` and the checks all read.
//
// Scenes run in order, each with exactly one driver from a closed set: `beatSpan` (a length in beats on the grid),
// `fixedSpan` (seconds) and `voiceSpan` (its lines' speech; here an adapter over measured durations, until vid-57's
// real driver). The beat scenes form one musical section on one grid. Cues live under their owning scene and are
// reached by qualified name; landmarks tie cues to the recording and throw at load where the table and the music
// disagree. Lengths come only from drivers, so referencing a cue never changes a scene's length.
//
// Negative space: there is no absolute-beat function. A scene reaches its own beats through its clock, and another
// scene's moment only by that scene's cue.

import { beatGrid as fitBeatGrid, steadyBeatGrid, type BeatGrid } from './beat-grid.ts';
import { FPS } from './frame-rate.ts';

// ---------- the grid ----------

/** A track `studio music fit --bars` cut to the timeline: its beats, and its fit's downbeats, in seconds. */
export type FittedTrack = { bpm: number; beats: readonly number[]; duration: number; fit: { downbeats: readonly number[] } };

/**
 * The musical section's beats: backed by a fitted recording (which plays from the section's start, and against which
 * landmarks are checked), or tempo-only, for rhythm before there's any sound (landmarks stay pending).
 */
export type TimelineGrid =
  | { kind: 'recorded'; track: FittedTrack; steady: boolean; beats: BeatGrid }
  | { kind: 'tempo'; bpm: number; beats: BeatGrid };

/** A fitted recording's grid; `steady` fits one tempo and phase through its tracked beats (`beatGrid`'s). */
export const recordedGrid = (track: FittedTrack, { steady = false } = {}): TimelineGrid =>
  ({ kind: 'recorded', track, steady, beats: fitBeatGrid(track, { steady }) });

/** A grid at a fixed tempo, beat 0 `firstBeat` seconds into the section. */
export const tempoGrid = (bpm: number, { firstBeat = 0 } = {}): TimelineGrid => ({ kind: 'tempo', bpm, beats: steadyBeatGrid(bpm, firstBeat) });

// ---------- scenes ----------

/**
 * A moment in its own scene: a position (beats in a beat scene, seconds in any other), `'end'` (the scene's nominal
 * end), or another of its own cues; then `frames` more, the escape hatch for a flash a frame or two long.
 */
export type SceneMoment = number | 'end' | { at: number | 'end'; frames?: number } | { after: string; frames?: number };

/** Where a move's end or a replay's end sits: a moment of the scene that declares it, or another scene's cue. */
export type MomentRef = SceneMoment | { cue: string; frames?: number };

/** A move that keeps its length when a scene is lengthened: the retime runner holds it (retime.ts). */
export type MoveSpan = { from: MomentRef; to: MomentRef };

type SceneOptions = {
  cues?: Readonly<Record<string, SceneMoment>>;
  moves?: Readonly<Record<string, MoveSpan>>;
  /** Seconds the cut into this scene crossfades over, centred on the cut. Default 0: a hard cut. */
  crossfade?: number;
};

export type BeatSpan = SceneOptions & {
  driver: 'beat';
  beats: number;
  /** For a scene that cuts in after its first beat, by how much: its picture takes over there, its beats count from 0. */
  cutIn?: number;
};
export type FixedSpan = SceneOptions & { driver: 'fixed'; seconds: number };
export type VoiceSpan = SceneOptions & { driver: 'voice'; seconds: number; lines: readonly string[] };
export type SceneSpan = BeatSpan | FixedSpan | VoiceSpan;

export const beatSpan = <const O extends SceneOptions & { cutIn?: number } = {}>(beats: number, options?: O) =>
  ({ driver: 'beat', beats, ...options }) as { driver: 'beat'; beats: number } & O;

export const fixedSpan = <const O extends SceneOptions = {}>(seconds: number, options?: O) =>
  ({ driver: 'fixed', seconds, ...options }) as { driver: 'fixed'; seconds: number } & O;

/**
 * A voiced scene's span from its lines' measured durations: `lead`, the lines with `gap` between, `tail`, or `min` if
 * longer. The speech sets the length. An adapter until vid-57's voiceSpan reads the take itself (its pauses, its words).
 */
export function voiceSpan<const O extends SceneOptions = {}>(
  voice: Readonly<Record<string, { duration: number }>>,
  lines: readonly string[],
  { lead = 0.5, gap = 0.35, tail = 0.6, min = 0, ...options }: { lead?: number; gap?: number; tail?: number; min?: number } & O = {} as O,
) {
  const spoken = lines.reduce((sum, id, j) => {
    const line = voice[id];
    if (!line) throw new Error(`voiceSpan: no voiced line ${id}`);
    return sum + line.duration + (j > 0 ? gap : 0);
  }, 0);
  return { driver: 'voice', seconds: Math.max(lead + spoken + tail, min), lines, ...options } as { driver: 'voice'; seconds: number; lines: readonly string[] } & Omit<O, 'lead' | 'gap' | 'tail' | 'min'>;
}

// ---------- the timeline ----------

export type CueNamesOf<Span> = Span extends { cues?: infer C } ? keyof NonNullable<C> & string : never;
export type MoveNamesOf<Span> = Span extends { moves?: infer M } ? keyof NonNullable<M> & string : never;
/** `'<scene>.<cue>'` for every cue: a misspelt one fails to compile. */
export type CueName<Scenes> = { [K in keyof Scenes & string]: `${K}.${CueNamesOf<Scenes[K]>}` }[keyof Scenes & string];

/** A replay: the scene that owns `to` plays the scene that owns `from`, so `from` lands on `to`, at `rate`. */
export type ReplaySpec<Cue extends string = string> = { from: Cue | { cue: Cue; frames: number }; to: Cue | { cue: Cue; frames: number }; rate?: number };

/** A cue that must fall on a downbeat of the fitted recording (`downbeat`: from 0, or negative from the last). */
export type Landmark<Cue extends string = string> = { name: string; cue: Cue; downbeat: number };

/** Replays, keyed by the replaying scene and the replay's name. */
export type ReplayTable<Scenes> = { readonly [K in keyof Scenes]?: Readonly<Record<string, ReplaySpec<CueName<Scenes>>>> };

export type TimelineSpec<Scenes extends Readonly<Record<string, SceneSpan>> = Readonly<Record<string, SceneSpan>>, Replays extends ReplayTable<Scenes> = ReplayTable<Scenes>> = {
  grid: TimelineGrid;
  /** Frames a beat's cut or hit comes before the grid's beat: the tracker hears a hit late, and a picture on the beat leads its sound. */
  pictureLeadFrames: number;
  /** Seconds a placed sound trails the picture's event it marks, to land with the music's hit rather than flam. */
  soundLagSeconds: number;
  scenes: Scenes;
  replays?: Replays;
  /** Every recorded grid names the music's final hit (downbeat -1). Pending, unchecked, on a tempo-only grid. */
  landmarks: readonly Landmark<CueName<Scenes>>[];
  /** The fade to black, in frames from the video's end (negative): e.g. `{ from: -9, to: -5 }`. */
  fade?: { from: number; to: number };
};

/** How far a landmark may sit from its downbeat: a steady grid against the tracker's downbeats, which wander. */
export const LANDMARK_TOLERANCE_SECONDS = 0.05;

declare const resolvedClock: unique symbol;

/**
 * One scene resolved, on its own clock, in video frames (each instant rounded once, then the picture lead taken off a
 * musical one). Only `defineTimeline` makes one.
 */
export type ResolvedSceneClock<Key extends string = string, Cue extends string = string, Move extends string = string, AnyCue extends string = string> = {
  readonly [resolvedClock]: true;
  id: Key;
  /** Its place in the timeline, from 1. */
  n: number;
  driver: SceneSpan['driver'];
  /** Its origin: its beat 0, or where a non-musical scene starts. */
  origin: number;
  /** Its cut (the video's first frame for the first scene), and the next scene's cut, or the video's end. */
  from: number;
  to: number;
  /** The frames it is on screen: its cut to the next, widened by a crossfade either side. */
  visible: { from: number; to: number };
  /** Its nominal end: the last beat's boundary, or its origin plus its length. */
  end: number;
  /** Its length in beats (a beat scene), or 0. */
  beats: number;
  /** Seconds per beat on the section's grid. */
  spb: number;
  /** The frame its own beat `n` hits on, counted from its first beat; throws outside the frames it plays. */
  beat(n: number): number;
  cues: Readonly<Record<Cue, number>>;
  moves: Readonly<Record<Move, { from: number; to: number }>>;
  /** Another scene's moment: may land before this scene's cut or after its end. */
  cue(name: AnyCue): number;
};

/** A replay resolved: on the target's frame `to`, the source's frame `from` plays, and `rate` source frames a frame after. */
export type ResolvedReplay = { name: string; target: string; source: string; fromCue: string; toCue: string; from: number; to: number; rate: number };

type AnyScenes = Readonly<Record<string, SceneSpan>>;

export type Timeline<Scenes extends AnyScenes = AnyScenes, Replays extends ReplayTable<Scenes> = ReplayTable<Scenes>> = {
  spec: TimelineSpec<Scenes, Replays>;
  fps: number;
  spb: number;
  soundLagSeconds: number;
  /** Scene keys in order. */
  keys: readonly (keyof Scenes & string)[];
  scenes: readonly ResolvedSceneClock<keyof Scenes & string>[];
  scene<K extends keyof Scenes & string>(key: K): ResolvedSceneClock<K, CueNamesOf<Scenes[K]>, MoveNamesOf<Scenes[K]>, CueName<Scenes>>;
  cue(name: CueName<Scenes>): number;
  replays: readonly ResolvedReplay[];
  /** The recording's placement: it plays from the musical section's start. None on a tempo-only grid. */
  audio: readonly { kind: 'music'; track: FittedTrack; atSeconds: number }[];
  /** Each landmark's cue: its frame, and its beat of the musical section (where a re-fit must put its downbeat). */
  landmarks: readonly { name: string; cue: string; downbeat: number; frame: number; beat: number; status: 'checked' | 'pending' }[];
  /** The video's last frame, exclusive: the last scene's end, or the recording's, whichever is later. */
  end: number;
  fade: { from: number; to: number };
  /** The grid's beat at `frame`, as a fraction: whole on each hit frame. For a beat counter, not for timing. */
  beatAtFrame(frame: number): number;
  /** Every beat's hit frame inside the video, pickup beats included. */
  beatFrames: readonly number[];
  /** Which beat of the music's own bar each beat scene cuts in on, 1 being its downbeat; null off the section. */
  musicBeats: readonly (number | null)[];
};

/** Resolves a timeline, or throws where it contradicts itself or its recording. */
export function defineTimeline<const Scenes extends AnyScenes, const Replays extends ReplayTable<Scenes> = {}>(
  spec: TimelineSpec<Scenes, Replays> & { landmarks: NoInfer<TimelineSpec<Scenes>['landmarks']> },
): Timeline<Scenes, Replays> {
  const keys = Object.keys(spec.scenes) as (keyof Scenes & string)[];
  const spans = keys.map((key) => spec.scenes[key] as SceneSpan);
  if (!keys.length) throw new Error('the timeline has no scenes');
  spans.forEach((span, k) => checkSpan(keys[k], span));
  const musical = spans.flatMap((span, k) => (span.driver === 'beat' ? [k] : []));
  if (musical.length && musical.at(-1)! - musical[0] + 1 !== musical.length) {
    const inside = keys.find((_, k) => k > musical[0] && k < musical.at(-1)! && spans[k].driver !== 'beat');
    throw new Error(`scene ${inside} (${spans[keys.indexOf(inside!)].driver}Span) sits inside the musical section: `
      + 'it would push the later beat scenes off their beats. Make it a beatSpan, or move it outside the section');
  }

  // Seconds, then frames: each instant rounded once. A musical instant leads by the picture lead.
  const { beats: grid } = spec.grid;
  const lead = spec.pictureLeadFrames;
  const nonMusicalBefore = (k: number) => spans.slice(0, k).reduce((sum, span) => sum + (span.driver === 'beat' ? 0 : span.seconds), 0);
  const sectionStart = musical.length ? nonMusicalBefore(musical[0]) : 0;
  const startBeat = spans.map((_, k) => spans.slice(musical[0] ?? 0, k).reduce((sum, span) => sum + (span.driver === 'beat' ? span.beats : 0), 0));
  const beatFrame = (beat: number) => Math.round((sectionStart + grid.at(beat)) * FPS) - lead;
  const plainFrame = (seconds: number) => Math.round(seconds * FPS);
  const lastBeat = musical.length ? startBeat[musical.at(-1)!] + (spans[musical.at(-1)!] as BeatSpan).beats : 0;
  const sectionEnd = musical.length ? sectionStart + grid.at(lastBeat) : 0;
  const after = (k: number) => musical.length > 0 && k > musical.at(-1)!;
  // A scene after the music counts from the last beat's frame, lead and all, so it cuts in where the music's last scene ends.
  const secondsFrame = (k: number, seconds: number) => (after(k) ? beatFrame(lastBeat) + plainFrame(seconds - sectionEnd) : plainFrame(seconds));
  const startSeconds = spans.map((_, k) => (after(k) ? sectionEnd + nonMusicalBefore(k) - nonMusicalBefore(musical[0]) : nonMusicalBefore(k)));
  const origins = spans.map((span, k) => (span.driver === 'beat' ? beatFrame(startBeat[k]) : secondsFrame(k, startSeconds[k])));
  const ends = spans.map((span, k) => (span.driver === 'beat' ? beatFrame(startBeat[k] + span.beats) : secondsFrame(k, startSeconds[k] + span.seconds)));
  const recordingEnd = spec.grid.kind === 'recorded' && musical.length ? plainFrame(sectionStart + spec.grid.track.duration) : 0;
  const end = Math.max(ends.at(-1)!, recordingEnd);
  const cuts = spans.map((span, k) => {
    if (k === 0) return 0;
    if (k === musical[0]) return plainFrame(sectionStart);
    return span.driver === 'beat' ? beatFrame(startBeat[k] + (span.cutIn ?? 0)) : origins[k];
  });
  const nexts = cuts.map((_, k) => cuts[k + 1] ?? end);
  for (let k = 1; k < cuts.length; k++) if (cuts[k] <= cuts[k - 1]) throw new Error(`scene ${keys[k]} cuts in on frame ${cuts[k]}, not after ${keys[k - 1]}'s ${cuts[k - 1]}`);
  const halfFade = (k: number) => (spans[k]?.crossfade ?? 0) * FPS / 2;

  // Cues, each in its own scene; `after` another of its own, with cycles refused.
  const cueFrames = new Map<string, number>();
  const ownMoment = (k: number, moment: SceneMoment, chain: readonly string[]): number => {
    const span = spans[k];
    if (typeof moment === 'object' && 'after' in moment) return ownCue(k, moment.after, chain) + (moment.frames ?? 0);
    const { at, frames = 0 } = typeof moment === 'object' ? moment : { at: moment };
    if (at === 'end') return ends[k] + frames;
    return (span.driver === 'beat' ? beatFrame(startBeat[k] + at) : secondsFrame(k, startSeconds[k] + at)) + frames;
  };
  const ownCue = (k: number, name: string, chain: readonly string[] = []): number => {
    const qualified = `${keys[k]}.${name}`;
    const known = cueFrames.get(qualified);
    if (known !== undefined) return known;
    if (chain.includes(qualified)) throw new Error(`cues ${[...chain, qualified].join(' → ')} form a cycle`);
    const moment = spans[k].cues?.[name];
    if (moment === undefined) throw new Error(`no cue ${qualified}`);
    const frame = ownMoment(k, moment, [...chain, qualified]);
    cueFrames.set(qualified, frame);
    return frame;
  };
  const indexOf = (key: string) => {
    const k = keys.indexOf(key as keyof Scenes & string);
    if (k < 0) throw new Error(`no scene ${key}: the timeline has ${keys.join(', ')}`);
    return k;
  };
  const cue = (name: string) => {
    const dot = name.lastIndexOf('.');
    if (dot < 0) throw new Error(`cue ${name} isn't qualified: name it <scene>.<cue>`);
    return ownCue(indexOf(name.slice(0, dot)), name.slice(dot + 1));
  };
  spans.forEach((span, k) => Object.keys(span.cues ?? {}).forEach((name) => ownCue(k, name)));
  const refFrame = (k: number, ref: MomentRef) =>
    (typeof ref === 'object' && 'cue' in ref ? cue(ref.cue) + (ref.frames ?? 0) : ownMoment(k, ref, []));

  const clocks = spans.map((span, k) => {
    const beat = (n: number) => {
      if (span.driver !== 'beat') throw new Error(`scene ${keys[k]} is a ${span.driver}Span: it has no beats`);
      const frame = beatFrame(startBeat[k] + n);
      // The first scene's pickup beats may fall before the video starts: no other scene's beats are there.
      if ((k > 0 && frame < cuts[k]) || frame > nexts[k]) {
        throw new Error(`scene ${keys[k]}'s beat ${n} (frame ${frame}) is outside the scene (frames ${cuts[k]}–${nexts[k]}): `
          + 'reach another scene\'s moment through its cue');
      }
      return frame;
    };
    const cues = Object.fromEntries(Object.keys(span.cues ?? {}).map((name) => [name, ownCue(k, name)]));
    const moves = Object.fromEntries(Object.entries(span.moves ?? {}).map(([name, move]) => [name, { from: refFrame(k, move.from), to: refFrame(k, move.to) }]));
    return {
      id: keys[k], n: k + 1, driver: span.driver, origin: origins[k], from: cuts[k], to: nexts[k], end: ends[k],
      visible: { from: Math.round(cuts[k] - halfFade(k)), to: Math.round(nexts[k] + halfFade(k + 1)) },
      beats: span.driver === 'beat' ? span.beats : 0, spb: grid.spb, beat, cues, moves, cue,
    } as unknown as ResolvedSceneClock<keyof Scenes & string>;
  });

  const replays = Object.entries(spec.replays ?? {}).flatMap(([target, table]) => {
    indexOf(target);
    return Object.entries(table as Record<string, ReplaySpec>).map(([name, replay]): ResolvedReplay => {
      const end = (ref: ReplaySpec['from']) => (typeof ref === 'string' ? { cue: ref, frames: 0 } : ref);
      const from = end(replay.from), to = end(replay.to);
      const source = from.cue.slice(0, from.cue.lastIndexOf('.'));
      if (to.cue.slice(0, to.cue.lastIndexOf('.')) !== target) throw new Error(`replay ${target}.${name} lands on ${to.cue}, not a cue of ${target}`);
      if (source === target) throw new Error(`replay ${target}.${name} replays its own scene`);
      indexOf(source);
      return { name, target, source, fromCue: from.cue, toCue: to.cue, from: cue(from.cue) + from.frames, to: cue(to.cue) + to.frames, rate: replay.rate ?? 1 };
    });
  });

  // A landmark is a musical instant: its cue's beat of the section, before any frame rounding.
  const landmarkBeat = (name: string) => {
    const dot = name.lastIndexOf('.'), k = indexOf(name.slice(0, dot)), span = spans[k];
    const moment = span.cues?.[name.slice(dot + 1)];
    if (span.driver !== 'beat' || moment === undefined) throw new Error(`landmark cue ${name} isn't a cue of a beat scene`);
    const at = typeof moment === 'object' ? ('at' in moment ? moment.at : undefined) : moment;
    if (at === undefined || (typeof moment === 'object' && moment.frames)) throw new Error(`landmark cue ${name} must sit on a beat, not a frame offset`);
    return startBeat[k] + (at === 'end' ? span.beats : at);
  };
  const landmarks = spec.landmarks.map((mark) => ({
    name: mark.name, cue: mark.cue, downbeat: mark.downbeat, frame: cue(mark.cue), beat: landmarkBeat(mark.cue),
    status: spec.grid.kind === 'recorded' ? 'checked' as const : 'pending' as const,
  }));
  if (spec.grid.kind === 'recorded') checkLandmarks(landmarks, spec.grid);

  const beatAtFrame = (frame: number) => grid.beatOf((frame + lead) / FPS - sectionStart);
  const beatFrames: number[] = [];
  if (musical.length) {
    for (let n = Math.floor(beatAtFrame(0)); beatFrame(n) < end; n++) if (beatFrame(n) >= 0) beatFrames.push(beatFrame(n));
  }
  // The tracker's downbeats wander off a steady grid by up to a quarter beat, so each is taken as its nearest beat.
  const downbeats = spec.grid.kind === 'recorded' ? spec.grid.track.fit.downbeats.map((t) => Math.round(grid.beatOf(t))) : [];
  const musicBeatOf = (beat: number) => {
    const on = downbeats.filter((d) => d <= beat + 0.1).at(-1);
    return on === undefined ? null : Math.round((beat - on + 1) * 4) / 4;
  };

  return {
    spec, fps: FPS, spb: grid.spb, soundLagSeconds: spec.soundLagSeconds, keys,
    scenes: clocks, scene: (key) => clocks[indexOf(key)] as never, cue: (name) => cue(name), replays,
    audio: spec.grid.kind === 'recorded' && musical.length ? [{ kind: 'music', track: spec.grid.track, atSeconds: sectionStart }] : [],
    landmarks, end, fade: { from: end + (spec.fade?.from ?? 0), to: end + (spec.fade?.to ?? 0) }, beatAtFrame, beatFrames,
    musicBeats: spans.map((span, k) => (span.driver === 'beat' ? musicBeatOf(startBeat[k] + (span.cutIn ?? 0)) : null)),
  };
}

function checkSpan(key: string, span: SceneSpan) {
  if (!['beat', 'fixed', 'voice'].includes(span.driver)) throw new Error(`scene ${key}: no driver ${String(span.driver)}; use beatSpan, fixedSpan or voiceSpan`);
  const length = span.driver === 'beat' ? span.beats : span.seconds;
  if (!(length > 0)) throw new Error(`scene ${key} is ${length} ${span.driver === 'beat' ? 'beats' : 'seconds'} long`);
  if (span.driver === 'beat' && span.cutIn !== undefined && !(span.cutIn >= 0 && span.cutIn < span.beats)) {
    throw new Error(`scene ${key} cuts in on beat ${span.cutIn}, outside its ${span.beats}`);
  }
}

// The music is a recording, re-cut only in whole bars (`studio music fit --bars`), so a scene lengthened in the timeline
// needs the music re-fitted to match, or the video ends over the wrong bar of it.
function checkLandmarks(landmarks: Timeline['landmarks'], grid: Extract<TimelineGrid, { kind: 'recorded' }>) {
  const downbeats = grid.track.fit.downbeats;
  const onFinalHit = landmarks.some((mark) => mark.downbeat === -1 || mark.downbeat === downbeats.length - 1);
  if (!onFinalHit) throw new Error('no landmark names the music\'s final hit (downbeat -1): add one, so a timeline that outruns the music fails');
  for (const mark of landmarks) {
    const at = downbeats.at(mark.downbeat);
    if (at === undefined) throw new Error(`landmark ${mark.name} names downbeat ${mark.downbeat}; the fit has ${downbeats.length}`);
    const seconds = grid.beats.at(mark.beat);
    if (Math.abs(seconds - at) > LANDMARK_TOLERANCE_SECONDS) {
      throw new Error(`the timeline puts ${mark.name} (${mark.cue}) at ${seconds.toFixed(2)} s of the recording, but the music's is at ${at} s: `
        + 're-fit it with studio music fit --bars, or change the timeline');
    }
  }
}

/**
 * The resolved timeline as `studio clock` prints it, for tools that don't import TypeScript: each scene's frames (as
 * `bars`, the name the tools read), every beat's frame, each cue's, the replays, landmarks and music, the fade and the
 * end. `to` and `end` are exclusive.
 */
export type TimelineClockTable = {
  fps: number;
  end: number;
  fade: { from: number; to: number };
  beats: number[];
  bars: { n: number; id: string; driver: SceneSpan['driver']; origin: number; from: number; to: number; visible: { from: number; to: number }; beats: number; musicBeat: number | null }[];
  cues: Record<string, number>;
  replays: ResolvedReplay[];
  landmarks: Timeline['landmarks'][number][];
  audio: { kind: 'music'; atSeconds: number }[];
};

export function timelineClockTable(timeline: Timeline): TimelineClockTable {
  return {
    fps: timeline.fps, end: timeline.end, fade: timeline.fade, beats: [...timeline.beatFrames],
    bars: timeline.scenes.map((scene, k) => ({
      n: scene.n, id: scene.id, driver: scene.driver, origin: scene.origin, from: scene.from, to: scene.to, visible: scene.visible,
      beats: scene.beats, musicBeat: timeline.musicBeats[k],
    })),
    cues: Object.fromEntries(timeline.scenes.flatMap((scene) => Object.entries(scene.cues as Record<string, number>).map(([name, frame]) => [`${scene.id}.${name}`, frame]))),
    replays: [...timeline.replays], landmarks: [...timeline.landmarks],
    audio: timeline.audio.map(({ kind, atSeconds }) => ({ kind, atSeconds })),
  };
}
