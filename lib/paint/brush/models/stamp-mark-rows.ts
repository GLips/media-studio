// stamp-mark-rows.ts: a deposit's placed stamps packed, a row of numbers a stamp (STAMP_MARK) and a tint row beside it
// when its brush has colour dynamics. Placement writes rows as it goes (createStampMarksWriter), and every reader reads
// them by index: a painting places millions of stamps, and an object each was most of its compile and its memory.
//
// Rows are float32, as the GPU reads them. Once made (stampMarksWriter's finish) a mark list is shared by every
// painting placed alike and never written again: a pose or a join makes new rows.

/** Where each of a stamp's numbers lies in its row. */
export const STAMP_MARK = {
  x: 0, y: 1, diameter: 2, rotation: 3, roundness: 4, alpha: 5, opacity: 6,
  /** Mirrored across its width, 1, and its length, 2, summed. */
  flips: 7,
  blur: 8, grainTurn: 9, grainDepth: 10, grainDepthByPressure: 11, pressure: 12,
  /** Where it was placed, which a pose leaves as it moves the stamp: what its tip's noise is seeded by. */
  restX: 13, restY: 14,
} as const;

/** Numbers in a stamp's row. */
export const STAMP_MARK_FIELDS = 15;

/** Where each of a tint's numbers lies in its row (StampTint). */
export const STAMP_TINT = { hue: 0, saturation: 1, lightness: 2, secondary: 3 } as const;

/** Numbers in a stamp's tint row. */
export const STAMP_TINT_FIELDS = 4;

declare const frozenStampMarks: unique symbol;

/**
 * A deposit's marks as a compiled painting holds them: `length` stamps' rows, and their tints, or null where every tint
 * is none. Only a writer's finish, stampMarksJoined or stampMarksReceived makes one, and nothing writes it after.
 */
export type FrozenStampMarks = {
  readonly length: number;
  readonly rows: Float32Array;
  readonly tints: Float32Array | null;
  readonly [frozenStampMarks]: true;
};

/**
 * How a stamp's colour moves from its deposit's (StampBrushColorDynamics): hue as a share of the wheel, saturation and
 * lightness each −1..1, and the share of the deposit's secondary colour, 0..1.
 */
export type StampTint = { hue: number; saturation: number; lightness: number; secondary: number };

/** One stamp read out of its row, for a test or a report: a renderer reads rows. */
export type PlacedStamp = {
  x: number; y: number; diameter: number; rotation: number;
  /** The share of its tip's roundness it keeps, 0..1: below 1 only under roundness pressure or jitter. */
  roundness: number;
  /** The share of the brush's paint this stamp lays down, 0..1: its flow after pressure and jitter. */
  alpha: number;
  /**
   * How far its paint may build, 0..1: its opacity after taper, pressure, falloff and jitter. A `buildToOpacity` brush
   * builds toward it; a `glaze` or a `build` lays alpha × opacity.
   */
  opacity: number;
  flipX: boolean; flipY: boolean;
  /** How blurred it is, 0..1 (1 about a sixteenth of its size). */
  blur: number;
  /** How far a rolling grain turns under it, radians: the stroke's direction times the grain's rotation. */
  grainTurn: number;
  /**
   * How much of a rolling grain's cut it takes, 0..1, mixed toward its uncut paint: below 1 only under grain depth
   * dynamics. Without its pressure binding's share, grainDepthByPressure; stampGrainDepthIn puts them together.
   */
  grainDepth: number;
  /** The share of grainDepth its brush's pressure binding keeps, which a medium on the paper's tooth sets aside. */
  grainDepthByPressure: number;
  /** The pen's pressure at it, 0..1, as its taper lets it through: what a pressed tip touches by. */
  pressure: number;
  /** Where it was placed (ENGINE 5.3): where it lies until a pose moves it. */
  rest: { readonly x: number; readonly y: number };
  tint: StampTint;
};

/** Rows a writer starts with room for. */
const FIRST_ROWS = 64;

/**
 * Rows written one stamp at a time: `next()` makes room for a stamp and returns where its row starts in `rows` (and,
 * divided by STAMP_MARK_FIELDS and times STAMP_TINT_FIELDS, its tint's in `tints`). Read `rows` after `next()`, which
 * may grow it. `finish()` makes the marks, after which the writer is done.
 */
export type StampMarksWriter = {
  readonly tinted: boolean;
  rows: Float32Array;
  tints: Float32Array | null;
  length: number;
  next(): number;
  finish(): FrozenStampMarks;
};

/** A writer of marks, `tinted` when its brush has colour dynamics, with room for `room` stamps before it grows. */
export function createStampMarksWriter(tinted: boolean, room = FIRST_ROWS): StampMarksWriter {
  const writer: StampMarksWriter = {
    tinted,
    rows: new Float32Array(Math.max(1, room) * STAMP_MARK_FIELDS),
    tints: tinted ? new Float32Array(Math.max(1, room) * STAMP_TINT_FIELDS) : null,
    length: 0,
    next() {
      if ((writer.length + 1) * STAMP_MARK_FIELDS > writer.rows.length) {
        writer.rows = grown(writer.rows);
        if (writer.tints) writer.tints = grown(writer.tints);
      }
      return writer.length++ * STAMP_MARK_FIELDS;
    },
    finish: () => stampMarksMade(writer.length, writer.rows.slice(0, writer.length * STAMP_MARK_FIELDS), writer.tints?.slice(0, writer.length * STAMP_TINT_FIELDS) ?? null),
  };
  return writer;
}

