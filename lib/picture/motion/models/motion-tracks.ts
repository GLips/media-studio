// motion-tracks.ts: how every tagged element actually moved, frame by frame, assembled from what the probe
// (lib/output/look/studio/probe.tsx) measured on each rendered frame. Pure; lib/output/render/engine/render-pipeline.ts renders the frames and writes
// the result to out/check/motion.json for review (studio look) and for checks that test what a scene declares.
//
// It measures and never judges: nothing here says a move is too fast or too linear. What it does report as errors is
// its own instrumentation going wrong (two elements sharing an id, a frame missing, a value that isn't a number),
// since a track built on those would mislead whatever reads it.
//
// Tags and what they register are lib/output/look/studio/motion-tag.ts.

import type { Rect } from '#lib/picture/camera/models/camera.ts';

export const MOTION_TRACKS_VERSION = 2;

/** The artifact the probe emits for each frame. */
export const motionArtifactName = (frame: number) => `motion-${frame}.json`;

/** A thousandth of a pixel (or of progress) is past anything a viewer or a check can tell apart, and keeps files small. */
export const roundMotionValue = (v: number) => Math.round(v * 1000) / 1000;

/**
 * Where a scene is in its crossfades on a frame: fading in over the one before, alone, or under the next as it fades
 * in. A hard cut goes straight from one scene's `solo` to the next's.
 */
export type ScenePhase = 'in' | 'solo' | 'out';

/**
 * What a track's `local` box is measured against:
 * - `scene`: nothing owns it, so its own motion is its screen motion;
 * - `group`: the tagged element it's nested in, in that element's own CSS pixels, its transforms undone;
 * - `camera`: the camera it's drawn through, in page pixels of that camera's capture;
 * - `unknown`: its owner's transform couldn't be recovered (a rotation on the way, a zero-size group), or a library
 *   piece was handed a screen rect it can't trace. Only its screen motion is known, which may be partly inherited.
 */
export type MotionAttribution = 'scene' | 'group' | 'camera' | 'unknown';

/**
 * A tagged element's place in a stagger: the `index`th of `count` things started one after another. In a sample,
 * `group` is scoped like an id (`scene/owner/group`), so staggers in two cards are two staggers.
 */
export type StaggerMembership = { group: string; index: number; count: number };

/** One tagged element on one frame, as the probe measured it. Rects are composition pixels, top-left based. */
export type MotionSample = {
  /** `<scene>/<tagged ancestors>/<name>`: unique on its frame, stable across frames. A piece's kind isn't in it. */
  id: string;
  scene: string;
  name: string;
  /** What library piece drew it (`camera`, `highlight`, `cursor`…); none for a hand-written tag. */
  kind?: string;
  /** The library picked its name, not the author (see lib/output/look/studio/motion-tag.ts). */
  implicit?: true;
  phase: ScenePhase;
  /** The id of the group or camera it belongs to; null when the scene owns it. */
  parent: string | null;
  attribution: MotionAttribution;
  /** Its box on screen. */
  rect: Rect;
  /** Its box in its owner's frame (see MotionAttribution): the screen box when the scene owns it, null iff unknown. */
  local: Rect | null;
  /** Its own opacity times every ancestor's, the scene's crossfade included. */
  opacity: number;
  /** Progress or value channels the element reports: a ring's `draw`, a camera's `zoom`, a counter's `value`. */
  values: Readonly<Record<string, number>>;
  stagger?: StaggerMembership;
  /**
   * Set on a camera: its box and camera, so several captures shown through one camera (a state dissolve) count as
   * one camera rather than as elements sharing an id.
   */
  camera?: string;
};

/** Everything the probe saw on one frame. */
export type FrameMotion = {
  frame: number;
  /** The scenes painted on this frame. */
  scenes: string[];
  samples: MotionSample[];
  /** What a scene shows that no tag can measure (a take's contents, a generated clip), by scene. */
  unmeasured: { scene: string; what: string }[];
  /** Tags the probe couldn't read: a malformed attribute, a name with a `/` in it. */
  problems: { id?: string; problem: string }[];
};

// ---------- the tracks ----------

type Channels<T> = { x: T[]; y: T[]; w: T[]; h: T[] };

/**
 * A stretch of frames where one element was on screen continuously, in one crossfade phase, under one owner. A track
 * breaks into segments wherever the element disappears and comes back, at crossfade boundaries, and where its owner
 * or attribution changes; nothing is ever interpolated across a break. Frame `f` is at `f / fps` video seconds.
 */
