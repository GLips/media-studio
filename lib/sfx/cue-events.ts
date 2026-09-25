// cue-events.ts: the moments in a rendered video a sound effect can mark, found from what `studio check` measured.
// Pure; lib/sfx/cues.ts drafts sounds onto them.
//
// - Clicks, keys and hand-placed sounds: every `<Sfx>` leaves a mark (lib/studio/sfx.tsx) that the probe reads on each
//   frame, so their times are exact, not rounded to a frame.
// - Scene changes and spoken words: timeline.json.
// - Camera moves and reveals: the motion tracks (lib/motion-tracks.ts), to the frame.

import type { MotionSegment, MotionTracks } from '../motion-tracks.ts';
import type { TimelineReport } from '../studio/Video.tsx';
import type { SfxRequest } from './library.ts';

/** The artifact the probe emits for each frame: the `<Sfx>` marks on it. */
export const sfxMarkArtifactName = (frame: number) => `sfx-${frame}.json`;

/**
 * What an `<Sfx>` marks: a `click` or `key` a library piece emits (CursorPath, TakeCursor), which a cue list plays
 * itself, or a sound a scene `placed` by hand, which always plays from the scene.
 */
export type SfxMarkedEvent = 'click' | 'key' | 'placed';

/** What an `<Sfx>` writes on its mark: when it lands as seconds from the frame it's on. */
export type SfxMarkAttr = { event: SfxMarkedEvent; fromNow: number; request: SfxRequest; volume: number };
/**
 * One mounted `<Sfx>` on one frame, landing `at` video seconds, in the scene it's mounted in. A sound on the video's
 * own clock (`VideoDef.sounds`) is in no scene: its event takes the scene it lands in.
 */
export type SfxMark = Omit<SfxMarkAttr, 'fromNow'> & { scene?: string; at: number };

/**
 * An event, identified as `click:speed:3` (the third click in scene speed), `scene:stock`, `move:sale:1` or
 * `reveal:<track>:1`, and landing `at` video seconds:
 * - `click`, `key`, `placed`: a marked `<Sfx>` (see SfxMarkedEvent), with its own sound and volume;
 * - `scene`: the cut into scene `scene`, or the middle of the dissolve into it (`dissolve`); `index` 1 is the change
 *   into the second scene, so neighbours can be told apart;
 * - `camera-move`: a camera moving from `from` to `to`, landing on its fastest frame; `big` if it travels far, fast;
 * - `reveal`: a highlight, dialog, card or free-standing text arriving (fully drawn).
 */
export type SfxEvent = { id: string; scene: string; at: number } & (
  | { kind: SfxMarkedEvent; request: SfxRequest; volume: number }
  | { kind: 'scene'; index: number; dissolve?: { from: number; to: number } }
  | { kind: 'camera-move'; track: string; from: number; to: number; big: boolean }
  | { kind: 'reveal'; track: string }
);
export type SfxEventKind = SfxEvent['kind'];
type Unnumbered = SfxEvent extends infer E ? (E extends SfxEvent ? Omit<E, 'id'> : never) : never;

// A camera is { cx, cy } in capture pixels and a zoom where 1 fits the capture's width to the frame. Captures are
// 1440 wide, which turns a pan into frame widths; it's only used to tell a big move from a nudge.
const CAPTURE_WIDTH = 1440;
/** Per-frame change (log zoom plus frame widths of pan) above which a camera counts as moving. */
const CAMERA_STILL = 0.0005;
/**
 * A move this far (log zoom plus frame widths) or more is big: a push of about 1.3×, or a quarter-frame pan. It must
 * also cover this much a second, so a slow drift under a title isn't one.
 */
const BIG_MOVE = 0.25;
const BIG_MOVE_SPEED = 0.25;
/** A camera that changes over fewer frames than this jumped (a cut inside a scene), rather than moved. */
const MIN_MOVE_FRAMES = 3;
/** Still frames a move may pause for and still be one move. */
const MOVE_PAUSE_FRAMES = 2;
/** A drawn value at or over this is arrived. */
const ARRIVED = 0.99;

/** A tenth of a millisecond is past anything heard, and keeps cues.json readable. */
export const roundSfxSeconds = (x: number) => Math.round(x * 1e4) / 1e4;

/** The part of an id before its number: events sharing it are numbered 1, 2, … in time order. */
export const sfxEventSeries = (id: string) => id.replace(/:\d+$/, '');

/** Numbers events of a series 1, 2, … in time order, into ids. */
function numbered(events: Unnumbered[], series: (e: Unnumbered) => string): SfxEvent[] {
  const counts = new Map<string, number>();
  return [...events].sort((a, b) => a.at - b.at).map((e) => {
    const key = series(e), n = (counts.get(key) ?? 0) + 1;
    counts.set(key, n);
    return { id: `${key}:${n}`, ...e } as SfxEvent;
  });
}

/** Every mounted `<Sfx>`, once: the same sound landing at the same moment on many frames is one event. */
function markEvents(marks: readonly SfxMark[], timeline: TimelineReport): SfxEvent[] {
  const landsIn = (at: number) => (timeline.scenes.findLast((s) => s.start <= at + 1e-6) ?? timeline.scenes[0]).id;
  const unique = new Map<string, SfxMark & { scene: string }>();
  for (const m of marks) {
    const scene = m.scene ?? landsIn(m.at);
    unique.set(`${scene}|${m.event}|${JSON.stringify(m.request)}|${m.at.toFixed(4)}`, { ...m, scene });
  }
  return numbered([...unique.values()].map(({ event, scene, at, request, volume }) => ({ kind: event, scene, at, request, volume })), (e) => `${e.kind}:${e.scene}`);
}

