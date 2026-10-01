// paint-medium.ts: what a pigment is carried in, which decides how the paint behaves: what a colour written for it
// means, how thick a full load lays, how it lightens (watercolour thins with water; gouache is tinted with white),
// how far granulation shows, where it meets the paper's tooth, how it lightens drying and how it mixes wet. It's
// data: nothing downstream asks which medium it is.
//
// A brush (StampBrush) says how paint is laid down; the paint (pigment in a medium) how it combines and dries.

import { kubelkaMunkFromAppearance } from './paint-kubelka-munk.ts';
import { paintHeldReflectance, paintPigmentFromAppearance, paintPigmentHabits, type PaintHex, type PaintPigment, type PaintPigmentAppearance, type PaintPigmentHabits } from './paint-pigment.ts';
import { paintHexToLinear, type PaintBands } from './paint-spectrum.ts';

/** How a medium lightens a paint: `water` thins its film so the paper shows; `white` mixes white in, at full body. */
export type PaintLightening = { kind: 'water' } | { kind: 'white'; white: PaintPigmentAppearance };

/**
 * How a dry medium meets the paper: a firm hand leaves bare the paper below `tooth` of its mean height, a light one
 * more. Its layers stack until the tooth holds `holds` full loads, then trade. Wax held fills the valleys `fill`
 * (0..1) of the way, so paper shows through several layers.
 */
export type PaintDryContact = { kind: 'peaks'; tooth: number; holds: number; fill: number };

export type PaintMedium = {
  name: string;
  /**
   * What a colour written for this medium means, and so how a pigment is fitted in it (paintPigmentInMedium).
   * `glaze`: the colour a full load shows over white paper, as transparent as `hiding` says (watercolour, ink).
   * `masstone`: the colour of the paint itself, thick (gouache, crayon), its strength never below `scatter`.
   */
  color: { kind: 'glaze'; hiding: number } | { kind: 'masstone'; scatter: number };
  /** How thick a full load lays, in unit films: a medium with more body lays more pigment per stroke. */
  body: number;
  lightening: PaintLightening;
  /** How far a pigment's granulation shows: free water lets it settle; a thick binder holds it. */
  granulation: number;
  /**
   * Where the paint meets the paper's tooth: a wet medium pools into the valleys (`valleys`, as deep as the paper is,
   * and further by granulation); a dry one catches on the peaks (PaintDryContact).
   */
  paperContact: { kind: 'valleys' } | PaintDryContact;
  /** How much more a film scatters dry than wet: air between the particles, where water was. Watercolour dries lighter. */
  dryingScatter: number;
  /**
   * How much of the wet paint under a loaded stroke the stroke carries and lays mixed with its own, 0..1: where two
   * wet washes meet they mix rather than one replacing the other. A dry medium picks up nothing; its layers only
   * stack. A lift isn't a loaded stroke: how much it takes is its own strength (stamp-wet-lift.ts).
   */
  pickup: number;
  wetting: PaintWetting;
};

/**
 * How the paint behaves wet over painting time, as a wash (stamp-wetness.ts) reads it. Nothing asks which medium it
 * is, so ink, oil or a dry medium is a row of numbers.
 */
export type PaintWetting = {
  /** How far paint landing on flooded paper spreads by itself, in diameters of the brush laying it; 0 never spreads. */
  spread: number;
  /** Seconds flooded paper of middling absorbency takes to dry, its wetness falling evenly from 1 to 0. */
  drying: number;
  /**
   * Seconds paint sets behind its water: it stays as workable as the paper was that long before. Watercolour's is
   * none. An oil would be a brush carrying its liquid medium as water (brushWater 1), no spread, and an open time of days.
   */
  openTime: number;
  /**
   * How much of set paint a lift works back up, 0..1, as loose as wet paint is at 1: gouache's binder redissolves,
   * watercolour's gum less, and a dry medium's is what an eraser takes. Its pigments' staining then holds some.
   */
  rewetting: number;
  /** How wet a loaded brush is, 0..1, where a deposit doesn't say. */
  brushWater: number;
  /** The wetness below which paint is damp rather than wet: what a wash's `wait('damp')` waits for. */
  damp: number;
};

export const TITANIUM_WHITE: PaintPigmentAppearance = { id: 'titaniumWhite', name: 'titanium white (PW6)', overWhite: '#fbfbf9', overBlack: '#d6d6d4' };

