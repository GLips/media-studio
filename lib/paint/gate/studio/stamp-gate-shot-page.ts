// stamp-gate-shot-page.ts: the gate page's shots (stamp-gate-shots.ts), each compiled and drawn through the shot's
// renderer on a surface of its own with the gate's brushes and images, its frames read back: the rigged heron's grain
// and pieces (test 6), the wet-contact foot posed by its rig (test 7), and their baselines' frames.

import { paintingProblemsError } from '#lib/paint/document/models/painting-problem.ts';
import { createStampPaintCostTally, type StampPaintCosts, type StampPaintCostTally } from '#lib/paint/painting/models/stamp-paint-costs.ts';
import { compilePaintedShot } from '#lib/paint/shot/models/shot-compile.ts';
import type { PaintedShotProps } from '#lib/paint/shot/models/shot-props.ts';
import { createPaintedShotRenderer } from '#lib/paint/shot/studio/shot-renderer.ts';
import { STAMP_GATE_FRAME_TOLERANCE } from '../models/stamp-gate-frames.ts';
import type { StampGateWashCheck } from '../models/stamp-gate-layer.ts';
import { STAMP_GATE_HERON_MOVE, stampGateHighPass, stampGatePeakShift } from '../models/stamp-gate-paper-heron.ts';
import { stampGateSheetBrushOf } from '../models/stamp-gate-sheets.ts';
import {
  STAMP_GATE_HERON_NECKS, STAMP_GATE_RIGGED_HERON_AT, STAMP_GATE_WET_CONTACT_AT, stampGateDifferenceBox, stampGateFadeBetween, stampGateReedsAtRest, stampGateRiggedHeronShot, stampGateRiggedHeronWindows, stampGateShotBaseline, stampGateWetContactShot, type StampGateShotId,
} from '../models/stamp-gate-shots.ts';
import { stampGateRgb, stampGateRgbBase64, withGateSurface } from './stamp-gate-page-surface.ts';
import { stampGateSheetImageUrl } from './stamp-gate-sheet-owner.ts';

/** `props`' frames at scene seconds `times`, in turn, each read back as RGBA bytes; `drawn` called after each. */
async function stampGateShotFrames(props: PaintedShotProps, times: readonly number[], costs?: StampPaintCostTally, drawn?: () => void): Promise<Uint8ClampedArray[]> {
  const { shot, problems } = compilePaintedShot(props, []);
  if (!shot) throw paintingProblemsError('stamp gate shot', problems);
  const { width, height } = shot.camera.stage.frame;
  return withGateSurface({ width, height }, stampGateSheetImageUrl, async (surface, frame) => {
    const renderer = await createPaintedShotRenderer(surface.owner, [surface], shot, { brushOf: stampGateSheetBrushOf, ...(costs && { costs }) });
    try {
      return await times.reduce(async (before, t) => {
        const frames = await before;
        await renderer.draw(t, 'fast');
        await renderer.finish();
        frames.push(frame());
        drawn?.();
        return frames;
      }, Promise.resolve<Uint8ClampedArray[]>([]));
    } finally {
      renderer.dispose();
    }
  });
}

const shiftText = ({ x, y, r }: { x: number; y: number; r: number }) => `${x}, ${y} (r ${r.toFixed(3)})`;

/**
 * paper/heron through a shot (ENGINE test 6, its rig): its root moved, the body's grain stays and the wing's goes with
 * it; the reeds, drawn as pieces, recompose at rest to their sheet unrigged but at their edge (ENGINE 6.5); a neck
 * cel swap changes only the necks; the heron fades as one. Neither swap nor fade re-solves.
 */
