// procreate-capture-plan.ts: where on Procreate's canvas each probe's marks go, and in what order (vid-96). A run is
// a few canvases, each a ground layer (imported from the template image drawn here: guides and the black, grey, white
// and striped patches that some marks are painted over) and a layer per probe, named after it. The capture rig
// (engine/procreate-capture.ts) paints every step and exports each canvas's layers once.
//
// A mark over a ground is painted on the ground layer itself, not its probe's: a brush composites only with the layer
// it paints on, and that composite is what the ground marks read. Every mark has a box of its own, so the ground
// layer's marks never meet and a probe's layer can be cropped to its box.
//
// Canvas coordinates are pixels of the capture canvas; the rig maps them to the screen.

import { procreatePreviewStrokePath } from './procreate-preview-stroke.ts';
import { PROCREATE_PROBE_INK, type ProcreateProbe, type ProcreateProbeGround, type ProcreateProbeMark } from './procreate-probes.ts';

/** The capture canvas's side in pixels, and its box grid. */
export const PROCREATE_CAPTURE_CANVAS = 4096;
const CELL = 512, COLUMNS = PROCREATE_CAPTURE_CANVAS / CELL;
/**
 * The top row of boxes sits under Procreate's toolbar (its lower edge is 176 canvas pixels down on a fitted 4096
 * canvas), so a stroke there would press a button. Only the calibration taps, well below the toolbar, go in it.
 */
const FIRST_ROW = 1, ROWS = PROCREATE_CAPTURE_CANVAS / CELL;
/**
 * Probe layers per canvas. Procreate allows 28 layers on a 4096 square canvas on Graham's iPad (Custom Canvas shows
 * the limit); the background and the ground layer take two, and two are left spare.
 */
const PROBE_LAYERS_PER_CANVAS = 24;
/** The ground layer's name: the imported template's own layer, renamed. */
export const PROCREATE_CAPTURE_GROUND_LAYER = 'Grounds';

/** How many boxes wide each mark is, one box tall. */
const MARK_WIDTH: Record<ProcreateProbeMark, number> = { tap: 1, line: 2, selfCross: 2, twoCross: 1, sCurve: 2, longLine: COLUMNS };

export type ProcreateCanvasPoint = { x: number; y: number };
/** A box on the canvas, in pixels. */
export type ProcreateCaptureBox = { x: number; y: number; width: number; height: number };

/** One mark: the strokes a finger paints (a tap is a stroke of one point), in order, lifted between. */
export type ProcreateCaptureStep = {
  probe: string;
  /** The layer it's painted on: its probe's own, or the ground layer. */
  layer: string;
  mark: ProcreateProbeMark;
  ground: ProcreateProbeGround;
  color: string;
  box: ProcreateCaptureBox;
  strokes: ProcreateCanvasPoint[][];
};

export type ProcreateGroundPatch = { ground: Exclude<ProcreateProbeGround, 'clear'>; box: ProcreateCaptureBox };

export type ProcreateCaptureCanvas = {
  /** Its template's file name, without .png; Procreate names the artwork and its exported layers by it. */
  name: string;
  grounds: ProcreateGroundPatch[];
  /** The probe layers, bottom to top, each named after its probe. */
  layers: string[];
  steps: ProcreateCaptureStep[];
};

/**
 * Where the calibration taps go, painted with the calibration probe on the ground layer: the two ends of the top row,
 * so each canvas's export checks the screen-to-canvas map it was painted through.
 */
export const PROCREATE_CAPTURE_CALIBRATION_TAPS: readonly ProcreateCanvasPoint[] = [{ x: CELL / 2, y: CELL / 2 }, { x: PROCREATE_CAPTURE_CANVAS - CELL / 2, y: CELL / 2 }];

const GROUND_COLOR: Record<ProcreateGroundPatch['ground'], [number, number, number]> = { black: [0, 0, 0], grey: [128, 128, 128], white: [255, 255, 255], stripe: [255, 255, 255] };
/** The stripe ground's band: a red the wet-mix probes pull their blue across. */
const STRIPE_COLOR: [number, number, number] = [210, 60, 30];
const GUIDE_COLOR: [number, number, number, number] = [0, 160, 255, 96];
/** How far a ground patch sits inside its box, so the guides never cross it. */
const PATCH_INSET = 8;

