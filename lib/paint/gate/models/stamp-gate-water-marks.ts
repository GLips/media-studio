// stamp-gate-water-marks.ts: the marks water leaves where it stops, which the gate's wash cases (stamp-gate-washes.ts)
// are held to: where each case lays its drop, edge or puddle, how far a mark may go, and the checks:
//
// - rimmed: a puddle's edge gathers pigment, a seam doesn't;
// - bloomed: paint elsewhere first doesn't stop a bloom;
// - unlined: a backrun leaves its wash's edge unlined;
// - unrimmed: a feathered edge dries with no line;
// - lipped, unlipped: damp paint lips a bloom all round, wet doesn't.

import {
  checkStampGateConserved, STAMP_GATE_LAYER_TOLERANCE, stampGateSlotAmounts, type StampGateLayer, type StampGateWashCheck,
} from './stamp-gate-layer.ts';

/** The rim case's puddle's right edge, its patches' seam and the columns the two patches span. */
export const STAMP_GATE_RIM_PUDDLE: { puddleTo: number; seam: number; patches: [number, number] } = { puddleTo: 60, seam: 115, patches: [80, 150] };
/**
 * How much more its rim must gather at the puddle's edge than the paint left still has there, as a share of the
 * interior; and how much more than still paint a seam may hold, as a share of both patches, flow evening it.
 */
export const STAMP_GATE_RIM = { least: 0.1, seamMost: 0.02 };

/** The bloomed case's drop, and how much of the paint round it must move, as a share of what lies there without it. */
export const STAMP_GATE_BLOOM_DROP = { x: 45, y: 60, radius: 30 };
export const STAMP_GATE_BLOOMED_LEAST = 0.02;

/** The unlined case's wash's right edge, by column, and its rows. */
export const STAMP_GATE_BACKRUN_EDGE = { x: 100, rows: [20, 100] as const };
/**
 * How much darker than without blooms the unlined case's wash's edge may get: each row's most pigment near it, as a
 * share of without's, on average. A backrun pushes a little paint toward the edge; a lip there would be a dark line.
 */
export const STAMP_GATE_UNLINED_MOST = 0.15;

/** The unrimmed case's columns its wash's edge feathers over (its wash starts at 40), its interior's, and its rows. */
export const STAMP_GATE_FEATHERED_EDGE = { from: 12, to: 60, interior: [80, 120] as const, rows: [44, 76] as const };
/**
 * The most the drying rim may darken the unrimmed case's feathered edge, at its darkest row by row, on average, as a
 * share of the wash's interior: a puddle's edge gains about 0.7.
 */
export const STAMP_GATE_UNRIMMED_MOST = 0.03;

/**
 * The unlipped and lipped cases' drop, and the seconds the unlipped case's sky waits for it: about halfway from its
 * shine to damp (a bloom op would wait for damp). A lip is read against the bloom within LIP_REACH px round it.
 */
export const STAMP_GATE_WET_DROP = { x: 80, y: 60, radius: 34, seconds: 50 };
const LIP_REACH = 4;
/**
 * How far the unlipped case's lip may stand above the bloom round it: its 2% most-raised pixels, on average, as a
 * share of the paint round the drop. The same drop at damp stands about 0.48 above.
 */
export const STAMP_GATE_UNLIPPED_MOST = 0.15;
/**
 * The lipped case's sectors round its drop, and how high its weakest's lip must stand, as a share of its strongest's
 * (each its most-raised pixel above the bloom round it): a front left open over a third of it reads about 0.32.
 */
const LIP_SECTORS = 12;
export const STAMP_GATE_LIPPED_LEAST = 0.42;

/**
 * Over the rim case's rows: the puddle's edge (the most within a few pixels of it) over its interior's mean amount of
 * `slot`, and the seam (the most across it) over both patches' mean. The patches are narrow, so their outer rims draw
 * on their insides: the seam is held to all their paint, which those rims only move about.
 */
