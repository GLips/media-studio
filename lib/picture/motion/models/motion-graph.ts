// motion-graph.ts: the motion tracks (lib/picture/motion/models/motion-tracks.ts) of a stretch of video, drawn over time for review, with
// the numbers behind them. Pure: lib/output/render/engine/render-pipeline.ts measures the stretch, renders the frame the trails sit on, and
// rasterizes the SVG this returns.
//
// Each channel gets its own plot (x and y, their signed velocities, size, opacity, each reported value), because a
// speed-only curve hides reversals and can't show overshoot. The voice's words and the crossfades are marked across
// all of them, so a move can be read against what it lands on. Like the tracks, this describes and never judges.

import { motionChannelVelocity, type MotionSegment, type MotionTrack, type MotionTracks } from './motion-tracks.ts';
import type { TimelineReport } from '#lib/picture/composition/studio/Video.tsx';

/** Which box a graph plots: where the viewer sees the element, or where it is in its owner's frame. */
export type MotionGraphSpace = 'screen' | 'local';

export type MotionGraphRequest = {
  /** The stretch, in frames, inclusive: the tracks must cover it (they're measured for it). */
  first: number;
  last: number;
  space: MotionGraphSpace;
  /** Track ids, or parts of them; none picks the tracks that move most. */
  tracks?: readonly string[];
  /** Seconds between the dots of a trail. */
  trailStep: number;
  /** The rendered frame the trails are drawn over: its number, and the image as a URL (a data: URL, to rasterize). */
  backdrop: { frame: number; href: string };
};

/** Tracks plotted when none are picked: more lines than this in one plot can't be told apart. */
const DEFAULT_TRACK_COUNT = 6; // one per PALETTE colour

/** A reported value is still when it changes less than this per frame, relative to its size; a box, less than PIXEL_STILL. */
const PIXEL_STILL = 0.05, OPACITY_STILL = 0.002, VALUE_STILL = 1e-4;
/** A pause shorter than this (seconds) inside a move doesn't end it: a counter ticking, a stepped value. */
const MOVE_GAP = 0.2;
/** A move that reverses more often than this is wobbling, not overshooting and settling. */
const MAX_SETTLING_REVERSALS = 3;
/** Where a move is "within" its target: this share of its travel. */
const LANDED_SHARE = 0.01;

// ---------- channels ----------

/**
 * One plotted quantity of one track: a series per run of it (see trackRuns), never joined across a break. `cut` says
 * why a series begins or ends, when not the element's own doing: the stretch's edge, or a break in its track. A move
 * touching a cut edge may have started before it or go on after it.
 */
type ChannelSeries = { start: number; values: (number | null)[]; cut?: { start?: EdgeCause; end?: EdgeCause } }[];

/** Why a series begins or ends: the stretch does, or the track breaks (the element appears, vanishes, changes owner). */
export type EdgeCause = 'stretch' | 'break';

type ChannelKind = 'x' | 'y' | 'w' | 'h' | 'opacity' | 'value';
type Channel = { key: string; kind: ChannelKind; unit: string; still: number };

const BOX_CHANNELS: Channel[] = [
  { key: 'x', kind: 'x', unit: 'px', still: PIXEL_STILL },
  { key: 'y', kind: 'y', unit: 'px', still: PIXEL_STILL },
  { key: 'w', kind: 'w', unit: 'px', still: PIXEL_STILL },
  { key: 'h', kind: 'h', unit: 'px', still: PIXEL_STILL },
  { key: 'opacity', kind: 'opacity', unit: '', still: OPACITY_STILL },
];

type Box = { x: number[]; y: number[]; w: number[]; h: number[] };

/**
 * A stretch of a track inside first..last with no gap and one owner and attribution: its segments there, joined. A
 * phase change alone (a crossfade starting or ending) doesn't break a run, since the element's boxes carry straight
 * on through it; a gap, a new owner or a new attribution does, as those change what the numbers are measured against.
 */
type TrackRun = {
  from: number;
  to: number;
  phases: { phase: MotionSegment['phase']; from: number; to: number }[];
  attribution: MotionSegment['attribution'];
  screen: Box & { opacity: number[] };
  local: Box | null;
  values: Record<string, (number | null)[]>;
};

