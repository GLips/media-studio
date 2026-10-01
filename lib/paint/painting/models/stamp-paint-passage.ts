// stamp-paint-passage.ts: writing one passage. Its scope (StampPassageScope) writes deposits and waits into the
// passage's history in painting order and, beside it, the tree of applications the score shares scene time over
// (stamp-paint-score.ts); a technique (stamp-technique.ts) is one application whose ops write through a scope bound
// to it. Ending the passage allots each deposit its reveal and settles whether it keeps a wet history.
//
// Randomness comes from names, never order or organisation: an application's ID enters provenance only.

import { checkPaintCapability, paintMediumCan, type PaintCapability, type PaintMedium } from '#lib/paint/materials/models/paint-medium.ts';
import type { StampBrush } from '#lib/paint/brush/models/stamp-brush.ts';
import type { StampRecipePaint, StampRecipeWashAction } from './stamp-paint-action.ts';
import { checkedStampIdSegment, stampDepositId, stampDepositNameText, type StampDepositName, type StampPassageIdentity } from './stamp-deposit-identity.ts';
import { pickStampMaterial } from './stamp-material-set.ts';
import type { StampMark } from './stamp-marks.ts';
import { allocateStampScore, type StampChildTiming, type StampScoreNode, type StampScoreOptions } from './stamp-paint-score.ts';
import { stampSizePx, stampSizeRangePx, type StampSize, type StampSizeRange } from './stamp-paint-sizes.ts';
import type { StampWithin } from './stamp-area.ts';
import type { StampRegion } from './stamp-region.ts';
import type {
  StampApplicationOptions, StampDepositGeometry, StampDepositWithin, StampFillOptions, StampLiftOptions, StampMarkPaintOptions, StampMasking, StampPaintEnvironment,
  StampPaintRecipeDeposit, StampPaintRecipeMask, StampPaintRecipePass, StampPaintRecipeStep, StampPassageDefaults, StampPassageOptions, StampPassageScope, StampPlacementOptions,
  StampResolvedGeometry, StampStrokeOptions, StampWaterOptions, StampWell,
} from './stamp-paint-recipe-types.ts';
import type { StampCondition, StampWaitEffect, StampWashWait, StampWetEffectKind } from './stamp-wash-effects.ts';

/** What a passage is written in: its painting's environment, its group's medium (null for flat colour) and fluid. */
export type StampPassageHost = {
  environment: StampPaintEnvironment;
  medium: PaintMedium | null;
  group: string;
  fluid: () => StampPaintRecipeMask;
  /** Masking in the scope `path` names (its group's ID, its passage's, the name's segments). */
  masking: (path: (id: string) => readonly string[]) => StampMasking;
};

/** How a scope names what it writes: a passage's ops by their IDs, under each keyed iteration's segments. */
type StampNamer = { name: (id: string) => StampDepositName; item: (key: string, itemKey: string) => StampNamer };
const passageNamer = (items: readonly string[]): StampNamer => ({
  name: (id) => ({ items, id, keys: [] }),
  item: (key, itemKey) => passageNamer([...items, key, itemKey]),
});
/** Inside a technique invoked as `base`: its ops are child keys of it, and an op given its own ID `own` is it. */
const keyedNamer = (base: StampDepositName, own?: string): StampNamer => ({
  name: (id) => (id === own ? base : { ...base, keys: [...base.keys, id] }),
  item: (key, itemKey) => keyedNamer({ ...base, keys: [...base.keys, key, itemKey] }),
});

type StampPassageState = {
  host: StampPassageHost;
  identity: StampPassageIdentity;
  full: string;
  options: StampPassageOptions;
  knockout: boolean;
  steps: StampPaintRecipeStep[];
  lifts: boolean;
};

/** Where a scope writes: its passage, its namer, the application its calls are children of, and what they inherit. */
type StampPassageWriter = {
  state: StampPassageState;
  namer: StampNamer;
  node: StampScoreNode<StampPaintRecipeDeposit>;
  provenance: readonly string[];
  within: readonly StampDepositWithin[] | undefined;
  defaults: StampPassageDefaults;
};

const writers = new WeakMap<object, StampPassageWriter>();