function rimShares(layer: StampGateLayer, slot: number) {
  const amounts = stampGateSlotAmounts(layer, slot), rows = Array.from({ length: 60 }, (_, k) => 30 + k);
  const at = (x: number, y: number) => amounts[y * layer.width + x];
  const most = (x0: number, x1: number) => rows.reduce((sum, y) => sum + Math.max(...Array.from({ length: x1 - x0 }, (_, k) => at(x0 + k, y))), 0) / rows.length;
  const mean = (...spans: [number, number][]) => {
    const xs = spans.flatMap(([x0, x1]) => Array.from({ length: x1 - x0 }, (_, k) => x0 + k));
    return rows.reduce((sum, y) => sum + xs.reduce((s, x) => s + at(x, y), 0), 0) / (rows.length * xs.length);
  };
  return {
    edge: most(STAMP_GATE_RIM_PUDDLE.puddleTo - 10, STAMP_GATE_RIM_PUDDLE.puddleTo + 6) / mean([25, 45]),
    seam: most(STAMP_GATE_RIM_PUDDLE.seam - 7, STAMP_GATE_RIM_PUDDLE.seam + 7) / mean(STAMP_GATE_RIM_PUDDLE.patches),
  };
}

/**
 * Whether `subject`'s bloom moved at least STAMP_GATE_BLOOMED_LEAST of the paint within STAMP_GATE_BLOOM_DROP's radius from where
 * `without` left it, every pigment summed, and each pigment's total held: a drop landing on paint already set moves none.
 */
export function checkStampGateBloomed(id: string, pigments: readonly string[], subject: StampGateLayer, without: StampGateLayer): StampGateWashCheck {
  let moved = 0, there = 0;
  pigments.forEach((_, slot) => {
    const after = stampGateSlotAmounts(subject, slot), before = stampGateSlotAmounts(without, slot);
    for (let i = 0; i < after.length; i++) {
      if (Math.hypot((i % subject.width) + 0.5 - STAMP_GATE_BLOOM_DROP.x, Math.floor(i / subject.width) + 0.5 - STAMP_GATE_BLOOM_DROP.y) >= STAMP_GATE_BLOOM_DROP.radius) continue;
      moved += Math.abs(after[i] - before[i]);
      there += before[i];
    }
  });
  const share = there > 0 ? moved / there : 0, conserved = checkStampGateConserved(id, pigments, subject, without);
  return {
    id: `${id}: bloomed`, passed: share >= STAMP_GATE_BLOOMED_LEAST && conserved.passed,
    detail: `${(share * 100).toFixed(2)}% of the paint round the drop moved (under ${STAMP_GATE_BLOOMED_LEAST * 100}% fails); ${conserved.detail}`,
  };
}

/**
 * Whether `subject`'s puddle gathers at its edge STAMP_GATE_RIM.least more than `without`'s, its seam holds no more
 * than STAMP_GATE_RIM.seamMost more, no pixel holds less than none, and each pigment's total holds.
 */
export function checkStampGateRimmed(id: string, pigments: readonly string[], subject: StampGateLayer, without: StampGateLayer): StampGateWashCheck {
  const rimmed = rimShares(subject, 0), still = rimShares(without, 0);
  const least = subject.values.reduce((low, v) => Math.min(low, v), Infinity);
  const conserved = checkStampGateConserved(id, pigments, subject, without);
  const problems = [
    ...(rimmed.edge < still.edge + STAMP_GATE_RIM.least ? ['the puddle has no rim'] : []),
    ...(rimmed.seam > still.seam + STAMP_GATE_RIM.seamMost ? ['the seam rims'] : []),
    ...(least < -STAMP_GATE_LAYER_TOLERANCE ? [`a pixel holds ${least}`] : []),
    ...(conserved.passed ? [] : ['a pigment\'s total drifted']),
  ];
  return {
    id: `${id}: rimmed`, passed: !problems.length,
    detail: `${problems.length ? `${problems.join('; ')}. ` : ''}the puddle's edge ${rimmed.edge.toFixed(3)} of its interior, ${still.edge.toFixed(3)} still (under +${STAMP_GATE_RIM.least} fails); the seam ${rimmed.seam.toFixed(3)}, ${still.seam.toFixed(3)} still (past +${STAMP_GATE_RIM.seamMost} fails); least ${least}; ${conserved.detail}`,
  };
}