function trackRuns(track: MotionTrack, first: number, last: number): TrackRun[] {
  const runs: TrackRun[] = [];
  let parent: string | null = null;
  for (const seg of track.segments) {
    const from = Math.max(seg.start, first), to = Math.min(seg.end, last);
    if (from > to) continue;
    const slice = <T,>(xs: readonly T[]) => xs.slice(from - seg.start, to - seg.start + 1);
    const box = (b: Box): Box => ({ x: slice(b.x), y: slice(b.y), w: slice(b.w), h: slice(b.h) });
    const run = runs.at(-1);
    if (run && run.to + 1 === from && parent === seg.parent && run.attribution === seg.attribution) {
      const n = run.to - run.from + 1, m = to - from + 1;
      for (const k of ['x', 'y', 'w', 'h'] as const) {
        run.screen[k].push(...slice(seg.screen[k]));
        run.local?.[k].push(...slice(seg.local![k]));
      }
      run.screen.opacity.push(...slice(seg.screen.opacity));
      for (const name of new Set([...Object.keys(run.values), ...Object.keys(seg.values)])) {
        run.values[name] = [...(run.values[name] ?? Array(n).fill(null)), ...(seg.values[name] ? slice(seg.values[name]) : Array(m).fill(null))];
      }
      run.phases.push({ phase: seg.phase, from, to });
      run.to = to;
    } else {
      runs.push({
        from, to, phases: [{ phase: seg.phase, from, to }], attribution: seg.attribution,
        screen: { ...box(seg.screen), opacity: slice(seg.screen.opacity) }, local: seg.local && box(seg.local),
        values: Object.fromEntries(Object.entries(seg.values).map(([k, v]) => [k, slice(v)])),
      });
    }
    parent = seg.parent;
  }
  return runs;
}

function channelSeries(track: MotionTrack, channel: Channel, req: Pick<MotionGraphRequest, 'first' | 'last' | 'space'>): ChannelSeries {
  return trackRuns(track, req.first, req.last).flatMap((run) => {
    const box = req.space === 'screen' ? run.screen : run.local;
    const values = channel.kind === 'value' ? run.values[channel.key] : channel.kind === 'opacity' ? run.screen.opacity : box?.[channel.kind];
    const cut = { start: run.from === req.first ? 'stretch' : 'break', end: run.to === req.last ? 'stretch' : 'break' } as const;
    return values ? [{ start: run.from, values, cut }] : [];
  });
}

const valueChannelsOf = (tracks: readonly MotionTrack[]): Channel[] => [...new Set(tracks.flatMap((t) => t.segments.flatMap((s) => Object.keys(s.values))))]
  .toSorted().map((key) => ({ key, kind: 'value', unit: '', still: VALUE_STILL }));

/** Per-frame change below which a channel counts as still: a value's is relative to its size. */
function stillThreshold(channel: Channel, series: ChannelSeries) {
  if (channel.kind !== 'value') return channel.still;
  const scale = Math.max(1, ...series.flatMap((s) => s.values).map((v) => Math.abs(v ?? 0)));
  return channel.still * scale;
}

const changes = (series: ChannelSeries, still: number) => series.some(({ values }) => values.some((v, i) => i > 0 && v !== null && values[i - 1] !== null && Math.abs(v - values[i - 1]!) > still));

/** How much a track moves in the stretch, to rank tracks when none are picked: pixels travelled, plus sweeps of values. */
function motionAmount(track: MotionTrack, req: Pick<MotionGraphRequest, 'first' | 'last'>) {
  const travelled = (series: ChannelSeries) => series.reduce((sum, { values }) => sum + values.reduce<number>((s, v, i) => (i > 0 && v !== null && values[i - 1] !== null ? s + Math.abs(v - values[i - 1]!) : s), 0), 0);
  const screen = { ...req, space: 'screen' as const };
  const box = BOX_CHANNELS.filter((c) => c.kind !== 'opacity').reduce((s, c) => s + travelled(channelSeries(track, c, screen)), 0);
  // A reported value's travel is in its own units: count each full sweep of it like a 200px move, and an opacity fade like 50px.
  const values = valueChannelsOf([track]).reduce((s, c) => {
    const series = channelSeries(track, c, screen), all = series.flatMap((x) => x.values).filter((v) => v !== null);
    const range = Math.max(...all) - Math.min(...all);
    return range > 0 ? s + (200 * travelled(series)) / range : s;
  }, 0);
  return box + values + 50 * travelled(channelSeries(track, BOX_CHANNELS[4], screen));
}

export type GraphTrackChoice = { plotted: MotionTrack[]; unplotted: string[]; still: string[] };

/**
 * The tracks a graph plots: those matching `patterns` (an exact id, or any id containing it), or without patterns,
 * the ones that move most. A pattern matching nothing is an error naming what there is.
 */
export function chooseGraphTracks(motion: MotionTracks, req: Pick<MotionGraphRequest, 'first' | 'last' | 'tracks'>): GraphTrackChoice {
  const present = motion.tracks.filter((t) => trackRuns(t, req.first, req.last).length > 0);
  if (req.tracks?.length) {
    const plotted = present.filter((t) => req.tracks!.some((p) => t.id === p || t.id.includes(p)));
    for (const p of req.tracks) {
      if (!present.some((t) => t.id === p || t.id.includes(p))) throw new Error(`no track in this stretch matches "${p}": ${present.map((t) => t.id).join(', ') || 'nothing is tracked here'}`);
    }
    if (plotted.length > PALETTE.length) throw new Error(`${plotted.length} tracks match, and a graph tells ${PALETTE.length} apart: pick fewer (${plotted.map((t) => t.id).join(', ')})`);
    return { plotted, unplotted: [], still: [] };
  }
  const ranked = present.map((t) => ({ t, amount: motionAmount(t, req) })).toSorted((a, b) => b.amount - a.amount);
  const moving = ranked.filter((r) => r.amount > 0);
  return {
    plotted: moving.slice(0, DEFAULT_TRACK_COUNT).map((r) => r.t),
    unplotted: moving.slice(DEFAULT_TRACK_COUNT).map((r) => r.t.id),
    still: ranked.filter((r) => r.amount === 0).map((r) => r.t.id),
  };
}

