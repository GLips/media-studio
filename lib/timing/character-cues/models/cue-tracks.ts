// cue-tracks.ts: a score compiled into one track per control, and sampled. Each track is its control's writes in time
// order; a write blends from the value its control held as it began (a snapshot) to its target, which a move makes a
// moving one. On each control the later write wins, so a wave keeps its arm while a new expression takes the face.
//
// Everything here is a pure function of the score and the time sampled: snapshots and move entries are memoised, but
// what they hold doesn't depend on which frame asked first.

import type { LookCatalog } from '#lib/paint/looks/models/look-catalog.ts';
import { cueBlendCurve, type CueBlend, type CueBlendCurve } from './cue-blend.ts';
import type { AnyCueCharacter, CueCharacterState } from './cue-character.ts';
import type { CueCast, CueFrame, CueMoveEnd, CueRow, CueVector } from './cue-score.ts';
import {
  cuePatchLeaf, cueSchema, cueSchemaLeaves, cueStateFromLeaves, cueStateLeaves, mixCueLeaf, type CueLeaf, type CuePatch, type CueState,
} from './cue-state.ts';
import { cueSecondsOf, cueTimeSeconds, type CueClock, type CueNamesOfClock, type CueTime } from './cue-time.ts';

/** A compiled score: the frame at any scene time. */
export type CueScore<C extends AnyCueCharacter, L extends LookCatalog, Camera extends CueState> = {
  readonly sample: (t: number) => CueFrame<C, L, Camera>;
};

/**
 * How far early a write or look still counts as begun. A render's `s.t` (frame / fps less the scene's start) can land a rounding error
 * before a cue computed as (frame - cut) / fps for the same frame; with this slack a cue lands on the frame it names.
 */
const CUE_TIME_SLACK = 1e-6;

/** The squash a spring's overshoot may not pass below: a body squashed through zero would turn inside out. */
const SQUASH_FLOOR = 0.05;

type Write = {
  readonly start: number;
  readonly row: number;
  readonly target: (t: number) => CueLeaf;
  readonly curve: CueBlendCurve;
};

type StageState = { character: CueState; actor: { position: CueVector; squash: number }; camera: CueState };

type LookSpan = { readonly start: number; readonly look: string; readonly palette: string; readonly phase: number };