export type MotionSegment = {
  /** First and last frame, inclusive: every array below has `end - start + 1` entries, one per frame. */
  start: number;
  end: number;
  phase: ScenePhase;
  parent: string | null;
  attribution: MotionAttribution;
  /** On the segment, not the track: a name the library picked can pass to an element in another stagger. */
  stagger?: StaggerMembership;
  /** Centre and size on screen, composition pixels, and effective opacity. */
  screen: Channels<number> & { opacity: number[] };
  /** Centre and size in the owner's frame (see MotionAttribution); null when attribution is unknown. */
  local: Channels<number> | null;
  /** Reported channels; null on a frame that didn't report one (an instrumentation error says so). */
  values: Record<string, (number | null)[]>;
};

export type MotionTrack = { id: string; scene: string; name: string; kind?: string; segments: MotionSegment[] };

export type FrameSpan = { first: number; last: number; count: number };

/** What was measured, so a quiet report can't be mistaken for a clean one. */
export type MotionCoverage = {
  /** Every scene painted in the analysed frames, with how many tracks it has and what it shows that isn't measured. */
  scenes: { id: string; tracks: number; unmeasured: string[] }[];
  /** Ids the library picked that several elements shared, so none of them was tracked there: one entry per stretch. */
  ambiguous: { id: string; elements: number; frames: FrameSpan }[];
};

export type MotionInstrumentationError = { id?: string; frames?: FrameSpan; problem: string };

/** out/check/motion.json. */
export type MotionTracks = {
  version: typeof MOTION_TRACKS_VERSION;
  fps: number;
  /** The analysed frames, inclusive. Every one of them was measured, or `errors` says which weren't. */
  frames: { first: number; last: number };
  tracks: MotionTrack[];
  coverage: MotionCoverage;
  errors: MotionInstrumentationError[];
};

const finiteRect = (r: Rect | null) => !r || [r.x, r.y, r.w, r.h].every(Number.isFinite);
const sameRect = (a: Rect, b: Rect) => Math.abs(a.x - b.x) < 0.01 && Math.abs(a.y - b.y) < 0.01 && Math.abs(a.w - b.w) < 0.01 && Math.abs(a.h - b.h) < 0.01;

/** Frame spans by key, each widened as frames come in, or with `contiguous`, a new span wherever a frame is skipped. */
function frameSpans<T>({ contiguous }: { contiguous: boolean }) {
  const spans = new Map<string, { of: T; span: FrameSpan }[]>();
  return {
    /** Returns the entry `frame` joined, whose `of` is the one it opened with. */
    add(key: string, frame: number, of: T) {
      const last = spans.get(key)?.at(-1), s = last?.span;
      if (last && s && !(contiguous && frame !== s.last + 1)) {
        [s.first, s.last, s.count] = [Math.min(s.first, frame), Math.max(s.last, frame), s.count + 1];
        return last;
      }
      const entry = { of, span: { first: frame, last: frame, count: 1 } };
      spans.set(key, [...(spans.get(key) ?? []), entry]);
      return entry;
    },
    list: () => [...spans.values()].flat(),
  };
}

/** Errors that happen on many frames, reported once each with the frames they span. */
function errorLog() {
  const spans = frameSpans<{ id?: string; problem: string }>({ contiguous: false });
  const unframed = new Map<string, MotionInstrumentationError>();
  return {
    add(problem: string, frame?: number, id?: string) {
      const key = `${id ?? ''}\n${problem}`, of = { ...(id !== undefined && { id }), problem };
      if (frame === undefined) unframed.set(key, of);
      else spans.add(key, frame, of);
    },
    list: (): MotionInstrumentationError[] => [...unframed.values(), ...spans.list().map(({ of, span }) => ({ ...of, frames: span }))],
  };
}

/**
 * The samples on one frame that can go into tracks: a camera seen through several captures merged into one, and
 * every id still claimed twice, or carrying a value that isn't a number, dropped. A name only authors chose that's
 * claimed twice is an error; one the library picked for any of them is ambiguous, and noted in `ambiguous` by id and count.
 */