/**
 * The frame trails are drawn over: where the most plotted tracks are visible, outside crossfades (where two scenes
 * blend) if it can be, and the latest of those, so the trails lead up to it.
 */
export function motionGraphBackdropFrame(motion: MotionTracks, timeline: TimelineReport, req: Pick<MotionGraphRequest, 'first' | 'last' | 'tracks'>): number {
  const runs = chooseGraphTracks(motion, req).plotted.map((t) => trackRuns(t, req.first, req.last));
  const blended = (f: number) => timeline.crossfades.some((c) => f / timeline.fps >= c.start && f / timeline.fps <= c.end);
  const visible = (f: number) => runs.filter((rs) => rs.some((r) => f >= r.from && f <= r.to && r.screen.opacity[f - r.from] > 0.1)).length;
  let best = req.last, score = -1;
  for (let f = req.last; f >= req.first; f--) {
    // Outside a crossfade first: in one, the outgoing scene's elements count as visible (their opacity holds at 1)
    // while the incoming scene covers them.
    const s = (blended(f) ? 0 : 1000) + visible(f);
    if (s > score) [best, score] = [f, s];
  }
  return best;
}

// ---------- moves ----------

/**
 * One stretch where a channel changes, pauses shorter than MOVE_GAP included. `start` is its last still frame and
 * `end` the frame it stops on, so a 0.5–1.5 s tween reads as 0.5–1.5 s.
 */
export type ChannelMove = {
  start: number;
  end: number;
  from: number;
  to: number;
  /** Largest signed change per second, and the frame it's at. */
  peak: { velocity: number; frame: number };
  /** How often the velocity changes sign: 0 for a move one way, more for a wobble or a jitter. */
  reversals: number;
  /** Its lowest and highest value: past `from` or `to` when it winds up, overshoots or swings. */
  range: [number, number];
  /**
   * How far it goes past `to` before coming back, in its units, and where it's furthest. Only for a swing smaller
   * than the travel and a few reversals: past that it's a wobble or a jitter, and `range` says how wide.
   */
  overshoot?: { by: number; frame: number };
  /** How far it first backs away from `to`, the way a wind-up does. */
  windup?: { by: number; frame: number };
  /** The frame from which it stays within LANDED_SHARE of its travel from `to`; `end` is when it's still. */
  landed: number;
  /** Set when the move touches a cut edge of its series: it may run on past it, so its start or end isn't its own. */
  cut?: { start?: EdgeCause; end?: EdgeCause };
};

/** The moves in a channel's series, one run at a time: nothing is inferred across a break. */
export function findChannelMoves(series: ChannelSeries, { fps, still }: { fps: number; still: number }): ChannelMove[] {
  const gap = Math.round(MOVE_GAP * fps);
  return series.flatMap(({ start, values, cut }) => {
    // Runs of frames that changed from the frame before, split wherever a sample is missing or the pause is long.
    const moved = values.map((v, i) => i > 0 && v !== null && values[i - 1] !== null && Math.abs(v - values[i - 1]!) > still);
    const spans: [number, number][] = [];
    moved.forEach((m, i) => {
      if (!m) return;
      const open = spans.at(-1);
      if (open && i - open[1] <= gap && values.slice(open[1], i).every((v) => v !== null)) open[1] = i;
      else spans.push([i - 1, i]);
    });
    const velocity = motionChannelVelocity(values, fps);
    return spans.map(([a, b]): ChannelMove => {
      const edges = { ...(a === 0 && cut?.start && { start: cut.start }), ...(b === values.length - 1 && cut?.end && { end: cut.end }) };
      const from = values[a]!, to = values[b]!, travel = to - from, dir = Math.sign(travel);
      let peak = { velocity: 0, frame: start + a }, reversals = 0, lastSign = 0;
      for (let i = a + 1; i <= b; i++) {
        const v = velocity[i]!;
        if (Math.abs(v) > Math.abs(peak.velocity)) peak = { velocity: v, frame: start + i };
        const sign = Math.abs(v) > still * fps ? Math.sign(v) : 0;
        if (sign && lastSign && sign !== lastSign) reversals++;
        if (sign) lastSign = sign;
      }
      const beyond = (sideOf: (v: number) => number) => {
        let best: { by: number; frame: number } | undefined;
        for (let i = a; i <= b; i++) {
          const by = sideOf(values[i]!);
          if (by > Math.max(still, LANDED_SHARE * Math.abs(travel)) && by > (best?.by ?? 0)) best = { by, frame: start + i };
        }
        return best;
      };
      const tolerance = Math.max(still, LANDED_SHARE * Math.abs(travel));
      let landed = b;
      while (landed > a && Math.abs(values[landed - 1]! - to) <= tolerance) landed--;
      const inMove = values.slice(a, b + 1) as number[];
      const overshoot = dir ? beyond((v) => (v - to) * dir) : undefined, windup = dir ? beyond((v) => (from - v) * dir) : undefined;
      // A swing as big as the travel, or back and forth more than a settling spring does, is a wobble or a jitter.
      const within = (x?: { by: number; frame: number }) => (x && x.by < Math.abs(travel) && reversals <= MAX_SETTLING_REVERSALS ? x : undefined);
      return {
        start: start + a, end: start + b, from, to, peak, reversals, range: [Math.min(...inMove), Math.max(...inMove)], landed: start + landed,
        ...(Object.keys(edges).length && { cut: edges }),
        overshoot: within(overshoot), windup: within(windup),
      };
    });
  }).map((m) => Object.fromEntries(Object.entries(m).filter(([, v]) => v !== undefined)) as ChannelMove);
}