function sceneEvents(timeline: TimelineReport): SfxEvent[] {
  return timeline.scenes.slice(1).map((scene, i) => {
    const fade = timeline.crossfades.find((c) => c.to === scene.id);
    return { id: `scene:${scene.id}`, kind: 'scene' as const, scene: scene.id, at: scene.start, index: i + 1, ...(fade && { dissolve: { from: fade.start, to: fade.end } }) };
  });
}

type Move = { scene: string; track: string; first: number; last: number; peak: number; travel: number };

/** Each stretch a camera moves for, from frame to frame of its cx, cy and zoom. */
function cameraMoves(motion: MotionTracks): Move[] {
  const moves: Move[] = [];
  for (const track of motion.tracks.filter((t) => t.kind === 'camera')) {
    for (const s of track.segments) {
      const { cx, cy, zoom } = s.values;
      if (!cx || !cy || !zoom) continue;
      let current: Move | null = null, still = 0, peakStep = 0;
      for (let i = 1; i < cx.length; i++) {
        const [x0, y0, z0, x1, y1, z1] = [cx[i - 1], cy[i - 1], zoom[i - 1], cx[i], cy[i], zoom[i]];
        if ([x0, y0, z0, x1, y1, z1].some((v) => v === null)) continue;
        const step = Math.abs(Math.log(z1! / z0!)) + (Math.hypot(x1! - x0!, y1! - y0!) * z1!) / CAPTURE_WIDTH;
        if (step > CAMERA_STILL) {
          if (!current) [current, peakStep] = [{ scene: track.scene, track: track.id, first: s.start + i - 1, last: s.start + i, peak: s.start + i, travel: 0 }, 0];
          current.last = s.start + i;
          current.travel += step;
          if (step > peakStep) [peakStep, current.peak] = [step, s.start + i];
          still = 0;
        } else if (current && ++still > MOVE_PAUSE_FRAMES) {
          moves.push(current);
          current = null;
        }
      }
      if (current) moves.push(current);
    }
  }
  return moves;
}

/** Camera moves, with several cameras moving together (a split's two panels) as one move: the one that travels furthest. */
function cameraMoveEvents(motion: MotionTracks): SfxEvent[] {
  const fps = motion.fps, merged: Move[][] = [];
  for (const move of cameraMoves(motion).filter((m) => m.last - m.first >= MIN_MOVE_FRAMES).sort((a, b) => a.first - b.first)) {
    const group = merged.find((g) => g[0].scene === move.scene && g.some((m) => move.first <= m.last && m.first <= move.last));
    if (group) group.push(move);
    else merged.push([move]);
  }
  return numbered(merged.map((group) => {
    const lead = group.reduce((a, b) => (b.travel > a.travel ? b : a));
    return {
      kind: 'camera-move' as const, scene: lead.scene, track: lead.track,
      big: lead.travel >= BIG_MOVE && lead.travel / ((lead.last - lead.first) / fps) >= BIG_MOVE_SPEED,
      // A step is measured between two frames, so the fastest one lands halfway between them.
      at: (lead.peak - 0.5) / fps, from: Math.min(...group.map((m) => m.first)) / fps, to: Math.max(...group.map((m) => m.last)) / fps,
    };
  }), (e) => `move:${e.scene}`);
}

// A reveal is something arriving that the viewer is meant to look at. Tags (a panel's label), menus and section
// cards' insides come with their scene, whose change is its own event, so they aren't reveals.
const REVEALED_KINDS = new Set(['highlight', 'dialog', 'card', 'text']);

function arrival(s: MotionSegment): number | null {
  const channel = s.values.draw ?? s.values.k;
  if (!channel || s.phase !== 'solo' || s.attribution === 'group') return null;
  if ((channel[0] ?? 0) >= 0.5) return null;
  const i = channel.findIndex((v) => v !== null && v >= ARRIVED);
  return i < 0 ? null : s.start + i;
}

function revealEvents(motion: MotionTracks): SfxEvent[] {
  const found = motion.tracks.filter((t) => t.kind && REVEALED_KINDS.has(t.kind)).flatMap((track) => track.segments.flatMap((s) => {
    const frame = arrival(s);
    return frame === null ? [] : [{ kind: 'reveal' as const, scene: track.scene, track: track.id, at: frame / motion.fps }];
  }));
  return numbered(found, (e) => `reveal:${(e as { track: string }).track}`);
}

/** Every event the video's picture and timeline give a sound to mark, in time order. */
export function sfxEventsFrom({ timeline, motion, marks }: { timeline: TimelineReport; motion: MotionTracks; marks: readonly SfxMark[] }): SfxEvent[] {
  return [...markEvents(marks, timeline), ...sceneEvents(timeline), ...cameraMoveEvents(motion), ...revealEvents(motion)]
    .map((e): SfxEvent => {
      const at = roundSfxSeconds(e.at);
      if (e.kind === 'camera-move') return { ...e, at, from: roundSfxSeconds(e.from), to: roundSfxSeconds(e.to) };
      if (e.kind === 'scene' && e.dissolve) return { ...e, at, dissolve: { from: roundSfxSeconds(e.dissolve.from), to: roundSfxSeconds(e.dissolve.to) } };
      return { ...e, at };
    })
    .sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
}
