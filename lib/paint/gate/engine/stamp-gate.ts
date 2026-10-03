// stamp-gate.ts: the GPU gate. In one headless browser session it runs every formula grid, paints every gate painting,
// solves every sheet case, draws every shot and painted texture and traces a resolve (studio/stamp-gate-page.ts), then
// holds each to what it answers to: a rendering formula, a painting, a solved sheet's still, a shot's frame and a
// painted texture's frame to their accepted baselines (stamp-gate-store.ts), a runtime twin to its CPU side, a trace to
// its frame. `node harness/stamp-paint-gate.ts` runs it; pre-commit runs it
// on the staged tree (stamp-gate-staged.ts).
//
// Negative space: nothing here skips or retries. No adapter, a missing feature or a failed draw is an error, and an
// error fails the gate as a difference does.

import { availableParallelism } from 'node:os';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { withBrowserModulePage } from '#lib/platform/browser/engine/browser-module-page.ts';
import { compareStampGateFormula, stampGateFormulaGrids, STAMP_GATE_FORMULA_TOLERANCE, type StampGateFormulaGrid } from '../models/stamp-gate-formulas.ts';
import { STAMP_GATE_TRACE_TOLERANCE, stampGateFrameDifference, stampGateFramePasses, type StampGateFrameDifference } from '../models/stamp-gate-frames.ts';
import { STAMP_GATE_PAINTING_IDS, STAMP_GATE_TRACE_ORDERS, stampGatePainting, stampGatePaintingInputs } from '../models/stamp-gate-paintings.ts';
import { STAMP_GATE_ANIMATION_IDS } from '../models/stamp-gate-animation.ts';
import { STAMP_GATE_FLOW_IDS } from '../models/stamp-gate-flow.ts';
import { STAMP_GATE_MEDIA_IDS } from '../models/stamp-gate-media.ts';
import { STAMP_GATE_THREE_IDS } from '../models/stamp-gate-three-plane.ts';
import { STAMP_GATE_THREE_STILL_ID } from '../models/stamp-gate-three-still.ts';
import { STAMP_GATE_PICTURE_ID } from '../models/stamp-gate-picture-plane.ts';
import { STAMP_GATE_TRANSPORT_ID } from '../models/stamp-gate-motion.ts';
import { STAMP_GATE_PLANES_IDS, STAMP_GATE_STAGE_IDS } from '../models/stamp-gate-stage.ts';
import { STAMP_GATE_LENS_IDS } from '../models/stamp-gate-lens.ts';
import { STAMP_GATE_STRIPE_IDS } from '../models/stamp-gate-stripe.ts';
import { STAMP_GATE_WASH_IDS } from '../models/stamp-gate-washes.ts';
import type { StampGateWashCheck } from '../models/stamp-gate-layer.ts';
import { STAMP_GATE_REGION_IDS } from '../models/stamp-gate-regions.ts';
import { STAMP_GATE_CONTACT_IDS } from '../models/stamp-gate-contact.ts';
import { STAMP_GATE_MASK_IDS } from '../models/stamp-gate-masks.ts';
import { STAMP_GATE_SHEET_IDS, STAMP_GATE_SOLVED_IDS, stampGateSolvedInputs, stampGateSolvedStill, type StampGateSolvedId } from '../models/stamp-gate-sheets.ts';
import { STAMP_GATE_SHOT_IDS, stampGateShotBaseline, stampGateShotInputs, type StampGateShotId } from '../models/stamp-gate-shots.ts';
import { STAMP_GATE_TEXTURE_FRAME, STAMP_GATE_TEXTURE_IDS, stampGateTextureInputs, type StampGateTextureId } from '../models/stamp-gate-textures.ts';
import { readStampGateBaseline, stampGateFrame, stampGateInputsHash, writeStampGateCandidate, type StampGateOutput } from './stamp-gate-store.ts';

/** The gate's browser side, which the private run loads too. */
export const STAMP_GATE_PAGE = fileURLToPath(new URL('../studio/stamp-gate-page.ts', import.meta.url));

/**
 * How many pages of the one browser paint the gate's cases at once. Every page shares the one GPU, so past four a
 * case waits on it, not on its page: on an M-series Mac two pages took the gate to 15 s, four to 13, eight to 12.
 */
export const STAMP_GATE_PAGES = Math.min(4, availableParallelism());

/** One thing the gate held, and how it came out. */
export type StampGateCheck = { id: string; passed: boolean; detail: string };

