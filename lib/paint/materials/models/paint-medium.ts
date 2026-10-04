// paint-medium.ts: what a pigment is carried in, which decides how the paint behaves: what a colour written for it
// means, how thick a full load lays, how it lightens (watercolour thins with water; gouache is tinted with white),
// how far granulation shows, where it meets the paper's tooth, how it lightens drying and how it mixes wet. It's
// data: nothing downstream asks which medium it is.
//
// A brush (StampBrush) says how paint is laid down; the paint (pigment in a medium) how it combines and dries.

import { kubelkaMunkFromAppearance } from './paint-kubelka-munk.ts';
import {
  paintHeldReflectance, paintPigmentFromAppearance, paintPigmentHabits, type PaintHex, type PaintMixturePigment, type PaintPigment, type PaintPigmentAppearance, type PaintPigmentHabits,
} from './paint-pigment.ts';
import { paintHexToLinear, type PaintBands } from './paint-spectrum.ts';

/** How a medium lightens a paint: `water` thins its film so the paper shows; `white` mixes white in, at full body. */
export type PaintLightening = { kind: 'water' } | { kind: 'white'; white: PaintPigmentAppearance };

/**
 * How a medium's layers combine. `mixes`: each stroke moves the paint toward its own, carrying `pickup` of what's
 * under it. `stacks`: each layer adds its pigment to what the tooth holds, trading for it only past `holds` full loads;
 * wax held round a pixel fills its valleys `fill` (0..1) of the way at `holds`, so paper shows through several layers.
 */
export type PaintLayering = { kind: 'mixes' } | PaintStackedLayering;
export type PaintStackedLayering = { kind: 'stacks'; holds: number; fill: number };

/**
 * What a lift leaves however strong (stamp-wet-lift.ts). `staining`: a stain in the fibres, `films` deep, each
 * pigment its staining share, held less while wet. `pressed`: wax pressed into the tooth, `share` of the coat however
 * thick, every pigment and its white alike, wet or set.
 */
export type PaintLiftResidue = { kind: 'staining'; films: number } | { kind: 'pressed'; share: number };

export type PaintMedium = {
  name: string;
  /**
   * What a colour written for this medium means, and so how a pigment is fitted in it (paintPigmentInMedium).
   * `glaze`: the colour a full load shows over white paper, as transparent as `hiding` says (watercolour, ink).
   * `masstone`: the colour of the paint itself, thick (gouache, crayon), its tinting strength never below
   * `leastStrength`, a full load covering as `cover` says (paintMasstoneScatter).
   */
  color: { kind: 'glaze'; hiding: number } | PaintMasstone;
  /**
   * How thick a full load lays, in unit films. A unit film is one full watercolour wash, the depth a staining
   * liftResidue is measured in: gouache lays many, so its stain is a sliver of a stroke.
   */
  body: number;
  lightening: PaintLightening;
  /**
   * How far a pigment's granulation shows, at a full load: free water lets it settle; a thick binder holds it. A
   * lighter load settles less, by its share of a full one.
   */
  granulation: number;
  /**
   * Where the paint meets the paper's tooth: a wet medium pools into the valleys (as deep as the paper is, and further
   * by granulation); a dry one catches on the peaks above `tooth` of the mean height, lower as it presses harder.
   * `dryBrush`: its dry-media brush catches the peaks above its `tooth`, skipping the valleys, its paint the medium's.
   */
  paperContact: { kind: 'valleys'; dryBrush: { tooth: number } } | { kind: 'peaks'; tooth: number };
  layering: PaintLayering;
  /** How much more a film scatters dry than wet: air between the particles, where water was. Watercolour dries lighter. */
  dryingScatter: number;
  /**
   * How much of the wet paint under a loaded stroke the stroke carries and lays mixed with its own, 0..1, in a wash
   * and in a medium whose layers mix: where two wet washes meet they mix rather than one replacing the other. A lift
   * isn't a loaded stroke: how much it takes is its own strength (stamp-wet-lift.ts).
   */
  pickup: number;
  liftResidue: PaintLiftResidue;
  wetting: PaintWetting;
  /** What it can do besides lay paint (PaintCapability), each named here, never read off the numbers above. */
  capabilities: readonly PaintCapability[];
};

/**
 * What a medium can do besides lay paint, declared, never read off its `wetting`. `wet-history`: its paint lands in
 * the paper's wetness. `wet-conditions`: a sheen to wait for. `water`: a deposit may state its water (a zero
 * defaultWater isn't a refusal). `lift`: paint comes back up (a sponge, an eraser). `burnish`: pressed into the tooth.
 */
export type PaintCapability = 'wet-history' | 'wet-conditions' | 'water' | 'lift' | 'burnish';