/**
 * Whether the drying rim darkens `subject`'s feathered edge by at most STAMP_GATE_UNRIMMED_MOST of its interior, at
 * its darkest row by row, against `withoutRim`, and each pigment's total holds.
 */
export function checkStampGateUnrimmed(id: string, pigments: readonly string[], subject: StampGateLayer, withoutRim: StampGateLayer): StampGateWashCheck {
  const sum = (layer: StampGateLayer) => {
    const slots = Array.from({ length: pigments.length }, (_, slot) => stampGateSlotAmounts(layer, slot));
    return (i: number) => slots.reduce((t, amounts) => t + amounts[i], 0);
  };
  const rimmed = sum(subject), plain = sum(withoutRim);
  const [y0, y1] = STAMP_GATE_FEATHERED_EDGE.rows, [x0, x1] = STAMP_GATE_FEATHERED_EDGE.interior;
  let gained = 0;
  for (let y = y0; y < y1; y++) {
    let interior = 0, most = 0;
    for (let x = x0; x < x1; x++) interior += plain(y * subject.width + x) / (x1 - x0);
    for (let x = STAMP_GATE_FEATHERED_EDGE.from; x < STAMP_GATE_FEATHERED_EDGE.to; x++) most = Math.max(most, rimmed(y * subject.width + x) - plain(y * subject.width + x));
    gained += most / interior / (y1 - y0);
  }
  const conserved = checkStampGateConserved(id, pigments, subject, withoutRim);
  return {
    id: `${id}: unrimmed`, passed: gained <= STAMP_GATE_UNRIMMED_MOST && conserved.passed,
    detail: `its feathered edge's darkest gains ${(gained * 100).toFixed(1)}% of its interior from the rim (past ${STAMP_GATE_UNRIMMED_MOST * 100}% fails); ${conserved.detail}`,
  };
}

/**
 * Round the drop, each pixel's gain in pigment against `without` less the mean gain within LIP_REACH of it (how far
 * it stands above the bloom round it, as a lip does), with its angle about the drop; and how much moved and lay there.
 */
function dropRidges(pigments: readonly string[], subject: StampGateLayer, without: StampGateLayer) {
  const sum = (layer: StampGateLayer) => {
    const slots = pigments.map((_, slot) => stampGateSlotAmounts(layer, slot));
    return (x: number, y: number) => slots.reduce((t, amounts) => t + amounts[y * layer.width + x], 0);
  };
  const after = sum(subject), before = sum(without), gain = (x: number, y: number) => after(x, y) - before(x, y);
  const ridges: { ridge: number; angle: number }[] = [];
  let moved = 0, there = 0;
  for (let y = 0; y < subject.height; y++) {
    for (let x = 0; x < subject.width; x++) {
      const dx0 = x + 0.5 - STAMP_GATE_WET_DROP.x, dy0 = y + 0.5 - STAMP_GATE_WET_DROP.y;
      if (Math.hypot(dx0, dy0) >= STAMP_GATE_WET_DROP.radius) continue;
      moved += Math.abs(gain(x, y));
      there += before(x, y);
      let round = 0;
      for (let dy = -LIP_REACH; dy <= LIP_REACH; dy++) for (let dx = -LIP_REACH; dx <= LIP_REACH; dx++) round += gain(x + dx, y + dy);
      ridges.push({ ridge: gain(x, y) - round / (2 * LIP_REACH + 1) ** 2, angle: Math.atan2(dy0, dx0) });
    }
  }
  return { ridges, moved, there };
}

/**
 * Whether `subject`'s drop moved at least STAMP_GATE_BLOOMED_LEAST of the paint round it, raising none of it more
 * than STAMP_GATE_UNLIPPED_MOST above the bloom round it, against `without`, and each pigment's total holds.
 */