/** Points along a segment, about `step` pixels apart, the first included and the last. */
function segment(a: ProcreateCanvasPoint, b: ProcreateCanvasPoint, step = 8): ProcreateCanvasPoint[] {
  const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / step));
  return Array.from({ length: n + 1 }, (_, i) => ({ x: a.x + ((b.x - a.x) * i) / n, y: a.y + ((b.y - a.y) * i) / n }));
}

/** The strokes of `mark` in `box`. */
export function procreateMarkStrokes(mark: ProcreateProbeMark, box: ProcreateCaptureBox): ProcreateCanvasPoint[][] {
  const at = (u: number, v: number) => ({ x: box.x + u * box.width, y: box.y + v * box.height });
  switch (mark) {
    case 'tap': return [[at(0.5, 0.5)]];
    case 'line': return [segment(at(0.1, 0.5), at(0.9, 0.5))];
    case 'longLine': return [segment(at(0.03, 0.5), at(0.97, 0.5))];
    case 'twoCross': return [segment(at(0.2, 0.2), at(0.8, 0.8)), segment(at(0.8, 0.2), at(0.2, 0.8))];
    case 'selfCross': {
      // A prolate cycloid with one loop: it runs right, turns back over itself and runs on.
      const loops = 1, r = box.height * 0.3, c = (box.width * 0.7) / (2 * Math.PI * loops), n = 240;
      return [Array.from({ length: n + 1 }, (_, i) => {
        const t = (2 * Math.PI * loops * i) / n;
        return { x: box.x + box.width * 0.15 + c * t - r * Math.sin(t), y: box.y + box.height / 2 - r * Math.cos(t) };
      })];
    }
    case 'sCurve': {
      const path = procreatePreviewStrokePath(), scale = box.width / 1060;
      const points = path.map((p) => ({ x: box.x + p.x * scale, y: box.y + box.height / 2 + (p.y - 162) * scale }));
      return [points.slice(1).flatMap((p, i) => segment(points[i], p).slice(i === 0 ? 0 : 1))];
    }
  }
}

/**
 * The run's canvases: every probe's marks in boxes, row by row, a new canvas when one fills (boxes or layers). A
 * probe's clear marks go on its own layer; its ground marks on the ground layer. `repeats` paints some probes again,
 * each `times` times on a canvas of their own, so the capture's own variation can be measured.
 */
export function planProcreateCapture(probes: readonly ProcreateProbe[], { prefix = 'studio-capture', only, repeats }: {
  prefix?: string;
  /** Paint only these probes (by name); every probe otherwise. `[]` paints none, for a run of repeats alone. */
  only?: readonly string[];
  repeats?: { probes: readonly string[]; times: number };
} = {}): ProcreateCaptureCanvas[] {
  type Sheet = { canvas: ProcreateCaptureCanvas; column: number; row: number };
  const canvases: ProcreateCaptureCanvas[] = [];
  const open = (): Sheet => {
    const canvas = { name: `${prefix}-${canvases.length + 1}`, grounds: [], layers: [], steps: [] };
    canvases.push(canvas);
    return { canvas, column: 0, row: FIRST_ROW };
  };
  /** Where `probe`'s marks would go on `sheet`, each box's width, or nothing if they don't fit. */
  const boxesOn = (sheet: Sheet, probe: ProcreateProbe, layer: boolean): ProcreateCaptureBox[] | undefined => {
    if (layer && sheet.canvas.layers.length >= PROBE_LAYERS_PER_CANVAS) return undefined;
    let { column, row } = sheet;
    const boxes = probe.marks.map(({ mark }) => {
      const width = MARK_WIDTH[mark];
      if (column + width > COLUMNS) column = 0, row++;
      const box = { x: column * CELL, y: row * CELL, width: width * CELL, height: CELL };
      column += width;
      return box;
    });
    return row < ROWS ? boxes : undefined;
  };
  /** Adds `probe` to the first of `sheets` it fits, opening one if none has room: first fit, since layers run out before boxes. */
  const add = (sheets: Sheet[], probe: ProcreateProbe, layerName: string) => {
    const clear = probe.marks.some((m) => m.ground === 'clear');
    let sheet = sheets.find((s) => boxesOn(s, probe, clear));
    if (!sheet) sheets.push(sheet = open());
    const boxes = boxesOn(sheet, probe, clear);
    if (!boxes) throw new Error(`capture plan: ${probe.name} has more marks than a canvas holds`);
    const last = boxes.at(-1)!;
    sheet.row = last.y / CELL;
    sheet.column = (last.x + last.width) / CELL;
    if (clear) sheet.canvas.layers.push(layerName);
    probe.marks.forEach(({ mark, ground, color }, i) => {
      const box = boxes[i];
      if (ground !== 'clear') sheet.canvas.grounds.push({ ground, box });
      sheet.canvas.steps.push({ probe: probe.name, layer: ground === 'clear' ? layerName : PROCREATE_CAPTURE_GROUND_LAYER, mark, ground, color, box, strokes: procreateMarkStrokes(mark, box) });
    });
  };
  const sheets: Sheet[] = [];
  for (const probe of probes) if (!only || only.includes(probe.name)) add(sheets, probe, probe.name);
  if (repeats) {
    const byName = new Map(probes.map((p) => [p.name, p]));
    const repeatSheets: Sheet[] = [];
    for (let k = 1; k <= repeats.times; k++) {
      for (const name of repeats.probes) {
        const probe = byName.get(name);
        if (!probe) throw new Error(`capture plan: no probe named ${name} to repeat`);
        add(repeatSheets, probe, `${name} #${k}`);
      }
    }
  }
  const calibration = probes.find((p) => p.calibration);
  if (!calibration) throw new Error('capture plan: no probe is marked as the calibration stamp');
  for (const c of canvases) {
    c.steps.unshift(...PROCREATE_CAPTURE_CALIBRATION_TAPS.map((at) => ({
      probe: calibration.name, layer: PROCREATE_CAPTURE_GROUND_LAYER, mark: 'tap' as const, ground: 'clear' as const, color: PROCREATE_PROBE_INK,
      box: { x: at.x - CELL / 2, y: at.y - CELL / 2, width: CELL, height: CELL }, strokes: [[at]],
    })));
  }
  return canvases;
}