/** A subject held to a baseline: its ID, what it produced now, and the hash of the inputs it produced it from. */
export type StampGateSubject = { id: string; output: StampGateOutput; inputs: string };

const formulaId = (grid: StampGateFormulaGrid) => `formula/${grid.formula}`;
const formulaInputs = (grid: StampGateFormulaGrid) => stampGateInputsHash(`${grid.call}|${grid.width}|${Buffer.from(grid.rows.buffer).toString('base64')}`);

/** Every baseline subject's ID: each rendering formula's, each painting's, each solved sheet's, each shot's and each painted texture's. */
export const stampGateBaselineIds = () => [
  ...stampGateFormulaGrids().filter((grid) => grid.expected.kind === 'baseline').map(formulaId),
  ...STAMP_GATE_PAINTING_IDS.map((id) => `painting/${id}`),
  ...STAMP_GATE_SOLVED_IDS,
  ...STAMP_GATE_SHOT_IDS,
  ...STAMP_GATE_TEXTURE_IDS,
];

/** Each kind of case: the page function checking one, and every case of it the gate runs. */
const STAMP_GATE_CASES = {
  checkStampGateWash: STAMP_GATE_WASH_IDS,
  checkStampGateAnimation: STAMP_GATE_ANIMATION_IDS,
  checkStampGateFlowCase: STAMP_GATE_FLOW_IDS,
  checkStampGateStripeCase: STAMP_GATE_STRIPE_IDS,
  checkStampGateRegionCase: STAMP_GATE_REGION_IDS,
  checkStampGateMaskCase: STAMP_GATE_MASK_IDS,
  checkStampGateMediaCase: STAMP_GATE_MEDIA_IDS,
  checkStampGateThreeCase: [...STAMP_GATE_THREE_IDS, STAMP_GATE_THREE_STILL_ID, STAMP_GATE_PICTURE_ID],
  checkStampGateStageCase: [...STAMP_GATE_STAGE_IDS, ...STAMP_GATE_PLANES_IDS, STAMP_GATE_TRANSPORT_ID, ...STAMP_GATE_LENS_IDS],
  checkStampGateContactCase: STAMP_GATE_CONTACT_IDS,
  checkStampGateSheetCase: STAMP_GATE_SHEET_IDS,
  checkStampGateTextureCase: STAMP_GATE_TEXTURE_IDS,
} satisfies Readonly<Record<string, readonly string[]>>;

/** What a run collects: the paintings, solved sheets, shots and painted textures drawn, and the cases checked, by page function. */
type StampGateRun = {
  paintings: readonly string[]; solved: readonly StampGateSolvedId[]; shots: readonly StampGateShotId[]; textures: readonly StampGateTextureId[];
  cases: Readonly<Record<string, readonly string[]>>;
};

/** Runs the page: every formula grid, the paintings, solved sheets, shots and painted textures named, the trace, and the cases named. */
async function collectStampGate({ paintings, solved, shots, textures, cases }: StampGateRun) {
  const grids = stampGateFormulaGrids();
  const gates = paintings.map((id) => ({ id, gate: stampGatePainting(id) }));
  // The page loads no files; it's served its own folder only because the page server serves one.
  return withBrowserModulePage({ entry: STAMP_GATE_PAGE, filesDir: dirname(STAMP_GATE_PAGE), pages: STAMP_GATE_PAGES }, async (call) => {
    // Every call is issued at once and runs on the first page free; each painting asks for a device of its own, so
    // which page a case lands on, or what ran there before it, can't change what it draws. Promise.all keeps the order.
    const [adapter, values, frames, sheets, shotFrames, textureFrames, trace, checks] = await Promise.all([
      call<string>('stampGateAdapter'),
      call<number[][]>('runStampGateFormulas', grids.map(({ call: wgsl, width, rows, points, grid, boundaries }) => ({
        call: wgsl, width, rows: Array.from(rows), ...(points && { points: Array.from(points) }), ...(grid && { grid: Array.from(grid) }), ...(boundaries && { boundaries: Array.from(boundaries) }),
      }))),
      Promise.all(gates.map(async ({ id, gate }): Promise<StampGateSubject> => {
        const rgb = Buffer.from(await call<string>('paintStampGate', id), 'base64');
        return { id: `painting/${id}`, output: stampGateFrame(new Uint8Array(rgb), gate.width, gate.height), inputs: stampGateInputsHash(stampGatePaintingInputs(gate)) };
      })),
      Promise.all(solved.map(async (id): Promise<StampGateSubject> => {
        const rgb = Buffer.from(await call<string>('paintStampGateSolved', id), 'base64');
        const { widthPx: width, heightPx: height } = stampGateSolvedStill(id).evaluation.document;
        return { id, output: stampGateFrame(new Uint8Array(rgb), width, height), inputs: stampGateInputsHash(stampGateSolvedInputs(id)) };
      })),
      Promise.all(shots.map(async (id): Promise<StampGateSubject> => {
        const rgb = Buffer.from(await call<string>('paintStampGateShot', id), 'base64');
        const { width, height } = stampGateShotBaseline(id).shot.camera.stage.frame;
        return { id, output: stampGateFrame(new Uint8Array(rgb), width, height), inputs: stampGateInputsHash(stampGateShotInputs(id)) };
      })),
      Promise.all(textures.map(async (id): Promise<StampGateSubject> => {
        const rgb = Buffer.from(await call<string>('paintStampGateTexture', id), 'base64'), { width, height } = STAMP_GATE_TEXTURE_FRAME;
        return { id, output: stampGateFrame(new Uint8Array(rgb), width, height), inputs: stampGateInputsHash(stampGateTextureInputs(id)) };
      })),
      call<{ worst: number; mean: number; ordinary: StampGateFrameDifference; orders: string[] }>('traceStampGate'),
      Promise.all(Object.entries(cases).flatMap(([name, ids]) => ids.map((id) => call<StampGateWashCheck | StampGateWashCheck[]>(name, id)))),
    ]);
    return { adapter, grids: grids.map((grid, g) => ({ grid, gpu: Float32Array.from(values[g]) })), frames: [...frames, ...sheets, ...shotFrames, ...textureFrames], trace, washChecks: checks.flat() };
  });
}

