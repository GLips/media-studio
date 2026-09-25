// bar-timeline.ts: a music-led video's timing, stated once in its timeline.ts as a table of bars on a fitted track,
// and resolved here to every frame the picture, the sounds and the tools cut on.
//
// A bar is its length in beats. Each bar times its moments in beats from its own first beat, and names the ones other
// bars reach (cues), so lengthening a bar is one edit and every later bar, cue and sound moves with it. Landmarks tie
// the table to the recording: a table that no longer matches the music throws at load, naming both fixes.
//
// Negative space: there is no absolute-beat function. A bar reaches its own beats, and another bar's moment only by
// that bar's cue, so no bar can count past its own start.

import { beatGrid, type BeatGrid } from './beat-grid.ts';
import { FPS } from './frame-rate.ts';

/** A track `studio music fit --bars` cut to the table: its beats, and its fit's downbeats, in seconds. */
export type FittedTrack = {
  bpm: number;
  beats: readonly number[];
  duration: number;
  fit: { downbeats: readonly number[] };
};

/** A row of the table: its bar's length in beats, and for a bar that cuts in after its first beat, by how much. */
export type BarRow<Id extends string = string> = { id: Id; beats: number; cutIn?: number };

/**
 * A moment in one bar: `beat` beats from its first (fractions for off-beats; `'end'` is the frame the next bar cuts
 * in on), then `frames` more. A bare number is a beat.
 */
export type BarMoment = number | { beat: number | 'end'; frames?: number };

/** A move's end: a moment in the move's own bar, or with `bar`, in another's. */
export type MoveEnd<Id extends string = string> = BarMoment | { bar: Id; beat: number | 'end'; frames?: number };

/** A move that must keep its length when a bar is lengthened: the retime runner holds it (retime.ts). */
export type MoveSpan<Id extends string = string> = { from: MoveEnd<Id>; to: MoveEnd<Id> };

/**
 * A beat of the table that must fall on a downbeat of the fit (`downbeat`: from 0, or negative from the last), within
 * `LANDMARK_TOLERANCE_SECONDS`. Every table names the last downbeat, the music's final hit.
 */
export type Landmark<Id extends string = string> = { name: string; bar: Id; beat: number; downbeat: number };

export type BarTable<Id extends string = string> = readonly BarRow<Id>[];
export type CueTable<Id extends string> = { readonly [K in Id]?: Readonly<Record<string, BarMoment>> };
export type MoveTable<Id extends string> = { readonly [K in Id]?: Readonly<Record<string, MoveSpan<Id>>> };

export type BarTimelineSpec<Id extends string = string, Cues extends CueTable<Id> = CueTable<Id>, Moves extends MoveTable<Id> = MoveTable<Id>> = {
  track: FittedTrack;
  /** One tempo and phase through the tracked beats (`beatGrid`'s `steady`), for a track made on a grid. */
  steadyGrid: boolean;
  /**
   * Frames the picture's cut or hit comes before the tracker's beat frame: the tracker hears a hit late, and a
   * picture reads on the beat when it leads the sound a little.
   */
  leadFrames: number;
  /** Seconds a placed sound trails the picture's event it marks, to land with the music's hit rather than flam. */
  soundLagSeconds: number;
  bars: BarTable<Id>;
  cues: Cues;
  moves?: Moves;
  landmarks: readonly Landmark<Id>[];
  /** The fade to black, in frames from the video's end (negative): e.g. `{ from: -9, to: -5 }`. */
  fade: { from: number; to: number };
};

/** How far a landmark may sit from its downbeat: a steady grid against the tracker's downbeats, which wander. */
export const LANDMARK_TOLERANCE_SECONDS = 0.05;

declare const resolvedBarClock: unique symbol;

/** One bar, resolved: its frames, its own beats and its own cues. Only `defineBarTimeline` makes one. */
export type BarClock<Id extends string = string, Cue extends string = string, Move extends string = string> = {
  readonly [resolvedBarClock]: true;
  id: Id;
  /** The bar's place in the table, from 1. */
  n: number;
  /** Its length in beats. */
  beats: number;
  /** Its first frame (the video's first for bar 1, else its cut-in), and the frame the next bar starts on. */
  from: number;
  to: number;
  /** The frame beat `n` of this bar hits on, counted from its first beat: fractions for off-beats. */
  beat(n: number): number;
  cues: Readonly<Record<Cue, number>>;
  moves: Readonly<Record<Move, { from: number; to: number }>>;
};

