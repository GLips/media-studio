// stamp-gate-reveals.ts: the gate's reveals (docs/painting-authoring.md, Time), each frame held to the CPU twin of
// what it shows (stampRevealShownAt): drawn mid-reveal, it matches the all-hidden frame wherever the twin shows
// nothing and the all-shown frame wherever it shows all. The ink: a flood revealed by three strokes of mixed widths
// and caps; wrapped, by one across its seam. The fields: a flood, a moon and a petal, revealed by a linear, a radial
// (profile `out`) and a noise field. The nested heron: its group and body each revealed, the body cut by both. The
// hidden foot: the wet-contact heron hidden whole. The reeds: a rig drawn as pieces, revealed. The page
// (studio/stamp-gate-reveals-page.ts) draws them; what its checks measure is here.

import type { PresentationValue } from '#lib/paint/animation/models/paint-value.ts';
import type { PaintingDocument, LayerNode, Reveal } from '#lib/paint/document/models/painting-document.ts';
import type { PropertySchema, PropertyValues } from '#lib/paint/document/models/painting-properties.ts';
import { paintingStampReveal } from '#lib/paint/document/models/painting-reveal-profile.ts';
import type { PaintingSourceModule } from '#lib/paint/document/models/painting-source.ts';
import { WATERCOLOUR_PIGMENTS } from '#lib/paint/materials/models/paint-watercolour-pigments.ts';
import type { StampPoint } from '#lib/paint/painting/models/stamp-region.ts';
import { stampRevealShownAt } from '#lib/paint/painting/models/stamp-reveal.ts';
import { stampStage, stampWrapPeriods } from '#lib/paint/painting/models/stamp-stage.ts';
import type { PaintedSource } from '#lib/paint/shot/models/shot-selection.ts';
import { STAMP_GATE_HERON_BODY, STAMP_GATE_HERON_MOVE, stampGatePaperHeronDocument } from './stamp-gate-paper-heron.ts';
import { stampGateTexelDiffers } from './stamp-gate-frames.ts';
import { STAMP_GATE_ROUND_REF, STAMP_GATE_SHEET_PAPER, STAMP_GATE_WET_CONTACT, stampGateRectangle } from './stamp-gate-sheets.ts';
import { STAMP_GATE_REED_PARTS, STAMP_GATE_RIGGED_HERON } from './stamp-gate-shots.ts';
import type { StampGateShot } from './stamp-gate-shot-span.ts';

/**
 * The reveal cases: strokes (mixed widths, caps, a crossing, uncovered paint, a soft ramp, a wrap's seam); fields
 * (linear, radial, noise, sought forward and back as stills); sheets (a shared root's film alone, nesting, own sheets'
 * cards, the ground); one painting through a still, a shot, HTML, a painted texture and a rig's pieces; and the
 * clock and cache.
 */
export const STAMP_GATE_REVEAL_IDS = ['reveal/strokes', 'reveal/fields', 'reveal/sheets', 'reveal/surfaces', 'reveal/clock'] as const;
export type StampGateRevealId = (typeof STAMP_GATE_REVEAL_IDS)[number];

/** Scene seconds before and after every gate reveal: all of it hidden, all of it shown. */
export const STAMP_GATE_REVEAL_ENDS = { lo: -1, hi: 20 } as const;

const SIZE = { width: 200, height: 140 } as const;
const { ultramarine, cerulean, burntSienna, quinacridoneRose } = WATERCOLOUR_PIGMENTS;
type GatePigment = (typeof WATERCOLOUR_PIGMENTS)[keyof typeof WATERCOLOUR_PIGMENTS];

/** A layer `key` of one wash flooding the rectangle x0, y0 to x1, y1 with `pigment` at `strength`, cut by `reveal`. */
function floodLayer(key: string, [x0, y0, x1, y1]: readonly [number, number, number, number], pigment: GatePigment, strength: number, reveal?: Reveal): LayerNode {
  return {
    key, ...(reveal && { reveal }),
    washes: [{
      key: `${key}-wash`,
      applications: [{
        key: `${key}-flood`, kind: 'fill', area: { region: stampGateRectangle(x0, y0, x1, y1) }, brush: STAMP_GATE_ROUND_REF, diameterPx: 24, seed: key,
        charge: { kind: 'paint', mix: { parts: [{ pigment, amount: 1 }], strength }, water: 0.5 },
      }],
    }],
  };
}