export function compileCueScore<Clock extends CueClock, C extends AnyCueCharacter, L extends LookCatalog, Camera extends CueState>(
  clock: Clock, cast: CueCast<C, L, Camera>, rows: readonly CueRow<C, L, Camera, CueNamesOfClock<Clock>>[],
): CueScore<C, L, Camera> {
  const initial: StageState = { character: cast.character.initial, actor: { position: [0, 0, 0], squash: 1 }, camera: cast.camera };
  const schema = cueSchema(initial), start = cueStateLeaves(schema, initial);
  const tracks: Write[][] = schema.paths.map(() => []);
  const timing = cueSecondsOf(clock);
  const at = (time: CueTime<string>) => cueTimeSeconds(timing, time);
  const curveOf = (blend: CueBlend | undefined, from: number) => cueBlendCurve(blend ?? 'cut', timing, from);
  const where = (row: number) => `score for scene ${clock.id}, row ${row + 1}`;

  const writePatch = (row: number, seconds: number, prefix: string, patch: CuePatch<CueState>, by: CueBlend | undefined) => {
    const curve = curveOf(by, seconds);
    for (const leaf of cueSchemaLeaves(schema, prefix)) {
      const value = cuePatchLeaf(patch, schema.paths[leaf].slice(prefix.length + 1));
      if (value !== undefined) tracks[leaf].push({ start: seconds, row, target: () => value, curve });
    }
  };

  // Each move's entry: the whole character as it stood just before the move began, read lazily once the tracks exist.
  const moves: { row: number; begins: number; ends: number; leaves: readonly number[]; end: CueMoveEnd }[] = [];

  rows.forEach((row, n) => {
    const seconds = at(row.at), { character } = cast;
    if (row.pose !== undefined) writePatch(n, seconds, 'character', character.poses[row.pose], row.by);
    if (row.expression !== undefined) writePatch(n, seconds, 'character', character.expressions[row.expression], row.by);
    for (const [name, value] of Object.entries(row.set ?? {})) {
      if (value === undefined) continue;
      const slider = character.sliders[name];
      if (!(value >= slider.min && value <= slider.max)) throw new Error(`${where(n)}: ${name} ${value} is outside ${slider.min}–${slider.max}`);
      const leaf = schema.index.get(`character.${slider.path}`)!;
      tracks[leaf].push({ start: seconds, row: n, target: () => value, curve: curveOf(row.by, seconds) });
    }
    if (row.position) writePatch(n, seconds, 'actor', { position: row.position }, row.by);
    if (row.squash !== undefined) {
      if (!(row.squash > 0)) throw new Error(`${where(n)}: squash must be positive, not ${row.squash}`);
      writePatch(n, seconds, 'actor', { squash: row.squash }, row.by);
    }
    if (row.camera) writePatch(n, seconds, 'camera', row.camera, row.by);
    if (row.move) {
      const call = row.move, move = character.moves[call.name], rate = call.rate ?? 1;
      if (!(rate > 0 && Number.isFinite(rate))) throw new Error(`${where(n)}: move ${call.name}'s rate must be positive, not ${rate}`);
      const marker = call.align === undefined ? 0 : move.markers?.[call.align];
      if (marker === undefined) throw new Error(`${where(n)}: move ${call.name} has no marker ${call.align}`);
      const begins = seconds - marker / rate;
      const ends = call.until === undefined ? begins + (move.seconds ?? Infinity) / rate : at(call.until);
      if (!(ends > begins)) throw new Error(`${where(n)}: move ${call.name} ends before it begins`);
      const leaves = [...new Set(move.writes.flatMap((path) => cueSchemaLeaves(schema, `character.${path}`)))];
      const index = moves.push({ row: n, begins, ends, leaves, end: call.end ?? 'hold' }) - 1;
      const local = (t: number) => Math.min(Math.max(t - begins, 0), ends - begins) * rate;
      let memo: { seconds: number; patch: CuePatch<CueState> } | undefined;
      const sampleAt = (t: number) => {
        const s = local(t);
        // SAFETY: a character's moves sample its own state, and entryOf rebuilds exactly that state from its own schema.
        if (memo?.seconds !== s) memo = { seconds: s, patch: move.sample(s, entryOf(index) as never) };
        return memo.patch;
      };
      const curve = curveOf(row.by, begins);
      for (const leaf of leaves) {
        const path = schema.paths[leaf].slice('character.'.length);
        tracks[leaf].push({ start: begins, row: n, curve, target: (t) => cuePatchLeaf(sampleAt(t), path) ?? entryLeaves(index)[leaf] });
      }
    }
  });

  // A returning move hands each of its controls back only where no later row has taken that control since it began.
  for (const [index, move] of moves.entries()) {
    const { end } = move;
    if (end === 'hold' || move.ends === Infinity) continue;
    const curve = curveOf(end.return, move.ends);
    for (const leaf of move.leaves) {
      if (tracks[leaf].some((w) => w.row !== move.row && w.start > move.begins && w.start <= move.ends)) continue;
      tracks[leaf].push({ start: move.ends, row: move.row, curve, target: () => entryLeaves(index)[leaf] });
    }
  }

  for (const [leaf, track] of tracks.entries()) {
    track.sort((a, b) => a.start - b.start);
    for (let k = 1; k < track.length; k++) {
      if (track[k].start === track[k - 1].start) {
        throw new Error(`score for scene ${clock.id}: rows ${track[k - 1].row + 1} and ${track[k].row + 1} both set ${schema.paths[leaf]} at ${track[k].start.toFixed(3)} s`);
      }
    }
  }

  const snapshots = tracks.map(() => new Map<number, CueLeaf>());
  /** Leaf `leaf` at `t` from its writes before `upto` (all of them when omitted). */
  const leafAt = (leaf: number, t: number, upto = tracks[leaf].length): CueLeaf => {
    const track = tracks[leaf];
    let k = upto - 1;
    while (k >= 0 && track[k].start > t + CUE_TIME_SLACK) k--;
    if (k < 0) return start[leaf];
    const write = track[k], s = Math.max(0, t - write.start), target = write.target(t);
    if (s >= write.curve.settles) return target;
    let from = snapshots[leaf].get(k);
    if (from === undefined) snapshots[leaf].set(k, (from = leafAt(leaf, write.start, k)));
    return mixCueLeaf(from, target, write.curve.progress(s), s >= write.curve.arrives);
  };
  // SAFETY: the schema was read from a StageState, so its leaves rebuild that shape, each mixed from a leaf of its own.
  const stageOf = (leaves: readonly CueLeaf[]) => cueStateFromLeaves(schema, leaves) as StageState;
  const characterLeaves = cueSchemaLeaves(schema, 'character');
  const entries = new Map<number, CueLeaf[]>();
  /** Every leaf just before move `index` began, by schema index (character leaves only are read). */
  function entryLeaves(index: number): CueLeaf[] {
    const known = entries.get(index);
    if (known) return known;
    const { begins } = moves[index], leaves = [...start];
    for (const leaf of characterLeaves) {
      const later = tracks[leaf].findIndex((w) => w.start >= begins);
      leaves[leaf] = leafAt(leaf, begins, later < 0 ? tracks[leaf].length : later);
    }
    entries.set(index, leaves);
    return leaves;
  }
  const entryOf = (index: number): CueState => stageOf(entryLeaves(index)).character;

  const looks = lookSpans(cast.looks, rows.map((row) => ({ ...row, seconds: at(row.at) })), clock.id);

  return {
    sample(t) {
      const span = looks.findLast((s) => s.start <= t + CUE_TIME_SLACK) ?? looks[0];
      const sampling = cast.looks[span.look].sampling;
      const fps = sampling === 'live' ? clock.fps : sampling.fps;
      const drawing = Math.floor((t - span.phase + CUE_TIME_SLACK) * fps), drawingTime = sampling === 'live' ? t : span.phase + drawing / fps;
      const leaves = schema.paths.map((path, leaf) => leafAt(leaf, path.startsWith('camera.') || path === 'actor.position' ? t : drawingTime));
      const stage = stageOf(leaves);
      return {
        t, drawing, drawingTime, look: span.look, palette: span.palette,
        // SAFETY: the character's subtree was read from its own initial state, so it rebuilds as that state's type.
        character: stage.character as CueCharacterState<C>,
        // SAFETY: the camera's subtree was read from the cast's camera, so it rebuilds as Camera.
        camera: stage.camera as Camera,
        position: stage.actor.position, squash: Math.max(SQUASH_FLOOR, stage.actor.squash),
      };
    },
  };
}

