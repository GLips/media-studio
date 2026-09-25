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

/** One mounted `<Sfx>` on one frame: the sound it would play and when it lands, in video seconds. */
export type SfxMark = { scene: string; at: number; request: SfxRequest; volume: number };
/** What an `<Sfx>` writes on its mark: when it lands as seconds from the frame it's on. */
export type SfxMarkAttr = { fromNow: number; request: SfxRequest; volume: number };

/**
 * - `click`, `key`: an `<Sfx>` playing a click or key (CursorPath, TakeCursor, a typed field);
 * - `placed`: any other `<Sfx>` a scene placed by hand;
 * - `scene`: the cut or the middle of the dissolve into scene `scene`;
 * - `camera-move`: a camera moving, landing on its fastest frame;
 * - `reveal`: a highlight, dialog, card or free-standing text arriving (fully drawn).
 */
export type SfxEventKind = 'click' | 'key' | 'placed' | 'scene' | 'camera-move' | 'reveal';

export type SfxEvent = {
  /** Stable across re-measures while the video keeps the same events, e.g. `click:speed:3`, `scene:stock`. */
  id: string;
  kind: SfxEventKind;
  scene: string;
  /** Video seconds where a sound marking it lands. */
  at: number;
  /** A camera move's or a dissolve's span, in video seconds. */
  from?: number;
  to?: number;
  /** A camera move that travels far: a big push or pan, which may take an accent. */
  big?: boolean;
  /** A scene change's place in the video (1 is the change into the second scene), so neighbours can be told apart. */
  index?: number;
  /** What was revealed or moved: its motion track id. */
  track?: string;
  /** A marked `<Sfx>`'s own sound and volume. */
  request?: SfxRequest;
  volume?: number;
};

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

const markKind = (request: SfxRequest): SfxEventKind => {
  const recipe = request.sound.split('.')[0];
  return recipe === 'click' ? 'click' : recipe === 'key' ? 'key' : 'placed';
};

/** Numbers events of a kind 1, 2, … in time order within their scene, into ids. */
function numbered(events: Omit<SfxEvent, 'id'>[], prefix: (e: Omit<SfxEvent, 'id'>) => string): SfxEvent[] {
  const counts = new Map<string, number>();
  return [...events].sort((a, b) => a.at - b.at).map((e) => {
    const key = prefix(e), n = (counts.get(key) ?? 0) + 1;
    counts.set(key, n);
    return { id: `${key}:${n}`, ...e };
  });
}

/** Every mounted `<Sfx>`, once: the same sound landing at the same moment on many frames is one event. */
function markEvents(marks: readonly SfxMark[]): SfxEvent[] {
  const unique = new Map<string, SfxMark>();
  for (const m of marks) unique.set(`${m.scene}|${JSON.stringify(m.request)}|${m.at.toFixed(4)}`, m);
  return numbered([...unique.values()].map(({ scene, at, request, volume }) => ({ kind: markKind(request), scene, at, request, volume })), (e) => `${e.kind}:${e.scene}`);
}

function sceneEvents(timeline: TimelineReport): SfxEvent[] {
  return timeline.scenes.slice(1).map((scene, i) => {
    const fade = timeline.crossfades.find((c) => c.to === scene.id);
    return { id: `scene:${scene.id}`, kind: 'scene' as const, scene: scene.id, at: scene.start, index: i + 1, ...(fade && { from: fade.start, to: fade.end }) };
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
      kind: 'camera-move' as const, scene: lead.scene, track: lead.track, big: lead.travel >= BIG_MOVE && lead.travel / ((lead.last - lead.first) / fps) >= BIG_MOVE_SPEED,
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
  return numbered(found, (e) => `reveal:${e.track}`);
}

/** Every event the video's picture and timeline give a sound to mark, in time order. */
export function sfxEventsFrom({ timeline, motion, marks }: { timeline: TimelineReport; motion: MotionTracks; marks: readonly SfxMark[] }): SfxEvent[] {
  // A tenth of a millisecond is past anything heard, and keeps cues.json readable.
  const round = (x: number | undefined) => x === undefined ? undefined : Math.round(x * 1e4) / 1e4;
  return [...markEvents(marks), ...sceneEvents(timeline), ...cameraMoveEvents(motion), ...revealEvents(motion)]
    .map((e) => ({ ...e, at: round(e.at)!, ...(e.from !== undefined && { from: round(e.from), to: round(e.to) }) }))
    .sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
}