export async function checkStampGateRiggedHeron(): Promise<StampGateWashCheck[]> {
  const id = 'paper/heron', { rest, moved, posed, swapped, faded, hidden } = STAMP_GATE_RIGGED_HERON_AT, costs = createStampPaintCostTally(), taken: StampPaintCosts[] = [];
  const [atRest, atMoved, atPosed, atSwapped, atFaded, atHidden] = await stampGateShotFrames(stampGateRiggedHeronShot(), [rest, moved, posed, swapped, faded, hidden], costs, () => taken.push(costs.take()));
  const [unrigged] = await stampGateShotFrames(stampGateRiggedHeronShot(false), [rest]);
  const { width, height } = stampGateRiggedHeronShot().camera.stage.frame, windows = stampGateRiggedHeronWindows(width, height);
  const [a, b] = [atRest, atMoved].map((rgba) => stampGateHighPass(Float32Array.from(rgba, (v) => v / 255), width, height));
  const body = stampGatePeakShift(a, b, windows.body), wing = stampGatePeakShift(a, b, windows.wing);
  const pieces = stampGateReedsAtRest(stampGateRgb(atRest), stampGateRgb(unrigged), width), warnings = taken.flatMap((each) => each.warnings);
  const swap = stampGateDifferenceBox(stampGateRgb(atPosed), stampGateRgb(atSwapped), width), swapSolves = taken[3].solves.map(({ program, from }) => `${program} from ${from}`);
  const necks = STAMP_GATE_HERON_NECKS, swapInside = !!swap && swap.x0 >= necks.x0 && swap.y0 >= necks.y0 && swap.x1 <= necks.x1 && swap.y1 <= necks.y1;
  const fade = stampGateFadeBetween(stampGateRgb(atSwapped), stampGateRgb(atFaded), stampGateRgb(atHidden));
  const fadeSolves = taken.slice(4).flatMap(({ solves }) => solves.map(({ program, from }) => `${program} from ${from}`));
  return [
    {
      id: `${id}: rigged grain`, passed: body.x === 0 && body.y === 0 && wing.x === STAMP_GATE_HERON_MOVE.x && wing.y === STAMP_GATE_HERON_MOVE.y,
      detail: `its root moved ${STAMP_GATE_HERON_MOVE.x}, ${STAMP_GATE_HERON_MOVE.y}: the paper inside the body's paint matches best at ${shiftText(body)} (0, 0 wanted), inside the wing's at ${shiftText(wing)}`,
    },
    {
      id: `${id}: pieces at rest`, passed: pieces.elsewhere <= STAMP_GATE_FRAME_TOLERANCE.max && !warnings.length,
      detail: `the reeds drawn as pieces at rest against unrigged differ by ${pieces.elsewhere} levels at most away from their edge (${STAMP_GATE_FRAME_TOLERANCE.max} allowed), ${pieces.edge} at it${warnings.length ? `; warned: ${warnings.join('; ')}` : ''}`,
    },
    {
      id: `${id}: cel swap`, passed: swapInside && !swapSolves.length,
      detail: `the lowered neck shown changed ${swap ? `x ${swap.x0}..${swap.x1}, y ${swap.y0}..${swap.y1}` : 'nothing'} (within x ${necks.x0}..${necks.x1}, y ${necks.y0}..${necks.y1} wanted) and solved ${swapSolves.join(', ') || 'nothing'}`,
    },
    {
      id: `${id}: group fade`, passed: fade.outside <= STAMP_GATE_FRAME_TOLERANCE.max && fade.apart > 0 && fade.between === fade.apart && !fadeSolves.length,
      detail: `the heron faded halfway strays ${fade.outside} levels outside it shown and hidden (${STAMP_GATE_FRAME_TOLERANCE.max} allowed), lies between them in ${fade.between} of the ${fade.apart} channels they differ in, and solved ${fadeSolves.join(', ') || 'nothing'}`,
    },
  ];
}

/**
 * sheet/wet-contact through a shot (ENGINE test 7, posed by its rig): the foot's part posed, its sheet re-solves from
 * the charge, the flood's checkpoint and decisions reused.
 */
export async function checkStampGateRiggedWetContact(): Promise<StampGateWashCheck> {
  const costs = createStampPaintCostTally(), { rest, posed } = STAMP_GATE_WET_CONTACT_AT;
  const taken: StampPaintCosts[] = [];
  await stampGateShotFrames(stampGateWetContactShot(), [rest, posed], costs, () => taken.push(costs.take()));
  const { counts, solves } = taken[1], hits = counts.get('checkpoint hits') ?? 0, reused = counts.get('decisions reused') ?? 0, resumed = solves.map(({ from }) => from).join(', ');
  return {
    id: 'sheet/wet-contact: rig posed', passed: hits === 1 && resumed === 'charge' && reused >= 1,
    detail: `the foot posed by its rig re-solved from ${resumed || 'nothing'}, ${hits} checkpoint hit, ${reused} decision${reused === 1 ? '' : 's'} reused`,
  };
}

/** Shot baseline `id`'s frame: RGB bytes row by row, in base64. */
export async function paintStampGateShot(id: StampGateShotId): Promise<string> {
  const { shot, at } = stampGateShotBaseline(id), [rgba] = await stampGateShotFrames(shot, [at]);
  return stampGateRgbBase64(rgba);
}
