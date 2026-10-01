// stamp-technique-catalogue.ts: the passage layer's techniques beyond the wet touches (stamp-wet-techniques.ts): a
// graded wash, marks laid along guides, a line the author drew, a form charged wet over a model the caller states,
// and a tissue's blot. Each is made by defineStampTechnique, called as an imported function on a passage's scope, one
// application however many deposits it lays, and states the capabilities it needs.
//
// Negative space: nothing here infers geometry. Guides, faces, a core and merged stretches are the caller's.

import { seededRandom } from '#lib/picture/motion/models/random.ts';
import type { StampBrush } from '#lib/paint/brush/models/stamp-brush.ts';
import type { StampStrokePoint } from '#lib/paint/brush/models/stamp-placement.ts';
import type { StampStrokeHand } from '#lib/paint/brush/models/stamp-stroke-hand.ts';
import { stampCheckedGuides, type StampFillReach, type StampGuide } from './stamp-fill-strokes.ts';
import { stampRoundedForm, type StampFormEllipse, type StampFormLight } from './stamp-form.ts';
import { pickStampMaterial } from './stamp-material-set.ts';
import { stampScatteredStrokePath, stampScatterMarks, type StampMark, type StampMarkAnchor } from './stamp-marks.ts';
import type { StampPaintField } from './stamp-paint-field.ts';
import { defineStampTechnique, type StampTechniqueContext } from './stamp-paint-passage.ts';
import type { StampKeyedMaterial, StampLoadOptions, StampToolOptions, StampWell } from './stamp-paint-recipe-types.ts';
import type { StampSize, StampSizeRange } from './stamp-paint-sizes.ts';
import { stampRegionPolygon, type StampPoint, type StampRegion } from './stamp-region.ts';
import type { StampCondition } from './stamp-wash-effects.ts';
import { stampSoften } from './stamp-wet-techniques.ts';

/** How much water a merged stretch's damp brush carries: enough to lose the opened edge, not to flood past it. */
const STAMP_MERGE_WATER = 0.5;

/**
 * A damp brush along each stretch the application's `within` merges, `2 × reach` wide, so its paint runs on into the
 * opened edge and loses it, in the same history. A technique laying a shape calls this last, while its paint is wet.
 */
function softenStampMerges({ p, merges }: StampTechniqueContext, brush: StampBrush | undefined) {
  for (const { name, path, reach } of merges) {
    stampSoften(p, `merge-${name}`, { along: path, size: 2 * reach, amount: STAMP_MERGE_WATER, hand: { profile: 'drag' }, ...(brush && { brush }) });
  }
}

/** `well`'s paint as one material, for a continuous grade; refused for a set or a field, which a grade can't take as an end. */
function singleMaterial({ paint }: StampWell, what: string): StampKeyedMaterial {
  if (paint.kind === 'set' || paint.kind === 'constant' || paint.kind === 'linear' || paint.kind === 'radial' || paint.kind === 'noise') {
    throw new Error(`stamp paint: ${what} grades from a ${paint.kind}, and a continuous grade runs between single materials; marks pick from a set`);
  }
  return paint;
}

/**
 * A wash flooded over `region` (the passage's area), graded between the points `along`: from one well's material to
 * another's, or one well's load `from` to `to`. `variety` mottles a second load over the first, up to `amount` in
 * patches `scale` px across. With `when`, it waits first. Named `junctions` come back on the handle. Deposits
 * `body`, `variety`.
 */