type CueNames<Cues, K> = K extends keyof Cues ? keyof Cues[K] & string : never;
type MoveNames<Moves, K> = K extends keyof Moves ? keyof Moves[K] & string : never;
/** `'<bar>.<cue>'` for every cue in the table: a misspelt one fails to compile. */
export type CueName<Cues> = { [K in keyof Cues & string]: `${K}.${keyof Cues[K] & string}` }[keyof Cues & string];

export type BarTimeline<Id extends string = string, Cues extends CueTable<Id> = CueTable<Id>, Moves extends MoveTable<Id> = MoveTable<Id>> = {
  spec: BarTimelineSpec<Id, Cues, Moves>;
  fps: number;
  bpm: number;
  /** Seconds per beat. */
  spb: number;
  soundLagSeconds: number;
  bars: readonly BarClock<Id>[];
  bar<K extends Id>(id: K): BarClock<K, CueNames<Cues, K>, MoveNames<Moves, K>>;
  /** The frame another bar's named moment falls on. */
  cue(name: CueName<Cues>): number;
  /** The video's last frame, exclusive: the fitted track ends with it. */
  end: number;
  /** The frames the picture fades to black over. */
  fade: { from: number; to: number };
  /** The track's beat at `frame` on the picture's clock, as a fraction: whole on each hit frame. For a beat counter. */
  beatAtFrame(frame: number): number;
  /** Every beat's hit frame inside the video, pickup beats included. */
  beatFrames: readonly number[];
  /** Which beat of the music's own bar each bar cuts in on, 1 being its downbeat. */
  musicBeats: readonly number[];
};

/** Resolves a music-led video's table on its track, or throws where the table and the music disagree. */
export function defineBarTimeline<const Id extends string, const Cues extends CueTable<Id>, const Moves extends MoveTable<Id> = {}>(
  spec: BarTimelineSpec<Id, Cues, Moves>,
): BarTimeline<Id, Cues, Moves> {
  const { track, bars: table, leadFrames } = spec;
  checkTable(table);
  const grid = beatGrid(track, { steady: spec.steadyGrid });
  const hitFrame = (beat: number) => Math.round(grid.at(beat) * FPS) - leadFrames;
  const startBeats = table.map((_, k) => table.slice(0, k).reduce((sum, row) => sum + row.beats, 0));
  const indexOf = (id: string) => {
    const k = table.findIndex((row) => row.id === id);
    if (k < 0) throw new Error(`no bar ${id}: the table has ${table.map((row) => row.id).join(', ')}`);
    return k;
  };
  checkLandmarks(spec, grid, (id, beat) => startBeats[indexOf(id)] + beat);

  const end = Math.round(track.duration * FPS);
  const froms = table.map((row, k) => (k === 0 ? 0 : hitFrame(startBeats[k] + (row.cutIn ?? 0))));
  const tos = froms.map((_, k) => froms[k + 1] ?? end);
  const momentFrame = (k: number, moment: BarMoment) => {
    const { beat, frames = 0 } = typeof moment === 'number' ? { beat: moment } : moment;
    return (beat === 'end' ? tos[k] : hitFrame(startBeats[k] + beat)) + frames;
  };
  const moveEndFrame = (k: number, moment: MoveEnd<Id>) =>
    typeof moment === 'object' && 'bar' in moment ? momentFrame(indexOf(moment.bar), moment) : momentFrame(k, moment);

  const clocks = table.map((row, k) => {
    const beat = (n: number) => {
      const frame = hitFrame(startBeats[k] + n);
      if (frame < froms[k] || frame > tos[k]) {
        throw new Error(`bar ${row.id}'s beat ${n} (frame ${frame}) is outside the bar (frames ${froms[k]}–${tos[k]}): `
          + `reach another bar's moment through its cue`);
      }
      return frame;
    };
    const cues = Object.fromEntries(Object.entries(spec.cues[row.id] ?? {}).map(([name, moment]) => [name, momentFrame(k, moment as BarMoment)]));
    const moves = Object.fromEntries(Object.entries(spec.moves?.[row.id] ?? {}).map(([name, span]) => {
      const { from, to } = span as MoveSpan<Id>;
      return [name, { from: moveEndFrame(k, from), to: moveEndFrame(k, to) }];
    }));
    return { id: row.id, n: k + 1, beats: row.beats, from: froms[k], to: tos[k], beat, cues, moves } as unknown as BarClock<Id>;
  });

  const beatAtFrame = (frame: number) => grid.beatOf((frame + leadFrames) / FPS);
  const beatFrames: number[] = [];
  for (let n = Math.floor(beatAtFrame(0)); hitFrame(n) < end; n++) if (hitFrame(n) >= 0) beatFrames.push(hitFrame(n));

  // The tracker's downbeats wander off a steady grid by up to a quarter beat, so each is taken as its nearest beat.
  const downbeatBeats = track.fit.downbeats.map((t) => Math.round(grid.beatOf(t)));
  const musicBeatOf = (beat: number) => Math.round((beat - downbeatBeats.filter((d) => d <= beat + 0.1).at(-1)! + 1) * 4) / 4;

  return {
    spec, fps: FPS, bpm: grid.bpm, spb: grid.spb, soundLagSeconds: spec.soundLagSeconds, bars: clocks,
    bar: (id) => clocks[indexOf(id)] as never,
    cue: (name) => {
      const dot = name.indexOf('.');
      const cues = clocks[indexOf(name.slice(0, dot))].cues as Record<string, number>;
      const frame = cues[name.slice(dot + 1)];
      if (frame === undefined) throw new Error(`no cue ${name}`);
      return frame;
    },
    end, fade: { from: end + spec.fade.from, to: end + spec.fade.to }, beatAtFrame, beatFrames,
    musicBeats: table.map((row, k) => musicBeatOf(startBeats[k] + (row.cutIn ?? 0))),
  };
}

