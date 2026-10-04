// stamp-gate-shot-page.ts: the gate page's shots (stamp-gate-shots.ts), each compiled and drawn through the shot's
// renderer on a surface of its own with the gate's brushes and images, its frames read back: the rigged heron's grain,
// pieces and boil (test 6), the wet-contact foot posed by its rig, painted in and hidden (test 7), the rain's drops
// blurred along their own falls (test 5), a dissolve between two sheets over a dissolving back, a warmed span, and
// their baselines' frames.

import { paintingProblemsError } from '#lib/paint/document/models/painting-problem.ts';
import { createStampPaintCostTally, type StampPaintCosts, type StampPaintCostTally } from '#lib/paint/painting/models/stamp-paint-costs.ts';
import { compilePaintedShot } from '#lib/paint/shot/models/shot-compile.ts';
import type { PaintedShotProps } from '#lib/paint/shot/models/shot-props.ts';
import { createPaintedShotRenderer } from '#lib/paint/shot/studio/shot-renderer.ts';
import { gpuEachInTurn } from '#lib/platform/gpu/models/gpu-in-turn.ts';
import { STAMP_GATE_FRAME_TOLERANCE } from '../models/stamp-gate-frames.ts';
import type { StampGateWashCheck } from '../models/stamp-gate-layer.ts';
import { STAMP_GATE_HERON_MOVE, stampGateHighPass, stampGatePeakShift } from '../models/stamp-gate-paper-heron.ts';
import { STAMP_GATE_LONE_DROP_AT, STAMP_GATE_LONE_DROP_TRAVEL, STAMP_GATE_RAIN, stampGateLoneDropShot, stampGateRainShot } from '../models/stamp-gate-rain.ts';
import { STAMP_GATE_FAR_SHALLOWS, stampGateSheetBrushOf } from '../models/stamp-gate-sheets.ts';
import {
  STAMP_GATE_DISSOLVE_AT, STAMP_GATE_HERON_BOIL_AT, STAMP_GATE_HERON_NECKS, STAMP_GATE_HIDDEN_FOOT_AT, STAMP_GATE_PAINTING_IN_AT, STAMP_GATE_RIGGED_HERON_AT, STAMP_GATE_SHOT_CASE_IDS,
  STAMP_GATE_SHOT_FPS, STAMP_GATE_WARM, STAMP_GATE_WARMED_AT, STAMP_GATE_WET_CONTACT_AT, stampGateBoilingHeronShot, stampGateDifferenceBox, stampGateDissolveShot, stampGateFadeBetween,
  stampGateHiddenFootShot, stampGateReedSwung, stampGateRiggedHeronShot, stampGateRiggedHeronWindows, stampGateShallowsAloneShot, stampGateShotBaseline, stampGateWarmShot,
  stampGateWetContactPaintingInShot, stampGateWetContactShot, type StampGateShotCaseId, type StampGateShotId,
} from '../models/stamp-gate-shots.ts';
import { stampGateRgb, stampGateRgbBase64, withGateSurface } from './stamp-gate-page-surface.ts';
import { stampGateSheetImageUrl } from './stamp-gate-sheet-owner.ts';

/** What a gate shot's frames count into, `costs`, and what's called as they're drawn: `warmed` after the warm, `drawn` after each frame. */
type StampGateShotFramesWatch = { readonly costs?: StampPaintCostTally; readonly warmed?: () => void; readonly drawn?: () => void };

/**
 * `props`' frames at scene seconds `times`, in turn, each read back as RGBA bytes, once its warm span (if any) is
 * solved at STAMP_GATE_SHOT_FPS, in no scene.
 */
