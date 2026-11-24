// library-grade.ts: a camera track's grade as data. A look is a named set of numbers; a measurement is what the
// track's own frames showed (the room's cast, the skin's, the face's two halves); gains come from the two when a grade
// is drawn. Pure, so looks and gains are tested without a frame. library-grade.py draws the pixels.
//
// Like a sync correction, a grade is never baked into the library's media: the measurement sits on the track in
// item.json and a graded file is a derived copy beside the media, remade when the look or the method changes.
import { Schema } from 'effect';

/** Linear RGB. */
export const LibraryGradeRgb = Schema.Tuple([Schema.Finite, Schema.Finite, Schema.Finite]);
export type LibraryGradeRgb = typeof LibraryGradeRgb.Type;

/**
 * Names how a measurement was taken (the models, the masks, the sampling). A track measured by another method is
 * measured again, since its numbers no longer mean what the gains assume.
 */
export const LIBRARY_GRADE_METHOD = 'studio-grade/1';

/** A camera track's mean linear colours over frames sampled across it, as library-grade.py measured them. */
export const LibraryGradeMeasurement = Schema.Struct({
  method: Schema.String,
  /** Frames the means are over. */
  sampled: Schema.Finite,
  /** Everything the segmenter didn't call the person. */
  background: LibraryGradeRgb,
  /** The segmenter's skin: face, neck, hands. */
  skin: LibraryGradeRgb,
  /** The face parser's skin, beard left out, and its frame-left and frame-right halves; none when no face was parsed. */
  face: Schema.optionalKey(Schema.Struct({ skin: LibraryGradeRgb, left: LibraryGradeRgb, right: LibraryGradeRgb })),
});
export type LibraryGradeMeasurement = typeof LibraryGradeMeasurement.Type;

/**
 * A look. Strengths run 0 (leave it) to 1 (all the way to the target). `face` parses the face: hair, beard and shirt
 * take `restShare` of the skin's correction, and the face's halves move `balance` of the way toward each other.
 * A LUT is a .cube in the LUT folder, mixed in at `mix`.
 */
export type LibraryGradeLook = {
  readonly description: string;
  readonly background: { readonly strength: number; readonly level: number };
  readonly skin: { readonly strength: number };
  readonly face?: { readonly restShare: number; readonly balance: number };
  readonly exposure: number;
  readonly contrast: number;
  /** Teal shadows and warm highlights, 0 for none. */
  readonly split: number;
  readonly saturation: number;
  readonly vignette: number;
  readonly lut?: { readonly file: string; readonly mix: number };
};

const DESK_NIGHT_BASE = {
  background: { strength: 0.45, level: 0.72 },
  skin: { strength: 0.45 },
  exposure: 1,
  contrast: 0.35,
  split: 0.35,
  saturation: 1.12,
  vignette: 0.4,
} as const;

/** Every look by name. The first is the default. */
export const LIBRARY_GRADE_LOOKS = {
  'desk-night': {
    ...DESK_NIGHT_BASE,
    description: 'The desk at night under mixed light: background toward neutral and a touch darker, skin toward healthy, the face parsed so the beard keeps its colour and both cheeks match; gentle contrast, split tone and vignette.',
    face: { restShare: 0.5, balance: 0.8 },
  },
  'desk-night-person': {
    ...DESK_NIGHT_BASE,
    description: 'desk-night corrected by the person matte alone, no face parsing: the whole person takes the skin\'s correction. For comparison.',
  },
} as const satisfies Record<string, LibraryGradeLook>;
export type LibraryGradeLookName = keyof typeof LIBRARY_GRADE_LOOKS;
export const isLibraryGradeLookName = (name: string): name is LibraryGradeLookName => Object.hasOwn(LIBRARY_GRADE_LOOKS, name);
export const LIBRARY_GRADE_DEFAULT_LOOK: LibraryGradeLookName = 'desk-night';

/** Healthy skin, sRGB about (224, 172, 140), as linear RGB over its green. The skin's measured cast is pulled toward it. */
export const LIBRARY_GRADE_SKIN_TARGET: LibraryGradeRgb = [1.8, 1, 0.65];

/** What the grade multiplies linear RGB by, green held at 1 so a gain moves colour, never brightness. */
export type LibraryGradeGains = { readonly background: LibraryGradeRgb; readonly skin: LibraryGradeRgb; readonly balance: LibraryGradeRgb };

const overGreen = ([r, g, b]: LibraryGradeRgb): LibraryGradeRgb => [r / g, 1, b / g];
const gainToward = (target: LibraryGradeRgb, measured: LibraryGradeRgb): LibraryGradeRgb => {
  const [tr, , tb] = overGreen(target), [mr, , mb] = overGreen(measured);
  return [tr / mr, 1, tb / mb];
};

/**
 * The gains `look` grades a track by. The background goes grey-world; the skin toward LIBRARY_GRADE_SKIN_TARGET,
 * from the parsed face when the look parses one and it was found; the balance is the left half's chroma over the
 * right's, whose brightness difference is modelling light and is kept.
 */
export function libraryGradeGainsOf(measured: LibraryGradeMeasurement, look: LibraryGradeLook): LibraryGradeGains {
  const face = look.face ? measured.face : undefined;
  const [lr, , lb] = face ? overGreen(face.left) : [1, 1, 1], [rr, , rb] = face ? overGreen(face.right) : [1, 1, 1];
  return {
    background: gainToward([1, 1, 1], measured.background),
    skin: gainToward(LIBRARY_GRADE_SKIN_TARGET, face?.skin ?? measured.skin),
    balance: [lr / rr, 1, lb / rb],
  };
}

/**
 * One process's share of a render: `frames` written from item second `from`, after `warm` frames before it that are
 * graded only so the masks, smoothed over time, have settled by the first one written.
 */
export type LibraryGradeChunk = { readonly from: number; readonly frames: number; readonly warm: number };

/**
 * `from`–`to` in item seconds at `fps`, split into up to `count` chunks of whole frames that run on from each other,
 * each warmed by up to `warmSeconds` but never from before `earliest`, where the track begins.
 */
export function planLibraryGradeChunks({ from, to, fps, count, warmSeconds, earliest }: {
  from: number; to: number; fps: number; count: number; warmSeconds: number; earliest: number;
}): LibraryGradeChunk[] {
  const total = Math.round((to - from) * fps), parts = Math.max(1, Math.min(count, total));
  return Array.from({ length: parts }, (_, i) => {
    const first = Math.floor((total * i) / parts), next = Math.floor((total * (i + 1)) / parts);
    const start = from + first / fps;
    return { from: start, frames: next - first, warm: Math.max(0, Math.min(Math.round(warmSeconds * fps), Math.floor((start - earliest) * fps + 1e-6))) };
  });
}
