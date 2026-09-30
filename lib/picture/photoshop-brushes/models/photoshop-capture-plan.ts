// photoshop-capture-plan.ts: where on Photoshop's capture sheets each mark goes (vid-100). A run paints many
// captures on one sheet and saves it once, which is what makes it about 0.2 s a capture; the rig
// (engine/photoshop-capture.ts) paints every cell of a sheet on its one layer and saves one 16-bit PNG.
//
// Cells are squares whose side is a multiple of 256 and so is every cell's origin. Photoshop anchors a texture
// fixed to the canvas at the canvas origin, so the 256-wide ramp pattern has the same phase in every cell, and a cell
// and its repeat can be compared pixel for pixel. A pack's own patterns have other sizes: the cell's origin in the
// manifest gives their phase.
//
// Coordinates are sheet pixels; at 72 dpi Photoshop's points are pixels too.

import { procreatePreviewStrokePath } from '#lib/picture/procreate-brushes/models/procreate-preview-stroke.ts';
import { PHOTOSHOP_PROBE_INK, type PhotoshopBrushSettings, type PhotoshopGround, type PhotoshopMark, type PhotoshopMarkKind, type PhotoshopProbe } from './photoshop-probes.ts';

export const PHOTOSHOP_SHEET_SIZE = 4096;
const CELL_UNIT = 256;
/** A probe's cell: room for its widest tip (200 px) with margin, two to a line. */
const PROBE_CELL = 512;
/** How many cells wide each mark is, one cell tall. */
const MARK_WIDTH: Record<PhotoshopMarkKind, number> = { stamp: 1, line: 2, sCurve: 2, twoCross: 1, selfCross: 2, overlap: 2 };
/** How far a ground patch sits inside its cell, so neighbouring patches never touch. */
const GROUND_INSET = 8;
export const PHOTOSHOP_GROUND_RGB: Record<Exclude<PhotoshopGround, 'clear'>, readonly [number, number, number]> = { white: [255, 255, 255], grey: [128, 128, 128], black: [0, 0, 0] };

export type PhotoshopBox = { x: number; y: number; width: number; height: number };
/** A stroke is a polyline of [x, y] points; one point is a single stamp. */
export type PhotoshopStroke = [number, number][];

/** One mark in one cell: the item it belongs to, which copy and which of the item's marks, and where. */
export type PhotoshopCaptureCell = PhotoshopMark & {
  item: string;
  copy: number;
  index: number;
  box: PhotoshopBox;
  /** Filled with the ground's colour before the mark is painted, on the same layer, so the paint composites over it. */
  groundBox?: PhotoshopBox;
  strokes: PhotoshopStroke[];
};

export type PhotoshopSheetGroup = 'capture' | 'repeat-a' | 'repeat-b';
export type PhotoshopCaptureSheet = { name: string; group: PhotoshopSheetGroup; width: number; height: number; cells: PhotoshopCaptureCell[] };

/** An item to lay out: its marks, its cell's side, the diameter its marks are sized for, and its copies. */
type LayoutItem = { key: string; marks: readonly PhotoshopMark[]; cell: number; diameter: number; copies: number };

/** Points along a segment, about `step` pixels apart, both ends included. */
function segment([ax, ay]: [number, number], [bx, by]: [number, number], step = 8): PhotoshopStroke {
  const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / step));
  return Array.from({ length: n + 1 }, (_, i) => [ax + ((bx - ax) * i) / n, ay + ((by - ay) * i) / n]);
}

/** The strokes of `mark` in `box`, for a brush `diameter` wide. Lines are two anchors: a straight path is exact. */
export function photoshopMarkStrokes(mark: PhotoshopMarkKind, box: PhotoshopBox, diameter: number): PhotoshopStroke[] {
  const at = (u: number, v: number): [number, number] => [box.x + u * box.width, box.y + v * box.height];
  switch (mark) {
    case 'stamp': return [[at(0.5, 0.5)]];
    case 'line': return [[at(0.1, 0.5), at(0.9, 0.5)]];
    case 'twoCross': return [[at(0.2, 0.2), at(0.8, 0.8)], [at(0.8, 0.2), at(0.2, 0.8)]];
    case 'overlap': {
      // Two parallel strokes, their centres half a diameter apart, so each half overlaps the other.
      const [x0, y] = at(0.1, 0.5), [x1] = at(0.9, 0.5);
      return [[[x0, y - diameter / 4], [x1, y - diameter / 4]], [[x0, y + diameter / 4], [x1, y + diameter / 4]]];
    }
    case 'selfCross': {
      // A prolate cycloid over one period centred on its loop: it rises, turns back over itself at the top, crossing
      // its own path, and comes down again.
      const r = box.height * 0.35, c = (box.width * 0.7) / (2 * Math.PI), n = 240;
      return [Array.from({ length: n + 1 }, (_, i) => {
        const t = Math.PI + (2 * Math.PI * i) / n;
        return [box.x + box.width * 0.15 + c * (t - Math.PI) - r * Math.sin(t), box.y + box.height / 2 - r * Math.cos(t)] as [number, number];
      })];
    }
    case 'sCurve': {
      // The stroke the brush fidelity sheet paints the renderer along: Procreate's preview stroke, 1060 × 324 wide.
      const path = procreatePreviewStrokePath(), scale = box.width / 1060;
      const points = path.map((p): [number, number] => [box.x + p.x * scale, box.y + box.height / 2 + (p.y - 162) * scale]);
      return [points.slice(1).flatMap((p, i) => segment(points[i], p).slice(i === 0 ? 0 : 1))];
    }
  }
}