function checkTable(table: BarTable) {
  if (!table.length) throw new Error('the bar table is empty');
  const ids = new Set<string>();
  for (const row of table) {
    if (ids.has(row.id)) throw new Error(`two bars are ${row.id}: give each its own id`);
    ids.add(row.id);
    if (!(row.beats > 0)) throw new Error(`bar ${row.id} is ${row.beats} beats long`);
    if (row.cutIn !== undefined && !(row.cutIn >= 0 && row.cutIn < row.beats)) throw new Error(`bar ${row.id} cuts in on beat ${row.cutIn}, outside its ${row.beats}`);
  }
}

// The music is a recording, re-cut only in whole bars (`studio music fit --bars`), so a bar length changed in the table
// needs the music re-fitted to match, or the video ends over the wrong bar of it.
function checkLandmarks(spec: BarTimelineSpec<string, CueTable<string>, MoveTable<string>>, grid: BeatGrid, beatOf: (bar: string, beat: number) => number) {
  const downbeats = spec.track.fit.downbeats;
  const onFinalHit = spec.landmarks.some((mark) => mark.downbeat === -1 || mark.downbeat === downbeats.length - 1);
  if (!onFinalHit) throw new Error('no landmark names the music\'s final hit (downbeat -1): add one, so a table that outruns the music fails');
  for (const mark of spec.landmarks) {
    const at = downbeats.at(mark.downbeat);
    if (at === undefined) throw new Error(`landmark ${mark.name} names downbeat ${mark.downbeat}; the fit has ${downbeats.length}`);
    const beat = beatOf(mark.bar, mark.beat);
    if (Math.abs(grid.at(beat) - at) > LANDMARK_TOLERANCE_SECONDS) {
      throw new Error(`the bar table puts ${mark.name} (bar ${mark.bar}, beat ${mark.beat}) on the track's beat ${beat} `
        + `(${grid.at(beat).toFixed(2)} s), but the music's is at ${at} s: re-fit it with studio music fit --bars, or change the table`);
    }
  }
}
