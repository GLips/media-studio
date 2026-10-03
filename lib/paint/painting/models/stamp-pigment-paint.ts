// stamp-pigment-paint.ts: a stamp painting's paint when its style paints in pigment, worked out once on the CPU for
// the GPU's pigment compositor (stamp-paint-pigment-compositor.ts), which lays and dries it per pixel.
//
// Each group's palette is every pigment its deposits lay (a colour fitted as a pigment of its own), fitted in the
// group's medium: one pigment id in gouache and in watercolour is two pigments. Its layer holds each one's amount per
// pixel, so a pigment stays itself to the pixel, where a lift needs it. A graded material lays each pigment of either
// end at an amount the GPU grades between the two, never by rendered colour; a keyed one over the scene too.

import { paintPigmentFromColor, paintPigmentInMedium, type PaintMedium } from '#lib/paint/materials/models/paint-medium.ts';
import { paintMixtureComponents } from '#lib/paint/materials/models/paint-mixture.ts';
import { paintPigmentSeed } from '#lib/paint/materials/models/paint-paper.ts';
import type { PaintPigment, PaintPigmentAppearance } from '#lib/paint/materials/models/paint-pigment.ts';
import type { PaintBands } from '#lib/paint/materials/models/paint-spectrum.ts';
import type { PlacedStamp } from '#lib/paint/brush/models/stamp-placement.ts';
import { stampPaintFieldEnds } from './stamp-paint-field.ts';
import { mapStampKeyList, stampKeySpanAt, type StampKeyList } from './stamp-scene-keys.ts';
import { stampGroupKnocksOut, stampPassDeposits, type CompiledStampDeposit, type CompiledStampGroup, type CompiledStampPaint } from './stamp-paint-recipe-compile.ts';
import type { CompiledStampKeyedMaterial } from './stamp-paint-recipe-types.ts';
import type { PaintMaterial, StampPaintColor } from '#lib/paint/materials/models/paint-material.ts';

/**
 * Paint as pigment in a `medium`, mixed and dried with Kubelka–Munk. `pigments`, keyed by id, are the ones a mixture
 * may name; a colour is fitted as a pigment of its own, and a medium lightened with white brings its white.
 */
export type StampPigmentMixing<P extends Readonly<Record<string, PaintPigmentAppearance>> = Readonly<Record<string, PaintPigmentAppearance>>> = {
  kind: 'pigment';
  medium: PaintMedium;
  pigments: P;
};

/** How a painting's paint mixes: `flat` colour, laid by each deposit's blend in gamma-encoded sRGB as Photoshop lays it; or pigment. */
export type StampPaintMixing = { kind: 'flat' } | StampPigmentMixing;

/**
 * The most pigments one group can mix: its layer holds a channel each, one for coverage and, in a group with a wash,
 * one for its open share, so 12 fit four rgba16float layers either way. A wash of more is two washes.
 */
export const STAMP_PIGMENT_GROUP_SLOTS = 12;

/** A group mixing more than STAMP_PIGMENT_GROUP_SLOTS pigments: a painting that can't be laid as written. */
export class StampPigmentSlotsExceeded extends Error {}

/**
 * A pigment's amount at one end of a material over scene time: a full stroke's (unit films) at each key, eased
 * between them and held beyond (stamp-material-keys.ts); a single key for paint that doesn't change.
 */
export type StampPigmentAmountKeys = StampKeyList<{ at: number; amount: number }>;

/**
 * One pigment of a deposit's paint: its slot in its group's palette, its amounts at its material's first end and at
 * its second (the same for an ungraded one; 0 at an end or a key without it), its habits.
 */
export type StampPigmentComponent = {
  slot: number; ends: readonly [first: StampPigmentAmountKeys, second: StampPigmentAmountKeys]; granulation: number; flocculation: number; seed: number;
};

/** `component`'s amounts at its material's two ends `t` seconds into the scene. */
export function stampPigmentAmountsAt({ ends }: StampPigmentComponent, t: number): [first: number, second: number] {
  const at = (keys: StampPigmentAmountKeys) => {
    const { from, to, share } = stampKeySpanAt(keys, t);
    return keys[from].amount + (keys[to].amount - keys[from].amount) * share;
  };
  return [at(ends[0]), at(ends[1])];
}

/** Where a deposit's material grades between its ends, as paintFieldShare reads it (STAMP_PAINT_FIELD_SHARE): kind 0 for none. */
export type StampPigmentGrade = { kind: 0 | 1 | 2 | 3; geometry: readonly [number, number, number, number] };

