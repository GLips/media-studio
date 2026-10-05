// stamp-gate-shot-page.ts: the gate page's shots (stamp-gate-shots.ts), drawn by stamp-gate-shot-frames.ts: the
// rigged heron's grain, pieces and boil (test 6), the wet-contact foot posed by its rig, painted in and hidden (test
// 7), the rain's drops blurred along their own falls (test 5), a plane blurred by the film's shutter unless shut, a
// dissolve between two sheets over a dissolving back,
// the rigged heron posed as it dissolves, a warmed span, the cut-out cards, the sprig drawn as pieces, and their
// baselines' frames. The masked shot's cases are stamp-gate-shot-masks-page.ts's, the rainy street's
// stamp-gate-rainy-street-page.ts's and the glowing shot's stamp-gate-shot-glow-page.ts's, handed on.

import type { StampPaintCosts } from '#lib/paint/painting/models/stamp-paint-costs.ts';
import { STAMP_GATE_CARDS_AT, STAMP_GATE_CARDS_POSED_AT, stampGateCardsPosedShot, stampGateCardsShot } from '../models/stamp-gate-cards.ts';
import { STAMP_GATE_FRAME_TOLERANCE, stampGateFrameDifference, stampGateFrameDifferenceText, stampGateFramePasses } from '../models/stamp-gate-frames.ts';
import type { StampGateWashCheck } from '../models/stamp-gate-layer.ts';
import { STAMP_GATE_HERON_MOVE, stampGateHighPass, stampGatePeakShift } from '../models/stamp-gate-paper-heron.ts';
import { STAMP_GATE_PIECES_AT, stampGatePiecesFlatShot, stampGatePiecesShot } from '../models/stamp-gate-pieces.ts';
import { paintFilmShutter } from '#lib/paint/animation/models/paint-camera.ts';
import {
  STAMP_GATE_LONE_DROP_AT, STAMP_GATE_LONE_DROP_TRAVEL, STAMP_GATE_RAIN, STAMP_GATE_SLIDING_POST, stampGateLoneDropShot, stampGateRainShot, stampGateSlidingPostShot,
} from '../models/stamp-gate-rain.ts';
import { STAMP_GATE_FAR_SHALLOWS } from '../models/stamp-gate-sheets.ts';
import {
  STAMP_GATE_DISSOLVE_AT, STAMP_GATE_HERON_BOIL_AT, STAMP_GATE_HERON_NECKS, STAMP_GATE_HIDDEN_FOOT_AT, STAMP_GATE_PAINTING_IN_AT, STAMP_GATE_RIGGED_DISSOLVE_AT,
  STAMP_GATE_RIGGED_HERON_AT, STAMP_GATE_SHOT_FPS, STAMP_GATE_WARM, STAMP_GATE_WARMED_AT, STAMP_GATE_WET_CONTACT_AT, stampGateBoilingHeronShot, stampGateDifferenceBox, stampGateDissolveShot,
  stampGateFadeBetween, stampGateFadeLiesBetween, stampGateHiddenFootShot, stampGateReedSwung, stampGateRiggedDissolveShot, stampGateRiggedDissolveSources,
  stampGateRiggedHeronShot, stampGateRiggedHeronWindows, stampGateShallowsAloneShot, stampGateShotBaseline, stampGateWarmShot, stampGateWetContactPaintingInShot,
  stampGateWetContactShot, type StampGateShotCaseId, type StampGateShotId,
} from '../models/stamp-gate-shots.ts';
import { stampGateRgb, stampGateRgbBase64 } from './stamp-gate-page-surface.ts';
import { stampGateShotFrames, stampGateSolvedText as solvedText } from './stamp-gate-shot-frames.ts';
import { checkStampGateRainyStreet } from './stamp-gate-rainy-street-page.ts';
import { checkStampGateShotGlowCase } from './stamp-gate-shot-glow-page.ts';
import { checkStampGateShotMasksCase } from './stamp-gate-shot-masks-page.ts';