type Collected = Awaited<ReturnType<typeof collectStampGate>>;

const formulaSubjects = ({ grids }: Collected): StampGateSubject[] => grids.filter(({ grid }) => grid.expected.kind === 'baseline')
  .map(({ grid, gpu }) => ({ id: formulaId(grid), output: { kind: 'values', values: gpu }, inputs: formulaInputs(grid) }));

/** How `output` compares with `baseline`'s: passed or not, and in what numbers. */
export function compareStampGateOutputs(id: string, output: StampGateOutput, baseline: StampGateOutput) {
  if (output.kind === 'values' && baseline.kind === 'values') {
    if (output.values.length !== baseline.values.length) return { passed: false, detail: `${output.values.length} rows, its baseline ${baseline.values.length}` };
    const grid = stampGateFormulaGrids().find((g) => formulaId(g) === id)!;
    const c = compareStampGateFormula(grid, baseline.values, output.values);
    return { passed: c.over === 0, detail: `${c.rows} rows, worst ${c.worst.toExponential(2)} at ${c.worstAt} (gpu ${c.gpu}, baseline ${c.expected}), ${c.over} past ${STAMP_GATE_FORMULA_TOLERANCE}` };
  }
  if (output.kind === 'frame' && baseline.kind === 'frame') {
    const d = stampGateFrameDifference(output.rgb, baseline.rgb);
    return { passed: stampGateFramePasses(d), detail: `max ${d.max}, mean ${d.mean.toFixed(4)}, ${(d.overTwo * 100).toFixed(3)}% past 2 levels` };
  }
  throw new Error(`stamp gate: ${id} produced a ${output.kind}, its baseline is a ${baseline.kind}`);
}

/**
 * A baseline subject, drawn on `adapter`, held to its baseline in `store`: missing, made from other inputs, or
 * compared. A difference names the baseline's GPU when it was drawn on another, as a new GPU may round differently.
 */
export function checkStampGateSubject(store: string, { id, output, inputs }: StampGateSubject, adapter: string): StampGateCheck {
  const accepted = readStampGateBaseline(store, id, output);
  if (!accepted) return { id, passed: false, detail: `no baseline; run update ${id} --reason …, then accept` };
  const { baseline } = accepted;
  if (baseline.inputs !== inputs) return { id, passed: false, detail: `its inputs changed since its baseline was accepted (${baseline.accepted}, over ${baseline.acceptedOver}: ${baseline.reason}); run update ${id} --reason …` };
  const { passed, detail } = compareStampGateOutputs(id, output, accepted.output);
  return { id, passed, detail: passed || baseline.adapter === adapter ? detail : `${detail}; accepted on ${baseline.adapter}, drawn now on ${adapter}` };
}