// ---- the ink -------------------------------------------------------------------------------------------------------

/**
 * The ink's reveal: a wide round stroke across its top from 0 to 2 s; a narrow flat one up through it from 1 to 2 s,
 * crossing it after the first has passed; a bent round one below from 0.5 to 1.5 s; each texel ramping in over 0.25 s.
 */
const INK_REVEAL = {
  kind: 'strokes', softS: 0.25,
  strokes: [
    { points: [{ x: 20, y: 40 }, { x: 180, y: 40 }], widthPx: 28, from: 0, to: 2 },
    { points: [{ x: 100, y: 130 }, { x: 100, y: 16 }], widthPx: 14, from: 1, to: 2, cap: 'flat' },
    { points: [{ x: 24, y: 104 }, { x: 56, y: 86 }, { x: 88, y: 112 }], widthPx: 20, from: 0.5, to: 1.5 },
  ],
} as const satisfies Reveal;

/** The ink's reveal edited, each stroke taking twice as long: an edit that only recomposes. */
const INK_REVEAL_SLOW: Reveal = { ...INK_REVEAL, strokes: INK_REVEAL.strokes.map((stroke) => ({ ...stroke, to: stroke.from + 2 * (stroke.to - stroke.from) })) };

/** Each reveal the ink may take, by its `reveal` property's value. */
export const STAMP_GATE_INK_REVEALS = { strokes: INK_REVEAL, slow: INK_REVEAL_SLOW } as const satisfies Readonly<Record<string, Reveal>>;

const inkProperties = { reveal: { type: 'enum', values: ['strokes', 'slow', 'none'], default: 'strokes' } } as const satisfies PropertySchema;

/** An ultramarine flood across the sheet, revealed by STAMP_GATE_INK_REVEALS' strokes (or slow), or not at all (none). */
export const STAMP_GATE_INK: PaintingSourceModule<typeof inkProperties> = {
  properties: inkProperties,
  default: function gateRevealInk({ reveal }: PropertyValues<typeof inkProperties>): PaintingDocument {
    const cut = reveal === 'none' ? undefined : STAMP_GATE_INK_REVEALS[reveal];
    return { widthPx: SIZE.width, heightPx: SIZE.height, paper: STAMP_GATE_SHEET_PAPER, medium: 'watercolour', layers: [floodLayer('ink', [4, 6, 196, 134], ultramarine, 0.75, cut)] };
  },
};

/** The ink's frames' scene seconds: its first stroke a third along; past halfway, the crossing reached; and later, the second stroke below it. */
export const STAMP_GATE_INK_AT = { early: 0.6, mid: 1.2, late: 1.5 } as const;

/**
 * Texels the ink's checks read, document px: inside the first stroke's round cap, past the second's flat end, where
 * they cross, on the second alone below the first, and on paint no stroke covers.
 */
export const STAMP_GATE_INK_TEXELS = {
  roundEnd: { x: 10, y: 40 }, flatEnd: { x: 100, y: 12 }, crossing: { x: 100, y: 40 }, secondOnly: { x: 100, y: 64 }, uncovered: { x: 150, y: 100 },
} as const satisfies Readonly<Record<string, StampPoint>>;

/** The first stroke's centreline, x from and to, at its y: where its soft ramp is read. */
export const STAMP_GATE_INK_RAMP = { x0: 30, x1: 90, y: 40 } as const;

/** How far the ink shows at document point `p` at scene second `t`, its reveal `reveal`. */
export const stampGateInkShownAt = (t: number, reveal: Reveal = INK_REVEAL) => (p: StampPoint) => stampRevealShownAt(paintingStampReveal(reveal), p, t);

/** The wrapped ink's reveal: a band from x 150 on across the right edge, wrapping to x 50 on the left, from 0 to 2 s. */
const WRAPPED_REVEAL = { kind: 'strokes', strokes: [{ points: [{ x: 150, y: 70 }, { x: 250, y: 70 }], widthPx: 60, from: 0, to: 2 }] } as const satisfies Reveal;

