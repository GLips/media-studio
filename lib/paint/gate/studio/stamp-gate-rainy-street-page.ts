// stamp-gate-rainy-street-page.ts: the gate page's rainy street (stamp-gate-rainy-street.ts, ENGINE test 5), drawn
// through the shot's renderer (stamp-gate-shot-frames.ts), its cost report read frame by frame: a warmed span costing
// nothing, the lamp's property step, a repeated pose, and the walker re-solving every frame while the street's prefix
// steps on sixes.

import { createStampPaintCostTally, type StampPaintCosts } from '#lib/paint/painting/models/stamp-paint-costs.ts';
import type { PaintMoment } from '#lib/paint/painting/models/stamp-paint-frame-state.ts';
import { PAINT_ANIMATION_FPS } from '#lib/paint/painting/models/stamp-group-motion.ts';
import type { PaintedShotProps } from '#lib/paint/shot/models/shot-props.ts';
import type { StampGateWashCheck } from '../models/stamp-gate-layer.ts';
import { STAMP_GATE_RAINY_STREET_AT, STAMP_GATE_RAINY_STREET_WARM, stampGateRainyStreetLampStep, stampGateRainyStreetShot } from '../models/stamp-gate-rainy-street.ts';
import { stampGateDifferenceBox } from '../models/stamp-gate-shots.ts';
import { stampGateRgb } from './stamp-gate-page-surface.ts';
import { stampGateShotFrames } from './stamp-gate-shot-frames.ts';

/** Where each of a frame's solves started: the first entry it re-ran. */
const solvedFrom = ({ solves }: StampPaintCosts) => solves.map(({ from }) => from);
const fromText = (froms: readonly string[]) => (froms.length ? `from ${froms.join(', ')}` : 'nothing');
const made = (costs: StampPaintCosts) => costs.counts.get('evaluations made') ?? 0;

/** The 24 fps frame scene second `t` lies in. */
const frameOf = (t: number) => Math.round(t * PAINT_ANIMATION_FPS - 0.5);

/** The street's first application of the walker's: where a pose of it re-solves the sheet from. */
const WALKER_ENTRY = 'figure-body';

/** `shot` drawn at `times` once warmed (its span, if any): each frame's RGBA bytes and costs, and the warm's. */
async function rainyStreetFrames(shot: PaintedShotProps, times: readonly number[]) {
  const costs = createStampPaintCostTally(), taken: StampPaintCosts[] = [], warmed: StampPaintCosts[] = [];
  const frames = await stampGateShotFrames(shot, times, { costs, warmed: () => warmed.push(costs.take()), drawn: () => taken.push(costs.take()) });
  return { frames, taken, warm: warmed[0] };
}

/**
 * Warmed over a span of one street hold, the walker still, frames in it moving only the camera, the rain, the sky's
 * `k` and the reflection's visibility evaluate nothing and solve nothing.
 */
async function checkWarmed(): Promise<StampGateWashCheck> {
  const shot = { ...stampGateRainyStreetShot(), warm: STAMP_GATE_RAINY_STREET_WARM }, { width } = shot.camera.stage.frame, times = STAMP_GATE_RAINY_STREET_AT.warmed;
  const { frames, taken, warm } = await rainyStreetFrames(shot, times);
  const evaluations = taken.reduce((sum, costs) => sum + made(costs), 0), solved = taken.flatMap(solvedFrom);
  const moved = stampGateDifferenceBox(stampGateRgb(frames[0]), stampGateRgb(frames.at(-1)!), width), box = moved && `x ${moved.x0}..${moved.x1}, y ${moved.y0}..${moved.y1}`;
  return {
    id: 'shot/rainy-street: warmed', passed: warm.solves.length > 0 && warm.bytesRetained > 0 && evaluations === 0 && !solved.length && !!moved,
    detail: `warming ${STAMP_GATE_RAINY_STREET_WARM.from}..${STAMP_GATE_RAINY_STREET_WARM.to} s solved ${warm.solves.length} sheet programs and kept ${warm.bytesRetained} bytes; its ${times.length} frames then changed ${box ?? 'nothing'}, made ${evaluations} evaluations and solved ${fromText(solved)} (0 and nothing wanted)`,
  };
}

