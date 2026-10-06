// stamp-gate-shot-glow.ts: the gate's glowing shot (a node's glow through a PaintedShot). A blue night washed over
// the back, a warm gouache streak across it; nearer, a clear plane holding a lamp's glass in thick cream gouache and
// a faint disc of the same cream over and round it. A glow is the light a film adds over the paint under it: the
// glass glows, the faint disc only by its thickness (never by the white a clear plane is measured on, nor by the
// glass under it), and the streak in its own warm colour, none of the blue under it; a keyed glow pulses.

import { paintKeyed } from '#lib/paint/animation/models/paint-keyed.ts';
import type { PresentationValue } from '#lib/paint/animation/models/paint-value.ts';
import type { Application, Layer, Mix, PaintingDocument, Region } from '#lib/paint/document/models/painting-document.ts';
import { layersOf } from '#lib/paint/document/models/painting-selection.ts';
import { painting, type PaintingSourceModule } from '#lib/paint/document/models/painting-source.ts';
import { TITANIUM_WHITE } from '#lib/paint/materials/models/paint-medium.ts';
import { WATERCOLOUR_PIGMENTS } from '#lib/paint/materials/models/paint-watercolour-pigments.ts';
import type { StampGroupGlow } from '#lib/paint/painting/models/stamp-paint-frame-state.ts';
import { stampStage } from '#lib/paint/painting/models/stamp-stage.ts';
import { STAMP_GATE_FRAME_TOLERANCE, stampGateFrameDifference, stampGateFrameDifferenceText, stampGateFramePasses } from './stamp-gate-frames.ts';
import type { StampGateWashCheck } from './stamp-gate-layer.ts';
import { stampGateHeronLayer, stampGateHeronPaper, stampGateHeronPolygon } from './stamp-gate-paper-heron.ts';
import { STAMP_GATE_ROUND_REF } from './stamp-gate-sheets.ts';
import type { StampGateShot } from './stamp-gate-shot-span.ts';

export const STAMP_GATE_SHOT_GLOW_ID = 'shot/glow' as const;

const GLOW_FRAME = { width: 160, height: 100 } as const;
const { ultramarine, hansaYellow, cadmiumRed } = WATERCOLOUR_PIGMENTS;

/** A box, document px (the frame's, as the planes lie at rest). */
type GlowBox = { readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number };
/** The lamp's glass; the faint disc's centre and radius, round the glass; the streak's ends, height and width. */
const GLASS: GlowBox = { x0: 40, y0: 30, x1: 60, y1: 50 };
const DISC = { x: 50, y: 40, r: 32 } as const;
const STREAK = { x0: 20, x1: 140, y: 80, widthPx: 6 } as const;

const CREAM: Mix = { parts: [{ pigment: hansaYellow, amount: 1 }, { pigment: cadmiumRed, amount: 0.1 }, { pigment: TITANIUM_WHITE, amount: 1.2 }], strength: 0.9 };
const ORANGE: Mix = { parts: [{ pigment: hansaYellow, amount: 1 }, { pigment: cadmiumRed, amount: 0.7 }], strength: 0.95 };
/** The faint disc's share of a full load: a veil a sixtieth as thick as its paint laid whole. */
const DISC_CAP = 0.015;

/** A gouache layer `key` of one wash, its one application. */
const gouache = (key: string, application: Application): Layer => ({ key, medium: 'gouache', washes: [{ key: `${key}-wash`, applications: [application] }] });
/** `region` filled with `mix`, `opacityCap` of a full load, once what's under it is dry. */
const fill = (key: string, region: Region, mix: Mix, opacityCap = 1): Application => ({
  key, on: 'dry', kind: 'fill', area: { region }, brush: STAMP_GATE_ROUND_REF, diameterPx: 12, seed: key, charge: { kind: 'paint', mix, opacityCap },
});
const rectangle = ({ x0, y0, x1, y1 }: GlowBox) => stampGateHeronPolygon(x0, y0, x1, y0, x1, y1, x0, y1);

