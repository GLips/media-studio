// stamp-paint-recipe.ts: writing a stamp painting. `stampPaintRecipe` runs a body that declares groups, their passes
// and the passes' deposits in painting order, and returns the recipe as written (stamp-paint-recipe-types.ts), which
// compileStampPaintRecipe (stamp-paint-recipe-compile.ts) checks and places.
//
// Randomness comes from IDs, never order: each deposit is seeded by its ID, so adding a stroke changes no other.

import type { StampRecipePaint } from './stamp-paint-action.ts';
import type {
  StampDepositGeometry, StampFillGeometry, StampMarkPaintSettings, StampMasking, StampPaintRecipe, StampPaintRecipeDeposit, StampPaintRecipeGroup, StampPaintRecipeMask,
  StampPaintRecipePass, StampPaintRecipeStep, StampPaintScope, StampPaintSettings, StampPassOptions, StampPassScope, StampPlacementGeometry, StampStrokeGeometry,
  StampToolSettings, StampWashScope, StampWashWater,
} from './stamp-paint-recipe-types.ts';
import { stampChargeTouches, stampWashWaits } from './stamp-wash-effects.ts';

/** How much water a softening stroke carries unless it says: a damp brush, which moves an edge without flooding it. */
export const STAMP_SOFTEN_WATER = 0.3;

/** Splits a deposit's settings into where it goes and the rest. */
function splitGeometry<S extends StampToolSettings>(kind: StampDepositGeometry['kind'], settings: S & Partial<StampStrokeGeometry & StampPlacementGeometry & StampFillGeometry>) {
  const { path, hand, at, region, application, direction, load, ...rest } = settings;
  const geometries: Record<StampDepositGeometry['kind'], () => StampDepositGeometry> = {
    stroke: () => ({ kind: 'stroke', path: path!, ...(hand && { hand }) }),
    stamps: () => ({ kind: 'stamps', at: at! }),
    fill: () => ({ kind: 'fill', region: region!, ...(application && { application }), ...(direction !== undefined && { direction }), ...(load && { load }) }),
  };
  return { geometry: geometries[kind](), rest };
}