/** Lays items out left to right in rows, a row per cell size, a new sheet when one fills. */
function layOutSheets(items: readonly LayoutItem[], group: PhotoshopSheetGroup, prefix: string): PhotoshopCaptureSheet[] {
  const sheets: PhotoshopCaptureSheet[] = [];
  const W = PHOTOSHOP_SHEET_SIZE, H = PHOTOSHOP_SHEET_SIZE;
  let sheet: PhotoshopCaptureSheet | undefined, x = 0, y = 0, rowHeight = 0;
  const newSheet = () => {
    sheet = { name: `${prefix}-${sheets.length + 1}`, group, width: W, height: H, cells: [] };
    sheets.push(sheet);
    x = 0, y = 0, rowHeight = 0;
  };
  for (const item of items) {
    if (item.cell % CELL_UNIT || item.cell > W) throw new Error(`capture plan: ${item.key}'s cell is ${item.cell} px, not a multiple of ${CELL_UNIT} up to ${W}`);
    for (let copy = 1; copy <= item.copies; copy++) {
      item.marks.forEach((mark, index) => {
        const width = MARK_WIDTH[mark.mark] * item.cell;
        if (!sheet) newSheet();
        if (rowHeight !== item.cell || x + width > W) y += rowHeight, x = 0, rowHeight = item.cell;
        if (y + item.cell > H) newSheet(), rowHeight = item.cell;
        const box = { x, y, width, height: item.cell };
        x += width;
        const groundBox = mark.ground === 'clear' ? undefined : { x: box.x + GROUND_INSET, y: box.y + GROUND_INSET, width: box.width - 2 * GROUND_INSET, height: box.height - 2 * GROUND_INSET };
        sheet!.cells.push({ ...mark, item: item.key, copy, index, box, ...(groundBox ? { groundBox } : {}), strokes: photoshopMarkStrokes(mark.mark, box, item.diameter) });
      });
    }
  }
  return sheets;
}

/**
 * The probe run's sheets: every probe (or `only` those) once, each copy of a randomness probe beside the first; then
 * the `repeat` probes laid out twice more, on sheets of their own at the same places, so the capture's own
 * repeatability is a cell-for-cell comparison.
 */
export function planPhotoshopProbeCapture(probes: readonly PhotoshopProbe[], { only, repeat = [] }: { only?: readonly string[]; repeat?: readonly string[] } = {}): PhotoshopCaptureSheet[] {
  const byName = new Map(probes.map((p) => [p.name, p]));
  for (const name of [...(only ?? []), ...repeat]) if (!byName.has(name)) throw new Error(`capture plan: no probe named ${JSON.stringify(name)}`);
  const item = (p: PhotoshopProbe): LayoutItem => ({ key: p.name, marks: p.marks, cell: PROBE_CELL, diameter: p.settings.tip.diameter, copies: p.copies ?? 1 });
  const chosen = probes.filter((p) => !only || only.includes(p.name));
  const repeated = repeat.map((name) => item(byName.get(name)!));
  return [
    ...layOutSheets(chosen.map(item), 'capture', 'probes'),
    ...(repeated.length ? [...layOutSheets(repeated, 'repeat-a', 'repeat-a'), ...layOutSheets(repeated, 'repeat-b', 'repeat-b')] : []),
  ];
}

/**
 * A pack brush's reference marks: a single stamp; a straight stroke at pen pressures 0.25, 0.5 and 1 (Brush Poses);
 * the standard S-curve under simulated pressure; two overlapping strokes. Black on the transparent sheet, so alpha is
 * the brush's coverage. The stamp and the overlap are at full pressure: a stroked path with neither a Brush Pose nor
 * simulated pressure paints at none, so a brush whose size or opacity follows pressure would leave next to nothing.
 */
export const PHOTOSHOP_REFERENCE_MARKS: readonly PhotoshopMark[] = [
  { mark: 'stamp', ground: 'clear', color: PHOTOSHOP_PROBE_INK, pressure: 1 },
  ...[0.25, 0.5, 1].map((pressure): PhotoshopMark => ({ mark: 'line', ground: 'clear', color: PHOTOSHOP_PROBE_INK, pressure })),
  { mark: 'sCurve', ground: 'clear', color: PHOTOSHOP_PROBE_INK, simulatePressure: true },
  { mark: 'overlap', ground: 'clear', color: PHOTOSHOP_PROBE_INK, pressure: 1 },
];