export type StampGradedWashOptions = StampToolOptions & {
  region?: StampRegion;
  when?: StampCondition;
  reach?: StampFillReach;
  direction?: number;
  variety?: { amount: number; scale: number };
  junctions?: { readonly [name: string]: readonly StampPoint[] };
} & (
  | { from: StampWell; to: StampWell; along: readonly [StampPoint, StampPoint] }
  | { well?: StampWell; load: { along: readonly [StampPoint, StampPoint]; from: number; to: number } }
);
export const stampGradedWash = defineStampTechnique<StampGradedWashOptions, { junctions: { readonly [name: string]: readonly StampPoint[] } }>({
  name: 'gradedWash', weight: 3, requires: [],
  expand: (context, options) => {
    const { p, full, area, well } = context;
    const region = options.region ?? area;
    if (!region) throw new Error(`stamp paint: ${full} grades no region: give it one, or its passage an area`);
    let laid: StampWell, load: StampPaintField<number> | undefined;
    if ('from' in options) {
      const [a, b] = options.along, { from, to } = options;
      if (from.water !== to.water) throw new Error(`stamp paint: ${full} grades between wells of ${from.water} and ${to.water} water; a grade carries one water`);
      laid = { paint: { kind: 'linear', from: { ...a, value: singleMaterial(from, full) }, to: { ...b, value: singleMaterial(to, full) } }, ...(from.water !== undefined && { water: from.water }) };
    } else {
      const [a, b] = options.load.along;
      laid = well(options.well);
      load = { kind: 'linear', from: { ...a, value: options.load.from }, to: { ...b, value: options.load.to } };
    }
    const { brush, size, opacity, direction, reach, variety } = options;
    if (variety && !(variety.amount > 0 && variety.amount <= 1 && variety.scale > 0 && Number.isFinite(variety.scale))) throw new Error(`stamp paint: ${full}'s variety needs an amount of 0..1 and a positive scale, px`);
    const fill = { region, brush, size, opacity, well: laid, application: { kind: 'flood' as const, ...(reach && { reach }) }, ...(direction !== undefined && { direction }) };
    context.conditioned(options.when, () => {
      p.fill('body', { ...fill, ...(load && { load }) });
      if (variety) p.fill('variety', { ...fill, load: { kind: 'noise', scale: variety.scale, a: 0, b: variety.amount } });
      softenStampMerges(context, undefined);
    });
    return { junctions: options.junctions ?? {} };
  },
});

/**
 * Marks along guides (a pine's tiers), `perGuide` each, up to `spread` px off, more where `weight` is higher. Each
 * runs the guide's way, turned `lean.share` of the way toward the absolute `lean.toward`, by `hand` (press and
 * flick), loaded per mark from a set; `anchor: 'start'` hangs it from its place. A guided fill's marks run between
 * guides instead. Keyed `${guide.id}-${k}`.
 */
export type StampGuidedMarksOptions = Omit<StampToolOptions, 'size'> & {
  guides: readonly StampGuide[];
  perGuide: number;
  length: readonly [number, number];
  size?: StampSizeRange;
  well?: StampWell;
  spread?: number;
  weight?: StampPaintField<number>;
  lean?: { toward: number; share: number };
  hand?: StampStrokeHand;
  anchor?: StampMarkAnchor;
  when?: StampCondition;
};
export const stampGuidedMarks = defineStampTechnique<StampGuidedMarksOptions, { marks: readonly StampMark[] }>({
  name: 'guidedMarks', weight: 2, requires: [],
  expand: ({ p, full, brush, well, sizeRange, conditioned }, options) => {
    const { perGuide, length, spread = 0, weight, lean, hand = { profile: 'pressFlick' }, anchor, when, opacity } = options;
    const guides = stampCheckedGuides(options.guides, full);
    if (lean && !(lean.share >= 0 && lean.share <= 1 && Number.isFinite(lean.toward))) throw new Error(`stamp paint: ${full} leans ${lean.share} of the way toward ${lean.toward}; a lean is a finite direction and a share of 0..1`);
    const { paint, water } = well(options.well), laid = brush(options.brush), diameter = sizeRange(options.size);
    const placed = guides.flatMap(({ id, path }) => stampScatterMarks({ kind: 'along', path, spread, ...(weight && { weight }) }, { count: perGuide, length, diameter, key: `${full}/${id}` })
      .map((scattered, k) => {
        // The turn toward the lean goes the short way round, so a lean of π/2 bends a mark heading left and one heading right both down.
        const turn = lean ? Math.atan2(Math.sin(lean.toward - scattered.angle), Math.cos(lean.toward - scattered.angle)) * lean.share : 0;
        const mark: StampMark = { key: scattered.key, brush: laid, diameter: scattered.diameter, geometry: { kind: 'stroke', path: stampScatteredStrokePath({ ...scattered, angle: scattered.angle + turn }, anchor), hand } };
        return { id: `${id}-${k}`, mark };
      }));
    conditioned(when, () => placed.forEach(({ id, mark }) => p.mark(id, {
      mark, well: { paint: paint.kind === 'set' ? pickStampMaterial(paint, `${full}|${id}|material`) : paint, ...(water !== undefined && { water }) }, ...(opacity !== undefined && { opacity }),
    })));
    return { marks: placed.map(({ mark }) => mark) };
  },
});

