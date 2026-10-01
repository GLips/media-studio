// stamp-gate.ts: the GPU gate. In one headless browser session it runs every formula grid, paints every gate painting
// and traces a resolve (studio/stamp-gate-page.ts), then holds each to what it answers to: a rendering formula and a
// painting to their accepted baselines (stamp-gate-store.ts), a runtime twin to its CPU side, a trace to its frame.
// `node harness/stamp-paint-gate.ts` runs it; pre-commit runs it on the staged tree (stamp-gate-staged.ts).
//
// Negative space: nothing here skips or retries. No adapter, a missing feature or a failed draw is an error, and an
// error fails the gate as a difference does.

import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { withBrowserModulePage } from '#lib/platform/browser/engine/browser-module-page.ts';
import { compareStampGateFormula, stampGateFormulaGrids, STAMP_GATE_FORMULA_TOLERANCE, type StampGateFormulaGrid } from '../models/stamp-gate-formulas.ts';
import { STAMP_GATE_TRACE_TOLERANCE, stampGateFrameDifference, stampGateFramePasses, type StampGateFrameDifference } from '../models/stamp-gate-frames.ts';
import { STAMP_GATE_PAINTING_IDS, STAMP_GATE_TRACE_ORDERS, stampGatePainting, stampGatePaintingInputs } from '../models/stamp-gate-paintings.ts';
import { STAMP_GATE_ANIMATION_IDS } from '../models/stamp-gate-animation.ts';
import { STAMP_GATE_FLOW_IDS } from '../models/stamp-gate-flow.ts';
import { STAMP_GATE_MEDIA_IDS } from '../models/stamp-gate-media.ts';
import { STAMP_GATE_OUTSIDE_IDS } from '../models/stamp-gate-outside-layer.ts';
import { STAMP_GATE_STRIPE_IDS } from '../models/stamp-gate-stripe.ts';
import { STAMP_GATE_WASH_IDS, type StampGateWashCheck } from '../models/stamp-gate-washes.ts';
import { readStampGateBaseline, stampGateFrame, stampGateInputsHash, writeStampGateCandidate, type StampGateOutput } from './stamp-gate-store.ts';

/** The gate's browser side, which the private run loads too. */
export const STAMP_GATE_PAGE = fileURLToPath(new URL('../studio/stamp-gate-page.ts', import.meta.url));

/** One thing the gate held, and how it came out. */
export type StampGateCheck = { id: string; passed: boolean; detail: string };

/** A subject held to a baseline: its ID, what it produced now, and the hash of the inputs it produced it from. */
export type StampGateSubject = { id: string; output: StampGateOutput; inputs: string };

const formulaId = (grid: StampGateFormulaGrid) => `formula/${grid.formula}`;
const formulaInputs = (grid: StampGateFormulaGrid) => stampGateInputsHash(`${grid.call}|${grid.width}|${Buffer.from(grid.rows.buffer).toString('base64')}`);

/** Every baseline subject's ID: each rendering formula's and each painting's. */
export const stampGateBaselineIds = () => [
  ...stampGateFormulaGrids().filter((grid) => grid.expected.kind === 'baseline').map(formulaId),
  ...STAMP_GATE_PAINTING_IDS.map((id) => `painting/${id}`),
];