/** The media the engine paints in. */
export const PAINT_MEDIA = {
  // Tuned by eye against the watercolor style's references (vid-109), not measured: a clear glaze keeps stacked
  // darks deep, granulation reads as speckle rather than sandpaper, drying lightens only a little. Its wetting is a
  // first guess (vid-117): paint travels, a sheet dries in minutes, unstaining pigment lifts some way.
  watercolour: {
    name: 'watercolour', color: { kind: 'glaze', hiding: 0.02 }, body: 1, lightening: { kind: 'water' }, granulation: 0.7, paperContact: { kind: 'valleys' }, dryingScatter: 0.1, pickup: 0.5,
    wetting: { spread: 0.5, drying: 240, openTime: 0, rewetting: 0.35, brushWater: 0.7, damp: 0.35 },
  },
  // Tuned by eye (vid-109), not measured: a stroke mostly lays its own paint over wet paint, darks dry lighter and
  // matte, and a dark colour holds its hue into tints with white.
  gouache: {
    name: 'gouache', color: { kind: 'masstone', scatter: 0.05 }, body: 2, lightening: { kind: 'white', white: TITANIUM_WHITE }, granulation: 0.1,
    paperContact: { kind: 'valleys' }, dryingScatter: 0.4, pickup: 0.2,
    // A first guess (vid-117): it barely travels, dries fast and re-dissolves once dry.
    wetting: { spread: 0.1, drying: 120, openTime: 0, rewetting: 0.9, brushWater: 0.4, damp: 0.35 },
  },
  // Tuned by eye (vid-109, vid-124), not measured: a firm hand skips the paper below 85% of its mean height; about
  // five layers fill the tooth. Its paper wants a depth of 1: wax hides even thinly, so a valley given any share
  // reads filled.
  crayon: {
    name: 'crayon', color: { kind: 'masstone', scatter: 0.05 }, body: 1.5, lightening: { kind: 'white', white: { id: 'waxWhite', name: 'wax white', overWhite: '#f7f6f1', overBlack: '#9d9c97' } },
    granulation: 0, paperContact: { kind: 'peaks', tooth: 0.85, holds: 2, fill: 0.6 }, dryingScatter: 0, pickup: 0,
    // No water and no spread. A lift is an eraser, taking the wax off the tooth's peaks but not what's pressed in (vid-117).
    wetting: { spread: 0, drying: 1, openTime: 0, rewetting: 0.85, brushWater: 0, damp: 0.35 },
  },
} as const satisfies Record<string, PaintMedium>;

/** Scattering per unit amount of a masstone pigment of strength 1: enough that a unit film of white hides black (about 0.8). */
const MASSTONE_SCATTER = 8;

/** K/S of a film whose masstone reflects `R`. */
const kubelkaMunkRatio = (R: number) => (1 - paintHeldReflectance(R)) ** 2 / (2 * paintHeldReflectance(R));

/** A colour's own pigment's id: one pigment per colour, whatever deposits name it. */
export const paintColorPigmentId = (color: PaintHex) => `color:${color.toLowerCase()}`;

/**
 * The pigment a colour written for `medium` names (PaintMedium's `color`): each colour is fitted once as a pigment of
 * its own, so only pigments are ever mixed. In a masstone medium its tinting strength is its luminance, held at the
 * medium's floor, so light colours scatter more, as real paints do on average.
 */
export function paintPigmentFromColor(color: PaintHex, medium: PaintMedium, bands: PaintBands, identity: Partial<PaintPigmentHabits> & { id?: string; name?: string } = {}): PaintPigment {
  const { id = paintColorPigmentId(color), name = color, ...habits } = identity;
  const linear = paintHexToLinear(color);
  const R = bands.reflectanceOf(linear);
  const K = new Float64Array(bands.count), S = new Float64Array(bands.count);
  if (medium.color.kind === 'masstone') {
    const strength = Math.max(medium.color.scatter, 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2]);
    for (let b = 0; b < bands.count; b++) {
      S[b] = strength * MASSTONE_SCATTER;
      K[b] = S[b] * kubelkaMunkRatio(R[b]);
    }
  } else {
    // The over-black swatch is the over-white one scaled per band, so it keeps its spectrum's shape.
    for (let b = 0; b < bands.count; b++) {
      const w = paintHeldReflectance(R[b], 2e-3);
      ({ K: K[b], S: S[b] } = kubelkaMunkFromAppearance(w, paintHeldReflectance(w * medium.color.hiding)));
    }
  }
  return { id, name, K, S, ...paintPigmentHabits(habits) };
}

/**
 * A named pigment as `medium` paints it: its appearance in a glaze medium; in a masstone one its over-white colour as
 * masstone, since a glaze's fit scatters almost nothing and greys as white is mixed in.
 */
export function paintPigmentInMedium(appearance: PaintPigmentAppearance, medium: PaintMedium, bands: PaintBands): PaintPigment {
  return medium.color.kind === 'glaze' ? paintPigmentFromAppearance(appearance, bands) : paintPigmentFromColor(appearance.overWhite, medium, bands, appearance);
}