// ---------- the number summary ----------

type Word = { text: string; start: number };

const wordsOf = (timeline: TimelineReport): Word[] => timeline.cues.flatMap((c) => c.words.map((w) => ({ text: w.text, start: w.start })));

/** The word spoken nearest `t`, within a second, said as "0.12s before "here" (4.20s)". */
function nearestWord(words: readonly Word[], t: number) {
  const w = words.reduce<Word | undefined>((best, x) => (!best || Math.abs(x.start - t) < Math.abs(best.start - t) ? x : best), undefined);
  if (!w || Math.abs(w.start - t) > 1) return '';
  const d = w.start - t, when = Math.abs(d) < 0.017 ? 'on' : `${Math.abs(d).toFixed(2)}s ${d > 0 ? 'before' : 'after'}`;
  return `, ${when} "${w.text}" (${w.start.toFixed(2)}s)`;
}

const fmt = (v: number, unit: string) => {
  if (v === 0) return `0${unit}`;
  const digits = Math.abs(v) >= 100 ? 0 : Math.abs(v) >= 10 ? 1 : Math.abs(v) >= 1 ? 2 : 3;
  return `${v.toFixed(digits)}${unit}`;
};
const signed = (v: number, unit: string) => `${v > 0 ? '+' : ''}${fmt(v, unit)}`;

const CUT_START = { stretch: 'already moving where the stretch starts', break: 'moving from its first frame' };
const CUT_END = { stretch: 'still moving where the stretch ends', break: 'still moving on its last frame' };

/**
 * One move as a line. A move cut off at an edge says so, and drops what that edge makes unknowable: at a cut end,
 * whether it overshoots or where it lands; at the stretch's edge, the word it started or stopped on. An element
 * appearing or vanishing mid-move did start or stop there, so its word stays.
 */
function describeMove(label: string, m: ChannelMove, unit: string, fps: number, words: readonly Word[]) {
  const s = (f: number) => `${(f / fps).toFixed(2)}s`;
  const rate = unit ? `${unit}/s` : '/s';
  const [lo, hi] = [Math.min(m.from, m.to), Math.max(m.from, m.to)], dir = Math.sign(m.to - m.from);
  // Past `to` or `from` without a reported overshoot or wind-up (too big to be one, or with no direction): a swing.
  const pastTo = dir > 0 ? m.range[1] > hi : dir < 0 ? m.range[0] < lo : m.range[0] < lo || m.range[1] > hi;
  const pastFrom = dir > 0 ? m.range[0] < lo : dir < 0 ? m.range[1] > hi : false;
  const settled = !m.cut?.end;
  const parts = [
    `${label.padEnd(8)} ${s(m.start)}–${s(m.end)}  ${fmt(m.from, unit)} → ${fmt(m.to, unit)} (${signed(m.to - m.from, unit)})`,
    ...(m.cut?.start ? [CUT_START[m.cut.start]] : []),
    ...(m.cut?.end ? [CUT_END[m.cut.end]] : []),
    `peak ${signed(m.peak.velocity, rate)} at ${s(m.peak.frame)}`,
    ...(m.reversals ? [`reverses ${m.reversals}×`] : []),
    ...(m.windup ? [`winds up ${fmt(m.windup.by, unit)} at ${s(m.windup.frame)}`] : []),
    ...(m.overshoot && settled ? [`overshoots ${fmt(m.overshoot.by, unit)} (${Math.round((100 * m.overshoot.by) / Math.abs(m.to - m.from || 1))}%) at ${s(m.overshoot.frame)}`] : []),
    ...((pastTo && !(m.overshoot && settled)) || (pastFrom && !m.windup) ? [`swings ${fmt(m.range[0], unit)}–${fmt(m.range[1], unit)}`] : []),
    ...(m.landed < m.end && settled ? [`within 1% by ${s(m.landed)}`] : []),
  ];
  const startWord = m.cut?.start === 'stretch' ? '' : nearestWord(words, m.start / fps).replace(/^, /, '; starts ');
  const stopWord = m.cut?.end === 'stretch' ? '' : nearestWord(words, m.end / fps).replace(/^, /, '; stops ');
  return `${parts.join(', ')}${startWord}${stopWord}`;
}

