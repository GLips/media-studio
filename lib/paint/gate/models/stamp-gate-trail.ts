// stamp-gate-trail.ts: the gate's trail (shot/trail). A hand in six poses, each a drawing held two animation frames
// and lying a step further right with its fingers spread wider, read as a figure no plane places and drawn by trail
// over footage: the hand now and three ghosts a drawing apart, each fainter, while the camera pans. Its frames are
// drawn in turn and shuffled, on renderers of their own, and must match.

import { drawingSchedule } from '#lib/timing/drawings/models/drawing-schedule.ts';
import { scheduledSource } from '#lib/paint/shot/models/shot-props.ts';
import { paintKeyed } from '#lib/paint/animation/models/paint-keyed.ts';
import { paintCameraPlay } from '#lib/paint/animation/models/paint-camera.ts';
import type { LayerGroup, PaintingDocument } from '#lib/paint/document/models/painting-document.ts';
import type { PropertySchema, PropertyValues } from '#lib/paint/document/models/painting-properties.ts';
import { painting, type PaintingSourceModule } from '#lib/paint/document/models/painting-source.ts';
import { WATERCOLOUR_PIGMENTS } from '#lib/paint/materials/models/paint-watercolour-pigments.ts';
import type { PaintMoment } from '#lib/paint/painting/models/stamp-paint-frame-state.ts';
import { stampStage } from '#lib/paint/painting/models/stamp-stage.ts';
import { shotFigure, shotPlace } from '#lib/paint/shot/models/shot-figure.ts';
import { trail } from '#lib/paint/shot/models/shot-trail.ts';
import { stampGateFootagePlane } from './stamp-gate-figure-card.ts';
import { stampGateFrameDifference, stampGateFrameDifferenceText } from './stamp-gate-frames.ts';
import { stampGateHeronPaper, stampGateHeronPolygon } from './stamp-gate-paper-heron.ts';
import { STAMP_GATE_SHOT_FPS, type StampGateShot } from './stamp-gate-shot-span.ts';

const FRAME = { width: 240, height: 120 } as const;
/** The poses, how far right each lies past the one before, px, and the animation frames each drawing holds. */
const POSES = 6, STEP = 32, HOLD = 2, ANIMATION_FPS = 24;
/** The palm of pose 0, document px: each pose's lies STEP further right. */
const PALM = { x0: 20, y0: 62, x1: 42, y1: 96 } as const;
/** How far the camera pans over the trail's frames, px. */
const PAN = 60;

/** The frames drawn, in turn: every frame at the gate's fps while the six drawings show. */
export const STAMP_GATE_TRAIL_FRAMES: readonly number[] = Array.from({ length: Math.ceil((POSES * HOLD * STAMP_GATE_SHOT_FPS) / ANIMATION_FPS) }, (_, k) => k / STAMP_GATE_SHOT_FPS);
/** The same frames shuffled, a fixed order, so a frame never follows the one before it. */
export const STAMP_GATE_TRAIL_SHUFFLED: readonly number[] = [9, 2, 14, 5, 0, 11, 7, 3, 12, 1, 8, 13, 4, 10, 6].map((k) => STAMP_GATE_TRAIL_FRAMES[k]);
/** The frame the baseline shows: the last pose, its three ghosts behind it. */
export const STAMP_GATE_TRAIL_AT = STAMP_GATE_TRAIL_FRAMES.at(-1)!;

const handProperties = { pose: { type: 'number', unit: 'pose', min: 0, max: POSES - 1, step: 1, default: 0 } } as const satisfies PropertySchema;

const paint = (strength: number) => ({ kind: 'paint', mix: { parts: [{ pigment: WATERCOLOUR_PIGMENTS.burntSienna, amount: 1 }], strength }, water: 0.5 }) as const;