/** The runtime twins, each held to its CPU side. */
function checkTwins({ grids }: Collected): StampGateCheck[] {
  return grids.flatMap(({ grid, gpu }) => {
    if (grid.expected.kind !== 'twin') return [];
    const c = compareStampGateFormula(grid, grid.expected.values, gpu);
    return [{ id: `twin/${grid.formula}`, passed: c.over === 0, detail: `${c.rows} rows, worst ${c.worst.toExponential(2)} at ${c.worstAt} (gpu ${c.gpu}, cpu ${c.expected}), ${c.over} past ${STAMP_GATE_FORMULA_TOLERANCE}` }];
  });
}

/** The laws still being tuned, each held to its properties. */
function checkProperties({ grids }: Collected): StampGateCheck[] {
  return grids.flatMap(({ grid, gpu }) => {
    if (grid.expected.kind !== 'property') return [];
    const { over, first } = grid.expected.check(gpu);
    return [{ id: `property/${grid.formula}`, passed: over === 0, detail: `${grid.labels.length} rows, ${over} breaking a property${first ? `, first ${first}` : ''}` }];
  });
}

/** The trace: its coverage against its frame, its frame against an ordinary draw's, its stage orders against both plans. */
function checkTrace({ trace }: Collected): StampGateCheck {
  const { worst, mean, ordinary, orders } = trace;
  const ordersHeld = orders.join('|') === STAMP_GATE_TRACE_ORDERS.join('|');
  return {
    id: 'trace', passed: worst <= STAMP_GATE_TRACE_TOLERANCE && stampGateFramePasses(ordinary) && ordersHeld,
    detail: `traced coverage against its frame: worst ${worst.toFixed(2)} levels, mean ${mean.toFixed(3)}; traced frame against an ordinary draw: max ${ordinary.max}, mean ${ordinary.mean.toFixed(4)}; orders ${orders.join(' | ')}${ordersHeld ? '' : `, expected ${STAMP_GATE_TRACE_ORDERS.join(' | ')}`}`,
  };
}

/** The whole gate against the baselines in `store`: every formula, twin, property grid, painting, solved sheet, shot, painted texture, the trace, and every case. */
export async function runStampGate(store: string): Promise<StampGateCheck[]> {
  const collected = await collectStampGate({
    paintings: STAMP_GATE_PAINTING_IDS, solved: STAMP_GATE_SOLVED_IDS, shots: STAMP_GATE_SHOT_IDS, textures: STAMP_GATE_TEXTURE_IDS, cases: STAMP_GATE_CASES,
  });
  return [
    ...formulaSubjects(collected).map((subject) => checkStampGateSubject(store, subject, collected.adapter)),
    ...checkTwins(collected),
    ...checkProperties(collected),
    ...collected.frames.map((subject) => checkStampGateSubject(store, subject, collected.adapter)),
    checkTrace(collected),
    ...collected.washChecks,
  ];
}

/**
 * Writes candidates for `ids` (stampGateBaselineIds') into `store`, each with `reason`, and how each compares with
 * its baseline; returns the files written. Throws on an ID the gate has no baseline subject for.
 */
export async function updateStampGate(store: string, ids: readonly string[], reason: string): Promise<{ id: string; files: string[]; comparison: string }[]> {
  const known = new Set(stampGateBaselineIds()), unknown = ids.filter((id) => !known.has(id));
  if (unknown.length) throw new Error(`stamp gate: no baseline subject ${unknown.join(', ')}; the gate has ${[...known].join(', ')}`);
  const paintings = ids.flatMap((id) => (id.startsWith('painting/') ? [id.slice('painting/'.length)] : []));
  const shots = STAMP_GATE_SHOT_IDS.filter((id) => ids.includes(id)), textures = STAMP_GATE_TEXTURE_IDS.filter((id) => ids.includes(id));
  const collected = await collectStampGate({ paintings, solved: STAMP_GATE_SOLVED_IDS.filter((id) => ids.includes(id)), shots, textures, cases: {} });
  const subjects = [...formulaSubjects(collected), ...collected.frames].filter((subject) => ids.includes(subject.id));
  return subjects.map((subject) => {
    const accepted = readStampGateBaseline(store, subject.id, subject.output);
    const comparison = accepted ? compareStampGateOutputs(subject.id, subject.output, accepted.output).detail : 'no baseline before';
    return { id: subject.id, files: writeStampGateCandidate(store, subject.id, subject.output, { inputs: subject.inputs, reason, comparison, adapter: collected.adapter }), comparison };
  });
}