/** `floats` copied into twice the room. */
function grown(floats: Float32Array): Float32Array {
  const more = new Float32Array(2 * floats.length);
  more.set(floats);
  return more;
}

function stampMarksMade(length: number, rows: Float32Array, tints: Float32Array | null): FrozenStampMarks {
  // SAFETY: the brand's makers: rows no one else holds, never written after.
  return Object.freeze({ length, rows, tints }) as FrozenStampMarks;
}

/** Marks another process placed, their rows and tints views no one else writes: as a render hands them to its pages. */
export function stampMarksReceived(length: number, rows: Float32Array, tints: Float32Array | null): FrozenStampMarks {
  if (rows.length !== length * STAMP_MARK_FIELDS || (tints && tints.length !== length * STAMP_TINT_FIELDS)) throw new Error(`stamp marks: ${length} stamps received with ${rows.length} row and ${tints?.length ?? 0} tint numbers`);
  return stampMarksMade(length, rows, tints);
}

/** No stamps. */
export const NO_STAMP_MARKS = stampMarksMade(0, new Float32Array(0), null);

/** `parts` laid end to end, in order; tinted if any part is, a part without tints at none. */
export function stampMarksJoined(parts: readonly FrozenStampMarks[]): FrozenStampMarks {
  const length = parts.reduce((sum, part) => sum + part.length, 0);
  const rows = new Float32Array(length * STAMP_MARK_FIELDS), tints = parts.some((part) => part.tints) ? new Float32Array(length * STAMP_TINT_FIELDS) : null;
  let at = 0;
  for (const part of parts) {
    rows.set(part.rows, at * STAMP_MARK_FIELDS);
    if (tints && part.tints) tints.set(part.tints, at * STAMP_TINT_FIELDS);
    at += part.length;
  }
  return stampMarksMade(length, rows, tints);
}

/** Stamp `i` of `marks`, read out of its rows. */
export function stampMarkAt(marks: FrozenStampMarks, i: number): PlacedStamp {
  const r = marks.rows, o = i * STAMP_MARK_FIELDS, t = marks.tints, u = i * STAMP_TINT_FIELDS, flips = r[o + STAMP_MARK.flips];
  return {
    x: r[o], y: r[o + 1], diameter: r[o + 2], rotation: r[o + 3], roundness: r[o + 4], alpha: r[o + 5], opacity: r[o + 6],
    flipX: (flips & 1) !== 0, flipY: (flips & 2) !== 0, blur: r[o + 8], grainTurn: r[o + 9], grainDepth: r[o + 10],
    grainDepthByPressure: r[o + 11], pressure: r[o + 12], rest: { x: r[o + 13], y: r[o + 14] },
    tint: t ? { hue: t[u], saturation: t[u + 1], lightness: t[u + 2], secondary: t[u + 3] } : { hue: 0, saturation: 0, lightness: 0, secondary: 0 },
  };
}

/** Every stamp of `marks`, read out: for a test or a report, never a renderer. */
export const stampMarksList = (marks: FrozenStampMarks): PlacedStamp[] => Array.from({ length: marks.length }, (_, i) => stampMarkAt(marks, i));

/** `stamps` written as marks, each placed where it lies unless its rest says otherwise: for a test or a probe. */
export function stampMarksOf(stamps: readonly (Omit<PlacedStamp, 'rest' | 'tint'> & { rest?: PlacedStamp['rest']; tint?: StampTint })[]): FrozenStampMarks {
  const writer = createStampMarksWriter(stamps.some(({ tint }) => tint));
  for (const s of stamps) {
    const o = writer.next(), r = writer.rows;
    r[o] = s.x; r[o + 1] = s.y; r[o + 2] = s.diameter; r[o + 3] = s.rotation; r[o + 4] = s.roundness; r[o + 5] = s.alpha; r[o + 6] = s.opacity;
    r[o + 7] = (s.flipX ? 1 : 0) + (s.flipY ? 2 : 0); r[o + 8] = s.blur; r[o + 9] = s.grainTurn; r[o + 10] = s.grainDepth;
    r[o + 11] = s.grainDepthByPressure; r[o + 12] = s.pressure; r[o + 13] = s.rest?.x ?? s.x; r[o + 14] = s.rest?.y ?? s.y;
    if (writer.tints && s.tint) writer.tints.set([s.tint.hue, s.tint.saturation, s.tint.lightness, s.tint.secondary], (o / STAMP_MARK_FIELDS) * STAMP_TINT_FIELDS);
  }
  return writer.finish();
}