/** A face of a faceted form: its region, and which way it faces (`facing`, as a light's direction and elevation). */
export type StampFormFace = { id: string; region: StampRegion; facing: StampFormLight };
/** How lit a face is: Lambert's term against the light. `lit` from `bands.lit` up, `half` from `bands.half`, else `shade`. */
export type StampFormValue = 'lit' | 'half' | 'shade';

/**
 * A form charged wet: its body in the `lit` well, then once `when` (shiny, to mingle) `half` and `shade` into the
 * parts turned away and `core` along each core. `model`: an ellipsoid, its shade and core derived
 * (stampRoundedForm), or the caller's faces, each lit by its facing. An `undercut` waits for the paint to set.
 */
export type StampChargedFormOptions = StampToolOptions & {
  model:
    | { kind: 'ellipsoid'; outline: StampRegion; ellipse?: StampFormEllipse; terminator?: number; half?: number }
    | { kind: 'faces'; outline: StampRegion; faces: readonly StampFormFace[]; bands?: { lit: number; half: number } };
  light: StampFormLight;
  wells?: { lit?: StampWell; half?: StampWell; shade?: StampWell; core?: StampWell; undercut?: StampWell };
  /** Where the core runs: an ellipsoid's is derived when left out, a faceted form's only where given. */
  core?: readonly (readonly StampPoint[])[];
  coreSize?: StampSize;
  coreBrush?: StampBrush;
  undercut?: readonly StampPoint[];
  undercutSize?: StampSize;
  undercutBrush?: StampBrush;
  when?: StampCondition;
};
/** Face values a faceted form takes unless it says: lit from 0.6 of full light, half from 0.3. */
const STAMP_FACE_BANDS = { lit: 0.6, half: 0.3 };

/** A unit vector pointing as `facing` says: in the picture plane toward `direction`, `elevation` toward the viewer. */
const facingVector = ({ direction, elevation }: StampFormLight) => [Math.cos(elevation) * Math.cos(direction), Math.cos(elevation) * Math.sin(direction), Math.sin(elevation)];

/** Each face's value under `light`, by Lambert's law over its facing, banded by `bands`. */
export function stampFaceValues(faces: readonly StampFormFace[], light: StampFormLight, bands = STAMP_FACE_BANDS): { id: string; light: number; value: StampFormValue }[] {
  const toward = facingVector(light);
  return faces.map(({ id, facing }) => {
    const normal = facingVector(facing), lambert = Math.max(0, normal.reduce((sum, n, i) => sum + n * toward[i], 0));
    let value: StampFormValue = 'shade';
    if (lambert >= bands.lit) value = 'lit';
    else if (lambert >= bands.half) value = 'half';
    return { id, light: lambert, value };
  });
}

export const stampChargedForm = defineStampTechnique<StampChargedFormOptions, { faces: readonly { id: string; light: number; value: StampFormValue }[]; core: readonly (readonly StampPoint[])[] }>({
  name: 'chargedForm', weight: 4, requires: ['wet-history'],
  when: 'shiny',
  expand: (context, options) => {
    const { p, full, roleWell, conditioned } = context;
    const { model, light, brush, size, opacity, when } = options;
    const tool = { brush, size, opacity, application: { kind: 'flood' as const } };
    let parts: { id: string; region: StampRegion; value: Exclude<StampFormValue, 'lit'> }[], faces: ReturnType<typeof stampFaceValues> = [], core = options.core ?? [];
    if (model.kind === 'faces') {
      const ids = new Set(model.faces.map(({ id }) => id));
      if (ids.size !== model.faces.length) throw new Error(`stamp paint: ${full} has two faces of one ID; each face's ID is its own`);
      faces = stampFaceValues(model.faces, light, model.bands);
      parts = faces.flatMap(({ id, value }, i) => (value === 'lit' ? [] : [{ id, region: model.faces[i].region, value }]));
    } else {
      const form = stampRoundedForm({ outline: model.outline, light, ...(model.ellipse && { ellipse: model.ellipse }), ...(model.terminator !== undefined && { terminator: model.terminator }) });
      const half = model.half === undefined ? [] : stampRoundedForm({ outline: model.outline, ellipse: form.ellipse, light, terminator: model.half }).shade;
      parts = [...half.map((region, k) => ({ id: `half-${k}`, region, value: 'half' as const })), ...form.shade.map((region, k) => ({ id: `shade-${k}`, region, value: 'shade' as const }))];
      core = options.core ?? form.core;
    }
    p.fill('body', { ...tool, region: model.outline, well: roleWell('lit', options.wells?.lit) });
    // A form wholly in the light has nothing to charge, and no wait for it.
    if (parts.length || core.length) conditioned(when, () => {
      // Half tones before shade, so a shade charged where they overlap lies over the half tone, as a painter's would.
      for (const part of [...parts.filter(({ value }) => value === 'half'), ...parts.filter(({ value }) => value === 'shade')]) {
        p.fill(part.id, { ...tool, region: part.region, well: roleWell(part.value, options.wells?.[part.value]) });
      }
      core.forEach((path, k) => p.stroke(`core-${k}`, { path, brush: options.coreBrush, size: options.coreSize, opacity, hand: { profile: 'swell' }, well: roleWell('core', options.wells?.core) }));
    });
    softenStampMerges(context, undefined);
    if (options.undercut) {
      p.wait('set');
      p.stroke('undercut', { path: options.undercut, brush: options.undercutBrush, size: options.undercutSize, hand: { profile: 'drag', wobble: { position: 0.3 } }, well: roleWell('undercut', options.wells?.undercut) });
    }
    return { faces, core };
  },
});