/** The night: a blue wash over the sheet, and a warm streak across it. */
export const STAMP_GATE_GLOW_NIGHT: PaintingSourceModule = {
  default: function gateGlowNight(): PaintingDocument {
    const { width, height } = GLOW_FRAME;
    return {
      widthPx: width, heightPx: height, paper: stampGateHeronPaper('#f3eee2', 1), medium: 'watercolour',
      layers: [
        stampGateHeronLayer('sky', stampGateHeronPolygon(-10, -10, width + 10, -10, width + 10, height + 10, -10, height + 10), { parts: [{ pigment: ultramarine, amount: 1 }], strength: 0.8 }, 0.8),
        gouache('streak', {
          key: 'streak-stroke', on: 'dry', kind: 'stroke', subpaths: [[{ x: STREAK.x0, y: STREAK.y }, { x: STREAK.x1, y: STREAK.y }]], brush: STAMP_GATE_ROUND_REF, diameterPx: STREAK.widthPx,
          seed: 'streak', charge: { kind: 'paint', mix: ORANGE, opacityCap: 0.5 },
        }),
      ],
    };
  },
};

/** The lamp: its glass, thick cream, and over it a faint disc of the same cream. */
export const STAMP_GATE_GLOW_LAMP: PaintingSourceModule = {
  default: function gateGlowLamp(): PaintingDocument {
    return {
      widthPx: GLOW_FRAME.width, heightPx: GLOW_FRAME.height, paper: stampGateHeronPaper('#f3eee2', 1), medium: 'gouache',
      layers: [
        gouache('glass', fill('glass-fill', rectangle(GLASS), CREAM)),
        gouache('disc', fill('disc-fill', { kind: 'ellipse', center: { x: DISC.x, y: DISC.y }, radiusX: DISC.r, radiusY: DISC.r }, CREAM, DISC_CAP)),
      ],
    };
  },
};

/** Which layers glow, at what: the lamp's `glass` or `disc`, or the night's `streak`. */
export type StampGateGlowing = Partial<Readonly<Record<'glass' | 'disc' | 'streak', PresentationValue<StampGroupGlow>>>>;

/** The glow the checks give the glass and the disc: past the disc's own light, short of the glass's. */
export const STAMP_GATE_LAMP_GLOW: StampGroupGlow = { amount: 1, threshold: 0.3 };
/** The streak's glow: any of its light. */
export const STAMP_GATE_STREAK_GLOW: StampGroupGlow = { amount: 1, threshold: 0.02 };

/** The scene seconds the glass's pulse is read at: dark, halfway up, and at the lamp's full glow. */
export const STAMP_GATE_GLOW_PULSE_AT = { dark: 0, half: 0.5, full: 1 } as const;
/** The glass's pulse: from no glow up to the lamp's over a second. */
export const STAMP_GATE_LAMP_PULSE = paintKeyed<StampGroupGlow>([
  { at: STAMP_GATE_GLOW_PULSE_AT.dark, value: { ...STAMP_GATE_LAMP_GLOW, amount: 0 } }, { at: STAMP_GATE_GLOW_PULSE_AT.full, value: STAMP_GATE_LAMP_GLOW },
]);

/** The glowing shot, `glowing` as given, the disc shown unless `disc` is false, bloomed by 4 frame px. */
export function stampGateGlowShot(glowing: StampGateGlowing, { disc = true }: { disc?: boolean } = {}): StampGateShot {
  const glows = (night: boolean) => Object.fromEntries(Object.entries(glowing).filter(([layer]) => (layer === 'streak') === night).map(([layer, glow]) => [layer, { glow }]));
  return {
    camera: { stage: stampStage(GLOW_FRAME, 2), fov: 35, lens: { bloom: 4, shutter: 'shut' }, plays: [] },
    planes: [
      { id: 'night', depth: 1, source: layersOf(painting(STAMP_GATE_GLOW_NIGHT), ['sky', 'streak']), occurrences: glows(true) },
      { id: 'lamp', depth: 1, source: layersOf(painting(STAMP_GATE_GLOW_LAMP), disc ? ['glass', 'disc'] : ['glass']), occurrences: glows(false) },
    ],
  };
}

/**
 * The frames the checks read, RGB bytes: none glowing; the glass, or the disc, glowing; the disc at threshold 0; the
 * disc unpainted; the streak glowing; the glass pulsing (STAMP_GATE_LAMP_PULSE) dark, halfway and full.
 */
export type StampGateGlowFrames = Readonly<Record<'plain' | 'glass' | 'disc' | 'discAll' | 'noDisc' | 'streak' | 'pulseDark' | 'pulseHalf' | 'pulseFull', ArrayLike<number>>>;

/** How far round the glass its spill is read, and how far inside the disc's rim and outside the glass its veil is. */
const SPILL = 4;
const CLEAR_OF = 8;