function usableSamples(fm: FrameMotion, log: ReturnType<typeof errorLog>, ambiguous: (id: string, elements: number) => void): MotionSample[] {
  const byId = new Map<string, MotionSample[]>();
  for (const s of fm.samples) byId.set(s.id, [...(byId.get(s.id) ?? []), s]);
  const usable: MotionSample[] = [];
  for (const [id, group] of byId) {
    const [first] = group;
    const oneCamera = group.every((s) => s.camera !== undefined && s.camera === first.camera && sameRect(s.rect, first.rect));
    if (group.length > 1 && !oneCamera) {
      // One of them named by the library is enough: the author couldn't have known to avoid it.
      if (group.some((s) => s.implicit)) ambiguous(id, group.length);
      else log.add(`${group.length} elements share this id: give each its own name`, fm.frame, id);
      continue;
    }
    const s = group.length > 1 ? { ...first, opacity: Math.max(...group.map((g) => g.opacity)) } : first;
    const bad = [
      !finiteRect(s.rect) && 'its box', !finiteRect(s.local) && 'its local box', !Number.isFinite(s.opacity) && 'its opacity',
      ...Object.entries(s.values).filter(([, v]) => !Number.isFinite(v)).map(([name]) => `its "${name}" value`),
    ].filter(Boolean);
    if (bad.length) {
      log.add(`${bad.join(', ')} isn't a finite number`, fm.frame, id);
      continue;
    }
    usable.push(s);
  }
  return usable;
}

const round = roundMotionValue;
const segmentKey = (s: MotionSample) => JSON.stringify([s.phase, s.parent, s.attribution, s.stagger ?? null]);

/** One segment's samples, a frame each, as channels. A value some frames didn't report is null there, and logged. */
function segmentOf(samples: readonly MotionSample[], start: number, id: string, log: ReturnType<typeof errorLog>): MotionSegment {
  const [s] = samples;
  const box = (rects: Rect[]) => ({ x: rects.map((r) => round(r.x + r.w / 2)), y: rects.map((r) => round(r.y + r.h / 2)), w: rects.map((r) => round(r.w)), h: rects.map((r) => round(r.h)) });
  const names = [...new Set(samples.flatMap((x) => Object.keys(x.values)))];
  const values = Object.fromEntries(names.map((name) => [name, samples.map((x, i) => {
    if (name in x.values) return round(x.values[name]);
    log.add(`its "${name}" value is missing on some frames`, start + i, id);
    return null;
  })]));
  return {
    start, end: start + samples.length - 1, phase: s.phase, parent: s.parent, attribution: s.attribution, ...(s.stagger && { stagger: s.stagger }),
    screen: { ...box(samples.map((x) => x.rect)), opacity: samples.map((x) => round(x.opacity)) },
    local: s.local ? box(samples.map((x) => x.local!)) : null,
    values,
  };
}

/**
 * Assembles one frame report per analysed frame (any order) into tracks. `first` and `last` are the analysed frames,
 * inclusive; a frame between them with no report is an instrumentation error, and breaks every track through it.
 */
export function assembleMotionTracks(frames: readonly FrameMotion[], { fps, first, last }: { fps: number; first: number; last: number }): MotionTracks {
  const log = errorLog(), ambiguous = frameSpans<{ id: string; elements: number }>({ contiguous: true });
  const byFrame = new Map(frames.map((fm) => [fm.frame, fm]));
  const coverage = new Map<string, { tracks: Set<string>; unmeasured: Set<string> }>();
  const sceneCoverage = (id: string) => coverage.get(id) ?? coverage.set(id, { tracks: new Set(), unmeasured: new Set() }).get(id)!;
  // Each id's runs of samples: a run continues only onto the very next frame, under the same key.
  const runs = new Map<string, { first: MotionSample; runs: { start: number; key: string; samples: MotionSample[] }[] }>();

  for (let frame = first; frame <= last; frame++) {
    const fm = byFrame.get(frame);
    if (!fm) {
      log.add('frames were not measured', frame);
      continue;
    }
    for (const p of fm.problems) log.add(p.problem, frame, p.id);
    for (const scene of fm.scenes) sceneCoverage(scene);
    for (const { scene, what } of fm.unmeasured) sceneCoverage(scene).unmeasured.add(what);
    const noteAmbiguous = (id: string, elements: number) => {
      const { of } = ambiguous.add(id, frame, { id, elements });
      of.elements = Math.max(of.elements, elements);
    };
    for (const s of usableSamples(fm, log, noteAmbiguous)) {
      sceneCoverage(s.scene).tracks.add(s.id);
      const entry = runs.get(s.id) ?? runs.set(s.id, { first: s, runs: [] }).get(s.id)!;
      const key = segmentKey(s), run = entry.runs.at(-1);
      if (run && run.key === key && run.start + run.samples.length === frame) run.samples.push(s);
      else entry.runs.push({ start: frame, key, samples: [s] });
    }
  }

  return {
    version: MOTION_TRACKS_VERSION,
    fps,
    frames: { first, last },
    tracks: [...runs].map(([id, { first: s, runs: rs }]) => ({
      id, scene: s.scene, name: s.name, ...(s.kind && { kind: s.kind }), segments: rs.map((r) => segmentOf(r.samples, r.start, id, log)),
    })),
    coverage: {
      scenes: [...coverage].map(([id, c]) => ({ id, tracks: c.tracks.size, unmeasured: [...c.unmeasured].sort() })),
      ambiguous: ambiguous.list().map(({ of, span }) => ({ ...of, frames: span })),
    },
    errors: log.list(),
  };
}