/** Throws, naming `what`, unless the passage can keep a wet history: its medium has one and it doesn't give it up. */
function checkWetHistory({ host, options, knockout }: StampPassageState, what: string, capability: PaintCapability = 'wet-history') {
  checkPaintCapability(host.medium, capability, what);
  if (capability !== 'wet-history') checkPaintCapability(host.medium, 'wet-history', what);
  if (options.wetHistory === false && !knockout) throw new Error(`stamp paint: ${what} needs its passage's wet history, which wetHistory: false gives up`);
}

/** A new application `id` under `writer`'s, refused if a sibling has its ID. */
function application(writer: StampPassageWriter, id: string, score: StampScoreOptions, kind: StampScoreNode<unknown>['kind'], own: { weight?: number; timing?: StampChildTiming } = {}) {
  const path = `${writer.node.path}/${checkedStampIdSegment(id)}`;
  if (writer.node.children.some((child) => child.path === path)) throw new Error(`stamp paint: two applications are named ${path}; an application's ID is unique among its siblings`);
  const node: StampScoreNode<StampPaintRecipeDeposit> = { path, score, kind, deposits: [], children: [], ...own };
  writer.node.children.push(node);
  return node;
}

/** Throws, naming `what`, if `within` merges a stretch where the passage keeps no wet history to merge it in. */
function checkMerges(state: StampPassageState, within: StampWithin | undefined, what: string) {
  const merged = Object.entries(within?.boundaries ?? {}).find(([, { treatment }]) => treatment === 'merge');
  if (merged) checkWetHistory(state, `${what}'s merged boundary ${merged[0]}`);
}

/** `writer` for `node`'s calls: their within narrowed by `within`, seeded by the application's name. */
function under(writer: StampPassageWriter, node: StampScoreNode<StampPaintRecipeDeposit>, id: string, within: StampApplicationOptions['within']): StampPassageWriter {
  const seed = `${writer.state.full}|${stampDepositNameText(writer.namer.name(id))}`;
  checkMerges(writer.state, within, node.path);
  return { ...writer, node, provenance: [...writer.provenance, id], ...(within && { within: [...(writer.within ?? []), { area: within, seed }] }) };
}

/** Runs `write`, then stands a wait until `when` before what it wrote, judging those deposits by name. */
function conditioned(writer: StampPassageWriter, when: StampCondition | undefined, effect: StampWaitEffect | undefined, what: string, write: () => void) {
  if (!when) return write();
  const { steps } = writer.state, first = steps.length;
  checkWetHistory(writer.state, `${what}'s condition (when: '${when}')`, 'wet-conditions');
  write();
  const deposits = steps.slice(first).flatMap((step) => (step.kind === 'deposit' ? [step.name] : []));
  steps.splice(first, 0, { kind: 'wait', until: when, under: { deposits }, ...(effect && { effect }) });
}

const missing = (full: string, what: string): never => {
  throw new Error(`stamp paint: ${full} has no ${what}: give it one, or its passage a default`);
};

/** What `writer`'s op `full` takes, from its own setting, else its defaults. */
const resolvers = (writer: StampPassageWriter, full: string) => ({
  brush: (given: StampBrush | undefined) => given ?? writer.defaults.brush ?? missing(full, 'brush'),
  well: (given: StampWell | undefined) => given ?? writer.defaults.well ?? missing(full, 'well'),
  size: (given: StampSize | undefined) => stampSizePx(given ?? writer.defaults.size ?? missing(full, 'size'), writer.state.host.environment.sheet, full),
  sizeRange: (given: StampSizeRange | undefined) => stampSizeRangePx(given ?? writer.defaults.size ?? missing(full, 'size'), writer.state.host.environment.sheet, full),
});

/** Writes deposit `id`, under the fluid as it stands. */
function lay(writer: StampPassageWriter, node: StampScoreNode<StampPaintRecipeDeposit>, id: string, written: Pick<StampPaintRecipeDeposit, 'geometry' | 'tool' | 'action'> & { mark?: StampMark }) {
  const deposit: StampPaintRecipeDeposit = {
    kind: 'deposit', name: writer.namer.name(id), provenance: writer.provenance, ...written, mask: writer.state.host.fluid(), ...(writer.within && { within: writer.within }),
  };
  node.deposits.push(deposit);
  writer.state.steps.push(deposit);
}

