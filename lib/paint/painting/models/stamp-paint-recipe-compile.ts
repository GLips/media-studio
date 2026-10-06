// stamp-paint-recipe-compile.ts: a recipe as written (stamp-paint-recipe-types.ts) checked, every stamp placed, its
// groups in the order they paint, and the compiled painting the renderer and the wetness model read.
//
// Randomness comes from IDs, never order: each deposit is seeded by its ID, so adding a stroke changes no other.

import type { StampBlend, StampBrush } from '#lib/paint/brush/models/stamp-brush.ts';
import type { FrozenStampMarks } from '#lib/paint/brush/models/stamp-placement.ts';
import { compileDeposit } from './stamp-deposit-compile.ts';
import type { StampFloodEdge } from './stamp-fill.ts';
import { stampPaintFieldEnds, stampPaintFieldProblem, stampSeededPaintField, type StampSeededPaintField } from './stamp-paint-field.ts';
import { compilePaintAction, compileWashAction, type CompiledStampAction, type CompiledStampPaintAction, type StampRecipeWashAction } from './stamp-paint-action.ts';
import { compileStampArea, stampFluidHolder, stampStandsBeforeExclusions, type CompiledStampArea } from './stamp-area.ts';
import { compileStampBrushedMask, stampResistHolder, type CompiledStampBrushedMask } from './stamp-brushed-mask.ts';
import { compileStampGroupMotion, type CompiledStampGroupMotion, type StampGroupBoil, type StampGroupPaper } from './stamp-group-motion.ts';
import { stampKeysSpan } from './stamp-scene-keys.ts';
import type { StampPaintMixing, StampPigmentMixing } from './stamp-pigment-paint.ts';
import { checkedStampPolygon, type StampGrid } from './stamp-region.ts';
import type { StampMark } from './stamp-marks.ts';
import { checkedStampIdSegment, stampDepositNameText } from './stamp-deposit-identity.ts';
import type { StampDepositWithin, StampPaintPaper, StampPaintRecipe, StampPaintRecipeDeposit, StampPaintRecipeGroup, StampPaintRecipeMask, StampPaintRecipeResist } from './stamp-paint-recipe-types.ts';
import { checkedStampRim, compileStampWashWait, type CompiledStampWash, type CompiledStampWashStep } from './stamp-wash-effects.ts';
import type { StampRestMap } from './stamp-rest-map.ts';
import type { StampWrapFrom } from './stamp-stage.ts';

/**
 * The fluid a deposit lands under: its latest op over the fluid before it, null for none. Deposits under the same
 * fluid share one object, so the renderer works each out once.
 */
export type CompiledStampMask = {
  /**
   * `<scope>/<op>`, unique in the painting; or `<group>/stands-before`, a group's reserve over the fluid of each
   * deposit of the groups it stands before, last, so none of their unmasks lifts it; or `<group>/<resist>`, wax over
   * the fluid of its group's later deposits, above their unmasks too.
   */
  id: string;
  under: CompiledStampMask | null;
} & ({ kind: 'mask'; area: CompiledStampArea } | { kind: 'brushed'; brushed: CompiledStampBrushedMask } | { kind: 'unmask'; amount: number; area: CompiledStampArea | null });

/**
 * What a flood holds beside its stamps (stamp-fill.ts's StampFloodPlacement): `barrier`, the line its paint and water
 * stop at (stampFloodBarrier), its water over all within it; `scale`, the local share of its diameter its water
 * reaches by; and its load.
 */
export type CompiledStampFlood = { edge: StampFloodEdge; barrier: CompiledStampArea; scale: StampGrid; load: StampSeededPaintField<number> };

type CompiledStampDepositCommon<A extends CompiledStampAction> = {
  /** `<group>/<pass>/<deposit>`, unique in the painting: the seed of every stamp in it. */
  id: string;
  brush: StampBrush;
  action: A;
  /** Where the brush's grain and its dual's start, as shares of their tiles: each deposit's own, by offset jitter. */
  grainOffset: { main: readonly [number, number]; dual: readonly [number, number] };
  /** The stamp's diameter at full size, as the deposit states it: what its texturized grain and edges scale with. */
  diameter: number;
  blend: StampBlend;
  opacity: number;
  /** The fluid it lands under. */
  mask: CompiledStampMask | null;
  /** The areas of the applications it was written under, its pass's `within` apart; absent for none. */
  within?: readonly CompiledStampArea[];
  /** Every stamp of the deposit, in the order laid: a flood's are its edge stroke's. */
  stamps: FrozenStampMarks;
  /** The brush's dual stamps, placed by its own settings along the same stroke, in the order laid; none without one. */
  dualStamps: FrozenStampMarks;
  /**
   * For a deposit a pose moved (ENGINE 5.3), the map back to where it was planned: its paint's and a flood's load
   * fields, a flood's local scale and its pigment's clumps are read there. Absent: where it lies.
   */
  rest?: StampRestMap;
  /**
   * On a sheet that wraps, where its pixels are read within a wrap of, before `rest` (stamp-sheet-wrap.ts): its copies
   * past a seam read its fields as it does. Absent elsewhere.
   */
  wrapFrom?: StampWrapFrom;
};