export function checkStampGateUnlipped(id: string, pigments: readonly string[], subject: StampGateLayer, without: StampGateLayer): StampGateWashCheck {
  const { ridges, moved, there } = dropRidges(pigments, subject, without);
  const darkest = ridges.map(({ ridge }) => ridge).toSorted((a, b) => b - a).slice(0, Math.ceil(ridges.length * 0.02));
  const lip = darkest.reduce((t, g) => t + g, 0) / darkest.length / (there / ridges.length), share = moved / there;
  const conserved = checkStampGateConserved(id, pigments, subject, without);
  return {
    id: `${id}: unlipped`, passed: share >= STAMP_GATE_BLOOMED_LEAST && lip <= STAMP_GATE_UNLIPPED_MOST && conserved.passed,
    detail: `${(share * 100).toFixed(2)}% of the paint round the drop moved (under ${STAMP_GATE_BLOOMED_LEAST * 100}% fails); its lip stands ${(lip * 100).toFixed(1)}% above the bloom round it (past ${STAMP_GATE_UNLIPPED_MOST * 100}% fails); ${conserved.detail}`,
  };
}

/**
 * Whether `subject`'s drop lips all round: in each of LIP_SECTORS sectors round it, its most-raised pixel stands at
 * least STAMP_GATE_LIPPED_LEAST as high as in the strongest; and each pigment's total holds.
 */
export function checkStampGateLipped(id: string, pigments: readonly string[], subject: StampGateLayer, without: StampGateLayer): StampGateWashCheck {
  const { ridges } = dropRidges(pigments, subject, without);
  const sectors = Array.from({ length: LIP_SECTORS }, () => 0);
  for (const { ridge, angle } of ridges) {
    const k = Math.min(LIP_SECTORS - 1, Math.floor(((angle + Math.PI) / (2 * Math.PI)) * LIP_SECTORS));
    sectors[k] = Math.max(sectors[k], ridge);
  }
  const weakest = Math.min(...sectors) / Math.max(...sectors), conserved = checkStampGateConserved(id, pigments, subject, without);
  return {
    id: `${id}: lipped`, passed: weakest >= STAMP_GATE_LIPPED_LEAST && conserved.passed,
    detail: `its weakest sector's lip ${(weakest * 100).toFixed(1)}% of its strongest's (under ${STAMP_GATE_LIPPED_LEAST * 100}% fails); ${conserved.detail}`,
  };
}

/** Each of the unlined case's rows' most pigment, every pigment summed, within a few pixels of its wash's edge, on average. */
function edgeMost(layer: StampGateLayer, pigments: number): number {
  const slots = Array.from({ length: pigments }, (_, slot) => stampGateSlotAmounts(layer, slot));
  const [y0, y1] = STAMP_GATE_BACKRUN_EDGE.rows;
  let sum = 0;
  for (let y = y0; y < y1; y++) {
    let most = 0;
    for (let x = STAMP_GATE_BACKRUN_EDGE.x - 6; x < STAMP_GATE_BACKRUN_EDGE.x + 16; x++) most = Math.max(most, slots.reduce((t, amounts) => t + amounts[y * layer.width + x], 0));
    sum += most;
  }
  return sum / (y1 - y0);
}

/**
 * Whether `subject`'s wash's edge holds at most STAMP_GATE_UNLINED_MOST more pigment at its darkest, row by row, than
 * `withoutBlooms`'s, and each pigment's total holds.
 */
export function checkStampGateUnlined(id: string, pigments: readonly string[], subject: StampGateLayer, withoutBlooms: StampGateLayer): StampGateWashCheck {
  const share = edgeMost(subject, pigments.length) / edgeMost(withoutBlooms, pigments.length) - 1;
  const conserved = checkStampGateConserved(id, pigments, subject, withoutBlooms);
  return {
    id: `${id}: unlined`, passed: share <= STAMP_GATE_UNLINED_MOST && conserved.passed,
    detail: `its edge's darkest ${share >= 0 ? '+' : ''}${(share * 100).toFixed(1)}% on without blooms (past +${STAMP_GATE_UNLINED_MOST * 100}% fails); ${conserved.detail}`,
  };
}