/** Paint as written from `well`, one material picked for deposit `full` from a set; its water needs the wet history. */
function loaded(writer: StampPassageWriter, full: string, well: StampWell, rest: Omit<StampRecipePaint, 'kind' | 'material'>): StampRecipeWashAction {
  const material = well.paint.kind === 'set' ? pickStampMaterial(well.paint, `${full}|material`) : well.paint;
  if (well.water !== undefined) checkWetHistory(writer.state, `${full}'s well water`);
  if (rest.burnish) checkPaintCapability(writer.state.host.medium, 'burnish', `${full}'s burnish`);
  return { kind: 'paint', material, ...rest, ...(well.water !== undefined && { water: well.water }) };
}

/** `geometry` as compiled reads it: a fill with no region of its own covers the passage's area. */
function resolvedGeometry({ state }: StampPassageWriter, full: string, geometry: StampDepositGeometry): StampResolvedGeometry {
  if (geometry.kind === 'stroke') return { kind: 'stroke', path: geometry.path, ...(geometry.hand && { hand: geometry.hand }) };
  if (geometry.kind === 'stamps') return { kind: 'stamps', at: geometry.at };
  const { application: laid, direction, load } = geometry;
  const region = geometry.region ?? state.options.area;
  if (!region) throw new Error(`stamp paint: ${full} fills no region: give it one, or its passage an area`);
  return { kind: 'fill', region, ...(laid && { application: laid }), ...(direction !== undefined && { direction }), ...(load && { load }) };
}

const splitScore = ({ weight, reveal, children }: StampScoreOptions): StampScoreOptions => ({
  ...(weight !== undefined && { weight }), ...(reveal && { reveal }), ...(children && { children }),
});

/** A raw op `id`, a singleton application: `write` lays its deposit through the writer bound to it. */
function rawOp(writer: StampPassageWriter, id: string, options: StampApplicationOptions & { when?: StampCondition }, write: (bound: StampPassageWriter, full: string) => void) {
  const node = application(writer, id, splitScore(options), 'op'), bound = under(writer, node, id, options.within);
  const full = stampDepositId(writer.state.identity, writer.namer.name(id));
  conditioned(bound, options.when, undefined, full, () => write({ ...bound, provenance: writer.provenance }, full));
}

/** The scope `writer` writes through. */
function passageScope(writer: StampPassageWriter): StampPassageScope {
  const { state } = writer, { host } = state;
  const deposit = (bound: StampPassageWriter, id: string, written: Parameters<typeof lay>[3]) => lay(bound, bound.node, id, written);
  const paint = (kind: StampDepositGeometry['kind']) => (id: string, options: StampStrokeOptions | StampPlacementOptions | StampFillOptions) => rawOp(writer, id, options, (bound, full) => {
    const { brush, size, opacity, well, blend, secondaryColor, burnish } = options, take = resolvers(bound, full);
    deposit(bound, id, {
      // SAFETY: each paint method takes its own geometry's settings; resolvedGeometry reads only `kind`'s.
      geometry: resolvedGeometry(bound, full, { ...options, kind } as StampDepositGeometry),
      tool: { brush: take.brush(brush), diameter: take.size(size), ...(opacity !== undefined && { opacity }) },
      action: loaded(bound, full, take.well(well), { ...(blend && { blend }), ...(secondaryColor && { secondaryColor }), ...(burnish && { burnish }) }),
    });
  });
  const clean = (verb: 'water' | 'lift') => (id: string, options: StampWaterOptions & StampLiftOptions) => rawOp(writer, id, options, (bound, full) => {
    if (verb === 'water') checkWetHistory(state, `${full}'s water`);
    else {
      checkPaintCapability(host.medium, 'lift', `${full}'s lift`);
      // A wet medium's lift takes up open paint, which only a wet history holds.
      if (paintMediumCan(host.medium, 'wet-history')) checkWetHistory(state, `${full}'s lift`);
      state.lifts = true;
    }
    const { brush, size, opacity, amount = 1, strength } = options, take = resolvers(bound, full);
    deposit(bound, id, {
      geometry: resolvedGeometry(bound, full, options), tool: { brush: take.brush(brush), diameter: take.size(size), ...(opacity !== undefined && { opacity }) },
      action: verb === 'water' ? { kind: 'water', water: amount } : { kind: 'lift', ...(strength !== undefined && { strength }) },
    });
  });
  const scope: StampPassageScope = {
    ...host.masking((id) => [state.identity.group, state.identity.passage, ...stampDepositNameText(writer.namer.name(id)).split('/')]),
    stroke: paint('stroke'), stamps: paint('stamps'), fill: paint('fill'), water: clean('water'), lift: clean('lift'),
    mark: (id, options: StampMarkPaintOptions) => rawOp(writer, id, options, (bound, full) => {
      const { mark, well, blend, secondaryColor, opacity } = options;
      deposit(bound, id, {
        geometry: mark.geometry, mark, tool: { brush: mark.brush, diameter: mark.diameter, ...(opacity !== undefined && { opacity }) },
        action: loaded(bound, full, resolvers(bound, full).well(well), { ...(blend && { blend }), ...(secondaryColor && { secondaryColor }) }),
      });
    }),
    wait: (until: StampWashWait, options?: { rim?: number; region?: StampRegion }) => {
      const what = `${state.full}'s wait(${JSON.stringify(until)})`;
      if (until === 'set') checkWetHistory(state, what);
      else if (typeof until === 'string') checkWetHistory(state, what, 'wet-conditions');
      const region = options?.region, rim = options?.rim;
      state.steps.push({ kind: 'wait', until, under: region ? { region } : 'wash', ...(rim !== undefined && { rim }) });
    },
    apply: (id, options, body) => {
      const node = application(writer, id, splitScore(options), 'apply');
      body(passageScope(under(writer, node, id, options.within)));
    },
    each: (key, items, body) => {
      const node = application(writer, key, {}, 'apply'), iteration = under(writer, node, key, undefined);
      for (const item of items) {
        const itemKey = checkedStampIdSegment(item.id);
        const itemNode = application(iteration, itemKey, {}, 'apply');
        body(passageScope({ ...under(iteration, itemNode, itemKey, undefined), namer: writer.namer.item(key, itemKey) }), item);
      }
    },
  };
  writers.set(scope, writer);
  return scope;
}