/** Writes a recipe by calling `body`, which declares groups, their passes and the passes' deposits in painting order. */
export function stampPaintRecipe(body: (paint: StampPaintScope) => void): StampPaintRecipe {
  const groups: StampPaintRecipeGroup[] = [], masks: NonNullable<StampPaintRecipeMask>[] = [];
  let fluid: StampPaintRecipeMask = null;
  const masking = (scope: readonly string[]): StampMasking => {
    const push = (op: NonNullable<StampPaintRecipeMask>['op'], id: string) => {
      fluid = { path: [...scope, id], op, under: fluid };
      masks.push(fluid);
    };
    return { mask: (id, settings) => push({ kind: 'mask', ...settings }, id), unmask: (id, settings) => push({ kind: 'unmask', ...settings }, id) };
  };
  /** Runs `inner`, then puts the fluid back as it was. */
  const scoped = (inner: () => void) => {
    const outer = fluid;
    try {
      inner();
    } finally {
      fluid = outer;
    }
  };
  type PaintSettings = StampPaintSettings & { water?: number } & Partial<StampStrokeGeometry & StampPlacementGeometry & StampFillGeometry>;
  /** A paint deposit as written, and the water its brush carries in a wash (undefined: its medium's); a dry pass drops it. */
  const paintDeposit = (kind: StampDepositGeometry['kind'], id: string, settings: PaintSettings) => {
    const { geometry, rest: { material, blend, secondaryColor, burnish, water, ...tool } } = splitGeometry(kind, settings);
    const action: StampRecipePaint = { kind: 'paint', material, ...(blend && { blend }), ...(secondaryColor && { secondaryColor }), ...(burnish && { burnish }) };
    return { deposit: { kind: 'deposit' as const, id, geometry, tool, mask: fluid, action }, water };
  };
  /** Paint from a mark as written: its brush, diameter and geometry the mark's. */
  const markDeposit = (id: string, { mark, material, blend, secondaryColor, opacity, appliedAt, drawnOver }: StampMarkPaintSettings) => ({
    kind: 'deposit' as const, id, geometry: mark.geometry, mark, mask: fluid,
    tool: { brush: mark.brush, diameter: mark.diameter, ...(opacity !== undefined && { opacity }), ...(appliedAt !== undefined && { appliedAt, ...(drawnOver !== undefined && { drawnOver }) }) },
    action: { kind: 'paint' as const, material, ...(blend && { blend }), ...(secondaryColor && { secondaryColor }) },
  });
  /** A dry pass's scope writing into `steps`: paint only. */
  const dryScope = (scope: readonly string[], steps: StampPaintRecipeDeposit<StampRecipePaint>[]): StampPassScope => {
    const paint = (kind: StampDepositGeometry['kind']) => (id: string, settings: PaintSettings) => steps.push(paintDeposit(kind, id, settings).deposit);
    return { ...masking(scope), mark: (id, settings) => steps.push(markDeposit(id, settings)), stroke: paint('stroke'), stamps: paint('stamps'), fill: paint('fill') };
  };
  /** A wash's scope writing into `steps`, and `ended`, which refuses a wait left with nothing after it to judge. */
  const washScope = (scope: readonly string[], steps: StampPaintRecipeStep[]): { wash: StampWashScope; ended: () => void } => {
    const { applied, waitUnder, wait, ended } = stampWashWaits(scope, steps);
    const paint = (kind: StampDepositGeometry['kind']) => (id: string, settings: PaintSettings) => {
      const { deposit, water } = paintDeposit(kind, id, settings);
      steps.push({ ...deposit, action: { ...deposit.action, ...(water !== undefined && { water }) } });
    };
    const water = (id: string, geometry: StampDepositGeometry, tool: StampPaintRecipeDeposit['tool'], amount: number) =>
      steps.push({ kind: 'deposit', id, geometry, tool, action: { kind: 'water', water: amount }, mask: fluid });
    const markPaint = (id: string, { water: carried, ...settings }: StampMarkPaintSettings & StampWashWater) => {
      const deposit = markDeposit(id, settings);
      steps.push({ ...deposit, action: { ...deposit.action, ...(carried !== undefined && { water: carried }) } });
    };
    const wash: StampWashScope = {
      ...masking(scope), wait, mark: applied(markPaint),
      stroke: applied(paint('stroke')), stamps: applied(paint('stamps')), fill: applied(paint('fill')),
      water: applied((id, { water: amount = 1, ...settings }) => {
        const { geometry, rest } = splitGeometry(settings.kind, settings);
        water(id, geometry, withoutKind(rest), amount);
      }),
      lift: applied((id, { strength, ...settings }) => {
        const { geometry, rest } = splitGeometry(settings.kind, settings);
        steps.push({ kind: 'deposit', id, geometry, tool: withoutKind(rest), action: { kind: 'lift', ...(strength !== undefined && { strength }) }, mask: fluid });
      }),
      soften: applied((id, { water: amount = STAMP_SOFTEN_WATER, ...settings }) => {
        const { geometry, rest } = splitGeometry('stroke', settings);
        water(id, geometry, rest, amount);
      }),
      bloom: applied((id, { water: amount = 1, ...settings }) => {
        waitUnder(1, 'bloom', id);
        const { geometry, rest } = splitGeometry('stamps', settings);
        water(id, geometry, rest, amount);
      }),
      charge: applied((id, settings) => {
        const touches = stampChargeTouches([...scope, id].join('/'), settings);
        if (settings.when === 'damp') waitUnder(touches.length, 'charge', id);
        for (const touch of touches) markPaint(`${id}${touch.suffix}`, touch.settings);
      }),
      backrun: applied((id, { along, hand, water: amount = 1, ...tool }) => {
        waitUnder(1, 'backrun', id);
        water(id, { kind: 'stroke', path: along, hand: hand ?? { profile: 'taper' } }, tool, amount);
      }),
    };
    return { wash, ended };
  };
  body({
    ...masking([]),
    group(id, options, groupBody) {
      const passes: StampPaintRecipePass[] = [];
      groups.push({ id, options, passes });
      scoped(() => groupBody({
        ...masking([id]),
        pass: (passId, passOptions, passBody) => {
          const steps: StampPaintRecipeDeposit<StampRecipePaint>[] = [];
          passes.push({ ...writtenPass(passId, passOptions), wash: null, steps });
          scoped(() => passBody(dryScope([id, passId], steps)));
        },
        knockout: (passId, { preparation }, knockoutBody) => {
          if (passes.length) throw new Error(`stamp paint: ${id}/${passId} is a knockout after ${id}'s ${passes.map((pass) => pass.id).join(', ')}; a group knocks out once, before it paints`);
          const steps: StampPaintRecipeStep[] = [];
          passes.push({ ...writtenPass(passId, {}), wash: { ...(preparation && { preparation }), knockout: true }, steps });
          scoped(() => {
            const { wash: { mask, unmask, water, lift, wait }, ended } = washScope([id, passId], steps);
            knockoutBody({ mask, unmask, water, lift, wait });
            ended();
          });
        },
        wash: (passId, { preparation, rim, ...passOptions }, washBody) => {
          const steps: StampPaintRecipeStep[] = [];
          passes.push({ ...writtenPass(passId, passOptions), wash: { ...(preparation && { preparation }), ...(rim !== undefined && { rim }), knockout: false }, steps });
          scoped(() => {
            const { wash, ended } = washScope([id, passId], steps);
            washBody(wash);
            ended();
          });
        },
      }));
    },
  });
  return { groups, masks };
}

/** A pass's settings as written. */
const writtenPass = (passId: string, { clipped = false, within }: StampPassOptions) => ({ id: passId, clipped, ...(within && { within }) });

const withoutKind = <T extends { kind?: unknown }>(settings: T): Omit<T, 'kind'> => {
  const { kind, ...rest } = settings;
  void kind;
  return rest;
};