const wrappedProperties = { revealed: { type: 'boolean', default: true } } as const satisfies PropertySchema;

/** A cerulean flood from x 140 across the right edge of a sheet wrapping x, to x 60 on its left, revealed (`revealed`) by WRAPPED_REVEAL. */
export const STAMP_GATE_WRAPPED_INK: PaintingSourceModule<typeof wrappedProperties> = {
  properties: wrappedProperties,
  default: function gateRevealWrappedInk({ revealed }: PropertyValues<typeof wrappedProperties>): PaintingDocument {
    return {
      widthPx: SIZE.width, heightPx: SIZE.height, wrap: 'x', paper: STAMP_GATE_SHEET_PAPER, medium: 'watercolour',
      layers: [floodLayer('ink', [140, 20, 260, 120], cerulean, 0.7, revealed ? WRAPPED_REVEAL : undefined)],
    };
  },
};

/** When the wrapped ink is read mid-reveal: its front past the seam, at x 25 on the left. */
export const STAMP_GATE_WRAPPED_AT = 1.5;

/** How far the wrapped ink shows at document point `p` at scene second `t`, its band reaching round the seam. */
export const stampGateWrappedShownAt = (t: number) => (p: StampPoint) => stampRevealShownAt(WRAPPED_REVEAL, p, t, stampWrapPeriods(SIZE, 'x'));

/** Where the wrapped ink's checks read the seam, document px: on the band's centreline just past the seam (shown mid-reveal), and past its front (not yet). */
export const STAMP_GATE_WRAPPED_TEXELS = { pastSeam: { x: 10, y: 70 }, ahead: { x: 45, y: 70 } } as const satisfies Readonly<Record<string, StampPoint>>;

// ---- the fields ----------------------------------------------------------------------------------------------------

/** Each field column's flood: its rectangle, pigment and strength, and its reveal. */
const FIELD_COLUMNS = {
  flood: {
    box: [6, 8, 62, 132], pigment: cerulean, strength: 0.6,
    reveal: { kind: 'field', softS: 0.2, base: { kind: 'linear', from: { x: 34, y: 132, value: 0 }, to: { x: 34, y: 8, value: 2 } } },
  },
  moon: {
    box: [72, 8, 128, 132], pigment: burntSienna, strength: 0.7,
    reveal: { kind: 'field', softS: 0.2, base: { kind: 'radial', center: { x: 100, y: 70 }, radius: 56, inner: 0, outer: 2 }, profile: 'out' },
  },
  petal: {
    box: [138, 8, 194, 132], pigment: quinacridoneRose, strength: 0.7,
    reveal: {
      kind: 'field', softS: 0.3, base: { kind: 'noise', scale: 14, seed: 'petal', a: 0, b: 1.2 },
      delay: { kind: 'linear', from: { x: 138, y: 70, value: 0 }, to: { x: 194, y: 70, value: 0.8 } },
    },
  },
} as const satisfies Readonly<Record<string, { box: readonly [number, number, number, number]; pigment: GatePigment; strength: number; reveal: Reveal }>>;

export type StampGateFieldColumn = keyof typeof FIELD_COLUMNS;
// SAFETY: FIELD_COLUMNS is the literal above, so its keys are exactly its columns.
export const STAMP_GATE_FIELD_COLUMNS = Object.keys(FIELD_COLUMNS) as readonly StampGateFieldColumn[];

const fieldProperties = { revealed: { type: 'boolean', default: true } } as const satisfies PropertySchema;

/** A flood, a moon and a petal, side by side, each revealed by its field (a linear, a radial run `out`, a noise and its delay) when `revealed`. */
export const STAMP_GATE_FIELDS: PaintingSourceModule<typeof fieldProperties> = {
  properties: fieldProperties,
  default: function gateRevealFields({ revealed }: PropertyValues<typeof fieldProperties>): PaintingDocument {
    return {
      widthPx: SIZE.width, heightPx: SIZE.height, paper: STAMP_GATE_SHEET_PAPER, medium: 'watercolour',
      layers: STAMP_GATE_FIELD_COLUMNS.map((key) => {
        const { box, pigment, strength, reveal } = FIELD_COLUMNS[key];
        return floodLayer(key, box, pigment, strength, revealed ? reveal : undefined);
      }),
    };
  },
};

