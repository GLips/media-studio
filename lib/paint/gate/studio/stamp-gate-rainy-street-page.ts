// stamp-gate-rainy-street-page.ts: the gate page's rainy street (stamp-gate-rainy-street.ts, ENGINE test 5), drawn
// through the shot's renderer (stamp-gate-shot-frames.ts), its cost report read frame by frame: a warmed span costing
// nothing, the lamp's property step, the reflection unsolved until it fades in, a repeated pose, and the walker
// re-solving every frame while the street's prefix steps on sixes.

import type { StampPaintCosts } from '#lib/paint/painting/models/stamp-paint-costs.ts';
import type { PaintMoment } from '#lib/paint/painting/models/stamp-paint-frame-state.ts';
import { PAINT_ANIMATION_FPS } from '#lib/paint/painting/models/stamp-group-motion.ts';
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

/** The reflection's one application: where its plane's first solve starts. */
const REFLECTION_ENTRY = 'reflection-streak';

const hiddenSkipped = (costs: StampPaintCosts) => costs.counts.get('hidden solves skipped') ?? 0;

/**
 * Warmed over a span of one street hold, the walker still, frames in it moving only the camera, the rain, the sky's
 * `k` and the reflection's visibility evaluate nothing and solve nothing.
 */
async function checkWarmed(): Promise<StampGateWashCheck> {
  const shot = { ...stampGateRainyStreetShot(), warm: STAMP_GATE_RAINY_STREET_WARM }, { width } = shot.camera.stage.frame, times = STAMP_GATE_RAINY_STREET_AT.warmed;
  const { frames, costs, warm } = await stampGateShotFrames(shot, times);
  const evaluations = costs.reduce((sum, each) => sum + made(each), 0), solved = costs.flatMap(solvedFrom);
  const moved = stampGateDifferenceBox(stampGateRgb(frames[0]), stampGateRgb(frames.at(-1)!), width), box = moved && `x ${moved.x0}..${moved.x1}, y ${moved.y0}..${moved.y1}`;
  return {
    id: 'shot/rainy-street: warmed', passed: warm.solves.length > 0 && warm.bytes.kept > 0 && evaluations === 0 && !solved.length && !!moved,
    detail: `warming ${STAMP_GATE_RAINY_STREET_WARM.from}..${STAMP_GATE_RAINY_STREET_WARM.to} s solved ${warm.solves.length} sheet programs and kept ${warm.bytes.kept} bytes; its ${times.length} frames then changed ${box ?? 'nothing'}, made ${evaluations} evaluations and solved ${fromText(solved)} (0 and nothing wanted)`,
  };
}

/**
 * The lamp lit by its property step re-solves the street from the first entry the step changes, as the diff reads it.
 * The reflection, faded out the frame before, is skipped there, and solved first at the lamp's frame as it fades in.
 */
async function checkLampStep(): Promise<StampGateWashCheck[]> {
  const { costs } = await stampGateShotFrames(stampGateRainyStreetShot(), STAMP_GATE_RAINY_STREET_AT.lamp), step = stampGateRainyStreetLampStep();
  const [before, lit] = costs.map(solvedFrom), street = lit.filter((from) => from !== REFLECTION_ENTRY), [hiddenBefore, hiddenLit] = costs.map(hiddenSkipped);
  const reflected = (froms: readonly string[]) => froms.filter((from) => from === REFLECTION_ENTRY).length;
  return [{
    id: 'shot/rainy-street: lamp step', passed: street.length === 1 && street[0] === step,
    detail: `the frame the lamp lights at solved the street ${fromText(street)}; its diff's first changed entry on the street is ${step}`,
  }, {
    id: 'shot/rainy-street: hidden reflection', passed: hiddenBefore === 1 && reflected(before) === 0 && hiddenLit === 0 && reflected(lit) === 1,
    detail: `faded out, the frame before the lamp skipped ${hiddenBefore} hidden planes and solved the reflection ${reflected(before)} times (1 and 0 wanted); fading in at the lamp's, ${hiddenLit} and ${reflected(lit)} times (0 and 1 wanted)`,
  }];
}

/** The walker forward a step and back within one hold of the street's source: the pose it comes back to solves nothing. */
async function checkRepeatedPose(): Promise<StampGateWashCheck> {
  const { costs } = await stampGateShotFrames(stampGateRainyStreetShot(), STAMP_GATE_RAINY_STREET_AT.repeated), [, stepped, back] = costs.map(solvedFrom);
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
  const shot = stampGateRainyStreetShot(), heard: number[][] = [], street = shot.planes.find((plane) => plane.id === 'street');
  if (street?.kind === 'instanced' || typeof street?.source !== 'function') throw new Error("the rainy street's street plane reads its source by a callback");
  // The moments the street's source reads, by frame: none heard before the first frame begins.
  const { source } = street, listened = { ...street, source: (moment: PaintMoment) => (heard.at(-1)?.push(moment.at), source(moment)) };
  const planes = shot.planes.map((plane) => (plane === street ? listened : plane)), times = STAMP_GATE_RAINY_STREET_AT.walking;
  const { costs } = await stampGateShotFrames({ ...shot, planes }, times, () => heard.push([]));
  const read = heard.map((ats) => Array.from(new Set(ats)));
  const steps = read.flatMap((ats, i) => (i > 0 && ats.join() !== read[i - 1].join() ? [frameOf(times[i])] : []));
  const walkerSolves = costs.slice(1).map((frame) => solvedFrom(frame).filter((from) => from === WALKER_ENTRY).length);
  const sixes = steps.length === 2 && steps.every((frame) => frame % 6 === 0);
  return {
    id: 'shot/rainy-street: walking', passed: read.every((ats) => ats.length === 1) && sixes && walkerSolves.every((n) => n === 1),
    detail: `over frames ${frameOf(times[0])}..${frameOf(times.at(-1)!)} the street's source read ${read.map((ats) => ats.join('/')).join(', ')} s, a new moment at frames ${steps.join(' and ')} (two, each a sixth, wanted); after the first, each frame re-solved from ${WALKER_ENTRY} ${walkerSolves.join(', ')} times (once each wanted)`,
  };
}

/** The rainy street's checks. */
export async function checkStampGateRainyStreet(): Promise<StampGateWashCheck[]> {
  return [await checkWarmed(), ...(await checkLampStep()), await checkRepeatedPose(), await checkWalking()];
}