/** Pose `pose`'s hand: a palm and four fingers fanning wider each pose, on a figure card round them. */
function handLayer(pose: number): LayerGroup {
  const x0 = PALM.x0 + pose * STEP, x1 = PALM.x1 + pose * STEP, spread = 0.1 + 0.08 * pose;
  const fingers = [-1.5, -0.5, 0.5, 1.5].map((k, i) => {
    const root = { x: x0 + 3 + (i * (x1 - x0 - 6)) / 3, y: PALM.y0 + 2 }, angle = k * spread, length = 26 - Math.abs(k) * 4;
    return [root, { x: root.x + Math.sin(angle) * length, y: root.y - Math.cos(angle) * length }];
  });
  // The card hugs the hand: round the palm, then out past each fingertip.
  const tips = fingers.map(([, tip]) => tip), [left, , , right] = tips, rim = 4;
  const outline = stampGateHeronPolygon(
    x0 - rim, PALM.y1 + rim, x1 + rim, PALM.y1 + rim, x1 + rim, PALM.y0, right.x + rim, right.y - rim,
    tips[2].x, tips[2].y - rim, tips[1].x, tips[1].y - rim, left.x - rim, left.y - rim, x0 - rim, PALM.y0,
  );
  const paper = stampGateHeronPaper('#f3eee2', 1.43);
  return {
    key: 'hand', sheet: { kind: 'own', paper, card: { figure: outline, fadePx: 3 } },
    children: [{ key: 'hand-paint', washes: [{ key: 'hand-wash', applications: [
      { key: 'palm', kind: 'fill', area: { region: stampGateHeronPolygon(x0, PALM.y0, x1, PALM.y0, x1, PALM.y1, x0, PALM.y1) }, brush: { style: 'gate', brush: 'round' }, diameterPx: 8, seed: 'palm', charge: paint(0.8) },
      { key: 'fingers', kind: 'stroke', subpaths: fingers, brush: { style: 'gate', brush: 'round' }, diameterPx: 5, seed: 'fingers', charge: paint(0.8) },
    ] }] }],
  };
}

/** The hand at pose `pose`, alone on the root's sheet, which a figure leaves out. */
export const STAMP_GATE_TRAIL_HAND: PaintingSourceModule<typeof handProperties> = {
  properties: handProperties,
  default: ({ pose }: PropertyValues<typeof handProperties>): PaintingDocument => ({
    widthPx: FRAME.width, heightPx: FRAME.height, paper: { color: '#f4f2ed', absorbency: 0.5 }, medium: 'watercolour', layers: [handLayer(pose)],
  }),
};

/** The pose the hand holds at moment `m` (as its plane's drawing clock holds it): one a drawing, the last held on. */
const drawings = drawingSchedule({ fps: ANIMATION_FPS / HOLD });
const poseAt = ({ at }: PaintMoment) => Math.min(POSES - 1, Math.max(0, drawings.at(at).index));

/** The hand's figure, posed at each moment. */
const hand = () => scheduledSource(shotFigure((m) => painting(STAMP_GATE_TRAIL_HAND, { pose: poseAt(m) }), 'hand'), drawings);

/** The footage, and the hand drawn by trail (`trailed`) or placed alone, its source on its drawing clock, the camera panning. */
export function stampGateTrailShot(trailed = true): StampGateShot {
  // The stage holds what the pan brings in.
  const stage = stampStage(FRAME, PAN + 2), placing = { id: 'hand', depth: 1 } as const;
  const pan = paintKeyed([{ at: 0, value: { pan: { x: 0, y: 0 } } }, { at: STAMP_GATE_TRAIL_AT, value: { pan: { x: PAN, y: 0 } } }]);
  return {
    camera: { stage, fov: 35, lens: { bloom: 0, shutter: 'shut' }, animationFps: ANIMATION_FPS, plays: [paintCameraPlay({ kind: 'move', value: pan }, { clock: { at: 0 }, origin: 'the camera pans' })] },
    planes: [stampGateFootagePlane(stage), shotPlace(trailed ? trail(hand(), { count: 3, every: { drawings: 1 }, fade: 0.6 }) : hand(), placing)],
  };
}

/** The drawings frame `t` shows, the hand's and its ghosts': the drawing then and the three before it, none before the first. */
const drawingsShown = (t: number) => {
  const now = drawings.at(t).index;
  return [now, now - 1, now - 2, now - 3].filter((drawing) => drawing >= 0);
};

/**
 * The trail's frames, RGB bytes, and what each drawn in turn laid anew: drawn in turn, shuffled (in
 * STAMP_GATE_TRAIL_SHUFFLED's order), the first frame with the hand placed alone, and pictures laid anew (`picture
 * misses`) and sheets solved per frame drawn in turn.
 */
export type StampGateTrailFrames = {
  readonly inTurn: readonly ArrayLike<number>[]; readonly shuffled: readonly ArrayLike<number>[]; readonly alone: ArrayLike<number>;
  readonly laid: readonly number[]; readonly solved: readonly number[];
};