const shiftText = ({ x, y, r }: { x: number; y: number; r: number }) => `${x}, ${y} (r ${r.toFixed(3)})`;
const boxText = (box: { x0: number; y0: number; x1: number; y1: number } | null) => (box ? `x ${box.x0}..${box.x1}, y ${box.y0}..${box.y1}` : 'nothing');

/**
 * paper/heron through a shot (ENGINE test 6, its rig): its root moved, the body's grain stays and the wing's goes; the
 * reeds, drawn as pieces (ENGINE 6.5), solve at rest as unrigged and swing when posed; a neck cel swap changes only
 * the necks; the heron fades as one; boiling, it wobbles each epoch. Neither swap, fade nor boil re-solves.
 */
export async function checkStampGateRiggedHeron(): Promise<StampGateWashCheck[]> {
  const id = 'paper/heron', { rest, moved, posed, swapped, faded, hidden } = STAMP_GATE_RIGGED_HERON_AT;
  const { frames: [atRest, atMoved, atPosed, atSwapped, atFaded, atHidden], costs: taken } = await stampGateShotFrames(stampGateRiggedHeronShot(), [rest, moved, posed, swapped, faded, hidden]);
  const { costs: [unrigged] } = await stampGateShotFrames(stampGateRiggedHeronShot(false), [rest]);
  const { frames: [boiled, reboiled], costs: boilTaken } = await stampGateShotFrames(stampGateBoilingHeronShot(), STAMP_GATE_HERON_BOIL_AT);
  const { width, height } = stampGateRiggedHeronShot().camera.stage.frame, windows = stampGateRiggedHeronWindows(width, height);
  const [a, b] = [atRest, atMoved].map((rgba) => stampGateHighPass(Float32Array.from(rgba, (v) => v / 255), width, height));
  const body = stampGatePeakShift(a, b, windows.body), wing = stampGatePeakShift(a, b, windows.wing);
  const riggedRest = solvedText(taken[0]).toSorted().join(', '), unriggedRest = solvedText(unrigged).toSorted().join(', ');
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
      id: `${id}: group fade`, passed: stampGateFadeLiesBetween(fade) && !fadeSolves.length,
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
  const { rest, posed } = STAMP_GATE_WET_CONTACT_AT, { costs: [, posedCosts] } = await stampGateShotFrames(stampGateWetContactShot(), [rest, posed]);
  const { counts, solves } = posedCosts, hits = counts.get('checkpoint hits') ?? 0, reused = counts.get('decisions reused') ?? 0, resumed = solves.map(({ from }) => from).join(', ');
  const paintingIn = stampGateWetContactPaintingInShot(), { unpainted, posed: painted } = STAMP_GATE_PAINTING_IN_AT;
  const { frames: [before, after], costs: inCosts, warm: inWarm } = await stampGateShotFrames(paintingIn, [unpainted, painted]);
  const width = paintingIn.camera.stage.frame.width, grown = stampGateDifferenceBox(stampGateRgb(before), stampGateRgb(after), width);
  const warnings = [inWarm, ...inCosts].flatMap((each) => each.warnings), { shown, hidden } = STAMP_GATE_HIDDEN_FOOT_AT;
  const { frames: [withFoot, footHidden], costs: hideTaken } = await stampGateShotFrames(stampGateHiddenFootShot(), [shown, hidden]);
  const { frames: [alone] } = await stampGateShotFrames(stampGateShallowsAloneShot(), [hidden]);
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

/** The lone drop shot of `kind`, its one frame as RGB bytes. */
const loneDropFrame = async (kind: Parameters<typeof stampGateLoneDropShot>[0]) => stampGateRgb((await stampGateShotFrames(stampGateLoneDropShot(kind), [STAMP_GATE_LONE_DROP_AT])).frames[0]);

/**
 * shot/rain (ENGINE test 5, the camera still): a lone drop out of focus spreads alike on every side; shutter open, it
 * blurs along its fall, longer than shut and no wider; keyed anew across the shutter, it draws as if shut; a frame
 * moving only drops solves nothing and lays no picture anew.
 */
async function checkStampGateRain(): Promise<StampGateWashCheck[]> {
  const none = await loneDropFrame('none'), sharp = await loneDropFrame('sharp'), defocused = await loneDropFrame('defocused'), blurred = await loneDropFrame('blurred');
  const recycled = await loneDropFrame('recycled');
  const rain = stampGateRainShot(), { width } = rain.camera.stage.frame;
  const { frames: [first, next], costs: taken } = await stampGateShotFrames(rain, [STAMP_GATE_RAIN.at.first, STAMP_GATE_RAIN.at.next]);
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

/** The sliding post shot of `kind`, its one frame as RGB bytes. */
const slidingPostFrame = async (kind: Parameters<typeof stampGateSlidingPostShot>[0]) =>
  stampGateRgb((await stampGateShotFrames(stampGateSlidingPostShot(kind), [STAMP_GATE_SLIDING_POST.at])).frames[0]);

/**
 * shot/shutter: a lens leaving out its shutter takes the film's, open half the frame STAMP_GATE_SHOT_FPS plays: the
 * sliding post blurs along its slide, wider than shut, as tall, and about the frame's time; shut, it draws as if it
 * stood still.
 */
async function checkSlidingPost(): Promise<StampGateWashCheck[]> {
  const none = await slidingPostFrame('none'), still = await slidingPostFrame('still'), shut = await slidingPostFrame('shut'), film = await slidingPostFrame('film');
  const { width } = stampGateSlidingPostShot('none').camera.stage.frame;
  const [shutBox, filmBox] = [shut, film].map((frame) => stampGateDifferenceBox(none, frame, width));
  const shutSize = boxSize(shutBox), filmSize = boxSize(filmBox), spread = spreadPast(shutBox, filmBox), asStill = stampGateFrameDifference(still, shut);
  const travel = STAMP_GATE_SLIDING_POST.speed * paintFilmShutter(STAMP_GATE_SHOT_FPS);
  const blurred = !!shutSize && !!filmSize && filmSize.w >= shutSize.w + travel / 2 && Math.abs(filmSize.h - shutSize.h) <= 2;
  return [
    {
      id: 'shot/shutter: film', passed: blurred && !!spread && Math.abs(spread.left - spread.right) <= 2,
      detail: `sliding ${travel} px while the film's shutter is open, the post shows over ${boxText(filmBox)}; shut, over ${boxText(shutBox)}${spread ? `, ${spread.left} and ${spread.right} px past it left and right` : ''} (at least ${travel / 2} px wider, within 2 px as tall and its sides within 2 px of each other wanted)`,
    },
    {
      id: 'shot/shutter: shut', passed: stampGateFramePasses(asStill),
      detail: `sliding, shut, the post lies ${stampGateFrameDifferenceText(asStill)} from it standing still (${STAMP_GATE_FRAME_TOLERANCE.max} levels allowed)`,
    },
  ];
}

/** A dissolve check: frame `between`, of `what` dissolving halfway, lying between its two `ends` in every channel they differ in. */
function dissolveHalfway(id: string, what: string, ends: readonly [Uint8ClampedArray, Uint8ClampedArray], between: Uint8ClampedArray): StampGateWashCheck {
  const lies = stampGateFadeBetween(stampGateRgb(ends[0]), stampGateRgb(between), stampGateRgb(ends[1]));
  return {
    id, passed: stampGateFadeLiesBetween(lies),
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
  const { together, apart, half, inPond, alone, backHalf } = STAMP_GATE_DISSOLVE_AT;
  const { frames: [atTogether, atApart, atHalf, atInPond, atAlone, atBackHalf], costs: taken } = await stampGateShotFrames(stampGateDissolveShot(), [together, apart, half, inPond, alone, backHalf]);
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

/** The paintings a frame's `costs` solved sheets of, by source name, each once. */
const solvedSources = ({ solves }: StampPaintCosts) => [...new Set(solves.map(({ program }) => program.slice(0, program.indexOf(','))))].toSorted();

/**
 * shot/rigged-dissolve: the rigged heron dissolving from day to dusk, drawn halfway first, lies between its posed ends.
 * Drawn after them, halfway solves nothing; posed anew it solves each end, and posed as first again nothing. Each frame
 * reads each rig's pose once. A warm of the halfway frame solves both ends.
 */
async function checkRiggedDissolve(): Promise<StampGateWashCheck[]> {
  const { day, dusk, half, reposed, again } = STAMP_GATE_RIGGED_DISSOLVE_AT, heard: Map<string, number>[] = [];
  const hear = (group: string) => {
    const frame = heard.at(-1);
    frame?.set(group, (frame.get(group) ?? 0) + 1);
  };
  const { frames: [atDay, atDusk], costs: taken } = await stampGateShotFrames(stampGateRiggedDissolveShot({ heard: hear }), [day, dusk, half, reposed, again], () => heard.push(new Map()));
  // Halfway is read off the warmed renderer, where it's the first frame drawn: both ends' pieces drawn in one frame. One
  // drawn after its ends reuses their kept pictures and draws no pieces, so it can't show one end's overwriting the other's.
  const warmed = await stampGateShotFrames(stampGateRiggedDissolveShot({ warm: { from: half, to: half } }), [half]), [atHalf] = warmed.frames;
  const ends = stampGateRiggedDissolveSources(), bothEnds = (costs: StampPaintCosts) => solvedSources(costs).join() === ends.join();
  const halfAnew = dissolveDrawnAnew(taken[2]), againAnew = dissolveDrawnAnew(taken[4]), warnings = taken.flatMap((each) => each.warnings);
  const reads = heard.map((frame) => [...frame].map(([group, count]) => `${group} ${count}`).join(', ') || 'none');
  const warmedSolves = solvedText(warmed.costs[0]);
  return [
    dissolveHalfway('shot/rigged-dissolve: halfway', 'the posed heron and reeds', [atDay, atDusk], atHalf),
    {
      id: 'shot/rigged-dissolve: solved per end and pose',
      passed: !halfAnew.solved.length && halfAnew.misses === 0 && bothEnds(taken[3]) && !againAnew.solved.length && againAnew.misses === 0 && !warnings.length,
      detail: `drawn after its posed ends, halfway ${anewText(halfAnew)}; posed anew, it solved sheets of ${solvedSources(taken[3]).join(' and ') || 'nothing'} (${ends.join(' and ')} wanted); posed as first again, it ${anewText(againAnew)}${warnings.length ? `; warned: ${warnings.join('; ')}` : ''}`,
    },
    {
      id: 'shot/rigged-dissolve: one pose read a frame', passed: heard.length === 5 && heard.every((frame) => frame.size === 2 && [...frame.values()].every((count) => count === 1)),
      detail: `its frames read its rigs' poses ${reads.join('; ')} times (heron 1, reeds 1 each wanted)`,
    },
    {
      id: 'shot/rigged-dissolve: warm', passed: bothEnds(warmed.warm) && !warmedSolves.length,
      detail: `warming the halfway frame solved sheets of ${solvedSources(warmed.warm).join(' and ') || 'nothing'} (${ends.join(' and ')} wanted); drawing it then solved ${warmedSolves.join(', ') || 'nothing'}`,
    },
  ];
}

/**
 * shot/warm: the wet-contact shot painted in on sixes, its plane on threes flipping its foot's pose, its span warmed,
 * solves each pairing of its clocks' moments and keeps bytes; frames the warm skipped as pairing alike then solve
 * nothing, as they would were a clock the solve reads left out of the pairing.
 */
async function checkWarm(): Promise<StampGateWashCheck[]> {
  const { costs, warm: { solves, bytes } } = await stampGateShotFrames(stampGateWarmShot(), STAMP_GATE_WARMED_AT), drawnSolves = costs.flatMap(solvedText);
  return [{
    id: 'shot/warm: span solved', passed: solves.length > 0 && bytes.kept > 0 && !drawnSolves.length,
    detail: `warming ${STAMP_GATE_WARM.from}..${STAMP_GATE_WARM.to} s solved ${solves.length} sheet program${solves.length === 1 ? '' : 's'} and kept ${bytes.kept} bytes; the frames at ${STAMP_GATE_WARMED_AT.map((t) => t.toFixed(3)).join(' and ')} s then solved ${drawnSolves.join(', ') || 'nothing'}`,
  }];
}

/** The cards shot painted as `painted` says, its one frame at scene second `at` as RGB bytes. */
const cardsFrame = async (painted: Parameters<typeof stampGateCardsShot>[0], at: number) => stampGateRgb((await stampGateShotFrames(stampGateCardsShot(painted), [at])).frames[0]);

/**
 * The collage on a plane of its own, at rest showing only a cel its pose hides, skipped unsolved; posed to show that
 * cel, solved.
 */
async function checkPosedCel(): Promise<StampGateWashCheck> {
  const { costs } = await stampGateShotFrames(stampGateCardsPosedShot(), [STAMP_GATE_CARDS_POSED_AT.rest, STAMP_GATE_CARDS_POSED_AT.lying]);
  const [skippedRest, skippedLying] = costs.map((each) => each.counts.get('hidden solves skipped') ?? 0);
  const [collageRest, collageLying] = costs.map(({ solves }) => solves.filter(({ program }) => program.includes('collage')).length);
  return {
    id: 'shot/cards: posed cel', passed: skippedRest === 1 && collageRest === 0 && skippedLying === 0 && collageLying > 0,
    detail: `at rest, its one cel left hidden by its pose, the frame skipped ${skippedRest} hidden planes and solved the collage's sheets ${collageRest} times (1 and 0 wanted); `
      + `posed to show it, ${skippedLying} and ${collageLying} (0 and more wanted)`,
  };
}

/**
 * shot/cards: the collage's hidden cel and its view switched off take no paper, each drawing as the card painted
 * without it, and the view shown changes the frame; the leaf owning its card fades card and paint as one, halfway
 * between shown and gone in every channel they differ in, gone drawing as the cards without it; and checkPosedCel.
 */
async function checkCards(): Promise<StampGateWashCheck[]> {
  const { shown, faded, gone, sitting } = STAMP_GATE_CARDS_AT;
  const { frames: [atShown, atFaded, atGone, atSitting], costs: taken } = await stampGateShotFrames(stampGateCardsShot(), [shown, faded, gone, sitting]);
  const [noDown, noSitting, noLeaf] = [await cardsFrame({ down: false }, shown), await cardsFrame({ sitting: false }, shown), await cardsFrame({ leaf: false }, gone)];
  const hiddenCel = stampGateFrameDifference(stampGateRgb(atShown), noDown), viewOff = stampGateFrameDifference(stampGateRgb(atShown), noSitting);
  const { width } = stampGateCardsShot().camera.stage.frame, viewShown = stampGateDifferenceBox(stampGateRgb(atGone), stampGateRgb(atSitting), width);
  const left = stampGateFrameDifference(stampGateRgb(atGone), noLeaf), fade = stampGateFadeBetween(stampGateRgb(atShown), stampGateRgb(atFaded), stampGateRgb(atGone));
  const fadeSolves = taken.slice(1).flatMap(solvedText), allowed = `${STAMP_GATE_FRAME_TOLERANCE.max} levels allowed`;
  return [
    {
      id: 'shot/cards: hidden cel', passed: stampGateFramePasses(hiddenCel),
      detail: `the collage with its lying cel hidden lies ${stampGateFrameDifferenceText(hiddenCel)} from it painted without that cel (${allowed})`,
    },
    {
      id: 'shot/cards: view off', passed: stampGateFramePasses(viewOff) && !!viewShown,
      detail: `the collage with its sitting view switched off lies ${stampGateFrameDifferenceText(viewOff)} from it painted without the view (${allowed}); switched on, the view changed ${boxText(viewShown)}`,
    },
    {
      id: 'shot/cards: owner fade', passed: stampGateFadeLiesBetween(fade) && stampGateFramePasses(left) && !fadeSolves.length,
      detail: `the leaf faded halfway strays ${fade.outside} levels outside it shown and gone (${allowed}) and lies between them in ${fade.between} of the ${fade.apart} channels they differ in; gone, it lies ${stampGateFrameDifferenceText(left)} from the cards painted without it; fading solved ${fadeSolves.join(', ') || 'nothing'}`,
    },
    await checkPosedCel(),
  ];
}

/** The sprig painted as `painted` says, every cel it holds shown, its one frame as RGB bytes. */
const piecesFlat = async (painted: Parameters<typeof stampGatePiecesFlatShot>[0]) => stampGateRgb((await stampGateShotFrames(stampGatePiecesFlatShot(painted), [STAMP_GATE_PIECES_AT.rest])).frames[0]);

/**
 * shot/pieces: a sprig drawn as pieces lays every film by its own palette, whatever is hidden ahead of it. Its flag
 * swapped to a cel of another colour, its bud's rim switched off and its seed hidden by a clear cel each draw as the
 * sprig painted without what each hides, solving nothing.
 */
async function checkPieces(): Promise<StampGateWashCheck[]> {
  const { rest, swapped, off, cleared } = STAMP_GATE_PIECES_AT;
  const { frames: [, atSwapped, atOff, atCleared], costs: taken } = await stampGateShotFrames(stampGatePiecesShot(), [rest, swapped, off, cleared]);
  const [swap, rimOff, clear] = [
    stampGateFrameDifference(stampGateRgb(atSwapped), await piecesFlat({ ochre: false })), stampGateFrameDifference(stampGateRgb(atOff), await piecesFlat({ blue: false, rim: false })),
    stampGateFrameDifference(stampGateRgb(atCleared), await piecesFlat({ blue: false, seed: false })),
  ];
  const solves = taken.slice(1).flatMap(solvedText), allowed = `${STAMP_GATE_FRAME_TOLERANCE.max} levels allowed`;
  return [
    {
      id: 'shot/pieces: swap', passed: stampGateFramePasses(swap),
      detail: `the sprig with its flag swapped to its blue cel lies ${stampGateFrameDifferenceText(swap)} from it painted without the ochre rest cel (${allowed})`,
    },
    {
      id: 'shot/pieces: layer off', passed: stampGateFramePasses(rimOff),
      detail: `the sprig with its bud's rim at visibility 0 lies ${stampGateFrameDifferenceText(rimOff)} from it painted without the rim (${allowed})`,
    },
    {
      id: 'shot/pieces: clear cel', passed: stampGateFramePasses(clear) && !solves.length,
      detail: `the sprig with its seed showing its clear cel lies ${stampGateFrameDifferenceText(clear)} from it painted without the seed (${allowed}); swapping, switching and clearing solved ${solves.join(', ') || 'nothing'}`,
    },
  ];
}

/** Shot case `id`'s checks. */
export function checkStampGateShotCase(id: StampGateShotCaseId): Promise<StampGateWashCheck[]> {
  if (id === 'shot/rain') return checkStampGateRain();
  if (id === 'shot/shutter') return checkSlidingPost();
  if (id === 'shot/dissolve') return checkDissolve();
  if (id === 'shot/rigged-dissolve') return checkRiggedDissolve();
  if (id === 'shot/warm') return checkWarm();
  if (id === 'shot/rainy-street') return checkStampGateRainyStreet();
  if (id === 'shot/cards') return checkCards();
  if (id === 'shot/pieces') return checkPieces();
  if (id === 'shot/glow') return checkStampGateShotGlowCase();
  return checkStampGateShotMasksCase(id);
}

/** Shot baseline `id`'s frame: RGB bytes row by row, in base64. */
export async function paintStampGateShot(id: StampGateShotId): Promise<string> {
  const { shot, at } = stampGateShotBaseline(id), { frames: [rgba] } = await stampGateShotFrames(shot, [at]);
  return stampGateRgbBase64(rgba);
}
