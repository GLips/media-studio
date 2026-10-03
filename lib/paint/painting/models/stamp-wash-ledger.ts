// stamp-wash-ledger.ts: one wash's wet bookkeeping as its deposits land at painting seconds handed to it: what each
// finds under it, the wettest its paper can stand, and its dryings. It decides no time: a recipe's waits set them
// (stamp-wash-waits.ts), or a schedule reading the paper itself.
//
// What a deposit finds goes by the closed form over the wash's earlier water whose box meets its reach: an
// overestimate, as each water is taken to wet all of its box.

import type { PaintMedium } from '#lib/paint/materials/models/paint-medium.ts';
import type { CompiledStampDeposit } from './stamp-paint-recipe-compile.ts';
import type { StampBox } from './stamp-region.ts';
import { stampFloodHeldWetness, stampWetnessAt, stampWorkableAt, type StampDrying, type StampWashDrying, type StampWetLanding } from './stamp-wetness.ts';

/** Water a wash laid: as wet as `level` at painting second `at`, as far as `box` (null for none). */
export type StampWetting = { at: number; level: number; box: StampBox | null };

export type StampWashLedgerOptions = {
  /** The wash's ID: its first drying's, and the stem of each later one's, which seed their rims. */
  id: string;
  medium: PaintMedium;
  drying: StampDrying;
  /** The water its preparation lays at painting second 0; null for dry paper. */
  preparation: StampWetting | null;
  /** What a deposit's brush carries (StampPaintMedia's waterOf), 0 for a lift. */
  waterOf: (deposit: CompiledStampDeposit) => number;
  /** Where a deposit's stamps can lay paint (stampDepositSupport), null for nowhere. */
  supportOf: (deposit: CompiledStampDeposit) => StampBox | null;
  /** How far past its support, px, a deposit's landing reads what it finds: its wet stages' reach. */
  reachOf: (deposit: CompiledStampDeposit, water: number) => number;
};

export type StampWashLedger = {
  /** Lands `deposit` at painting second `tau`: what it finds, and the water it lays. Its landing. */
  land: (deposit: CompiledStampDeposit, tau: number) => StampWetLanding;
  /**
   * Closes the drying of the deposits landed since the last, at painting second `tau`, rimming `rim` (0..2): when the
   * whole wash has `set`, or at its `end`. Nothing landed since, no drying.
   */
  dry: (tau: number, closes: StampWashDrying['closes'], rim: number) => void;
  /** The water laid so far whose box meets any of `boxes`; all of it when left out. */
  wettings: (boxes?: readonly StampBox[]) => readonly StampWetting[];
  landings: ReadonlyMap<CompiledStampDeposit, StampWetLanding>;
  /** Its dryings so far, in painting order. */
  dryings: readonly StampWashDrying[];
};

/**
 * A ledger for one wash on `options.medium`'s water, drying as `options.drying` says. Painting time only moves
 * forward: a landing or drying before the last refused.
 */
export function createStampWashLedger({ id, medium, drying, preparation, waterOf, supportOf, reachOf }: StampWashLedgerOptions): StampWashLedger {
  const wettings: StampWetting[] = preparation ? [preparation] : [];
  const landings = new Map<CompiledStampDeposit, StampWetLanding>(), dryings: StampWashDrying[] = [];
  let now = 0, since: CompiledStampDeposit[] = [];
  /** The wettest any of the wash's water can still stand at `tau`: what a drying starts from. */
  const standing = (tau: number) => Math.min(1, Math.max(0, ...wettings.map(({ level, at }) => stampWetnessAt(level, at, tau, drying))));
  let wettest = standing(0);
  const advance = (tau: number) => {
    if (tau < now) throw new Error(`stamp wash ${id}: painting time runs forward, and ${tau} s comes before ${now} s`);
    now = tau;
  };
  const meeting = (boxes: readonly StampBox[]) => wettings.filter(({ box }) => meetsAny(box, boxes));
  return {
    land: (deposit, tau) => {
      advance(tau);
      const water = waterOf(deposit), support = supportOf(deposit);
      const reach = support && grown(support, reachOf(deposit, water));
      const under = meeting(reach ? [reach] : []);
      const landing: StampWetLanding = {
        tau, water, medium, drying,
        finds: {
          wet: under.some(({ level, at }) => stampWetnessAt(level, at, tau, drying) > 0),
          workable: under.some(({ level, at }) => stampWorkableAt(level, at, tau, drying) > 0),
        },
      };
      landings.set(deposit, landing);
      if (water > 0 && deposit.action.kind !== 'lift') {
        wettings.push({ at: tau, level: water, box: support });
        wettest = Math.max(wettest, Math.min(1, water), stampFloodHeldWetness(deposit, landing));
      }
      since.push(deposit);
      return landing;
    },
    dry: (tau, closes, rim) => {
      advance(tau);
      if (since.length) dryings.push({ id: dryings.length ? `${id}|dry${dryings.length}` : id, deposits: since, rim, at: tau, closes, wettest });
      since = [];
      wettest = standing(tau);
    },
    wettings: (boxes) => (boxes ? meeting(boxes) : [...wettings]),
    landings,
    dryings,
  };
}

/** `box` grown by `pad` px on every side. */
const grown = ({ x0, y0, x1, y1 }: StampBox, pad: number): StampBox => ({ x0: x0 - pad, y0: y0 - pad, x1: x1 + pad, y1: y1 + pad });

/** Whether `box` overlaps any of `boxes`: none for a box of nothing. */
const meetsAny = (box: StampBox | null, boxes: readonly StampBox[]) =>
  !!box && boxes.some((other) => box.x0 < other.x1 && other.x0 < box.x1 && box.y0 < other.y1 && other.y0 < box.y1);