// ---------- drawing ----------

// Named, so the summary can say which line is which.
const PALETTE = [['blue', '#1f6fd1'], ['orange', '#d1451f'], ['green', '#1f9e5a'], ['purple', '#9b3fc4'], ['gold', '#c49a00'], ['teal', '#00a0b0']] as const;
const IMG_W = 1600, PAD = 24, PLOT_LEFT = 110, PLOT_RIGHT = IMG_W - PAD, PLOT_H = 96, PLOT_GAP = 30, MARK_LANE = 44;
const BACKDROP_W = 896;

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const text = (x: number, y: number, s: string, attrs = '') => `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" ${attrs}>${esc(s)}</text>`;

/** A nice step for gridlines over `span`, about `count` of them. */
function niceStep(span: number, count: number) {
  const raw = span / count, pow = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw)!;
}

type Plot = { title: string; unit: string; zero: boolean; lines: { track: number; dashed?: boolean; series: ChannelSeries }[] };

export type MotionGraph = { svg: string; width: number; height: number; summary: string[] };

/**
 * The graph of `req`'s stretch: trails over the backdrop frame, then one plot per channel that changes, with words
 * and crossfades marked across them; and the numbers, one line per move, for quoting.
 */
export function buildMotionGraph(motion: MotionTracks, timeline: TimelineReport, req: MotionGraphRequest): MotionGraph {
  const { fps } = motion, { first, last, space } = req;
  const sec = (f: number) => `${(f / fps).toFixed(2)}s`;
  const choice = chooseGraphTracks(motion, req);
  const tracks = choice.plotted;
  const words = wordsOf(timeline);
  const colour = (i: number) => PALETTE[i % PALETTE.length][1];

  // The summary, and the plots the same channels make.
  const summary = [
    `motion ${sec(first)}–${sec(last + 1)} (frames ${first}–${last} at ${fps} fps), ${space} boxes; ${tracks.length} track${tracks.length === 1 ? '' : 's'} plotted`,
  ];
  if (choice.unplotted.length) summary.push(`  not plotted, moving less (pick with --tracks): ${choice.unplotted.join(', ')}`);
  if (choice.still.length) summary.push(`  still throughout: ${choice.still.join(', ')}`);
  for (const e of motion.errors) summary.push(`  ✗ tracking${e.frames ? ` ${sec(e.frames.first)}–${sec(e.frames.last)}` : ''}: ${e.id ? `"${e.id}" ` : ''}${e.problem}`);
  for (const a of motion.coverage.ambiguous) summary.push(`  untracked ${sec(a.frames.first)}–${sec(a.frames.last)}: ${a.elements} elements share "${a.id}"`);
  const fades = timeline.crossfades.filter((c) => c.end * fps >= first && c.start * fps <= last);
  const cuts = timeline.scenes.filter((s) => !timeline.crossfades.some((c) => c.to === s.id) && s.start * fps > first && s.start * fps <= last);
  if (fades.length || cuts.length) {
    summary.push(`  scene changes: ${[...fades.map((c) => `${c.from} → ${c.to} crossfade ${c.start.toFixed(2)}–${c.end.toFixed(2)}s`), ...cuts.map((s) => `cut to ${s.id} at ${s.start.toFixed(2)}s`)].join('; ')}`);
  }

  const valueChannels = valueChannelsOf(tracks);
  const channelsOf = (kinds: ChannelKind[]) => [...BOX_CHANNELS, ...valueChannels].filter((c) => kinds.includes(c.kind));
  // A fade that sits inside a crossfade is the scene's, shared by everything in it, so it doesn't count as leading.
  const inCrossfade = (m: ChannelMove) => fades.some((c) => m.start >= Math.floor(c.start * fps) && m.end <= Math.ceil(c.end * fps));
  const firstMoves: { id: string; channel: string; frame: number }[] = [];
  tracks.forEach((track, ti) => {
    const runs = trackRuns(track, first, last);
    const phases = runs.flatMap((r) => r.phases).map((ph) => `${ph.phase} ${sec(ph.from)}–${sec(ph.to + 1)}`);
    const attribution = [...new Set(runs.map((r) => r.attribution))].join('/');
    const crossfaded = phases.length > 1 || runs[0].phases[0].phase !== 'solo';
    summary.push('', `${track.id} (${PALETTE[ti % PALETTE.length][0]})${track.kind ? ` ${track.kind}` : ''}, ${attribution}${crossfaded ? `; ${phases.join(', ')}` : ''}`);
    if (space === 'local' && runs.some((r) => r.local === null)) summary.push('  no local box where attribution is unknown: only opacity and values there');
    let quiet = true;
    for (const channel of [...BOX_CHANNELS, ...valueChannelsOf([track])]) {
      const series = channelSeries(track, channel, req);
      const moves = findChannelMoves(series, { fps, still: stillThreshold(channel, series) });
      if (moves.length) quiet = false;
      // A move already under way when the stretch starts can't be said to lead; one as the element appears can.
      const lead = moves.find((m) => m.cut?.start !== 'stretch' && (channel.kind !== 'opacity' || !inCrossfade(m)));
      if (lead) firstMoves.push({ id: track.id, channel: channel.key, frame: lead.start });
      for (const m of moves) summary.push(`  ${describeMove(channel.key, m, channel.unit, fps, words)}`);
    }
    if (quiet) {
      const held = (space === 'local' && runs[0].local) || runs[0].screen;
      summary.push(`  holds still at ${fmt(held.x[0], 'px')}, ${fmt(held.y[0], 'px')}`);
    }
  });
  if (new Set(firstMoves.map((m) => m.id)).size > 1) {
    const leads = new Map<string, { frame: number; channels: string[] }>();
    for (const m of firstMoves.toSorted((a, b) => a.frame - b.frame)) {
      const lead = leads.get(m.id);
      if (!lead) leads.set(m.id, { frame: m.frame, channels: [m.channel] });
      else if (lead.frame === m.frame) lead.channels.push(m.channel);
    }
    summary.push('', `first to move (crossfades aside): ${[...leads].map(([id, l]) => `${id} ${l.channels.join('+')} ${sec(l.frame)}`).join(', ')}`);
  }

  const lines = (kinds: ChannelKind[], transform?: (s: ChannelSeries) => ChannelSeries) => tracks.flatMap((track, ti) => kinds.flatMap((kind, ki) => channelsOf([kind]).map((channel) => {
    const series = channelSeries(track, channel, req);
    return { track: ti, dashed: ki > 0, series: transform ? transform(series) : series };
  })));
  const velocityOf = (s: ChannelSeries) => s.map(({ start, values }) => ({ start, values: motionChannelVelocity(values, fps) }));
  const moving = (kind: ChannelKind) => tracks.some((t) => channelsOf([kind]).some((c) => changes(channelSeries(t, c, req), c.still)));
  const plots: Plot[] = [
    ...(moving('x') ? [{ title: `x (${space}, px)`, unit: 'px', zero: false, lines: lines(['x']) }, { title: 'x velocity (px/s)', unit: 'px/s', zero: true, lines: lines(['x'], velocityOf) }] : []),
    ...(moving('y') ? [{ title: `y (${space}, px; down is +)`, unit: 'px', zero: false, lines: lines(['y']) }, { title: 'y velocity (px/s)', unit: 'px/s', zero: true, lines: lines(['y'], velocityOf) }] : []),
    ...(moving('w') || moving('h') ? [{ title: 'size (px): width solid, height dashed', unit: 'px', zero: false, lines: lines(['w', 'h']) }] : []),
    ...(moving('opacity') ? [{ title: 'opacity (with the crossfade)', unit: '', zero: false, lines: lines(['opacity']) }] : []),
    ...valueChannels.filter((c) => tracks.some((t) => { const s = channelSeries(t, c, req); return changes(s, stillThreshold(c, s)); })).map((c): Plot => ({
      title: `reported: ${c.key}`, unit: '', zero: false,
      lines: tracks.map((t, ti) => ({ track: ti, series: channelSeries(t, c, req) })),
    })),
  ];
  if (!plots.length) summary.push('', 'nothing moves in this stretch: no plots');

  // Layout: the backdrop and legend, then the mark lane, then the plots, then the time axis.
  const { width: W, height: H } = timeline;
  const backdropH = Math.round((BACKDROP_W * H) / W);
  const top = PAD + 30, plotsTop = top + backdropH + PAD + MARK_LANE;
  const height = plotsTop + plots.length * (PLOT_H + PLOT_GAP) + 30;
  const t0 = first / fps, t1 = Math.max(last, first + 1) / fps;
  const tx = (t: number) => PLOT_LEFT + ((t - t0) / (t1 - t0)) * (PLOT_RIGHT - PLOT_LEFT);
  const fx = (f: number) => tx(f / fps);
  const out: string[] = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${IMG_W}" height="${height}" font-family="Helvetica, Arial, sans-serif" font-size="13">`);
  out.push(`<rect width="${IMG_W}" height="${height}" fill="#fff"/>`);
  out.push(text(PAD, PAD + 14, `${timeline.title}: motion ${sec(first)}–${sec(last + 1)}, ${space} boxes`, 'font-size="18" font-weight="700" fill="#1c2733"'));

  // The backdrop, with each track's trail: a dot every trailStep seconds, so their spacing is speed.
  const scale = BACKDROP_W / W;
  out.push(`<image href="${req.backdrop.href}" x="${PAD}" y="${top}" width="${BACKDROP_W}" height="${backdropH}"/>`);
  out.push(`<rect x="${PAD}" y="${top}" width="${BACKDROP_W}" height="${backdropH}" fill="rgba(255,255,255,0.35)" stroke="#ccd"/>`);
  const every = Math.max(1, Math.round(req.trailStep * fps));
  const frameSized = (runs: TrackRun[]) => runs.every((r) => r.screen.w.every((w, i) => w * r.screen.h[i] >= 0.8 * W * H));
  const onBackdrop = (runs: TrackRun[]) => runs.some((r) => req.backdrop.frame >= r.from && req.backdrop.frame <= r.to);
  tracks.forEach((track, ti) => {
    const runs = trackRuns(track, first, last);
    // A trail only means something over a frame its element is on (another scene's would float over this one), and
    // for something smaller than the frame: a camera's centre is the frame's, and its motion is its values.
    if (!onBackdrop(runs) || frameSized(runs)) return;
    for (const { from, to, screen } of runs) {
      const at = (f: number) => ({ x: PAD + screen.x[f - from] * scale, y: top + screen.y[f - from] * scale });
      const frames: number[] = [];
      for (let f = first; f <= last; f += every) if (f >= from && f <= to) frames.push(f);
      const shown = req.backdrop.frame >= from && req.backdrop.frame <= to;
      if (shown && frames.at(-1) !== req.backdrop.frame) frames.push(req.backdrop.frame);
      const pts = frames.map(at);
      if (pts.length > 1) out.push(`<polyline points="${pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')}" fill="none" stroke="${colour(ti)}" stroke-width="1.5" opacity="0.7"/>`);
      for (const p of pts) out.push(`<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="3.5" fill="${colour(ti)}" stroke="#fff" stroke-width="1"/>`);
      // Its box on the frame shown.
      const i = req.backdrop.frame - from;
      if (shown) {
        const w = screen.w[i] * scale, h = screen.h[i] * scale;
        out.push(`<rect x="${(PAD + screen.x[i] * scale - w / 2).toFixed(1)}" y="${(top + screen.y[i] * scale - h / 2).toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" fill="none" stroke="${colour(ti)}" stroke-width="1.5" stroke-dasharray="4 3"/>`);
      }
    }
  });

  // The legend: what each colour is, and how to read the trails.
  const lx = PAD + BACKDROP_W + PAD;
  out.push(text(lx, top + 12, `frame shown: ${sec(req.backdrop.frame)}; trail dots every ${req.trailStep}s (close together = slow)`, 'fill="#556"'));
  tracks.forEach((track, ti) => {
    const y = top + 40 + ti * 24;
    out.push(`<rect x="${lx}" y="${y - 11}" width="14" height="14" rx="3" fill="${colour(ti)}"/>`);
    const label = `${track.id.length > 50 ? `${track.id.slice(0, 48)}…` : track.id}${!onBackdrop(trackRuns(track, first, last)) ? ' (not on this frame: no trail)' : frameSized(trackRuns(track, first, last)) ? ' (frame-sized: no trail)' : ''}`;
    out.push(text(lx + 22, y, label, 'fill="#1c2733"'));
  });
  const ly = top + 52 + tracks.length * 24;
  out.push(`<rect x="${lx}" y="${ly}" width="14" height="14" fill="#e3e8f5"/>`, text(lx + 22, ly + 11, 'crossfade', 'fill="#556"'));
  out.push(`<line x1="${lx + 110}" y1="${ly}" x2="${lx + 110}" y2="${ly + 14}" stroke="#b07000"/>`, text(lx + 118, ly + 11, 'word starts', 'fill="#556"'));
  out.push(`<line x1="${lx + 220}" y1="${ly}" x2="${lx + 220}" y2="${ly + 14}" stroke="#333" stroke-dasharray="3 3"/>`, text(lx + 228, ly + 11, 'cut / frame shown', 'fill="#556"'));
  if (choice.unplotted.length) out.push(text(lx, ly + 40, `${choice.unplotted.length} more moving track${choice.unplotted.length > 1 ? 's' : ''} not plotted: see the summary`, 'fill="#933"'));

  // Marks across the plot stack: crossfades shaded, cuts and the frame shown dashed, words ticked and labelled.
  const stackTop = plotsTop - 8, stackBottom = height - 30 - PLOT_GAP + 8;
  for (const c of fades) {
    const a = Math.max(PLOT_LEFT, tx(c.start)), b = Math.min(PLOT_RIGHT, tx(c.end));
    out.push(`<rect x="${a.toFixed(1)}" y="${stackTop - MARK_LANE + 8}" width="${Math.max(1, b - a).toFixed(1)}" height="${stackBottom - stackTop + MARK_LANE - 8}" fill="#e3e8f5"/>`);
    out.push(text(a + 3, stackTop - MARK_LANE + 20, `${c.from} → ${c.to}`, 'fill="#556" font-size="11"'));
  }
  for (const s of cuts) {
    out.push(`<line x1="${tx(s.start).toFixed(1)}" y1="${stackTop - MARK_LANE + 8}" x2="${tx(s.start).toFixed(1)}" y2="${stackBottom}" stroke="#333" stroke-dasharray="3 3"/>`);
    out.push(text(tx(s.start) + 3, stackTop - MARK_LANE + 20, `cut to ${s.id}`, 'fill="#333" font-size="11"'));
  }
  out.push(`<line x1="${fx(req.backdrop.frame).toFixed(1)}" y1="${stackTop}" x2="${fx(req.backdrop.frame).toFixed(1)}" y2="${stackBottom}" stroke="#333" stroke-dasharray="3 3" opacity="0.6"/>`);
  // Two rows of word labels, so close words still get one; a word with no room in either goes unlabelled.
  const labelEnds = [-Infinity, -Infinity];
  for (const w of words.filter((x) => x.start >= t0 && x.start <= t1)) {
    const x = tx(w.start), row = labelEnds.findIndex((end) => x > end);
    out.push(`<line x1="${x.toFixed(1)}" y1="${stackTop - 14}" x2="${x.toFixed(1)}" y2="${stackBottom}" stroke="#b07000" stroke-width="0.8" opacity="0.45"/>`);
    if (row < 0) continue;
    out.push(text(x + 2, stackTop - 18 + row * 11, w.text, 'fill="#b07000" font-size="11"'));
    labelEnds[row] = x + w.text.length * 6.6 + 6;
  }

  // The plots.
  plots.forEach((plot, pi) => {
    const y0 = plotsTop + pi * (PLOT_H + PLOT_GAP);
    // The scale fits what changes. A line that holds still far outside it (a camera's 1920px width beside a ring
    // growing 150 → 340) would flatten everything else, so it's named in the title instead of drawn.
    const valuesOf = (l: Plot['lines'][number]) => l.series.flatMap((s) => s.values).filter((v) => v !== null);
    const spreadOf = (vs: number[]) => Math.max(...vs) - Math.min(...vs);
    const changing = plot.lines.filter((l) => spreadOf(valuesOf(l)) > 0);
    const fitted = (changing.length ? changing : plot.lines).flatMap(valuesOf);
    let lo = Math.min(...fitted, ...(plot.zero ? [0] : [])), hi = Math.max(...fitted, ...(plot.zero ? [0] : []));
    const reach = Math.max(hi - lo, 1);
    const drawn = plot.lines.filter((l) => valuesOf(l).every((v) => v >= lo - reach && v <= hi + reach));
    const offScale = plot.lines.filter((l) => !drawn.includes(l) && valuesOf(l).length).map((l) => `${tracks[l.track].id} ${fmt(valuesOf(l)[0], plot.unit)}`);
    const shown = drawn.flatMap(valuesOf);
    [lo, hi] = [Math.min(lo, ...shown), Math.max(hi, ...shown)];
    if (hi - lo < 1e-9) [lo, hi] = [lo - 1, hi + 1];
    const pad = (hi - lo) * 0.08;
    [lo, hi] = [lo - pad, hi + pad];
    const ty = (v: number) => y0 + PLOT_H - ((v - lo) / (hi - lo)) * PLOT_H;
    out.push(`<rect x="${PLOT_LEFT}" y="${y0}" width="${PLOT_RIGHT - PLOT_LEFT}" height="${PLOT_H}" fill="none" stroke="#dde3ec"/>`);
    out.push(text(PLOT_LEFT + 4, y0 - 5, `${plot.title}${offScale.length ? `; held off scale: ${[...new Set(offScale)].join(', ')}` : ''}`, 'fill="#1c2733" font-weight="600"'));
    const step = niceStep(hi - lo, 3);
    for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) {
      out.push(`<line x1="${PLOT_LEFT}" y1="${ty(v).toFixed(1)}" x2="${PLOT_RIGHT}" y2="${ty(v).toFixed(1)}" stroke="${Math.abs(v) < step / 1e6 && plot.zero ? '#99a' : '#eef1f5'}"/>`);
      out.push(text(PLOT_LEFT - 6, ty(v) + 4, fmt(Math.abs(v) < step / 1e6 ? 0 : v, ''), 'fill="#667" text-anchor="end" font-size="11"'));
    }
    for (const l of drawn) {
      for (const s of l.series) {
        let d = '', pen = false;
        s.values.forEach((v, i) => {
          if (v === null) { pen = false; return; }
          d += `${pen ? 'L' : 'M'}${fx(s.start + i).toFixed(1)},${ty(v).toFixed(1)}`;
          pen = true;
        });
        if (d) out.push(`<path d="${d}" fill="none" stroke="${colour(l.track)}" stroke-width="1.8"${l.dashed ? ' stroke-dasharray="6 4"' : ''} stroke-linejoin="round"/>`);
      }
    }
  });

  // The time axis, under the last plot.
  const axisY = plotsTop + plots.length * (PLOT_H + PLOT_GAP) - PLOT_GAP + 16;
  const tstep = niceStep(t1 - t0, 12);
  for (let t = Math.ceil(t0 / tstep) * tstep; t <= t1 + 1e-9; t += tstep) {
    out.push(`<line x1="${tx(t).toFixed(1)}" y1="${stackTop}" x2="${tx(t).toFixed(1)}" y2="${axisY - 12}" stroke="#000" opacity="0.06"/>`);
    out.push(text(tx(t), axisY, `${Number(t.toFixed(2))}s`, 'fill="#556" text-anchor="middle" font-size="11"'));
  }
  out.push('</svg>');
  return { svg: out.join('\n'), width: IMG_W, height, summary };
}