/** Runs the page: every formula grid, the paintings named, the trace, and the wash, animation, flow, stripe, media and outside layer cases named. */
async function collectStampGate(
  paintings: readonly string[], washes: readonly string[] = [], animations: readonly string[] = [], flows: readonly string[] = [], stripes: readonly string[] = [], media: readonly string[] = [],
  outside: readonly string[] = [],
) {
  const grids = stampGateFormulaGrids();
  const gates = paintings.map((id) => ({ id, gate: stampGatePainting(id) }));
  // The page loads no files; it's served its own folder only because the page server serves one.
  return withBrowserModulePage({ entry: STAMP_GATE_PAGE, filesDir: dirname(STAMP_GATE_PAGE) }, async (call) => {
    const adapter = await call<string>('stampGateAdapter');
    const values = await call<number[][]>('runStampGateFormulas', grids.map(({ call: wgsl, width, rows, points, grid }) => ({
      call: wgsl, width, rows: Array.from(rows), ...(points && { points: Array.from(points) }), ...(grid && { grid: Array.from(grid) }),
    })));
    // One painting at a time: each asks for a device of its own.
    const frames = await gates.reduce<Promise<StampGateSubject[]>>(async (done, { id, gate }) => {
      const painted = await done;
      const rgb = Buffer.from(await call<string>('paintStampGate', id), 'base64');
      const output = stampGateFrame(new Uint8Array(rgb), gate.width, gate.height);
      return [...painted, { id: `painting/${id}`, output, inputs: stampGateInputsHash(stampGatePaintingInputs(gate)) }];
    }, Promise.resolve([]));
    const trace = await call<{ worst: number; mean: number; ordinary: StampGateFrameDifference; orders: string[] }>('traceStampGate');
    const washChecks = await washes.reduce<Promise<StampGateWashCheck[]>>(async (done, id) => [...await done, ...await call<StampGateWashCheck[]>('checkStampGateWash', id)], Promise.resolve([]));
    const animationChecks = await animations.reduce<Promise<StampGateWashCheck[]>>(async (done, id) => [...await done, await call<StampGateWashCheck>('checkStampGateAnimation', id)], Promise.resolve([]));
    const flowChecks = await flows.reduce<Promise<StampGateWashCheck[]>>(async (done, id) => [...await done, await call<StampGateWashCheck>('checkStampGateFlowCase', id)], Promise.resolve([]));
    const stripeChecks = await stripes.reduce<Promise<StampGateWashCheck[]>>(async (done, id) => [...await done, await call<StampGateWashCheck>('checkStampGateStripeCase', id)], Promise.resolve([]));
    const mediaChecks = await media.reduce<Promise<StampGateWashCheck[]>>(async (done, id) => [...await done, ...await call<StampGateWashCheck[]>('checkStampGateMediaCase', id)], Promise.resolve([]));
    const outsideChecks = await outside.reduce<Promise<StampGateWashCheck[]>>(async (done, id) => [...await done, ...await call<StampGateWashCheck[]>('checkStampGateOutsideCase', id)], Promise.resolve([]));
    return {
      adapter, grids: grids.map((grid, g) => ({ grid, gpu: Float32Array.from(values[g]) })), frames, trace,
      washChecks: [...washChecks, ...animationChecks, ...flowChecks, ...stripeChecks, ...mediaChecks, ...outsideChecks],
    };
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

/** The whole gate against the baselines in `store`: every formula, twin, property grid, painting, the trace, every wash, animation, flow, stripe, media and outside layer case. */
export async function runStampGate(store: string): Promise<StampGateCheck[]> {
  const collected = await collectStampGate(STAMP_GATE_PAINTING_IDS, STAMP_GATE_WASH_IDS, STAMP_GATE_ANIMATION_IDS, STAMP_GATE_FLOW_IDS, STAMP_GATE_STRIPE_IDS, STAMP_GATE_MEDIA_IDS, STAMP_GATE_OUTSIDE_IDS);
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
  const collected = await collectStampGate(paintings);
  const subjects = [...formulaSubjects(collected), ...collected.frames].filter((subject) => ids.includes(subject.id));
  return subjects.map((subject) => {
    const accepted = readStampGateBaseline(store, subject.id, subject.output);
    const comparison = accepted ? compareStampGateOutputs(subject.id, subject.output, accepted.output).detail : 'no baseline before';
    return { id: subject.id, files: writeStampGateCandidate(store, subject.id, subject.output, { inputs: subject.inputs, reason, comparison, adapter: collected.adapter }), comparison };
  });
}