/**
 * Change per second of one channel of a segment, frame by frame: null on the segment's first frame, and wherever a
 * sample either side is missing. A segment is gap-free by construction, so this never spans a break.
 */
export function motionChannelVelocity(series: readonly (number | null)[], fps: number): (number | null)[] {
  return series.map((v, i) => {
    const before = series[i - 1];
    return i === 0 || v === null || before === null || before === undefined ? null : (v - before) * fps;
  });
}

/** Reads out/check/motion.json, refusing one written by another version of this format. */
export function parseMotionTracks(json: string): MotionTracks {
  const tracks = JSON.parse(json) as MotionTracks;
  if (tracks.version !== MOTION_TRACKS_VERSION) {
    throw new Error(`motion tracks are version ${tracks.version}, and this reads version ${MOTION_TRACKS_VERSION}: run studio check again`);
  }
  return tracks;
}

// ---------- the report ----------

const list = (items: readonly string[]) => items.join(', ');

/**
 * What `studio check` prints about motion: instrumentation errors, one line each, then what was measured and what
 * wasn't. With nothing tagged it says so, rather than reading as a pass.
 */
export function formatMotionReport(m: MotionTracks): { ok: boolean; lines: string[] } {
  const at = (f: number) => `${(f / m.fps).toFixed(2)}s`;
  const lines = m.errors.map((e) => {
    const when = e.frames ? (e.frames.first === e.frames.last ? ` at ${at(e.frames.first)}` : ` ${at(e.frames.first)}–${at(e.frames.last)} (${e.frames.count} frames)`) : '';
    return `  ✗ motion tracking${when}: ${e.id ? `"${e.id}" ` : ''}${e.problem}`;
  });
  const scenes = m.coverage.scenes;
  const tracked = scenes.filter((s) => s.tracks > 0);
  const untagged = scenes.filter((s) => s.tracks === 0).map((s) => s.id);
  const unmeasured = [...new Set(scenes.flatMap((s) => s.unmeasured))].map((what) => `${what} (${list(scenes.filter((s) => s.unmeasured.includes(what)).map((s) => s.id))})`);
  const span = `${(m.frames.first / m.fps).toFixed(2)}–${((m.frames.last + 1) / m.fps).toFixed(2)}s, every frame`;
  const summary = m.tracks.length === 0
    ? `motion: nothing tagged, so no motion was measured (${span})`
    : `motion: ${m.tracks.length} track${m.tracks.length > 1 ? 's' : ''} in ${tracked.length} of ${scenes.length} scene${scenes.length > 1 ? 's' : ''} (${span})`;
  lines.push(`${summary}${m.errors.length ? `, ${m.errors.length} tracking error${m.errors.length > 1 ? 's' : ''}` : ''}`);
  if (m.tracks.length && untagged.length) lines.push(`  nothing tagged in ${list(untagged)}`);
  for (const a of m.coverage.ambiguous) {
    lines.push(`  untracked ${at(a.frames.first)}–${at(a.frames.last)}: ${a.elements} elements share "${a.id}", a name the library picked; name them (a \`motion\` prop) or wrap each in its own data-motion group to track them`);
  }
  if (unmeasured.length) lines.push(`  unmeasured by nature: ${list(unmeasured)}`);
  return { ok: m.errors.length === 0, lines };
}