/**
 * A tissue pressed into wet paint over each shape `repeat` times, `strength` each, its outline moved up to
 * `irregular` px point by point, crumpled afresh each press so none is a stamped copy. One wait before the first,
 * until `when` (damp; `false` for none). Deposits `${shape.id}-${press}`.
 */
export type StampBlotOptions = StampToolOptions & {
  shapes: readonly { id: string; region: StampRegion }[];
  repeat?: number;
  strength?: number;
  irregular?: number;
  when?: StampCondition | false;
};
export const stampBlot = defineStampTechnique<StampBlotOptions>({
  name: 'blot', weight: 1, requires: ['lift'],
  effect: 'lift', when: 'damp',
  expand: ({ p, full, conditioned }, { shapes, repeat = 1, strength, irregular = 0, when, brush, size, opacity }) => {
    if (!(Number.isInteger(repeat) && repeat >= 1)) throw new Error(`stamp paint: ${full} blots ${repeat} times, and a blot presses a whole number from 1`);
    if (!(irregular >= 0 && Number.isFinite(irregular))) throw new Error(`stamp paint: ${full}'s irregular is ${irregular} px, and it's finite from 0`);
    if (new Set(shapes.map(({ id }) => id)).size !== shapes.length) throw new Error(`stamp paint: ${full} blots two shapes of one ID; each shape's ID is its own`);
    conditioned(when, () => {
      for (let press = 0; press < repeat; press++) {
        for (const { id, region } of shapes) {
          const random = seededRandom(`${full}|${id}|${press}`);
          const pressed: StampRegion = irregular ? { kind: 'polygon', points: stampRegionPolygon(region).map(({ x, y }) => ({ x: x + (random() * 2 - 1) * irregular, y: y + (random() * 2 - 1) * irregular })) } : region;
          p.lift(`${id}-${press}`, { kind: 'fill', region: pressed, brush, size, opacity, ...(strength !== undefined && { strength }) });
        }
      }
    });
    return {};
  },
});

/**
 * A line the author drew, stroked once along `path` by `hand` (a taper unless it says): a fold, a strand, a feature,
 * a gully, a bird. With `when`, it waits first, a line drawn into shiny paint feathering. Its one deposit is its own ID.
 */
export type StampDrawnLineOptions = StampToolOptions & Omit<StampLoadOptions, 'burnish'> & { path: readonly StampStrokePoint[]; hand?: StampStrokeHand; when?: StampCondition };
export const stampDrawnLine = defineStampTechnique<StampDrawnLineOptions>({
  name: 'drawnLine', weight: 1, requires: [],
  expand: ({ p, id, conditioned }, { path, hand = { profile: 'taper' }, brush, size, opacity, well, blend, secondaryColor, when }) => {
    conditioned(when, () => p.stroke(id, { path, hand, brush, size, opacity, well, blend, secondaryColor }));
    return {};
  },
});