/** Whether `medium` declares `capability`; flat colour (null, painting in no medium) declares none. */
export const paintMediumCan = (medium: PaintMedium | null, capability: PaintCapability) => !!medium?.capabilities.includes(capability);

/** Throws, naming `what` asked, unless `medium` declares `capability`: the one place a painting is held to its medium. */
export function checkPaintCapability(medium: PaintMedium | null, capability: PaintCapability, what: string): void {
  if (paintMediumCan(medium, capability)) return;
  throw new Error(`stamp paint: ${what} needs '${capability}', which ${medium ? medium.name : 'flat colour, in no medium,'} doesn't declare`);
}

/**
 * `medium` as a brush's profile probe sees it: without its dry brush's tooth, since probes paint a pack's brushes as
 * the pack reads them, never dragged dry. Profiles are keyed on this (stampBrushProbeMediumKey), so tuning what no
 * probe sees measures nothing anew.
 */
export type PaintMediumAsProbed = Omit<PaintMedium, 'paperContact'> & { paperContact: { kind: 'valleys' } | { kind: 'peaks'; tooth: number } };

export const paintMediumAsProbed = (medium: PaintMedium): PaintMediumAsProbed =>
  (medium.paperContact.kind === 'valleys' ? { ...medium, paperContact: { kind: 'valleys' } } : medium);

/**
 * A masstone medium's colours: each the paint's own, thick. `cover` is what a full load of a perfect white reflects
 * dry over black, below 1: how far one stroke hides what's under it, and so how far a lift has to thin it before the
 * paper shows. Tinting strength is a colour's luminance, at least `leastStrength`.
 */
type PaintMasstone = { kind: 'masstone'; leastStrength: number; cover: number };

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
   * none. An oil would be a brush carrying its liquid medium as water (defaultWater 1), no spread, and an open time
   * of days.
   */
  openTime: number;
  /**
   * How much of set paint a lift works back up, 0..1, as loose as wet paint is at 1: gouache's binder redissolves,
   * watercolour's gum less, and an eraser takes all of a dry medium's wax it reaches. Its liftResidue then stays.
   */
  rewetting: number;
  /**
   * How wet a loaded brush is, 0..1, where a deposit doesn't say: read once, as the deposit compiles in the medium
   * (stampDepositWater). A default only; no threshold reads it.
   */
  defaultWater: number;
  /** Where the paper's look changes as it dries (PaintSheen): what a wash's `wait('shiny')` and `wait('damp')` wait for. */
  sheen: PaintSheen;
};

/**
 * Wetness thresholds, 0 < damp < shiny <= 1: at `shiny` and below a wash has lost its standing shine, and water
 * dropped in starts to push rather than merge; at `damp` and below it's lost its shine altogether, and a bloom's water
 * pushes with all its surplus. Operational marks on the drying curve, not a simulated gloss.
 */
export type PaintSheen = { shiny: number; damp: number };

export const TITANIUM_WHITE: PaintPigmentAppearance = { id: 'titaniumWhite', name: 'titanium white (PW6)', overWhite: '#fbfbf9', overBlack: '#d6d6d4' };