/**
 * A technique's options as a call gives them, and how it's made: its `name` (for provenance and messages), default
 * `weight` and child timing, the capabilities it `requires`, the wet `effect` its conditions ask for, its defaults.
 */
export type StampTechniqueSpec = {
  name: string; weight: number; requires: readonly PaintCapability[]; effect?: StampWetEffectKind; children?: StampChildTiming; defaults?: StampPassageDefaults;
};

/**
 * What a technique's expansion writes through: `p`, a scope bound to its application (its ops are child keys of its
 * name; one given its own `id` is it), its full name, and its settings resolved as a raw op's are.
 */
export type StampTechniqueContext = {
  p: StampPassageScope;
  id: string;
  /** `group/passage/name`: what its generated marks are keyed from. */
  full: string;
  brush: (given: StampBrush | undefined) => StampBrush;
  well: (given: StampWell | undefined) => StampWell;
  size: (given: StampSize | undefined) => number;
  sizeRange: (given: StampSizeRange | undefined) => readonly [number, number];
  /** Runs `write`, its deposits standing after a wait until `when`, judged together and named for the technique's effect. */
  conditioned: (when: StampCondition | undefined, write: () => void) => void;
  /** The passage's area: a technique's default geometry. */
  area: StampRegion | undefined;
};

/** A deposit by full ID (`group/passage/name`). */
export type StampDepositRef = { readonly kind: 'deposit'; readonly id: string };
/** An application by its path in its passage: its enclosing applications' IDs, then its own. */
export type StampApplicationRef = { readonly kind: 'application'; readonly path: readonly string[] };
/** What every technique call returns besides its own: its application and the deposits it wrote. */
export type StampTechniqueHandle = { application: StampApplicationRef; deposits: readonly StampDepositRef[] };

/**
 * Makes a technique: an imported function `(p, id, options) => handle`. A call is one application, weighing `weight`
 * unless it says, whatever it lays; it checks what the technique `requires` against the passage's medium, then runs
 * `expand` with a scope bound to it. Techniques nest: one called on a context's `p` is a child application.
 */
export function defineStampTechnique<O, H extends object = Record<never, never>>(definition: StampTechniqueSpec & { expand: (context: StampTechniqueContext, options: O) => H }) {
  const { expand, ...spec } = definition;
  return (p: StampPassageScope, id: string, options: O & StampApplicationOptions): H & StampTechniqueHandle => invokeStampTechnique(p, spec, id, options, (context) => expand(context, options));
}