/** The fields' frames' scene seconds, sought forward and then back. */
export const STAMP_GATE_FIELD_SEEKS = { forward: [0.5, 1, 1.5], back: [1, 0.5] } as const;

/** How far a column's field shows at document point `p` at scene second `t`: judged only well inside its column, a flood's bleed clear of the next. */
export function stampGateFieldShownAt(column: StampGateFieldColumn, t: number): (p: StampPoint) => number | null {
  const { box: [x0, y0, x1, y1], reveal } = FIELD_COLUMNS[column], inset = 4;
  return (p) => (p.x >= x0 + inset && p.x <= x1 - inset && p.y >= y0 + inset && p.y <= y1 - inset ? stampRevealShownAt(paintingStampReveal(reveal), p, t) : null);
}

// ---- the nested heron ----------------------------------------------------------------------------------------------

/** The heron group's reveal: a hard front left to right, x 20 at 0.5 s to x 180 at 2.5 s. */
const GROUP_REVEAL = { kind: 'field', base: { kind: 'linear', from: { x: 20, y: 0, value: 0.5 }, to: { x: 180, y: 0, value: 2.5 } } } as const satisfies Reveal;
/** The body's own: a band 30 px wide along its middle, from its left end at 0 s to its right at 1 s; above and below the band it never shows. */
const BODY_REVEAL = { kind: 'strokes', strokes: [{ points: [{ x: 30, y: 60 }, { x: 102, y: 60 }], widthPx: 30, from: 0, to: 1 }] } as const satisfies Reveal;

/** When the nested heron is read mid-reveal: the group's front at x 40, the body's band's at x 84. */
export const STAMP_GATE_NESTED_AT = 0.75;

/** `nodes` with each node `reveals` names cut by its reveal, at any depth. */
function revealedNodes(nodes: readonly LayerNode[], reveals: Readonly<Record<string, Reveal>>): LayerNode[] {
  return nodes.map((node) => {
    const reveal = reveals[node.key], cut = reveal ? { ...node, reveal } : node;
    return cut.children ? { ...cut, children: revealedNodes(cut.children, reveals) } : cut;
  });
}

const heronProperties = { reveal: { type: 'enum', values: ['nested', 'none'], default: 'nested' }, heron: { type: 'boolean', default: true } } as const satisfies PropertySchema;

/**
 * The paper heron, its group revealed by a front and its body by a band too (`nested`), or neither (`none`); without
 * its heron group when not `heron`.
 */
export const STAMP_GATE_NESTED_HERON: PaintingSourceModule<typeof heronProperties> = {
  properties: heronProperties,
  default: function gateNestedHeron({ reveal, heron }: PropertyValues<typeof heronProperties>): PaintingDocument {
    const paperHeron = stampGatePaperHeronDocument(), layers = heron ? paperHeron.layers : paperHeron.layers.filter(({ key }) => key !== 'heron');
    return { ...paperHeron, layers: reveal === 'none' ? layers : revealedNodes(layers, { heron: GROUP_REVEAL, body: BODY_REVEAL }) };
  },
};

/** Whether document point `p` lies where the body's paint may reach: its ellipse grown 10 px for its bleed. */
const inBody = ({ x, y }: StampPoint) => {
  const { center, radiusX, radiusY } = STAMP_GATE_HERON_BODY;
  return ((x - center.x) / (radiusX + 10)) ** 2 + ((y - center.y) / (radiusY + 10)) ** 2 <= 1;
};
/** Whether `p` lies in the box holding the wing's sheets, cards and paint, the body's right end in it too. */
const inWing = ({ x, y }: StampPoint) => x >= 92 && x < 186 && y >= 10 && y < 80;

/** Which of the nested heron's parts `p` lies on: the body's paint, the wing's sheets, both, or the ground and water only. */
export function stampGateNestedPart(p: StampPoint): 'body' | 'wing' | 'both' | 'ground' {
  const body = inBody(p), wing = inWing(p);
  if (body && wing) return 'both';
  if (body) return 'body';
  return wing ? 'wing' : 'ground';
}