/**
 * A stroke's stamps overlap along its path (a fill laid in strokes is one); placed stamps each land alone; a flood is
 * strokes of its brush filling a region, stopped at its barrier.
 */
export type CompiledStampDeposit<A extends CompiledStampAction = CompiledStampAction> = CompiledStampDepositCommon<A> & ({ kind: 'stroke' | 'stamps' } | { kind: 'flood'; flood: CompiledStampFlood });

/** A passage without wet history, `dry`, its deposits all paint (each lands as vid-83's paint does), or with one, a `wash`. */
export type CompiledStampPass = {
  /** `<group>/<pass>`. */
  id: string;
  /** The pass this one is clipped to, by ID: it lands only where that pass holds paint. Absent for an unclipped pass. */
  clipTo?: string;
  /** The area it lands within; null for none. */
  within: CompiledStampArea | null;
} & ({ kind: 'dry'; deposits: readonly CompiledStampDeposit<CompiledStampPaintAction>[] } | { kind: 'wash'; wash: CompiledStampWash; knockout: boolean });

const washDeposits = new WeakMap<CompiledStampWash, readonly CompiledStampDeposit[]>();

/** What seeds deposit `id`'s randomness at boil `epoch`: its ID as written at 0, and a seed of the epoch's own after. */
export const stampBoilSeed = (id: string, epoch: number) => (epoch ? `${id}|boil${epoch}` : id);

/** `pass`'s deposits in painting order: a wash's are its schedule's, worked out once per wash. */
export function stampPassDeposits(pass: CompiledStampPass): readonly CompiledStampDeposit[] {
  if (pass.kind === 'dry') return pass.deposits;
  let deposits = washDeposits.get(pass.wash);
  if (!deposits) washDeposits.set(pass.wash, (deposits = pass.wash.schedule.flatMap((step) => (step.kind === 'deposit' ? [step.deposit] : []))));
  return deposits;
}

/** How much an opaque group's coverage is raised as it lands, in flat colour and pigment alike: paint at half its density or more covers. */
export const STAMP_OPAQUE_COVER = 2;

export type CompiledStampGroup = {
  id: string; composite: 'opaque' | 'glaze'; opacity: number; paper: StampGroupPaper; passes: readonly CompiledStampPass[];
  /** Absent for a group in the painting's mixing. */
  mixing?: StampPigmentMixing;
  /** Absent for a group that stays where it's painted. */
  motion?: CompiledStampGroupMotion;
  /** The scene seconds over which its paint changes (a keyed material's first key to its last); absent for paint that doesn't. */
  recolours?: { from: number; to: number };
  /**
   * Absent for a group painted once. `epoch`: which of its boil's paintings this is (0, as written); `reseeded`
   * compiles this group alone at another epoch, each deposit's randomness drawn afresh and its ID, fluid and colour
   * kept, so an epoch reshapes marks but never repaints the palette.
   */
  boil?: StampGroupBoil & { epoch: number; reseeded: (epoch: number) => CompiledStampGroup };
};

/** Whether `group` takes out of the paint behind it: its first pass is a knockout, as only a first may be. */
export const stampGroupKnocksOut = ({ passes: [first] }: { passes: readonly ({ kind: 'dry' } | { kind: 'wash'; knockout: boolean })[] }) => first?.kind === 'wash' && first.knockout;

/** A checked recipe with every stamp placed, its groups in the order they paint, and the paper and mixing it's painted in. */
export type CompiledStampPaint = { paper: StampPaintPaper; mixing: StampPaintMixing; groups: readonly CompiledStampGroup[] };