async function stampGateShotFrames(props: PaintedShotProps, times: readonly number[], { costs, warmed, drawn }: StampGateShotFramesWatch = {}): Promise<Uint8ClampedArray[]> {
  const { shot, problems } = compilePaintedShot(props, []);
  if (!shot) throw paintingProblemsError('stamp gate shot', problems);
  const { width, height } = shot.camera.stage.frame;
  return withGateSurface({ width, height }, stampGateSheetImageUrl, async (surface, frame) => {
    const renderer = await createPaintedShotRenderer(surface.owner, [surface], shot, { brushOf: stampGateSheetBrushOf, ...(costs && { costs }) });
    try {
      await renderer.warm({ fps: STAMP_GATE_SHOT_FPS, sceneDur: null });
      warmed?.();
      return await gpuEachInTurn(times, async (t) => {
        await renderer.draw(t, 'fast');
        await renderer.finish();
        const read = frame();
        drawn?.();
        return read;
      });
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
  const [atRest, atMoved, atPosed, atSwapped, atFaded, atHidden] = await stampGateShotFrames(stampGateRiggedHeronShot(), [rest, moved, posed, swapped, faded, hidden], { costs, drawn: () => taken.push(costs.take()) });
  const unriggedCosts = createStampPaintCostTally();
  await stampGateShotFrames(stampGateRiggedHeronShot(false), [rest], { costs: unriggedCosts });
  const boilCosts = createStampPaintCostTally(), boilTaken: StampPaintCosts[] = [];
  const [boiled, reboiled] = await stampGateShotFrames(stampGateBoilingHeronShot(), STAMP_GATE_HERON_BOIL_AT, { costs: boilCosts, drawn: () => boilTaken.push(boilCosts.take()) });
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
 * sheet/wet-contact through a shot (ENGINE test 7): its foot posed re-solves from the charge, the flood's checkpoint
 * and decisions reused. Painted in as it plays, its rig draws before the foot is painted and poses it once it is.
 * Hidden, the foot's paint goes, what its water did to the shallows stays, and nothing re-solves.
 */
export async function checkStampGateRiggedWetContact(): Promise<StampGateWashCheck[]> {
  const costs = createStampPaintCostTally(), { rest, posed } = STAMP_GATE_WET_CONTACT_AT;
  const taken: StampPaintCosts[] = [];
  await stampGateShotFrames(stampGateWetContactShot(), [rest, posed], { costs, drawn: () => taken.push(costs.take()) });
  const { counts, solves } = taken[1], hits = counts.get('checkpoint hits') ?? 0, reused = counts.get('decisions reused') ?? 0, resumed = solves.map(({ from }) => from).join(', ');
  const paintingIn = stampGateWetContactPaintingInShot(), inCosts = createStampPaintCostTally(), { unpainted, posed: painted } = STAMP_GATE_PAINTING_IN_AT;
  const [before, after] = await stampGateShotFrames(paintingIn, [unpainted, painted], { costs: inCosts });
  const width = paintingIn.camera.stage.frame.width, grown = stampGateDifferenceBox(stampGateRgb(before), stampGateRgb(after), width), { warnings } = inCosts.take();
  const hideCosts = createStampPaintCostTally(), hideTaken: StampPaintCosts[] = [], { shown, hidden } = STAMP_GATE_HIDDEN_FOOT_AT;
  const [withFoot, footHidden] = await stampGateShotFrames(stampGateHiddenFootShot(), [shown, hidden], { costs: hideCosts, drawn: () => hideTaken.push(hideCosts.take()) });
  const [alone] = await stampGateShotFrames(stampGateShallowsAloneShot(), [hidden]);
  const gone = stampGateDifferenceBox(stampGateRgb(withFoot), stampGateRgb(footHidden), width), left = stampGateDifferenceBox(stampGateRgb(alone), stampGateRgb(footHidden), width);
  const far = { x0: STAMP_GATE_FAR_SHALLOWS.x, y0: STAMP_GATE_FAR_SHALLOWS.y, x1: STAMP_GATE_FAR_SHALLOWS.x + STAMP_GATE_FAR_SHALLOWS.w, y1: STAMP_GATE_FAR_SHALLOWS.y + STAMP_GATE_FAR_SHALLOWS.h };
  const leftFar = !!left && left.x0 < far.x1 && left.x1 > far.x0 && left.y0 < far.y1 && left.y1 > far.y0, hideSolves = solvedText(hideTaken[1]);
  return [
    {
      id: 'sheet/wet-contact: foot hidden', passed: !!gone && !!left && !leftFar && !hideSolves.length,
      detail: `hidden, the foot's paint changed ${boxText(gone)}; against the shallows painted alone, its water left ${boxText(left)} in them (clear of ${boxText(far)} wanted); hiding solved ${hideSolves.join(', ') || 'nothing'}`,
    },
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

/** How far `wide` reaches past `narrow` on each side, px; null if either is. */
const spreadPast = (narrow: ReturnType<typeof stampGateDifferenceBox>, wide: ReturnType<typeof stampGateDifferenceBox>) =>
  narrow && wide && { left: narrow.x0 - wide.x0, right: wide.x1 - narrow.x1, top: narrow.y0 - wide.y0, bottom: wide.y1 - narrow.y1 };

/**
 * shot/rain (ENGINE test 5, the camera still): a lone drop out of focus spreads alike on every side; shutter open, it
 * blurs along its fall, longer than shut and no wider; keyed anew across the shutter, it draws as if shut; a frame
 * moving only drops solves nothing and lays no picture anew.
 */
async function checkStampGateRain(): Promise<StampGateWashCheck[]> {
  const loneDrop = async (kind: Parameters<typeof stampGateLoneDropShot>[0]) => stampGateRgb((await stampGateShotFrames(stampGateLoneDropShot(kind), [STAMP_GATE_LONE_DROP_AT]))[0]);
  const none = await loneDrop('none'), sharp = await loneDrop('sharp'), defocused = await loneDrop('defocused'), blurred = await loneDrop('blurred'), recycled = await loneDrop('recycled');
  const rain = stampGateRainShot(), { width } = rain.camera.stage.frame, costs = createStampPaintCostTally(), taken: StampPaintCosts[] = [];
  const [first, next] = await stampGateShotFrames(rain, [STAMP_GATE_RAIN.at.first, STAMP_GATE_RAIN.at.next], { costs, drawn: () => taken.push(costs.take()) });
  const [shut, soft, open, renewed] = [sharp, defocused, blurred, recycled].map((frame) => stampGateDifferenceBox(none, frame, width));
  const shutSize = boxSize(shut), openSize = boxSize(open), travel = STAMP_GATE_LONE_DROP_TRAVEL, spread = spreadPast(shut, soft);
  const renewedAsShut = !!shut && !!renewed && (['x0', 'x1', 'y0', 'y1'] as const).every((edge) => Math.abs(shut[edge] - renewed[edge]) <= 1);
  const spreadAlike = !!spread && Object.values(spread).every((px) => px > 0) && Math.abs(spread.top - spread.bottom) <= 1 && Math.abs(spread.left - spread.right) <= 1;
  const fell = stampGateDifferenceBox(stampGateRgb(first), stampGateRgb(next), width), nextSolves = solvedText(taken[1]), misses = taken[1].counts.get('picture misses') ?? 0;
  const warnings = taken.flatMap((each) => each.warnings);
  return [
    {
      id: 'shot/rain: defocus', passed: spreadAlike,
      detail: `out of focus, the still drop shows over ${boxText(soft)}; in focus, over ${boxText(shut)}${spread ? `: ${spread.left}, ${spread.right}, ${spread.top} and ${spread.bottom} px past it left, right, above and below` : ''} (more than 0 each, sides and ends within a px of each other wanted)`,
    },
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

/** A dissolve check: frame `between`, of `what` dissolving halfway, lying between its two `ends` in every channel they differ in. */
function dissolveHalfway(id: string, what: string, ends: readonly [Uint8ClampedArray, Uint8ClampedArray], between: Uint8ClampedArray): StampGateWashCheck {
  const lies = stampGateFadeBetween(stampGateRgb(ends[0]), stampGateRgb(between), stampGateRgb(ends[1]));
  return {
    id, passed: lies.outside <= STAMP_GATE_FRAME_TOLERANCE.max && lies.apart > 0 && lies.between === lies.apart,
    detail: `halfway, ${what} strays ${lies.outside} levels outside its two ends (${STAMP_GATE_FRAME_TOLERANCE.max} allowed), and lies between them in ${lies.between} of the ${lies.apart} channels they differ in`,
  };
}

/** What a frame's `costs` did anew: the sheets it solved and the pictures it laid. */
const dissolveDrawnAnew = (costs: StampPaintCosts) => ({ solved: solvedText(costs), misses: costs.counts.get('picture misses') ?? 0 });
const anewText = ({ solved, misses }: ReturnType<typeof dissolveDrawnAnew>) => `solved ${solved.join(', ') || 'nothing'} and laid ${misses} picture${misses === 1 ? '' : 's'} anew`;

/**
 * shot/dissolve: the heron dissolving between its two sheets lies, halfway, between its ends in every channel they
 * differ in, and so does the back dissolving under it, the heron hidden; drawn after their ends, neither halfway frame
 * solves anything or lays a picture anew, each end's kept.
 */
async function checkDissolve(): Promise<StampGateWashCheck[]> {
  const costs = createStampPaintCostTally(), taken: StampPaintCosts[] = [], { together, apart, half, inPond, alone, backHalf } = STAMP_GATE_DISSOLVE_AT;
  const times = [together, apart, half, inPond, alone, backHalf];
  const [atTogether, atApart, atHalf, atInPond, atAlone, atBackHalf] = await stampGateShotFrames(stampGateDissolveShot(), times, { costs, drawn: () => taken.push(costs.take()) });
  const anew = [taken[2], taken[5]].map(dissolveDrawnAnew);
  return [
    dissolveHalfway('shot/dissolve: halfway', 'the heron', [atTogether, atApart], atHalf),
    dissolveHalfway('shot/dissolve: back halfway', 'the back', [atInPond, atAlone], atBackHalf),
    {
      id: 'shot/dissolve: ends kept', passed: anew.every(({ solved, misses }) => !solved.length && misses === 0),
      detail: `drawn after their ends, the heron's halfway frame ${anewText(anew[0])}; the back's ${anewText(anew[1])}`,
    },
  ];
}

/**
 * shot/warm: the wet-contact shot painted in on sixes, its plane on threes flipping its foot's pose, its span warmed,
 * solves each pairing of its clocks' moments and keeps bytes; frames the warm skipped as pairing alike then solve
 * nothing, as they would were a clock the solve reads left out of the pairing.
 */
async function checkWarm(): Promise<StampGateWashCheck[]> {
  const costs = createStampPaintCostTally(), taken: StampPaintCosts[] = [];
  let warm: StampPaintCosts | null = null;
  await stampGateShotFrames(stampGateWarmShot(), STAMP_GATE_WARMED_AT, { costs, warmed: () => (warm = costs.take()), drawn: () => taken.push(costs.take()) });
  const { solves, bytesRetained } = warm!, drawnSolves = taken.flatMap(solvedText);
  return [{
    id: 'shot/warm: span solved', passed: solves.length > 0 && bytesRetained > 0 && !drawnSolves.length,
    detail: `warming ${STAMP_GATE_WARM.from}..${STAMP_GATE_WARM.to} s solved ${solves.length} sheet program${solves.length === 1 ? '' : 's'} and kept ${bytesRetained} bytes; the frames at ${STAMP_GATE_WARMED_AT.map((t) => t.toFixed(3)).join(' and ')} s then solved ${drawnSolves.join(', ') || 'nothing'}`,
  }];
}

/** Shot case `id`'s checks. */
export function checkStampGateShotCase(id: StampGateShotCaseId): Promise<StampGateWashCheck[]> {
  if (id === 'shot/rain') return checkStampGateRain();
  if (id === 'shot/dissolve') return checkDissolve();
  if (id === 'shot/warm') return checkWarm();
  throw new Error(`stamp gate: no shot case ${JSON.stringify(id)}; the gate has ${STAMP_GATE_SHOT_CASE_IDS.join(', ')}`);
}

/** Shot baseline `id`'s frame: RGB bytes row by row, in base64. */
export async function paintStampGateShot(id: StampGateShotId): Promise<string> {
  const { shot, at } = stampGateShotBaseline(id), [rgba] = await stampGateShotFrames(shot, [at]);
  return stampGateRgbBase64(rgba);
}