/**
 * How far the nested heron shows at document point `p` at scene second `t`, its group posed by `moved` (a shift,
 * document px): the body's paint cut by both reveals, the wing's sheets by the group's alone. Where both lie it's
 * judged only all hidden or all shown; on the ground and water it isn't judged.
 */
export function stampGateNestedShownAt(t: number, moved: StampPoint = { x: 0, y: 0 }): (p: StampPoint) => number | null {
  return (p) => {
    const rest = { x: p.x - moved.x, y: p.y - moved.y }, part = stampGateNestedPart(rest), group = stampRevealShownAt(GROUP_REVEAL, rest, t);
    if (part === 'ground') return null;
    if (part === 'wing') return group;
    const both = group * stampRevealShownAt(BODY_REVEAL, rest, t);
    if (part === 'body') return both;
    if (group === 0) return 0;
    return both === 1 ? 1 : null;
  };
}

/** How the nested heron's twin splits the body's paint at `t`: the group's front past it but the band not, the band but not the front, and both. */
export function stampGateNestedClass(p: StampPoint, t: number): 'group only' | 'band only' | 'both' | 'neither' | null {
  if (stampGateNestedPart(p) !== 'body') return null;
  const group = stampRevealShownAt(GROUP_REVEAL, p, t), band = stampRevealShownAt(BODY_REVEAL, p, t);
  if (group === 1 && band === 0) return 'group only';
  if (group === 0 && band === 1) return 'band only';
  if (group === 1 && band === 1) return 'both';
  return group === 0 && band === 0 ? 'neither' : null;
}

/** The posed check's heron moved, document px. */
export const STAMP_GATE_NESTED_MOVE: StampPoint = STAMP_GATE_HERON_MOVE;

// ---- the hidden foot -----------------------------------------------------------------------------------------------

/** A reveal hiding all it cuts until long after the gate looks. */
const HIDDEN: Reveal = { kind: 'field', base: { kind: 'constant', value: 1000 } };

/** The wet-contact sheet, its heron (the foot that walked into the shallows' wet) hidden whole by a reveal. */
export const STAMP_GATE_REVEAL_HIDDEN_FOOT: PaintingSourceModule = {
  default: function gateHiddenFoot(): PaintingDocument {
    const wetContact = STAMP_GATE_WET_CONTACT.default({ heron: true, apart: false });
    return { ...wetContact, layers: revealedNodes(wetContact.layers, { heron: HIDDEN }) };
  },
};

/** When the hidden foot is read: once its charge and glaze have both landed. */
export const STAMP_GATE_REVEAL_HIDDEN_FOOT_AT = 8;

// ---- the reeds -----------------------------------------------------------------------------------------------------

/** The reeds' reveal: a hard front rising out of the water, y 136 at 0 s to y 94 at 2 s. */
const REEDS_REVEAL = { kind: 'field', base: { kind: 'linear', from: { x: 0, y: 136, value: 0 }, to: { x: 0, y: 94, value: 2 } } } as const satisfies Reveal;

const reedsProperties = { revealed: { type: 'boolean', default: true } } as const satisfies PropertySchema;

/** The rigged heron, its reeds (a group owning its sheet, so a rig of it is drawn as pieces) revealed by REEDS_REVEAL when `revealed`. */
export const STAMP_GATE_REVEALED_REEDS: PaintingSourceModule<typeof reedsProperties> = {
  properties: reedsProperties,
  default: function gateRevealedReeds({ revealed }: PropertyValues<typeof reedsProperties>): PaintingDocument {
    const heron = STAMP_GATE_RIGGED_HERON.default({});
    return revealed ? { ...heron, layers: revealedNodes(heron.layers, { reeds: REEDS_REVEAL }) } : heron;
  },
};

/** When the reeds are read mid-reveal: the front at y 115, through both reeds. */
export const STAMP_GATE_REEDS_AT = 1;

/** How far the reeds show at document point `p` at scene second `t`, at rest: their reveal's front, paint and card alike. */
export const stampGateReedsShownAt = (t: number) => (p: StampPoint) => stampRevealShownAt(REEDS_REVEAL, p, t);

/** A shot of the rigged heron's `source`, its reeds rigged at rest, so drawn as pieces. */
export function stampGateRevealedReedsShot(source: PresentationValue<PaintedSource>): StampGateShot {
  return { ...stampGateRevealShot(source), rigs: { 'sheet/reeds': { parts: STAMP_GATE_REED_PARTS, pose: () => ({}) } } };
}