/**
 * What a painting's paint is mixed from (stampPaintCompositorFor): its paper and mixing, and each group's passes and
 * their deposits. A recipe's painting gives one (stampMixedPainting); a document's solve, holding no
 * CompiledStampPaint, builds its own.
 */
export type StampMixedPainting = { paper: StampPaintPaper; mixing: StampPaintMixing; groups: readonly StampMixedGroup[] };
/** A group as its paint is mixed: its ID, its own mixing (absent for the painting's), the paper it lies on, its passes. */
export type StampMixedGroup = Pick<CompiledStampGroup, 'id' | 'mixing' | 'paper'> & { passes: readonly StampMixedPass[] };
/** A pass as its paint is mixed: its ID and its deposits in painting order, a dry pass's all paint, a wash's knocking out or not. */
export type StampMixedPass = { id: string } & (
  | { kind: 'dry'; deposits: readonly CompiledStampDeposit<CompiledStampPaintAction>[] }
  | { kind: 'wash'; knockout: boolean; deposits: readonly CompiledStampDeposit[] }
);

/** `painting` as its paint is mixed. */
export const stampMixedPainting = ({ paper, mixing, groups }: CompiledStampPaint): StampMixedPainting => ({
  paper, mixing,
  groups: groups.map((group) => ({
    id: group.id, mixing: group.mixing, paper: group.paper,
    passes: group.passes.map((pass): StampMixedPass => (pass.kind === 'dry'
      ? { id: pass.id, kind: 'dry', deposits: pass.deposits }
      : { id: pass.id, kind: 'wash', knockout: pass.knockout, deposits: stampPassDeposits(pass) })),
  })),
});

/**
 * Checks `recipe` and places every stamp. Throws on an ID used twice at one level (it would seed two deposits alike)
 * or holding `/` or `|` (the seed's separators), a pass clipped to one it can't be (clipTo), a deposit with no points
 * or diameter, a region that isn't a shape, or any number out of its range.
 */