/** Which look and palette show from when: a genuine look change starts a new drawing phase; a palette change doesn't. */
function lookSpans(catalog: LookCatalog, rows: readonly { seconds: number; look?: string; palette?: string | { look: string; name: string } }[], scene: string): LookSpan[] {
  const first = Object.keys(catalog)[0];
  if (first === undefined) throw new Error(`score for scene ${scene}: its look catalog is empty`);
  const spans: LookSpan[] = [{ start: -Infinity, look: first, palette: catalog[first].palettes[0], phase: 0 }];
  const sorted = rows.map((row, n) => ({ ...row, n })).filter((row) => row.look !== undefined || row.palette !== undefined)
    .toSorted((a, b) => a.seconds - b.seconds);
  for (const [k, row] of sorted.entries()) {
    if (k > 0 && sorted[k - 1].seconds === row.seconds) throw new Error(`score for scene ${scene}: rows ${sorted[k - 1].n + 1} and ${row.n + 1} both set the look at ${row.seconds.toFixed(3)} s`);
    const now = spans.at(-1)!;
    if (row.look !== undefined) {
      const named = typeof row.palette === 'string' ? row.palette : undefined;
      if (row.look === now.look) spans.push({ ...now, start: row.seconds, palette: named ?? now.palette });
      else spans.push({ start: row.seconds, look: row.look, palette: named ?? catalog[row.look].palettes[0], phase: row.seconds });
    } else if (typeof row.palette === 'object') {
      if (row.palette.look !== now.look) throw new Error(`score for scene ${scene}, row ${row.n + 1}: palette ${row.palette.name} is ${row.palette.look}'s, but ${now.look} is showing`);
      spans.push({ ...now, start: row.seconds, palette: row.palette.name });
    }
  }
  return spans;
}