/**
 * The largest diameter a reference paints a brush at, so its cell (three diameters) and a stroke two cells long fit
 * a sheet; a bigger preset is resized to it after it's selected, which leaves its dual tip and texture unscaled.
 */
export const PHOTOSHOP_REFERENCE_MAX_DIAMETER = 640;
/** The size a preset saved without one is painted at: it would otherwise take whatever size the tool had. */
export const PHOTOSHOP_REFERENCE_UNSIZED_DIAMETER = 100;

export type PhotoshopReferenceSizing = 'own' | 'capped' | 'unsized';
/** The diameter a reference paints a preset at, from the size it carries (null for none), and why. */
export function photoshopReferenceSize(native: number | null): { diameter: number; sizing: PhotoshopReferenceSizing } {
  if (native === null) return { diameter: PHOTOSHOP_REFERENCE_UNSIZED_DIAMETER, sizing: 'unsized' };
  return native > PHOTOSHOP_REFERENCE_MAX_DIAMETER ? { diameter: PHOTOSHOP_REFERENCE_MAX_DIAMETER, sizing: 'capped' } : { diameter: native, sizing: 'own' };
}
/** A brush's cell: three diameters, rounded up to the cell unit, at least two units. */
export const photoshopReferenceCell = (diameter: number) => Math.max(2 * CELL_UNIT, Math.ceil((3 * diameter) / CELL_UNIT) * CELL_UNIT);

export function planPhotoshopReferenceCapture(brushes: readonly { key: string; diameter: number }[]): PhotoshopCaptureSheet[] {
  return layOutSheets(brushes.map((b) => ({ key: b.key, marks: PHOTOSHOP_REFERENCE_MARKS, cell: photoshopReferenceCell(b.diameter), diameter: b.diameter, copies: 1 })), 'capture', 'references');
}

/** The document every sheet is painted on. */
export const PHOTOSHOP_CAPTURE_DOCUMENT = { mode: 'RGB', bitsPerChannel: 16, resolution: 72, fill: 'transparent', layers: 1, file: 'PNG, 16-bit RGBA, lossless' } as const;

/** A pack brush as a reference paints it: its preset's name, the size the preset carries (null for none), and the size painted. */
export type PhotoshopReferencePreset = { name: string; nativeDiameter: number | null; diameter: number; sizing: PhotoshopReferenceSizing };

/** Photoshop's tool options, as read back after a probe or preset was applied (photoshop-actions.jsxinc descToObj). */
export type PhotoshopAppliedOptions = Record<string, unknown>;

/** What a probe run or a pack's reference run wrote, as manifest.json beside its sheets. */
export type PhotoshopCaptureManifest = {
  run: string;
  kind: 'probes' | 'references';
  startedAt: string;
  /** When the last sheet was saved: the manifest is written then, before Photoshop quits. */
  finishedAt: string;
  seconds: { total: number; paint: number; perCapture: number };
  photoshop: {
    version: string;
    /** Photoshop's Color Settings as read at the run: RGBBlendGamma true is "Blend RGB Colors Using Gamma 1.0" (linear). */
    colorSettings: Record<string, unknown>;
    blending: 'gamma-encoded' | 'linear (gamma 1.0)';
  };
  document: typeof PHOTOSHOP_CAPTURE_DOCUMENT;
  /** The rig's own images, defined into Photoshop for the probes: the ramp pattern and the sampled tip. */
  assets?: { ramp: { name: string; width: number; height: number; file: string }; tip: { name: string; size: number; file: string } };
  /** For a reference run: the .abr its brushes came from. */
  source?: { abr: string; pack: string; style: string };
  /** Each item's requested settings (a probe's) or preset (a pack brush's), and the tool options Photoshop read back. */
  items: Record<string, {
    reads?: string;
    settings?: PhotoshopBrushSettings;
    preset?: PhotoshopReferencePreset;
    applied: PhotoshopAppliedOptions;
    /** A probe's settings that its read-back doesn't hold (photoshopPresetMismatches, photoshop-brushes/models/photoshop-preset.ts); absent when all took. */
    mismatches?: string[];
  }>;
  sheets: (PhotoshopCaptureSheet & { file: string })[];
  /** What the rig can't capture, and why. */
  notCaptured: string[];
  /** For a reference run: presets not captured because the pack repeats their name (only the first can be selected). */
  repeatedNames?: string[];
  /** For a probe run with repeats: each repeated cell's difference between its two paintings. */
  repeatability?: Record<string, PhotoshopCellDifference>;
};

/** How two paintings of one cell differ, on 16-bit RGBA. */
export type PhotoshopCellDifference = { identical: boolean; maxAlpha: number; meanAlpha: number; maxPremultiplied: number; differing: number };

export const PHOTOSHOP_NOT_CAPTURED = [
  "Build-up (Photoshop's airbrush): it piles paint up while the pen dwells, and a stroked path has no time under a held pen.",
  'Per-point pressure within a stroke: a script sets one constant pressure per stroke (a Brush Pose) or simulated pressure, never a curve of its own.',
  'Pen tilt and rotation.',
];