export function compileStampPaintRecipe(recipe: StampPaintRecipe): CompiledStampPaint {
  const seen = new Set<string>(), duplicates = new Set<string>();
  /** `id` claimed under `parent`, each of its segments checked (a deposit's name has its iterations' segments). */
  const claim = (id: string, parent?: string) => {
    id.split('/').forEach(checkedStampIdSegment);
    const full = parent ? `${parent}/${id}` : id;
    if (seen.has(full)) duplicates.add(full);
    seen.add(full);
    return full;
  };
  const marks = new Map<string, StampMark>();
  /** A mark's key held to one mark: two alike would land the same stamps. */
  const claimMark = (mark: StampMark) => {
    if (!mark.key || mark.key.includes('|')) throw new Error(`stamp paint: "${mark.key}" isn't a mark's key: a key is non-empty and holds no "|"`);
    if ((marks.get(mark.key) ?? mark) !== mark) throw new Error(`stamp paint: two marks share the key ${mark.key}, and would land the same stamps`);
    marks.set(mark.key, mark);
  };
  const masks = new Map<NonNullable<StampPaintRecipeMask>, CompiledStampMask>();
  for (const node of recipe.masks) {
    const { path, op, under } = node;
    const full = claim(path.at(-1)!, path.slice(0, -1).join('/') || undefined);
    const common = { id: full, under: under ? masks.get(under)! : null };
    if (op.kind === 'mask' && 'marks' in op) {
      op.marks.forEach(claimMark);
      masks.set(node, { ...common, kind: 'brushed', brushed: compileStampBrushedMask(full, op.marks, null) });
      continue;
    }
    if (op.kind === 'mask') {
      masks.set(node, { ...common, kind: 'mask', area: compileStampArea(op, full) });
      continue;
    }
    const amount = op.amount ?? 1;
    if (!(amount >= 0 && amount <= 1)) throw new Error(`stamp paint: ${full} lifts ${amount} of the fluid, and an unmask lifts 0..1 of it`);
    masks.set(node, { ...common, kind: 'unmask', amount, area: op.region ? compileStampArea(op, full) : null });
  }
  // Each group's wax, oldest first under each resist as written.
  const waxes = new Map<NonNullable<StampPaintRecipeResist>, readonly CompiledStampBrushedMask[]>();
  for (const node of recipe.resists) {
    const { path, settings, under } = node, full = claim(path.at(-1)!, path[0]);
    settings.marks.forEach(claimMark);
    waxes.set(node, [...(under ? waxes.get(under)! : []), compileStampBrushedMask(full, settings.marks, { amount: settings.amount ?? 1 })]);
  }
  const resisted = stampResistHolder();
  /** `fluid` with the wax written before it (`resist`) over it, as an epoch's deposits share it. */
  const waxed = (fluid: CompiledStampMask | null, resist: StampPaintRecipeResist | undefined) => (resist ? resisted(fluid, waxes.get(resist)!) : fluid);
  // Groups in the order they paint; a standing before reaches only groups earlier in it.
  const resolved = recipe.groups.map((group, written) => ({ written, order: group.options.order ?? 0, depth: group.options.depth ?? 0, group }));
  resolved.sort((a, b) => a.order - b.order || b.depth - a.depth || a.written - b.written);
  const exclusions = stampStandsBeforeExclusions(resolved.map(({ group: { id, options } }) => ({ id, ...(options.standsBefore && { standsBefore: options.standsBefore }) })));
  const holders = new Map(resolved.map(({ group: { id } }) => [id, stampFluidHolder(exclusions.get(id) ?? [])]));
  /**
   * `group` compiled with every deposit seeded for boil `epoch` (0: as written). IDs are claimed only as written:
   * an epoch's are those same IDs, checked already.
   */
  const compileGroup = ({ id, options, passes }: StampPaintRecipeGroup, epoch: number): CompiledStampGroup => {
    const named = epoch ? (child: string, parent?: string) => (parent ? `${parent}/${child}` : child) : claim;
    const groupId = named(id), held = holders.get(id)!;
    const compiledWithin = new Map<readonly StampDepositWithin[], readonly CompiledStampArea[]>();
    /** An application's areas, compiled once for every deposit written under it. */
    const withinOf = (within: readonly StampDepositWithin[] | undefined) => {
      if (!within) return undefined;
      let compiled = compiledWithin.get(within);
      if (!compiled) compiledWithin.set(within, (compiled = within.map(({ area, seed }) => compileStampArea(area, seed))));
      return compiled;
    };
    const compiledPasses = passes.map((pass, index): CompiledStampPass => {
      const passId = named(pass.id, groupId);
      if (pass.wash?.knockout) {
        if (index > 0) throw new Error(`stamp paint: ${passId} is a knockout after ${groupId}'s first pass; a group knocks out once, before it paints`);
        const painted = pass.steps.flatMap((step) => (step.kind === 'deposit' && step.action.kind === 'paint' ? [step] : []))[0];
        if (painted) throw new Error(`stamp paint: ${passId} is a knockout and ${stampDepositNameText(painted.name)} paints in it; a knockout only reserves and lifts`);
      }
      const clipTo = pass.clipTo && `${groupId}/${checkedClipBase(passes, index, groupId)}`;
      /** `step` compiled, its action by `action` from the colour jitter drawn for it, placed from its mark's key or its own ID. */
      const deposit = <W extends StampRecipeWashAction, A extends CompiledStampAction>(step: StampPaintRecipeDeposit<W>, action: (full: string, draws: readonly number[]) => A) => {
        // Its name seeds it and its provenance never does: wrapping it in an application moves nothing.
        if (!epoch) [...step.name.items, step.name.id, ...step.name.keys].forEach(checkedStampIdSegment);
        const full = named(stampDepositNameText(step.name), passId), fluid = step.mask && masks.get(step.mask)!;
        if (step.mark && !epoch) claimMark(step.mark);
        // A knockout acts on the paint behind the group, which neither a standing before nor the group's wax holds off.
        const reserved = pass.wash?.knockout ? fluid : held(waxed(fluid, step.resist));
        return compileDeposit(full, step, (draws) => action(full, draws), reserved, stampBoilSeed(step.mark?.key ?? full, epoch), withinOf(step.within));
      };
      const common = { id: passId, ...(clipTo && { clipTo }), within: pass.within ? compileStampArea(pass.within, passId) : null };
      if (!pass.wash) {
        // Deposits before kind, as the stamp gate's input prints have held a dry pass since vid-117's Phase 0.
        return { ...common, deposits: pass.steps.map((step) => deposit(step, (full, draws) => compilePaintAction(full, step.action, step.tool.brush, draws))), kind: 'dry' };
      }
      const schedule = pass.steps.map((step): CompiledStampWashStep => {
        if (step.kind === 'deposit') return { kind: 'deposit', deposit: deposit(step, (full, draws) => compileWashAction(full, step.action, step.tool.brush, draws)) };
        return compileStampWashWait(step, passId);
      });
      const { preparation, rim, knockout, strict } = pass.wash;
      if (rim !== undefined) checkedStampRim(rim, passId);
      let prepared: CompiledStampWash['preparation'] = null;
      if (preparation) {
        const wetness = preparation.wetness ?? { kind: 'constant' as const, value: 1 };
        const problem = stampPaintFieldProblem(wetness, (value) => (value >= 0 && value <= 1 ? null : `a wetness of ${value}, outside 0..1`));
        if (problem) throw new Error(`stamp paint: ${passId}'s preparation can't be laid: ${problem}`);
        const reserved = knockout ? null : held(waxed(null, pass.resist));
        prepared = { polygon: checkedStampPolygon(preparation.region, passId), wetness: stampSeededPaintField(wetness, passId), ...(reserved && { held: reserved }) };
      }
      return { ...common, kind: 'wash', wash: { preparation: prepared, schedule, ...(rim !== undefined && { rim }), ...(strict && { strict }) }, knockout };
    });
    const opacity = options.composite === 'glaze' ? options.opacity : 1;
    const { boil } = options, motion = options.motion && compileStampGroupMotion(options.motion, groupId);
    if (boil && !(Number.isInteger(boil.every) && boil.every >= 1)) throw new Error(`stamp paint: ${groupId} boils every ${boil.every} frames, and a boil repaints every whole number of frames from 1`);
    const written = { id, options, passes };
    const recolours = stampGroupRecolours(compiledPasses);
    return {
      id: groupId, composite: options.composite, opacity, paper: options.paper ?? 'ground', passes: compiledPasses, ...(options.mixing && { mixing: options.mixing }),
      ...(motion && { motion }), ...(recolours && { recolours }),
      ...(boil && { boil: { every: boil.every, epoch, reseeded: (next: number) => compileGroup(written, next) } }),
    };
  };
  const groups = resolved.map(({ group }) => compileGroup(group, 0));
  if (duplicates.size) throw new Error(`stamp paint: IDs used twice, which would seed two deposits alike: ${[...duplicates].join(', ')}`);
  const { paper, mixing } = recipe.environment;
  return { paper, mixing, groups };
}