/** The lamp lit by its property step re-solves the street from the first entry the step changes, as the diff reads it. */
async function checkLampStep(): Promise<StampGateWashCheck> {
  const { taken } = await rainyStreetFrames(stampGateRainyStreetShot(), STAMP_GATE_RAINY_STREET_AT.lamp), lit = solvedFrom(taken[1]), step = stampGateRainyStreetLampStep();
  return {
    id: 'shot/rainy-street: lamp step', passed: lit.length === 1 && lit[0] === step,
    detail: `the frame the lamp lights at solved ${fromText(lit)}; its diff's first changed entry on the street is ${step}`,
  };
}

/** The walker forward a step and back within one hold of the street's source: the pose it comes back to solves nothing. */
async function checkRepeatedPose(): Promise<StampGateWashCheck> {
  const { taken } = await rainyStreetFrames(stampGateRainyStreetShot(), STAMP_GATE_RAINY_STREET_AT.repeated), [, stepped, back] = taken.map(solvedFrom);
  return {
    id: 'shot/rainy-street: repeated pose', passed: stepped.length === 1 && stepped[0] === WALKER_ENTRY && !back.length,
    detail: `the walker a step on solved ${fromText(stepped)} (from ${WALKER_ENTRY} wanted); back where it was, ${fromText(back)}`,
  };
}

/**
 * The walker crossing the puddle with the street's source on sixes and its clock unheld: the street's source reads a
 * new moment, so a new prefix, every sixth frame, and its walker re-solves every frame.
 */
async function checkWalking(): Promise<StampGateWashCheck> {
  const shot = stampGateRainyStreetShot(), heard: number[][] = [[]], street = shot.planes.find((plane) => plane.id === 'street');
  if (street?.kind === 'instanced' || typeof street?.source !== 'function') throw new Error("the rainy street's street plane reads its source by a callback");
  const { source } = street, listened = { ...street, source: (moment: PaintMoment) => (heard.at(-1)!.push(moment.at), source(moment)) };
  const costs = createStampPaintCostTally(), taken: StampPaintCosts[] = [], planes = shot.planes.map((plane) => (plane === street ? listened : plane));
  await stampGateShotFrames({ ...shot, planes }, STAMP_GATE_RAINY_STREET_AT.walking, { costs, warmed: () => heard.push([]), drawn: () => (taken.push(costs.take()), heard.push([])) });
  const read = heard.slice(1, -1).map((ats) => Array.from(new Set(ats)));
  const steps = read.flatMap((ats, i) => (i > 0 && ats.join() !== read[i - 1].join() ? [frameOf(STAMP_GATE_RAINY_STREET_AT.walking[i])] : []));
  const walkerSolves = taken.slice(1).map((frame) => solvedFrom(frame).filter((from) => from === WALKER_ENTRY).length);
  const sixes = steps.length === 2 && steps.every((frame) => frame % 6 === 0);
  return {
    id: 'shot/rainy-street: walking', passed: read.every((ats) => ats.length === 1) && sixes && walkerSolves.every((n) => n === 1),
    detail: `over frames ${frameOf(STAMP_GATE_RAINY_STREET_AT.walking[0])}..${frameOf(STAMP_GATE_RAINY_STREET_AT.walking.at(-1)!)} the street's source read ${read.map((ats) => ats.join('/')).join(', ')} s, a new moment at frames ${steps.join(' and ')} (two, each a sixth, wanted); after the first, each frame re-solved from ${WALKER_ENTRY} ${walkerSolves.join(', ')} times (once each wanted)`,
  };
}

/** The rainy street's checks. */
export async function checkStampGateRainyStreet(): Promise<StampGateWashCheck[]> {
  return [await checkWarmed(), await checkLampStep(), await checkRepeatedPose(), await checkWalking()];
}