/** The most each channel of `frame` rises over `base` (RGB bytes), over the texels `where` takes, and the least. */
function rises(frame: ArrayLike<number>, base: ArrayLike<number>, where: (x: number, y: number) => boolean) {
  const most = [0, 0, 0], least = [0, 0, 0];
  for (let y = 0; y < GLOW_FRAME.height; y++) for (let x = 0; x < GLOW_FRAME.width; x++) {
    if (!where(x + 0.5, y + 0.5)) continue;
    for (let c = 0; c < 3; c++) {
      const d = frame[(y * GLOW_FRAME.width + x) * 3 + c] - base[(y * GLOW_FRAME.width + x) * 3 + c];
      most[c] = Math.max(most[c], d);
      least[c] = Math.min(least[c], d);
    }
  }
  return { most, least, peak: Math.max(...most) };
}

const inBox = ({ x0, y0, x1, y1 }: GlowBox, by = 0) => (x: number, y: number) => x >= x0 - by && x < x1 + by && y >= y0 - by && y < y1 + by;
const everywhere = () => true;

/**
 * Whether the glass, thick paint on a clear plane, glows round its edge; the faint disc of the same paint glows by
 * its thickness alone, under the threshold the glass passes and, at threshold 0, by no more than the light it lays;
 * the warm streak's glow raises red over the blue night, never blue; and the glass pulses.
 */
export function checkStampGateShotGlow({ plain, glass, disc, discAll, noDisc, streak, pulseDark, pulseHalf, pulseFull }: StampGateGlowFrames): StampGateWashCheck[] {
  const spillOf = (frame: ArrayLike<number>) => rises(frame, plain, (x, y) => inBox(GLASS, SPILL)(x, y) && !inBox(GLASS)(x, y));
  const spill = spillOf(glass), halfSpill = spillOf(pulseHalf);
  const dark = stampGateFrameDifference(pulseDark, plain), full = stampGateFrameDifference(pulseFull, glass);
  const discThreshold = rises(disc, plain, everywhere);
  const veil = (x: number, y: number) => Math.hypot(x - DISC.x, y - DISC.y) < DISC.r - CLEAR_OF && !inBox(GLASS, CLEAR_OF)(x, y);
  const discGlow = rises(discAll, plain, veil), discLaid = rises(plain, noDisc, veil);
  const streakSpill = rises(streak, plain, (x, y) => x > STREAK.x0 + 20 && x < STREAK.x1 - 20 && Math.abs(y - STREAK.y) > STREAK.widthPx / 2 + 1 && Math.abs(y - STREAK.y) < STREAK.widthPx / 2 + 5);
  const [red, , blue] = streakSpill.most;
  return [
    {
      id: 'shot/glow: a clear plane\'s light', passed: spill.peak >= 20 && Math.min(...spill.least) >= 0,
      detail: `the glass glowing rises ${spill.peak} at most within ${SPILL} px round it (under 20 fails), least ${Math.min(...spill.least)} (under 0 fails)`,
    },
    {
      id: 'shot/glow: a veil by its thickness', passed: discThreshold.peak <= 1 && discGlow.peak > 0 && discGlow.peak <= discLaid.peak + 2,
      detail: `the faint disc glowing at the glass's threshold changes the frame ${discThreshold.peak} at most (past 1 fails: it took the white it's measured on, or the glass under it, for its own); `
        + `at threshold 0 it rises ${discGlow.peak} inside its rim away from the glass (0 fails), against ${discLaid.peak} its paint lays there (past that + 2 fails)`,
    },
    {
      id: 'shot/glow: its own colour', passed: red >= 40 && blue <= 1,
      detail: `the warm streak glowing over the blue night rises red ${red} (under 40 fails) and blue ${blue} (past 1 fails: it glowed the night's blue under it) just past its edge`,
    },
    {
      id: 'shot/glow: a glow in time', passed: stampGateFramePasses(dark) && stampGateFramePasses(full) && halfSpill.peak >= 4 && halfSpill.peak <= spill.peak - 4 && Math.min(...halfSpill.least) >= 0,
      detail: `the glass's keyed glow at amount 0 lies ${stampGateFrameDifferenceText(dark)} from the shot glowing nowhere, and at its full amount ${stampGateFrameDifferenceText(full)} from the glass glowing `
        + `(${STAMP_GATE_FRAME_TOLERANCE.max} levels allowed each); halfway up its spill rises ${halfSpill.peak} at most, least ${Math.min(...halfSpill.least)} (4 levels or more from 0 and from the full ${spill.peak} wanted)`,
    },
  ];
}