// ---- shots ---------------------------------------------------------------------------------------------------------

/**
 * A shot of a gate reveal's sheet at its size, its camera at rest, so frame px are document px: one plane showing
 * `source`, its source held on `hold`s when given.
 */
export function stampGateRevealShot(source: PresentationValue<PaintedSource>, hold?: number): StampGateShot {
  return {
    camera: { stage: stampStage(SIZE, 2), fov: 35, lens: { bloom: 0, shutter: 'shut' }, plays: [] },
    planes: [{ id: 'sheet', depth: 1, source, ...(hold !== undefined && { sourceClock: { hold } }) }],
  };
}

// ---- measures ------------------------------------------------------------------------------------------------------

/** A frame's bytes, `channels` a texel (RGB, or premultiplied RGBA), `width` × `height`. */
export type StampGateRevealFrame = { readonly bytes: ArrayLike<number>; readonly width: number; readonly height: number; readonly channels: 3 | 4 };

/** How many texels of two frames differ by over 2 levels in a channel. */
export function stampGateTexelsChanged(a: StampGateRevealFrame, b: ArrayLike<number>, within: (p: StampPoint) => boolean = () => true): number {
  let changed = 0;
  for (let texel = 0; texel < a.width * a.height; texel++) {
    if (within({ x: (texel % a.width) + 0.5, y: Math.floor(texel / a.width) + 0.5 }) && stampGateTexelDiffers(a.bytes, b, texel, a.channels)) changed++;
  }
  return changed;
}

/**
 * How frame `at`, drawn mid-reveal, lies against `lo` (all hidden) and `hi` (all shown) by `shownAt`, the twin's
 * share at each texel (null: not judged): `hidden` texels where every texel within `reach` (a draw's spread) shows
 * nothing, `hiddenOff` of them differing from `lo`; `shown` and `shownOff` alike against `hi`; `between` the rest.
 */
export function stampGateRevealSplit(
  at: StampGateRevealFrame, lo: ArrayLike<number>, hi: ArrayLike<number>, shownAt: (p: StampPoint) => number | null, reach: number,
): { hidden: number; hiddenOff: number; shown: number; shownOff: number; between: number } {
  const { width, height, channels } = at, shares = new Float32Array(width * height);
  for (let texel = 0; texel < width * height; texel++) shares[texel] = shownAt({ x: (texel % width) + 0.5, y: Math.floor(texel / width) + 0.5 }) ?? Number.NaN;
  const all = (x: number, y: number, value: number) => {
    for (let j = Math.max(0, y - reach); j <= Math.min(height - 1, y + reach); j++) {
      for (let i = Math.max(0, x - reach); i <= Math.min(width - 1, x + reach); i++) if (shares[j * width + i] !== value) return false;
    }
    return true;
  };
  const split = { hidden: 0, hiddenOff: 0, shown: 0, shownOff: 0, between: 0 };
  for (let texel = 0; texel < width * height; texel++) {
    if (Number.isNaN(shares[texel])) continue;
    const x = texel % width, y = Math.floor(texel / width);
    if (all(x, y, 0)) {
      split.hidden++;
      if (stampGateTexelDiffers(at.bytes, lo, texel, channels)) split.hiddenOff++;
    } else if (all(x, y, 1)) {
      split.shown++;
      if (stampGateTexelDiffers(at.bytes, hi, texel, channels)) split.shownOff++;
    } else split.between++;
  }
  return split;
}

/** A split as a check's detail reads it. */
export const stampGateRevealSplitText = ({ hidden, hiddenOff, shown, shownOff, between }: ReturnType<typeof stampGateRevealSplit>) =>
  `${hiddenOff} of ${hidden} hidden texels off all-hidden, ${shownOff} of ${shown} shown off all-shown (0 wanted), ${between} between`;

/** Whether a split held: none off, and some texels hidden and some shown. */
export const stampGateRevealSplitHeld = ({ hidden, hiddenOff, shown, shownOff }: ReturnType<typeof stampGateRevealSplit>) => hidden > 0 && shown > 0 && hiddenOff === 0 && shownOff === 0;
