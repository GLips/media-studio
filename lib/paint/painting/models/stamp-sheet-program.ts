// stamp-sheet-program.ts: a sheet's one physical history as the wash solver runs it: every application painted on
// one paper, over one wet field, each layer's paint kept in its own film. A document compiles to it
// (lib/paint/document); the solver schedules each entry forward against the field (stamp-sheet-schedule.ts).
//
// A program is posed before it's solved (lib/paint/document's painting-pose.ts): each entry's deposit as its chain's
// map puts it, the map's canonical text in `pose`. The solver reads a program as it's handed, posed or at rest.
//
// Negative space: names (keys) appear only in messages; ordinals and seeds are what a solve reads.

import type { PaintMedium } from '#lib/paint/materials/models/paint-medium.ts';
import type { CompiledStampArea } from './stamp-area.ts';
import type { StampSeededPaintField } from './stamp-paint-field.ts';
import type { CompiledStampPaintAction } from './stamp-paint-action.ts';
import type { CompiledStampDeposit, CompiledStampMask, StampMixedPainting, StampMixedPass } from './stamp-paint-recipe-compile.ts';
import type { StampPigmentMixing } from './stamp-pigment-paint.ts';
import type { StampPaintPaper } from './stamp-paint-recipe-types.ts';
import type { StampRestMap } from './stamp-rest-map.ts';

/** What an entry waits for over its core before it lands (StampSheetEntry's `on`). */
export type StampSheetWetness = 'wet' | 'damp' | 'dry';

/**
 * A film's layout (ENGINE 4.2's slot schema): `palette`, pigment ids a slot each in first-use order; `paintLayers`, the
 * four-channel layers holding coverage and a channel per slot; `open`, the channel of its open share (null for none).
 */
export type StampSheetFilmSlots = { palette: readonly string[]; paintLayers: number; open: number | null };

/** One layer's film: the medium its paint lands by, the pigments it mixes (its group's mixing), its layout, its name. */
export type StampSheetFilm = { medium: PaintMedium; mixing: StampPigmentMixing; slots: StampSheetFilmSlots; name: string };

/**
 * Clean water laid evenly at a wash's start over `area`, `water` 0..1 by place, held off where `held` masks it; the
 * masks of `held` that stay on the paper when its layer is posed, `anchored`.
 */
export type StampSheetPrewet = {
  area: CompiledStampArea; water: StampSeededPaintField<number>; held: CompiledStampMask | null; anchored: ReadonlySet<CompiledStampMask>;
  /** For a prewet a pose moved, the map back to where it was planned, where its water's field is read; absent where it lies. */
  rest?: StampRestMap;
  /** On a sheet that wraps, the x its water's field is read within a wrap of (stamp-sheet-wrap.ts); absent elsewhere. */
  wrapFrom?: number;
};

/**
 * A wash: its film (an index into `films`), its name, its prewet (null for none), its rim's strength 0..2, the earlier
 * wash of its film whose paint clips it (an index into `washes`, null for none), whether it touches water at all, and
 * its clock's origin: a scene second, `'set'`, or null for an unclocked wash.
 */
export type StampSheetWash = {
  film: number; name: string; prewet: StampSheetPrewet | null; rim: number; clipTo: number | null; wetHistory: boolean; origin: number | 'set' | null;
};

/**
 * A sheet's one clock (ENGINE 4.1), once a clocked wet wash paints it: `scale`, a model second taking `scale` scene
 * seconds from `origin` (S, its clocked washes' earliest start) at its unclocked run's end; `instant`, the sheet set
 * before each clocked application; `never`, nothing drying. `none`, a scale alone timing nothing: model time only,
 * clocked scene times their order times.
 */
export type StampSheetClock = { readonly kind: 'none' } | { readonly kind: 'scale'; readonly scale: number; readonly origin: number } | { readonly kind: 'instant' } | { readonly kind: 'never' };