/** Calls technique `spec` as application `id` of `p`'s passage, `expand` writing its ops. Checks what it requires. */
function invokeStampTechnique<H extends object>(p: StampPassageScope, spec: StampTechniqueSpec, id: string, options: StampApplicationOptions, expand: (context: StampTechniqueContext) => H): H & StampTechniqueHandle {
  const writer = writers.get(p);
  if (!writer) throw new Error(`stamp paint: ${spec.name} ${id} was called on something that isn't a passage's scope`);
  const node = application(writer, id, splitScore(options), 'technique', { weight: spec.weight, ...(spec.children && { timing: spec.children }) });
  const name = writer.namer.name(id), full = stampDepositId(writer.state.identity, name);
  for (const capability of spec.requires) {
    if (capability === 'wet-history' || capability === 'wet-conditions') checkWetHistory(writer.state, `${full}, a ${spec.name},`, capability);
    else checkPaintCapability(writer.state.host.medium, capability, `${full}, a ${spec.name},`);
  }
  const bound: StampPassageWriter = { ...under(writer, node, id, options.within), namer: keyedNamer(name, id), defaults: { ...writer.defaults, ...spec.defaults } };
  const effect = spec.effect && { kind: spec.effect, id: stampDepositNameText(name) };
  const take = resolvers(bound, full);
  const made = expand({
    p: passageScope(bound), id, full, ...take, area: writer.state.options.area,
    conditioned: (when, write) => conditioned(bound, when, effect, full, write),
  });
  const deposits: StampDepositRef[] = [];
  const collect = (each: StampScoreNode<StampPaintRecipeDeposit>): void => {
    for (const laid of each.deposits) deposits.push({ kind: 'deposit', id: stampDepositId(writer.state.identity, laid.name) });
    each.children.forEach(collect);
  };
  collect(node);
  return { ...made, application: { kind: 'application', path: bound.provenance }, deposits };
}

/**
 * Writes passage `id` of `host`'s group by calling `body`; a `knockout` acts on the paint behind it. It keeps a wet
 * history where its medium has one (unless wetHistory: false) or it lifts; without one, its seconds waits mean nothing.
 */
export function writeStampPassage(host: StampPassageHost, id: string, options: StampPassageOptions, knockout: boolean, body: (p: StampPassageScope) => void): StampPaintRecipePass {
  const identity = { group: host.group, passage: checkedStampIdSegment(id) }, full = `${host.group}/${id}`;
  const state: StampPassageState = { host, identity, full, options, knockout, steps: [], lifts: false };
  if (options.wetHistory === false) checkPaintCapability(host.medium, 'wet-history', `${full}'s wetHistory: false`);
  const { preparation, rim } = options;
  if (preparation) checkWetHistory(state, `${full}'s preparation`);
  if (rim !== undefined) checkWetHistory(state, `${full}'s rim`);
  checkMerges(state, options.within, full);
  const root: StampScoreNode<StampPaintRecipeDeposit> = { path: full, score: splitScore(options), kind: 'apply', deposits: [], children: [] };
  body(passageScope({ state, namer: passageNamer([]), node: root, provenance: [], within: undefined, defaults: options.defaults ?? {} }));
  const reveals = allocateStampScore(root);
  const history = knockout || state.lifts || (paintMediumCan(host.medium, 'wet-history') && options.wetHistory !== false);
  const steps = state.steps.flatMap((step): StampPaintRecipeStep[] => {
    if (step.kind === 'wait') return history ? [step] : [];
    const reveal = reveals.get(step);
    return [reveal ? { ...step, reveal } : step];
  });
  const common = { id, ...(options.clipTo && { clipTo: options.clipTo }), ...(options.within && { within: options.within }) };
  if (!history) return { ...common, wash: null, steps: steps.filter((step): step is StampPaintRecipeDeposit<StampRecipePaint> => step.kind === 'deposit' && step.action.kind === 'paint') };
  let prepared: { region: StampRegion; wetness?: NonNullable<Exclude<typeof preparation, 'area'>>['wetness'] } | undefined;
  if (preparation === 'area') {
    if (!options.area) throw new Error(`stamp paint: ${full} prepares its area, and it has none`);
    prepared = { region: options.area };
  } else prepared = preparation;
  return { ...common, wash: { ...(prepared && { preparation: prepared }), ...(rim !== undefined && { rim }), knockout }, steps };
}