/** What a capture run wrote: `manifest.json` in its folder, beside a folder of layer PNGs per canvas. */
export type ProcreateCaptureManifest = {
  run: string;
  startedAt: string;
  finishedAt: string;
  device: { name: string; productType: string; osVersion: string; osBuild: string };
  procreate: { version: string; build: string };
  canvas: { width: number; height: number; profile: string; bitDepth: number; screen: { pixelsPerPoint: number; left: number; top: number } };
  /** The brush set painted with, its template brush, and the pack both came from. */
  brushSet: { name: string; template: string; archive: string };
  /** A finger at a steady pace, as procreate-app-driver.ts paints. */
  touch: { pointsPerSecond: number; tapHoldMs: number; pressure: 'none: a finger' };
  probes: ProcreateProbe[];
  canvases: (ProcreateCaptureCanvas & {
    template: string;
    /** Each exported layer's file, by its layer name. */
    files: Record<string, string>;
    /** Where each calibration tap landed against where it was asked for, in canvas pixels. */
    calibration: { asked: ProcreateCanvasPoint; landed: ProcreateCanvasPoint }[];
    seconds: { paint: number; export: number; total: number };
    /** Seconds per probe, from adding its layer to its last mark. */
    probeSeconds: Record<string, number>;
  })[];
};

/**
 * A canvas's template, RGBA, row by row: transparent, with faint guides on the box lines and each ground's patch.
 * Imported into Procreate, it becomes the ground layer.
 */
export function drawProcreateCaptureTemplate(canvas: ProcreateCaptureCanvas): Uint8Array {
  const size = PROCREATE_CAPTURE_CANVAS, pixels = new Uint8Array(size * size * 4);
  const fill = (x0: number, y0: number, x1: number, y1: number, [r, g, b]: readonly number[], a = 255) => {
    for (let y = Math.max(0, y0); y < Math.min(size, y1); y++) {
      for (let x = Math.max(0, x0); x < Math.min(size, x1); x++) pixels.set([r, g, b, a], (y * size + x) * 4);
    }
  };
  for (let k = CELL; k < size; k += CELL) {
    fill(k, 0, k + 1, size, GUIDE_COLOR, GUIDE_COLOR[3]);
    fill(0, k, size, k + 1, GUIDE_COLOR, GUIDE_COLOR[3]);
  }
  for (const { ground, box } of canvas.grounds) {
    const x0 = box.x + PATCH_INSET, y0 = box.y + PATCH_INSET, x1 = box.x + box.width - PATCH_INSET, y1 = box.y + box.height - PATCH_INSET;
    fill(x0, y0, x1, y1, GROUND_COLOR[ground]);
    if (ground === 'stripe') fill(Math.round(box.x + box.width * 0.4), y0, Math.round(box.x + box.width * 0.6), y1, STRIPE_COLOR);
  }
  return pixels;
}