/**
 * What an entry leaves on the paper when posed: which of its deposit's `within` areas (by index), and which masks of
 * its fluid (by object), stay where the paper is.
 */
export type StampSheetAnchors = { within: ReadonlySet<number>; masks: ReadonlySet<CompiledStampMask> };

/**
 * One application in its sheet's order: its deposit, as posed; its paint's medium (its film's, spread capped); what
 * it waits for; the node ordinals posing it, outermost first, its layer's too; its order time and fixed `at`, scene s
 * (null when unclocked or untimed); `datum`, the text of all it reads at rest (ENGINE 4.2); `pose`, its map's text.
 */
export type StampSheetEntry = {
  wash: number; name: string; deposit: CompiledStampDeposit; medium: PaintMedium; on: StampSheetWetness | null; bloom: boolean;
  chain: readonly number[]; orderTime: number | null; at: number | null; anchors: StampSheetAnchors; datum: string; pose: string;
};

/**
 * A sheet program: its name (for a cost report), size, paper, where that lies (`document`, the root's; `union`, a
 * card, as far as its films' paint reaches), the medium its water dries by, its clock, its document's `wrap`, its
 * films, washes and entries, and `head`, its incoming state's text (K₀). No solve reads the edge: the head omits it.
 */
export type StampSheetProgram = {
  name: string; width: number; height: number; paper: StampPaintPaper; edge: 'document' | 'union'; water: PaintMedium; clock: StampSheetClock;
  wrap: 'x' | null; films: readonly StampSheetFilm[]; washes: readonly StampSheetWash[]; entries: readonly StampSheetEntry[]; head: string;
};

/**
 * A step of a composite of sheets, back to front (ENGINE 5.4): an own sheet's card, its paper as far as the union of
 * its films' paint reaches; or film `film` of sheet `sheet` (indexes into the composite's sheets).
 */
export type StampSheetCompositeStep = { readonly kind: 'card'; readonly sheet: number } | { readonly kind: 'film'; readonly sheet: number; readonly film: number };

/**
 * Each wash's first and last entry in `program`'s order (-1 for a wash with none): where it starts, its clip and
 * checkpoint with it, and where it ends, its set time measured there.
 */
export function stampSheetWashSpans({ washes, entries }: Pick<StampSheetProgram, 'washes' | 'entries'>): { first: readonly number[]; last: readonly number[] } {
  return { first: washes.map((_, w) => entries.findIndex((entry) => entry.wash === w)), last: washes.map((_, w) => entries.findLastIndex((entry) => entry.wash === w)) };
}

/**
 * The painting `program`'s films mix as, a group per film (film f is group f), a pass per wash holding its entries'
 * deposits: the compositor is keyed by deposit object, so it's made for the program as posed.
 */
export function stampSheetMixedPainting(program: StampSheetProgram): StampMixedPainting {
  const passes = program.washes.map((wash, w) => {
    const laid: CompiledStampDeposit[] = [];
    return { film: wash.film, id: `film${wash.film}/wash${w}`, wet: wash.wetHistory, deposits: laid };
  });
  for (const entry of program.entries) passes[entry.wash].deposits.push(entry.deposit);
  return {
    paper: program.paper, mixing: { kind: 'pigment', medium: program.water, pigments: {} },
    groups: program.films.map((film, f) => ({
      id: `film${f}`, mixing: film.mixing, paper: 'ground',
      passes: passes.filter((pass) => pass.film === f).map(({ id, wet, deposits: laid }): StampMixedPass => (wet
        ? { id, kind: 'wash', knockout: false, deposits: laid }
        : { id, kind: 'dry', deposits: laid.filter(stampPaintingDeposit) })),
    })),
  };
}

/** Whether `deposit` lays paint: a direct wash's every one does, as the compiler refuses its lifts so far. */
const stampPaintingDeposit = (deposit: CompiledStampDeposit): deposit is CompiledStampDeposit<CompiledStampPaintAction> => deposit.action.kind === 'paint';