/** How far red stands above green, levels, for the sienna to read as palm: the footage and the card's paper stand below. */
const PALM_RED = 12;

/** Each palm along the palms' middle rows, right to left: where it stands now, and its red past green there, levels (fainter ghosts less). */
function palms(rgb: ArrayLike<number>) {
  const red = Array.from({ length: FRAME.width }, (_, x) => {
    let sum = 0;
    for (let y = PALM.y0 + 12; y < PALM.y1 - 6; y++) sum += rgb[(y * FRAME.width + x) * 3] - rgb[(y * FRAME.width + x) * 3 + 1];
    return sum / (PALM.y1 - 6 - PALM.y0 - 12);
  });
  const found: { x: number; red: number }[] = [];
  let start = -1;
  red.forEach((value, x) => {
    const inside = value > PALM_RED && x < red.length - 1;
    if (inside && start < 0) start = x;
    if (!inside && start >= 0) {
      const span = red.slice(start, x);
      if (x - start >= 6) found.push({ x: (start + x - 1) / 2, red: span.reduce((a, b) => a + b, 0) / span.length });
      start = -1;
    }
  });
  return found.toSorted((a, b) => b.x - a.x);
}

const f = (value: number) => value.toFixed(1);

/**
 * shot/trail: shuffled, every frame matches it drawn in turn; the first, before any earlier drawing, matches the hand
 * placed alone; a frame lays anew only the drawings no earlier frame showed, and solves no more; the last shows the
 * hand and three ghosts a step apart where the camera sees them now, each fainter.
 */
export function checkStampGateTrail({ inTurn, shuffled, alone, laid, solved }: StampGateTrailFrames) {
  const order = STAMP_GATE_TRAIL_SHUFFLED.map((t) => STAMP_GATE_TRAIL_FRAMES.indexOf(t));
  const apart = order.map((k, i) => stampGateFrameDifference(shuffled[i], inTurn[k])), worst = apart.reduce((a, b) => (b.max > a.max || (b.max === a.max && b.mean > a.mean) ? b : a));
  const first = stampGateFrameDifference(inTurn[0], alone), second = STAMP_GATE_TRAIL_FRAMES.findIndex((t) => drawingsShown(t).length === 2), early = palms(inTurn[second]).length;
  const fresh = STAMP_GATE_TRAIL_FRAMES.map((t, k) => drawingsShown(t).filter((drawing) => !STAMP_GATE_TRAIL_FRAMES.slice(0, k).some((before) => drawingsShown(before).includes(drawing))).length);
  const reuses = fresh.every((n, k) => laid[k] === n && solved[k] <= n);
  const found = palms(inTurn.at(-1)!), gaps = found.slice(1).map(({ x }, i) => found[i].x - x);
  return [
    {
      id: 'shot/trail: shuffled order', passed: worst.max === 0,
      detail: `drawn in a shuffled order, its ${order.length} frames lie at most ${stampGateFrameDifferenceText(worst)} from them drawn in turn (identical wanted)`,
    },
    {
      id: 'shot/trail: no ghost before the first drawing', passed: first.max === 0 && early === 2,
      detail: `its first frame lies ${stampGateFrameDifferenceText(first)} from the hand placed alone (identical wanted); frame ${second}, the second drawing's first, shows ${early} palms (2 wanted: the hand and the first drawing's ghost)`,
    },
    {
      id: 'shot/trail: held drawings reuse pictures', passed: reuses,
      detail: `drawn in turn, frames laid ${laid.join(', ')} pictures anew and solved ${solved.join(', ')} sheets (${fresh.join(', ')} wanted: the drawings no earlier frame showed)`,
    },
    {
      id: 'shot/trail: ghosts through the camera now, each fainter',
      passed: found.length === 4 && gaps.every((gap) => Math.abs(gap - STEP) <= 1.5) && found.every(({ red }, i) => i === 0 || red < found[i - 1].red),
      detail: `its last frame shows palms at x ${found.map(({ x }) => f(x)).join(', ')} (4 wanted, ${STEP} px apart as the camera stands now: the pan moves ${f(PAN / (STAMP_GATE_TRAIL_AT * ANIMATION_FPS / HOLD))} px a drawing), `
        + `their red standing ${found.map(({ red }) => f(red)).join(', ')} levels past their green (each less than the one before wanted)`,
    },
  ];
}
