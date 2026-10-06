// stamp-gate-in-time-page.ts: the gate page's painting in time (stamp-gate-in-time.ts), drawn through the shot's
// renderer (stamp-gate-shot-frames.ts): its plan's keys; a frame between two keys lying between their frames; each
// key's drawing solved once, and frames after them solving nothing; a warm over the sweep solving its drawings alone.

import type { StampPaintCosts } from '#lib/paint/painting/models/stamp-paint-costs.ts';
import { compilePaintedShot } from '#lib/paint/shot/models/shot-compile.ts';
import { shotPlanesKeyDrawingsText } from '#lib/paint/shot/models/shot-painting-in-time.ts';
import { STAMP_GATE_FRAME_TOLERANCE } from '../models/stamp-gate-frames.ts';
import { STAMP_GATE_IN_TIME_AT, STAMP_GATE_IN_TIME_KEYS, STAMP_GATE_RIDGE_DRAWINGS, stampGateInTimeShot } from '../models/stamp-gate-in-time.ts';
import type { StampGateWashCheck } from '../models/stamp-gate-layer.ts';
import { stampGateShotSpanned } from '../models/stamp-gate-shot-span.ts';
import { stampGateFadeBetween, stampGateFadeLiesBetween } from '../models/stamp-gate-shots.ts';
import { stampGateRgb } from './stamp-gate-page-surface.ts';
import { stampGateShotFrames, stampGateSolvedText as solvedText } from './stamp-gate-shot-frames.ts';

/** The frames the checks draw, in order. */
const IN_TIME_DRAWS = [STAMP_GATE_IN_TIME_AT.seventy, STAMP_GATE_IN_TIME_AT.fifty, STAMP_GATE_IN_TIME_AT.between, STAMP_GATE_IN_TIME_AT.end];

/** What a frame's `costs` did anew: the sheets it solved and the pictures it laid. */
const drawnAnew = (costs: StampPaintCosts) => ({ solved: solvedText(costs), misses: costs.counts.get('picture misses') ?? 0 });
const anewText = ({ solved, misses }: ReturnType<typeof drawnAnew>) => `solved ${solved.join(', ') || 'nothing'} and laid ${misses} picture${misses === 1 ? '' : 's'} anew`;

/** The sweep's plan as its frames' span compiles it: its keys, and its lines as `studio paint check` prints them. */
function inTimePlan() {
  const { shot } = compilePaintedShot(stampGateShotSpanned(stampGateInTimeShot(), IN_TIME_DRAWS), []);
  const plane = shot?.planes[0], keys = plane?.kind === 'painted' ? plane.keyDrawings?.keys ?? [] : [];
  return { keys, lines: shot ? shotPlanesKeyDrawingsText(shot.planes) : [] };
}

/** shot/properties-in-time's checks. */
export async function checkStampGateInTime(): Promise<StampGateWashCheck[]> {
  const { keys, lines } = inTimePlan(), drawings = new Set(keys.map(({ painting }) => painting)).size;
  const planned = keys.length === STAMP_GATE_IN_TIME_KEYS.length && keys.every(({ moment, values, reason }, i) => {
    const wanted = STAMP_GATE_IN_TIME_KEYS[i];
    return Math.abs(moment.at - wanted.at) < 1e-9 && values.ridgeTopPx === wanted.ridgeTopPx && reason === wanted.reason;
  });
  const { frames: [atSeventy, atFifty, atBetween], costs } = await stampGateShotFrames(stampGateInTimeShot(), IN_TIME_DRAWS);
  const warmed = await stampGateShotFrames(stampGateInTimeShot({ warm: { from: 0, to: STAMP_GATE_IN_TIME_AT.end } }), [STAMP_GATE_IN_TIME_AT.between]);
  const lies = stampGateFadeBetween(stampGateRgb(atSeventy), stampGateRgb(atBetween), stampGateRgb(atFifty));
  const [seventySolves, fiftySolves] = costs.slice(0, 2).map(solvedText), after = costs.slice(2).map(drawnAnew);
  const warmSolves = solvedText(warmed.warm), drawnSolves = solvedText(warmed.costs[0]);
  return [
    {
      id: 'shot/properties-in-time: plan', passed: planned && drawings === STAMP_GATE_RIDGE_DRAWINGS,
      detail: `${lines.join('; ')} (wanted keys at ${STAMP_GATE_IN_TIME_KEYS.map(({ at, ridgeTopPx, reason }) => `${Number(at.toFixed(3))} s ${ridgeTopPx} px, ${reason}`).join('; ')})`,
    },
    {
      id: 'shot/properties-in-time: between', passed: stampGateFadeLiesBetween(lies),
      detail: `the ridge at ${STAMP_GATE_IN_TIME_AT.between} s, halfway from 70 px to 50, strays ${lies.outside} levels outside its keys' drawings (${STAMP_GATE_FRAME_TOLERANCE.max} allowed), and lies between them in ${lies.between} of the ${lies.apart} channels they differ in`,
    },
    {
      id: 'shot/properties-in-time: solved per drawing', passed: seventySolves.length === 1 && fiftySolves.length === 1 && after.every(({ solved, misses }) => !solved.length && misses === 0),
      detail: `at 70 px it solved ${seventySolves.join(', ') || 'nothing'}, at 50 px ${fiftySolves.join(', ') || 'nothing'} (one sheet each wanted); drawn after them, between ${anewText(after[0])}, and the sweep's end, 70 px again, ${anewText(after[1])}`,
    },
    {
      id: 'shot/properties-in-time: warm', passed: warmSolves.length === STAMP_GATE_RIDGE_DRAWINGS && !drawnSolves.length,
      detail: `warming the sweep solved ${warmSolves.length} sheets (its ${STAMP_GATE_RIDGE_DRAWINGS} drawings wanted); drawing between then solved ${drawnSolves.join(', ') || 'nothing'}`,
    },
  ];
}