export type StampPigmentGroup = {
  /** Its medium's index in the painting's media (StampPigmentPaint's `media`): its palette is fitted in it. */
  medium: number;
  /** Its palette, a slot each. */
  palette: readonly PaintPigment[];
  /**
   * Layers of four channels its paint needs, all a wet stage moves: coverage, then a channel per slot, and in a group
   * with a wash its open share.
   */
  paintLayers: number;
  /**
   * In a group with a wash, the channel holding each pixel's open share, its paint's last: how much of its paint
   * hasn't set (stamp-paint-pigment-compositor.ts). Null in a group without, which pays nothing for it.
   */
  open: number | null;
  /**
   * In a group with a knockout, the layer after its paint holding what the knockout took out of the paint behind it
   * (stamp-paint-pigment-compositor.ts), which no wet stage moves. Null in a group without.
   */
  knockoutLayer: number | null;
};

/** Layers of four channels a group's pixels need: its paint's, and its knockout layer if it has one. */
export const stampPigmentGroupLayers = ({ paintLayers, knockoutLayer }: StampPigmentGroup) => paintLayers + (knockoutLayer === null ? 0 : 1);

export type StampPigmentPaint = {
  /** Every medium a group paints in, each once, in the order groups first name them. */
  media: readonly PaintMedium[];
  bands: PaintBands;
  groups: readonly StampPigmentGroup[];
  /** Each deposit's group, by index, its components (none for water or a lift), where its material grades. */
  deposits: ReadonlyMap<CompiledStampDeposit, StampPigmentDeposit>;
  /** What a knockout reads of the paint behind it; null in a painting where no group knocks out. */
  underpaint: StampPigmentUnderpaint | null;
};

/**
 * The paint on each pixel, pigment by pigment, as kept for a knockout to lift by each pigment's staining: `pigments`,
 * every pigment a group laid before the last knockout lays, `media` each one's medium's index; `slots`, each group's
 * palette slot's index among them; `writes`, whether a group adds its film (one before the last knockout does).
 */
export type StampPigmentUnderpaint = { pigments: readonly PaintPigment[]; media: readonly number[]; slots: readonly (readonly number[])[]; writes: readonly boolean[] };

/** The most pigments a painting's underpaint keeps: four layers of the painting's. */
export const STAMP_PIGMENT_UNDERPAINT_SLOTS = 16;

/**
 * `knockout`: whether it's in its group's knockout, taking from the paint behind the group rather than laying its own.
 * `dryBrush`: whether its paint catches the paper's peaks as a dry brush does in its medium (PaintMedium's
 * `paperContact.dryBrush`): a dry-media brush in a medium that says how. Its water is the painting's media binding's
 * (StampPaintMedia).
 */
export type StampPigmentDeposit = { group: number; components: readonly StampPigmentComponent[]; grade: StampPigmentGrade; knockout: boolean; dryBrush: boolean };

const UNGRADED: StampPigmentGrade = { kind: 0, geometry: [0, 0, 0, 0] };

/** How much of pigment `id` an end of a material lays: none if it lacks it. */
const amountAtEnd = (laid: readonly { pigment: PaintPigment; amount: number }[], id: string) => laid.find(({ pigment }) => pigment.id === id)?.amount ?? 0;

/** Layers of four channels a group of `slots` pigments needs for its paint: coverage, a channel each, and an open share if it `washes`. */
export const stampPigmentLayers = (slots: number, washes: boolean) => Math.ceil((slots + 1 + (washes ? 1 : 0)) / 4);

/**
 * The mixing `group` paints in: its own (a group naming another medium, StampGroupOptions' `mixing`), else the
 * painting's.
 */
export const stampGroupMixing = (group: CompiledStampGroup, painting: StampPigmentMixing): StampPigmentMixing => group.mixing ?? painting;

/** What a medium's pigments are fitted as: each by id, the colours each colour names, and the ids its mixtures may name. */
type StampMediumFits = { medium: PaintMedium; known: Map<string, PaintPigment>; byColor: Map<StampPaintColor, PaintPigment>; named: Set<string> };

/**
 * `painting`'s paint, each group mixed as its mixing says (stampGroupMixing), a graded material's pigments from both
 * its ends, each pigment fitted in its group's medium. Throws on a mixture naming a pigment its mixing lacks, two
 * different pigments with one id in one medium, two medium objects of one name, or a group that mixes more than
 * STAMP_PIGMENT_GROUP_SLOTS pigments.
 */