/** The media the engine paints in. */
export const PAINT_MEDIA = {
  // Tuned by eye against the watercolor style's references (vid-109), not measured: a clear glaze keeps stacked
  // darks deep, granulation reads as speckle rather than sandpaper, drying lightens only a little. Its wetting is a
  // first guess (vid-117): paint travels, a sheet dries in minutes, unstaining pigment lifts some way.
  watercolour: {
    name: 'watercolour', color: { kind: 'glaze', hiding: 0.02 }, body: 1, lightening: { kind: 'water' }, granulation: 0.7, paperContact: { kind: 'valleys', dryBrush: { tooth: 0.85 } }, layering: { kind: 'mixes' }, dryingScatter: 0.1, pickup: 0.5,
    liftResidue: { kind: 'staining', films: 0.6 },
    wetting: { spread: 0.5, drying: 240, openTime: 0, rewetting: 0.35, defaultWater: 0.7, sheen: { shiny: 0.7, damp: 0.35 } },
    capabilities: ['wet-history', 'wet-conditions', 'water', 'lift'],
  },
  // Tuned by eye (vid-109), not measured: a stroke mostly lays its own paint over wet paint, darks dry lighter and
  // matte, and a dark colour holds its hue into tints with white. A stroke is about twenty washes thick and one coat
  // of white nearly hides black, so a lift thins it toward the paper, paler as it goes (vid-122).
  gouache: {
    name: 'gouache', color: { kind: 'masstone', leastStrength: 0.05, cover: 0.9 }, body: 20, lightening: { kind: 'white', white: TITANIUM_WHITE }, granulation: 0.2,
    paperContact: { kind: 'valleys', dryBrush: { tooth: 0.85 } }, layering: { kind: 'mixes' }, dryingScatter: 0.4, pickup: 0.2, liftResidue: { kind: 'staining', films: 0.6 },
    // A first guess (vid-117): it barely travels, dries fast and re-dissolves once dry.
    wetting: { spread: 0.1, drying: 120, openTime: 0, rewetting: 0.9, defaultWater: 0.4, sheen: { shiny: 0.4, damp: 0.35 } },
    capabilities: ['wet-history', 'wet-conditions', 'water', 'lift'],
  },
  // Tuned by eye (vid-109, vid-124), not measured: a firm hand skips the paper below 85% of its mean height; about
  // five layers fill the tooth. Wax lays about fifteen washes thick and one coat of white nearly hides black, so a
  // lift thins it toward the paper, paler as it goes (vid-122).
  crayon: {
    name: 'crayon', color: { kind: 'masstone', leastStrength: 0.05, cover: 0.92 }, body: 15, lightening: { kind: 'white', white: { id: 'waxWhite', name: 'wax white', overWhite: '#f7f6f1', overBlack: '#9d9c97' } },
    granulation: 0, paperContact: { kind: 'peaks', tooth: 0.85 }, layering: { kind: 'stacks', holds: 4 / 3, fill: 0.6 }, dryingScatter: 0,
    pickup: 0, liftResidue: { kind: 'pressed', share: 0.04 },
    // No water and no spread. A lift is an eraser, taking all the wax it reaches but what's pressed in, a
    // twenty-fifth of the coat: 0.6 films of a full one (vid-139). Its sheen only times a wait: no bloom or rim reads it.
    wetting: { spread: 0, drying: 1, openTime: 0, rewetting: 1, defaultWater: 0, sheen: { shiny: 0.7, damp: 0.35 } },
    // Laid by its own law, pressure and tooth, never the wash's; it takes no water; its eraser lifts.
    capabilities: ['lift', 'burnish'],
  },
} as const satisfies Record<string, PaintMedium>;

/**
 * Scattering per unit film, wet, of a masstone pigment of tinting strength 1: what a full load of it lays so that, dry,
 * it covers as `cover` says. A film scattering x in all and absorbing nothing reflects x / (1 + x) over black.
 */
function paintMasstoneScatter({ cover }: PaintMasstone, { body, dryingScatter }: Pick<PaintMedium, 'body' | 'dryingScatter'>): number {
  return cover / (1 - cover) / (body * (1 + dryingScatter));
}

/** K/S of a film whose masstone reflects `R`. */
const kubelkaMunkRatio = (R: number) => (1 - paintHeldReflectance(R)) ** 2 / (2 * paintHeldReflectance(R));

/** A colour's own pigment's id: one pigment per colour, whatever deposits name it. */
export const paintColorPigmentId = (color: PaintHex) => `color:${color.toLowerCase()}`;

/**
 * The pigment a colour written for `medium` names (PaintMedium's `color`): each colour is fitted once as a pigment of
 * its own, so only pigments are ever mixed. In a masstone medium its tinting strength is its luminance, held at the
 * medium's least, so light colours scatter more, as real paints do on average.
 */
export function paintPigmentFromColor(color: PaintHex, medium: PaintMedium, bands: PaintBands, identity: Partial<PaintPigmentHabits> & { id?: string; name?: string } = {}): PaintPigment {
  const { id = paintColorPigmentId(color), name = color, ...habits } = identity;
  const linear = paintHexToLinear(color);
  const R = bands.reflectanceOf(linear);
  const K = new Float64Array(bands.count), S = new Float64Array(bands.count);
  if (medium.color.kind === 'masstone') {
    const strength = Math.max(medium.color.leastStrength, 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2]);
    const scatter = paintMasstoneScatter(medium.color, medium);
    for (let b = 0; b < bands.count; b++) {
      S[b] = strength * scatter;
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
 * masstone, since a glaze's fit scatters almost nothing and greys as white is mixed in. A colour standing for a
 * pigment (PaintColorPigment) is fitted as a colour in either.
 */
export function paintPigmentInMedium(pigment: PaintMixturePigment, medium: PaintMedium, bands: PaintBands): PaintPigment {
  if ('color' in pigment) return paintPigmentFromColor(pigment.color, medium, bands, { id: pigment.id, name: pigment.name });
  const appearance = pigment;
  return medium.color.kind === 'glaze' ? paintPigmentFromAppearance(appearance, bands) : paintPigmentFromColor(appearance.overWhite, medium, bands, appearance);
}