/**
 * The pass `passes[index]` is clipped to, by its ID, checked: an earlier pass of its group, unclipped and no knockout
 * (which holds none of the group's paint), with only passes clipped to it between, as the renderer keeps one clip's
 * coverage at a time.
 */
function checkedClipBase(passes: StampPaintRecipeGroup['passes'], index: number, groupId: string): string {
  const pass = passes[index], base = pass.clipTo!, at = passes.findIndex(({ id }) => id === base);
  const refused = (why: string) => new Error(`stamp paint: ${groupId}/${pass.id} is clipped to ${base}, ${why}`);
  if (at < 0 || at >= index) throw refused(`which isn't a pass of ${groupId} before it`);
  if (passes[at].clipTo || passes[at].wash?.knockout) throw refused('and a pass clips only to an unclipped one that paints');
  const between = passes.slice(at + 1, index).find((other) => other.clipTo !== base);
  if (between) throw refused(`and ${between.id} comes between unclipped to it`);
  return base;
}

/** The scene seconds over which `passes`' paint changes, every keyed material's span joined; null for none. */
function stampGroupRecolours(passes: readonly CompiledStampPass[]): CompiledStampGroup['recolours'] | null {
  const spans = passes.flatMap((pass) => stampPassDeposits(pass)).flatMap(({ action }) => {
    if (action.kind !== 'paint') return [];
    const { first, second } = stampPaintFieldEnds(action.material);
    return [first, second].flatMap((end) => (end.kind === 'keys' ? [stampKeysSpan(end.keys)] : []));
  });
  return spans.length ? { from: Math.min(...spans.map(({ from }) => from)), to: Math.max(...spans.map(({ to }) => to)) } : null;
}

/**
 * Everything a render reads of `painting`, as text: each stamp and draw, fluid and wash schedule, and each
 * boiled group's next epoch. Two paintings printing alike paint alike, wetness too, which compileStampWetness works
 * out from nothing else: how a check proves that organising a recipe moved none of it.
 */
export function stampCompiledPaintPrint(painting: CompiledStampPaint): string {
  const boils = painting.groups.flatMap(({ boil }) => (boil ? [boil.reseeded(boil.epoch + 1)] : []));
  return JSON.stringify({ painting, boils });
}