export function compileStampPigmentPaint(painting: CompiledStampPaint, mixing: StampPigmentMixing, bands: PaintBands): StampPigmentPaint {
  const media: StampMediumFits[] = [];
  /** `of`'s medium's index among `media`, its pigments fitted: the first mixing's first, so a mixture can't name another by one of theirs. */
  const fitsOf = (of: StampPigmentMixing) => {
    // A medium is one object: a copy is another medium, and two of one name couldn't be told apart in the WGSL or an error.
    let index = media.findIndex(({ medium }) => medium === of.medium);
    if (index < 0 && media.some(({ medium }) => medium.name === of.medium.name)) throw new Error(`stamp paint: two media are named ${of.medium.name}; a medium is one object, so name each its own`);
    if (index < 0) index = media.push({ medium: of.medium, known: new Map(), byColor: new Map(), named: new Set() }) - 1;
    const fits = media[index];
    for (const appearance of Object.values(of.pigments)) {
      if (fits.named.has(appearance.id)) continue;
      fits.named.add(appearance.id);
      fits.known.set(appearance.id, paintPigmentInMedium(appearance, fits.medium, bands));
    }
    return { index, fits };
  };
  const deposits = new Map<CompiledStampDeposit, StampPigmentDeposit>();
  const groups = painting.groups.map((group, g): StampPigmentGroup => {
    const groupMixing = stampGroupMixing(group, mixing);
    const { index, fits: { medium, known, byColor } } = fitsOf(groupMixing);
    const named = new Set(Object.values(groupMixing.pigments).map(({ id }) => id));
    const white = medium.lightening.kind === 'white' ? medium.lightening.white.id : null;
    const palette: PaintPigment[] = [];
    for (const [pass, deposit] of group.passes.flatMap((written) => stampPassDeposits(written).map((laid) => [written, laid] as const))) {
      const { action } = deposit;
      // Water and a lift lay no pigment of their own.
      if (action.kind !== 'paint') {
        deposits.set(deposit, { group: g, components: [], grade: UNGRADED, knockout: pass.kind === 'wash' && pass.knockout, dryBrush: false });
        continue;
      }
      const { first, second, kind, geometry } = stampPaintFieldEnds(action.material);
      /** What a full stroke of `material` lays, each pigment its medium's one of its id. */
      const laidOf = (material: PaintMaterial) => {
        const laid = material.kind === 'mixture'
          ? paintMixtureComponents(material, medium, bands)
          : [{ pigment: byColor.get(material.color) ?? byColor.set(material.color, paintPigmentFromColor(material.color, medium, bands)).get(material.color)!, amount: medium.body }];
        return laid.map(({ pigment, amount }) => {
          if (material.kind === 'mixture' && pigment.id !== white && !named.has(pigment.id)) {
            throw new Error(`stamp paint: ${deposit.id} mixes ${pigment.id}, which isn't among its style's pigments (${[...named].join(', ')})`);
          }
          const kept = known.get(pigment.id) ?? known.set(pigment.id, pigment).get(pigment.id)!;
          if (!samePigment(kept, pigment)) throw new Error(`stamp paint: ${deposit.id} lays a pigment named ${pigment.id} unlike the painting's other ${pigment.id} in ${medium.name}`);
          return { pigment: kept, amount };
        });
      };
      /** Each key of a material's end with what it lays: a material that doesn't change is one key. */
      const keysOf = (end: CompiledStampKeyedMaterial) => mapStampKeyList(end.kind === 'keys' ? end.keys : [{ at: 0, material: end }], ({ at, material }) => ({ at, laid: laidOf(material) }));
      const atFirst = keysOf(first), atSecond = kind === 0 ? atFirst : keysOf(second);
      const pigments = [...atFirst, ...atSecond].flatMap(({ laid }) => laid.map(({ pigment }) => pigment)).filter((pigment, i, all) => all.findIndex(({ id }) => id === pigment.id) === i);
      deposits.set(deposit, {
        group: g,
        knockout: false,
        dryBrush: deposit.brush.media === 'dry' && medium.paperContact.kind === 'valleys' && !!medium.paperContact.dryBrush,
        grade: kind === 0 ? UNGRADED : { kind, geometry },
        components: pigments.map((pigment) => {
          let slot = palette.findIndex(({ id }) => id === pigment.id);
          if (slot < 0) slot = palette.push(pigment) - 1;
          const amounts = (keys: typeof atFirst) => mapStampKeyList(keys, ({ at, laid }) => ({ at, amount: amountAtEnd(laid, pigment.id) }));
          return {
            slot, ends: [amounts(atFirst), amounts(atSecond)],
            granulation: pigment.granulation * medium.granulation, flocculation: pigment.flocculation, seed: paintPigmentSeed(pigment.id),
          };
        }),
      });
    }
    if (palette.length > STAMP_PIGMENT_GROUP_SLOTS) {
      throw new StampPigmentSlotsExceeded(`stamp paint: ${group.id} mixes ${palette.length} pigments, over the ${STAMP_PIGMENT_GROUP_SLOTS} a wash holds, counting every key and end of its materials; split it into two groups, or key fewer pigments (${palette.map(({ id }) => id).join(', ')})`);
    }
    const washes = group.passes.some((pass) => pass.kind === 'wash'), paintLayers = stampPigmentLayers(palette.length, washes);
    return { medium: index, palette, paintLayers, open: washes ? 4 * paintLayers - 1 : null, knockoutLayer: stampGroupKnocksOut(group) ? paintLayers : null };
  });
  // A painting of no groups still has a medium to compile its passes in.
  if (!media.length) fitsOf(mixing);
  return { media: media.map(({ medium }) => medium), bands, groups, deposits, underpaint: stampPigmentUnderpaint(painting, groups) };
}

