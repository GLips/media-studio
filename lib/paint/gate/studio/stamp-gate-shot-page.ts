// stamp-gate-shot-page.ts: the gate page's shots (stamp-gate-shots.ts), each compiled and drawn through the shot's
// renderer on a surface of its own with the gate's brushes and images, its frames read back: the rigged heron's grain,
// pieces and boil (test 6), the wet-contact foot posed by its rig and painted in (test 7), the rain's drops blurred
// along their own falls (test 5), and their baselines' frames.

import { paintingProblemsError } from '#lib/paint/document/models/painting-problem.ts';
import { createStampPaintCostTally, type StampPaintCosts, type StampPaintCostTally } from '#lib/paint/painting/models/stamp-paint-costs.ts';
import { compilePaintedShot } from '#lib/paint/shot/models/shot-compile.ts';
import type { PaintedShotProps } from '#lib/paint/shot/models/shot-props.ts';
import { createPaintedShotRenderer } from '#lib/paint/shot/studio/shot-renderer.ts';
import { STAMP_GATE_FRAME_TOLERANCE } from '../models/stamp-gate-frames.ts';
import type { StampGateWashCheck } from '../models/stamp-gate-layer.ts';
import { STAMP_GATE_HERON_MOVE, stampGateHighPass, stampGatePeakShift } from '../models/stamp-gate-paper-heron.ts';
import { STAMP_GATE_LONE_DROP_AT, STAMP_GATE_LONE_DROP_TRAVEL, STAMP_GATE_RAIN, stampGateLoneDropShot, stampGateRainShot } from '../models/stamp-gate-rain.ts';
import { stampGateSheetBrushOf } from '../models/stamp-gate-sheets.ts';
import {
  STAMP_GATE_HERON_BOIL_AT, STAMP_GATE_HERON_NECKS, STAMP_GATE_PAINTING_IN_AT, STAMP_GATE_RIGGED_HERON_AT, STAMP_GATE_WET_CONTACT_AT, stampGateBoilingHeronShot, stampGateDifferenceBox, stampGateFadeBetween,
  stampGateReedSwung, stampGateRiggedHeronShot, stampGateRiggedHeronWindows, stampGateShotBaseline, stampGateWetContactPaintingInShot, stampGateWetContactShot, type StampGateShotCaseId,
  type StampGateShotId,
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
const solvedText = ({ solves }: StampPaintCosts) => solves.map(({ program, from }) => `${program} from ${from}`);
const boxText = (box: { x0: number; y0: number; x1: number; y1: number } | null) => (box ? `x ${box.x0}..${box.x1}, y ${box.y0}..${box.y1}` : 'nothing');

/**
 * paper/heron through a shot (ENGINE test 6, its rig): its root moved, the body's grain stays and the wing's goes; the
 * reeds, drawn as pieces (ENGINE 6.5), solve at rest as unrigged and swing when posed; a neck cel swap changes only
 * the necks; the heron fades as one; boiling, it wobbles each epoch. Neither swap, fade nor boil re-solves.
 */
export async function checkStampGateRiggedHeron(): Promise<StampGateWashCheck[]> {
  const id = 'paper/heron', { rest, moved, posed, swapped, faded, hidden } = STAMP_GATE_RIGGED_HERON_AT, costs = createStampPaintCostTally(), taken: StampPaintCosts[] = [];
  const [atRest, atMoved, atPosed, atSwapped, atFaded, atHidden] = await stampGateShotFrames(stampGateRiggedHeronShot(), [rest, moved, posed, swapped, faded, hidden], costs, () => taken.push(costs.take()));
  const unriggedCosts = createStampPaintCostTally();
  await stampGateShotFrames(stampGateRiggedHeronShot(false), [rest], unriggedCosts);
  const boilCosts = createStampPaintCostTally(), boilTaken: StampPaintCosts[] = [];
  const [boiled, reboiled] = await stampGateShotFrames(stampGateBoilingHeronShot(), STAMP_GATE_HERON_BOIL_AT, boilCosts, () => boilTaken.push(boilCosts.take()));
  const { width, height } = stampGateRiggedHeronShot().camera.stage.frame, windows = stampGateRiggedHeronWindows(width, height);
  const [a, b] = [atRest, atMoved].map((rgba) => stampGateHighPass(Float32Array.from(rgba, (v) => v / 255), width, height));
  const body = stampGatePeakShift(a, b, windows.body), wing = stampGatePeakShift(a, b, windows.wing);
  const riggedRest = solvedText(taken[0]).toSorted().join(', '), unriggedRest = solvedText(unriggedCosts.take()).toSorted().join(', ');
  const swung = stampGateReedSwung(stampGateRgb(atMoved), stampGateRgb(atPosed), width), warnings = taken.flatMap((each) => each.warnings);
  const swap = stampGateDifferenceBox(stampGateRgb(atPosed), stampGateRgb(atSwapped), width), swapSolves = solvedText(taken[3]);
  const necks = STAMP_GATE_HERON_NECKS, swapInside = !!swap && swap.x0 >= necks.x0 && swap.y0 >= necks.y0 && swap.x1 <= necks.x1 && swap.y1 <= necks.y1;
  const fade = stampGateFadeBetween(stampGateRgb(atSwapped), stampGateRgb(atFaded), stampGateRgb(atHidden));
  const fadeSolves = taken.slice(4).flatMap(solvedText);
  const boil = stampGateDifferenceBox(stampGateRgb(boiled), stampGateRgb(reboiled), width), boilSolves = solvedText(boilTaken[1]);
  return [
    {
      id: `${id}: rigged grain`, passed: body.x === 0 && body.y === 0 && wing.x === STAMP_GATE_HERON_MOVE.x && wing.y === STAMP_GATE_HERON_MOVE.y,
      detail: `its root moved ${STAMP_GATE_HERON_MOVE.x}, ${STAMP_GATE_HERON_MOVE.y}: the paper inside the body's paint matches best at ${shiftText(body)} (0, 0 wanted), inside the wing's at ${shiftText(wing)}`,
    },
    {
      id: `${id}: pieces at rest`, passed: riggedRest === unriggedRest && swung > 0 && !warnings.length,
      detail: `rigged, its rest frame solved ${riggedRest || 'nothing'} (unrigged, ${unriggedRest || 'nothing'}); the reed drawn as a piece and swung changed ${swung} texels of its paint at rest${warnings.length ? `; warned: ${warnings.join('; ')}` : ''}`,
    },
    {
      id: `${id}: cel swap`, passed: swapInside && !swapSolves.length,
      detail: `the lowered neck shown changed ${boxText(swap)} (within ${boxText(necks)} wanted) and solved ${swapSolves.join(', ') || 'nothing'}`,
    },
    {
      id: `${id}: group fade`, passed: fade.outside <= STAMP_GATE_FRAME_TOLERANCE.max && fade.apart > 0 && fade.between === fade.apart && !fadeSolves.length,
      detail: `the heron faded halfway strays ${fade.outside} levels outside it shown and hidden (${STAMP_GATE_FRAME_TOLERANCE.max} allowed), lies between them in ${fade.between} of the ${fade.apart} channels they differ in, and solved ${fadeSolves.join(', ') || 'nothing'}`,
    },
    {
      id: `${id}: boil`, passed: !!boil && !boilSolves.length,
      detail: `the heron boiling every frame changed ${boxText(boil)} at its next epoch, and solved ${boilSolves.join(', ') || 'nothing'} (its wobble moves finished paint)`,
    },
  ];
}

/**
 * sheet/wet-contact through a shot (ENGINE test 7, posed by its rig): the foot's part posed, its sheet re-solves from
 * the charge, the flood's checkpoint and decisions reused. Painted in as it plays, its rig, found over all its paint,
 * draws before the foot is painted and poses it once it is.
 */
export async function checkStampGateRiggedWetContact(): Promise<StampGateWashCheck[]> {
  const costs = createStampPaintCostTally(), { rest, posed } = STAMP_GATE_WET_CONTACT_AT;
  const taken: StampPaintCosts[] = [];
  await stampGateShotFrames(stampGateWetContactShot(), [rest, posed], costs, () => taken.push(costs.take()));
  const { counts, solves } = taken[1], hits = counts.get('checkpoint hits') ?? 0, reused = counts.get('decisions reused') ?? 0, resumed = solves.map(({ from }) => from).join(', ');
  const paintingIn = stampGateWetContactPaintingInShot(), inCosts = createStampPaintCostTally(), { unpainted, posed: painted } = STAMP_GATE_PAINTING_IN_AT;
  const [before, after] = await stampGateShotFrames(paintingIn, [unpainted, painted], inCosts);
  const grown = stampGateDifferenceBox(stampGateRgb(before), stampGateRgb(after), paintingIn.camera.stage.frame.width), { warnings } = inCosts.take();
  return [
    {
      id: 'sheet/wet-contact: rig posed', passed: hits === 1 && resumed === 'charge' && reused >= 1,
      detail: `the foot posed by its rig re-solved from ${resumed || 'nothing'}, ${hits} checkpoint hit, ${reused} decision${reused === 1 ? '' : 's'} reused`,
    },
    {
      id: 'sheet/wet-contact: rig painting in', passed: !!grown && !warnings.length,
      detail: `drawn at ${unpainted} s, its foot unpainted, and at ${painted} s, painted and posed: changed ${boxText(grown)}${warnings.length ? `; warned: ${warnings.join('; ')}` : ''}`,
    },
  ];
}

const boxSize = (box: ReturnType<typeof stampGateDifferenceBox>) => box && { w: box.x1 - box.x0, h: box.y1 - box.y0 };

/**
 * shot/rain (ENGINE test 5, the camera still): a lone drop under an open shutter blurs along its own fall, longer than
 * it's drawn shut and no wider; keyed anew across the shutter, it draws as if shut; and a frame of the rain that moves
 * only its drops solves nothing and lays no picture anew.
 */
async function checkStampGateRain(): Promise<StampGateWashCheck[]> {
  const loneDrop = async (kind: Parameters<typeof stampGateLoneDropShot>[0]) => stampGateRgb((await stampGateShotFrames(stampGateLoneDropShot(kind), [STAMP_GATE_LONE_DROP_AT]))[0]);
  const none = await loneDrop('none'), sharp = await loneDrop('sharp'), blurred = await loneDrop('blurred'), recycled = await loneDrop('recycled');
  const rain = stampGateRainShot(), { width } = rain.camera.stage.frame, costs = createStampPaintCostTally(), taken: StampPaintCosts[] = [];
  const [first, next] = await stampGateShotFrames(rain, [STAMP_GATE_RAIN.at.first, STAMP_GATE_RAIN.at.next], costs, () => taken.push(costs.take()));
  const [shut, open, renewed] = [sharp, blurred, recycled].map((frame) => stampGateDifferenceBox(none, frame, width));
  const shutSize = boxSize(shut), openSize = boxSize(open), travel = STAMP_GATE_LONE_DROP_TRAVEL;
  const renewedAsShut = !!shut && !!renewed && (['x0', 'x1', 'y0', 'y1'] as const).every((edge) => Math.abs(shut[edge] - renewed[edge]) <= 1);
  const fell = stampGateDifferenceBox(stampGateRgb(first), stampGateRgb(next), width), nextSolves = solvedText(taken[1]), misses = taken[1].counts.get('picture misses') ?? 0;
  const warnings = taken.flatMap((each) => each.warnings);
  return [
    {
      id: 'shot/rain: own blur', passed: !!shutSize && !!openSize && openSize.h >= shutSize.h + travel / 2 && Math.abs(openSize.w - shutSize.w) <= 2,
      detail: `falling ${travel} px while the shutter's open, the drop shows over ${boxText(open)}; shut, over ${boxText(shut)} (at least ${travel / 2} px longer and within 2 px as wide wanted)`,
    },
    {
      id: 'shot/rain: recycled key', passed: renewedAsShut,
      detail: `keyed anew across the open shutter, the drop shows over ${boxText(renewed)}; shut, over ${boxText(shut)} (within a px wanted)`,
    },
    {
      id: 'shot/rain: drops only', passed: !!fell && !nextSolves.length && misses === 0 && !warnings.length,
      detail: `a frame later the drops changed ${boxText(fell)}, solved ${nextSolves.join(', ') || 'nothing'} and laid ${misses} picture${misses === 1 ? '' : 's'} anew${warnings.length ? `; warned: ${warnings.join('; ')}` : ''}`,
    },
  ];
}

/** Shot case `id`'s checks. */
export async function checkStampGateShotCase(id: StampGateShotCaseId): Promise<StampGateWashCheck[]> {
  if (id === 'shot/rain') return checkStampGateRain();
  throw new Error(`stamp gate: no shot case ${JSON.stringify(id)}`);
}

/** Shot baseline `id`'s frame: RGB bytes row by row, in base64. */
export async function paintStampGateShot(id: StampGateShotId): Promise<string> {
  const { shot, at } = stampGateShotBaseline(id), [rgba] = await stampGateShotFrames(shot, [at]);
  return stampGateRgbBase64(rgba);
}
