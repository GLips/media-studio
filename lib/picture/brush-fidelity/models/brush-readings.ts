// brush-readings.ts: each app's reading, the constants its importer reads every brush by where the source's meaning
// isn't known exactly, as `npm run brushes:fit` and `brushes:diagnose` search it: its checked-in values, how far each
// constant may go, how a brush is read under a candidate, which brushes a constant touches, and which are held out.
//
// Held out: Kyle T. Webster's Photoshop packs whole (another author's brushes, never fitted to), and a fifth of every
// other Photoshop pack's, chosen by a hash of the brush's name so it never moves. No Procreate brush is held out: its
// reading was fitted against VVDS's previews, the only ones there are.

import { normalizePhotoshopBrush, type PhotoshopReading } from '#lib/picture/photoshop-brushes/models/photoshop-brush.ts';
import { PHOTOSHOP_READING } from '#lib/picture/photoshop-brushes/models/photoshop-reading.ts';
import { normalizeProcreateBrush, type ProcreateReading } from '#lib/picture/procreate-brushes/models/procreate-brush.ts';
import { PROCREATE_READING } from '#lib/picture/procreate-brushes/models/procreate-reading.ts';
import type { StampBrush } from '#lib/picture/stamp-paint/models/stamp-brush.ts';
import type { PhotoshopPackBrush, ProcreatePackBrush } from '#lib/picture/stamp-styles/models/stamp-paint-pack.ts';
import type { BrushReading, BrushReadingRange } from './brush-reading-search.ts';

export type BrushReadingApp<R extends BrushReading, Source> = {
  /** The checked-in reading every style reads the app's brushes by. */
  reading: R;
  ranges: Readonly<Record<keyof R & string, BrushReadingRange>>;
  read: (name: string, source: Source, reading: R) => StampBrush;
  /** Whether `source` uses the mechanism `key` reads, so a candidate for it can change how the brush paints. */
  uses: (key: keyof R & string, source: Source) => boolean;
  heldOut: (pack: string, name: string) => boolean;
  /** The reading module's text for `reading`, fitted against `against` (`<style>/<pack>, …`). */
  module: (reading: R, against: string) => string;
};

const scale = (min: number, max: number): BrushReadingRange => ({ kind: 'multiplicative', min, max, factor: 2, finest: 1.1 });
const amount = (min: number, max: number, step: number, finest: number): BrushReadingRange => ({ kind: 'additive', min, max, step, finest });

const readingLines = (reading: BrushReading) => Object.entries(reading).map(([key, value]) => `  ${key}: ${value},`).join('\n');

const PROCREATE: BrushReadingApp<ProcreateReading, ProcreatePackBrush> = {
  reading: PROCREATE_READING,
  ranges: {
    taperShare: amount(0.05, 1, 0.2, 0.03),
    edgeWidth: scale(0.005, 0.3),
    rimSharpness: scale(1, 128),
    wetRim: scale(0.1, 3),
    grainTile: scale(0.25, 12),
    grainBrightness: amount(-1, 1, 0.4, 0.05),
    grainContrast: scale(1, 8),
    grainDepthCurve: scale(0.2, 4),
    glazeFlowCurve: scale(0.2, 4),
    blendingFlowCurve: scale(0.2, 4),
    dualScale: scale(0.25, 4),
    spacingPower: amount(0.25, 1, 0.15, 0.02),
    lateralJitterScale: scale(0.05, 2),
    lateralJitterPower: amount(0.25, 1.5, 0.25, 0.03),
    glazeBuildLight: amount(0, 1, 0.5, 0.06),
    glazeBuildUniform: amount(0, 1, 0.5, 0.06),
    glazeBuildIntense: amount(0, 1, 0.5, 0.06),
    glazeBuildHeavy: amount(0, 1, 0.5, 0.06),
  },
  read: (name, source, reading) => normalizeProcreateBrush(name, source.main, source.dual, reading).brush,
  uses: () => true,
  heldOut: () => false,
  module: (reading, against) => `// procreate-reading.ts: the fitted ProcreateReading (procreate-brush.ts), written by \`npm run brushes:fit\`
// (lib/picture/brush-fidelity/engine/brush-reading-fit.ts) against ${against}. Edit by fitting again, not by hand:
// each value was chosen with the others, against every brush the fit was given.
import type { ProcreateReading } from './procreate-brush.ts';

export const PROCREATE_READING: ProcreateReading = {
${readingLines(reading)}
};
`,
};

const PHOTOSHOP_HELD_OUT_PACKS: readonly string[] = ['kyle-watercolor', 'kyle-dry-media', 'kyle-gouache'];

const PHOTOSHOP: BrushReadingApp<PhotoshopReading, PhotoshopPackBrush> = {
  reading: PHOTOSHOP_READING,
  ranges: {
    scatterSpan: scale(0.1, 2),
    angleJitterSpan: scale(Math.PI / 4, 4 * Math.PI),
    hueJitterShare: amount(0, 1, 0.25, 0.05),
    dualScale: scale(0.25, 4),
  },
  read: (name, source, reading) => normalizePhotoshopBrush(name, source, reading).brush,
  // Hue jitter is colour, which a coverage sheet can't see.
  uses: (key, { preset }) => {
    switch (key) {
      case 'scatterSpan': return (preset.scatter?.scatter.jitter ?? 0) > 0;
      case 'angleJitterSpan': return (preset.tipDynamics?.angle.jitter ?? 0) > 0;
      case 'dualScale': return !!preset.dual;
      case 'hueJitterShare': return false;
    }
  },
  heldOut: (pack, name) => {
    if (PHOTOSHOP_HELD_OUT_PACKS.includes(pack)) return true;
    let hash = 2166136261;
    for (let i = 0; i < name.length; i++) hash = Math.imul(hash ^ name.charCodeAt(i), 16777619) >>> 0;
    return hash % 5 === 0;
  },
  module: (reading, against) => `// photoshop-reading.ts: the PhotoshopReading (photoshop-brush.ts) every Photoshop pack is read by: what vid-97's probes
// couldn't pin exactly, written by \`npm run brushes:fit\` (lib/picture/brush-fidelity/engine/brush-reading-fit.ts)
// against ${against}'s training brushes. hueJitterShare is Photoshop's dialog read literally (a coverage sheet can't
// see hue). Edit by fitting again, or by \`npm run brushes:diagnose\`'s findings.
import type { PhotoshopReading } from './photoshop-brush.ts';

export const PHOTOSHOP_READING: PhotoshopReading = {
${readingLines(reading)}
};
`,
};

/** Each app's reading, by the app a pack's manifest names. */
export const BRUSH_READINGS = { procreate: PROCREATE, photoshop: PHOTOSHOP } as const;
