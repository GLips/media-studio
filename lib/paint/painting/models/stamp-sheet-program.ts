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
export type StampSheetPrewet = { area: CompiledStampArea; water: StampSeededPaintField<number>; held: CompiledStampMask | null; anchored: ReadonlySet<CompiledStampMask> };

/**
 * A wash: its film (an index into `films`), its name, its prewet (null for none), its rim's strength 0..2, the earlier
 * wash of its film whose paint clips it (an index into `washes`, null for none), and whether it touches water at all.
 */
export type StampSheetWash = { film: number; name: string; prewet: StampSheetPrewet | null; rim: number; clipTo: number | null; wetHistory: boolean };

/**
 * What an entry leaves on the paper when posed: which of its deposit's `within` areas (by index), and which masks of
 * its fluid (by object), stay where the paper is.
 */
export type StampSheetAnchors = { within: ReadonlySet<number>; masks: ReadonlySet<CompiledStampMask> };

/**
 * One application in its sheet's order: its deposit, as posed; the medium its paint lands by (its film's, spread held
 * to its own cap); what it waits for; the group ordinals posing it, outermost first; `datum`, canonical text of all
 * it reads at rest, compiled marks too (ENGINE 4.2); `pose`, canonical text of the map posing it.
 */
export type StampSheetEntry = {
  wash: number; name: string; deposit: CompiledStampDeposit; medium: PaintMedium; on: StampSheetWetness | null; bloom: boolean;
  chain: readonly number[]; anchors: StampSheetAnchors; datum: string; pose: string;
};

/**
 * A sheet program, unclocked: its name (its source and sheet, for a cost report), the document's size, the sheet's
 * paper and the medium its water dries by, its films back to front, washes and entries in order, and `head`, the
 * canonical text of its incoming state (K₀).
 */
export type StampSheetProgram = {
  name: string; width: number; height: number; paper: StampPaintPaper; water: PaintMedium;
  films: readonly StampSheetFilm[]; washes: readonly StampSheetWash[]; entries: readonly StampSheetEntry[]; head: string;
};

/**
 * A step of a composite of sheets, back to front (ENGINE 5.4): an own sheet's card, its paper as far as the union of
 * its films' paint reaches; or film `film` of sheet `sheet` (indexes into the composite's sheets).
 */
export type StampSheetCompositeStep = { readonly kind: 'card'; readonly sheet: number } | { readonly kind: 'film'; readonly sheet: number; readonly film: number };

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