/** The medium `group` (by its ID, as written, boiled or live) paints in. */
export function stampPigmentGroupMedium(paint: StampPigmentPaint, painting: CompiledStampPaint, group: Pick<CompiledStampGroup, 'id'>): PaintMedium {
  const g = painting.groups.findIndex(({ id }) => id === group.id);
  if (g < 0) throw new Error(`stamp paint: ${group.id} isn't a group of the painting its paint was compiled for`);
  return paint.media[paint.groups[g].medium];
}

/** `stamp`'s share of its grain's depth in `medium` (null: flat paint), pressure's share as STAMP_PRESSURE_GRAIN_OWNER says. */
export const stampGrainDepthIn = (stamp: PlacedStamp, medium: PaintMedium | null): number => stampGrainDepthBy(stamp, stampGrainDepthSourceIn(medium));

/** What owns a stamp's grain response to pressure: the paper's tooth, or the brush (STAMP_PRESSURE_GRAIN_OWNER). */
export type StampGrainDepthSource = 'tooth' | 'brush';

/**
 * Crayon's grain policy, by the medium's paper contact: in 'peaks' contact the paper's tooth owns the pressure
 * response (paintDryContact presses into it), so the brush's grain depth by pressure, Photoshop's model of the same,
 * is set aside; kept, Kyle's Nupastel laid nothing at half pressure. In 'valleys' the brush owns it. A lift goes alike.
 */
export const STAMP_PRESSURE_GRAIN_OWNER = { peaks: 'tooth', valleys: 'brush' } as const satisfies Record<PaintMedium['paperContact']['kind'], StampGrainDepthSource>;

/** What owns a stamp's grain response to pressure in `medium`; flat paint, touching no tooth, leaves it to the brush. */
export const stampGrainDepthSourceIn = (medium: PaintMedium | null): StampGrainDepthSource => (medium ? STAMP_PRESSURE_GRAIN_OWNER[medium.paperContact.kind] : 'brush');
/** `stamp`'s share of its grain's depth, its pressure's share taken from `source`. */
export const stampGrainDepthBy = (stamp: PlacedStamp, source: StampGrainDepthSource): number =>
  stamp.grainDepth * (source === 'tooth' ? 1 : stamp.grainDepthByPressure);

/** Whether two pigments are one: the same absorption, scattering and habits. A name is only for people. */
const samePigment = (a: PaintPigment, b: PaintPigment) =>
  a.K.every((k, i) => k === b.K[i]) && a.S.every((s, i) => s === b.S[i])
  && a.granulation === b.granulation && a.flocculation === b.flocculation && a.staining === b.staining;

/** `painting`'s underpaint (StampPigmentUnderpaint), null with no knockout. Throws past STAMP_PIGMENT_UNDERPAINT_SLOTS. */
function stampPigmentUnderpaint(painting: CompiledStampPaint, groups: readonly StampPigmentGroup[]): StampPigmentUnderpaint | null {
  const last = painting.groups.findLastIndex(stampGroupKnocksOut);
  if (last < 0) return null;
  const pigments: PaintPigment[] = [], media: number[] = [];
  const slots = groups.map(({ palette, medium }, g) => (g < last ? palette.map((pigment) => {
    const at = pigments.findIndex(({ id }, p) => id === pigment.id && media[p] === medium);
    if (at >= 0) return at;
    media.push(medium);
    return pigments.push(pigment) - 1;
  }) : []));
  if (pigments.length > STAMP_PIGMENT_UNDERPAINT_SLOTS) {
    throw new Error(`stamp paint: ${painting.groups[last].id} knocks out of ${pigments.length} pigments, over the ${STAMP_PIGMENT_UNDERPAINT_SLOTS} a painting keeps for it (${pigments.map(({ id }) => id).join(', ')})`);
  }
  return { pigments, media, slots, writes: groups.map((_, g) => g < last) };
}
