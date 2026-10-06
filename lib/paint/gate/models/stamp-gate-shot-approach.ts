// stamp-gate-shot-approach.ts: the gate's approaching kite (a plane's depth in time, through a PaintedShot). As the
// camera pushes in, a cream gouache kite flies from behind a dark gouache post, which holds one depth, to in front of
// it and on toward the camera. Each frame draws the kite as a kite held at its depth then; it passes the post where
// it crosses the post's depth; an open shutter blurs it along its approach, growing over it. What the checks measure
// is here.

import { paintCameraPlay } from '#lib/paint/animation/models/paint-camera.ts';
import { paintKeyed } from '#lib/paint/animation/models/paint-keyed.ts';
import type { Application, Layer, Mix, PaintingDocument, Region } from '#lib/paint/document/models/painting-document.ts';
import { layersOf } from '#lib/paint/document/models/painting-selection.ts';
import { painting, type PaintingSourceModule } from '#lib/paint/document/models/painting-source.ts';
import { TITANIUM_WHITE } from '#lib/paint/materials/models/paint-medium.ts';
import { WATERCOLOUR_PIGMENTS } from '#lib/paint/materials/models/paint-watercolour-pigments.ts';
import { paintMoment } from '#lib/paint/painting/models/stamp-paint-frame-state.ts';
import { stampStage } from '#lib/paint/painting/models/stamp-stage.ts';
import type { PlaneProps } from '#lib/paint/shot/models/shot-props.ts';
import { stampGateFrameDifference, stampGateFrameDifferenceText, stampGateFramePasses, STAMP_GATE_FRAME_TOLERANCE } from './stamp-gate-frames.ts';
import type { StampGateWashCheck } from './stamp-gate-layer.ts';
import { stampGateHeronLayer, stampGateHeronPaper, stampGateHeronPolygon } from './stamp-gate-paper-heron.ts';
import { STAMP_GATE_ROUND_REF } from './stamp-gate-sheets.ts';
import type { StampGateShot } from './stamp-gate-shot-span.ts';

export const STAMP_GATE_SHOT_APPROACH_ID = 'shot/approach' as const;

const APPROACH_FRAME = { width: 160, height: 120 } as const;
const { ultramarine, burntUmber, hansaYellow, cadmiumRed, cerulean } = WATERCOLOUR_PIGMENTS;

/**
 * The shot's depths (the kite's over the first second); the camera's push over it; its shutter, a whole frame of
 * STAMP_GATE_SHOT_FPS so the kite's blur is plain; the post's and kite's paint, document px (frame px, at rest); and
 * the scene seconds the checks draw, the kite behind the post and past it.
 */
export const STAMP_GATE_APPROACH = {
  depths: { back: 4, post: 2, kite: { from: 3, to: 0.75 } },
  push: 0.6,
  shutter: 1 / 30,
  post: { x0: 74, x1: 86 },
  kite: { x: 80, y: 60, r: 18 },
  at: { behind: 0.2, past: 0.95 },
} as const;

const DARK: Mix = { parts: [{ pigment: ultramarine, amount: 1 }, { pigment: burntUmber, amount: 1 }], strength: 0.95 };
const CREAM: Mix = { parts: [{ pigment: hansaYellow, amount: 1 }, { pigment: cadmiumRed, amount: 0.2 }, { pigment: TITANIUM_WHITE, amount: 1 }], strength: 0.9 };

/** A gouache layer `key` filling `region` with `mix`, once what's under it is dry. */
const gouache = (key: string, region: Region, mix: Mix): Layer => {
  const fill: Application = { key: `${key}-fill`, on: 'dry', kind: 'fill', area: { region }, brush: STAMP_GATE_ROUND_REF, diameterPx: 12, seed: key, charge: { kind: 'paint', mix } };
  return { key, medium: 'gouache', washes: [{ key: `${key}-wash`, applications: [fill] }] };
};

/** The approach's painting: a pale `sky` over the sheet, a `post` down its middle and a round `kite` on it, both gouache. */
export const STAMP_GATE_APPROACH_PAINTING: PaintingSourceModule = {
  default: function gateApproach(): PaintingDocument {
    const { width, height } = APPROACH_FRAME, { post, kite } = STAMP_GATE_APPROACH;
    return {
      widthPx: width, heightPx: height, paper: stampGateHeronPaper('#f3eee2', 1), medium: 'watercolour',
      layers: [
        stampGateHeronLayer('sky', stampGateHeronPolygon(-10, -10, width + 10, -10, width + 10, height + 10, -10, height + 10), { parts: [{ pigment: cerulean, amount: 1 }], strength: 0.35 }, 0.8),
        gouache('post', stampGateHeronPolygon(post.x0, -10, post.x1, -10, post.x1, height + 10, post.x0, height + 10), DARK),
        gouache('kite', { kind: 'ellipse', center: { x: kite.x, y: kite.y }, radiusX: kite.r, radiusY: kite.r }, CREAM),
      ],
    };
  },
};

/** The kite's depth over the shot: from behind the post to past it, toward the camera. */
const kiteDepth = paintKeyed([{ at: 0, value: STAMP_GATE_APPROACH.depths.kite.from }, { at: 1, value: STAMP_GATE_APPROACH.depths.kite.to }]);
const pushing = paintKeyed([{ at: 0, value: { dolly: 0 } }, { at: 1, value: { dolly: STAMP_GATE_APPROACH.push } }]);

/**
 * The approach as `kite` says: flying; held at the depth it flies at at that scene second; or left out. `post` false
 * leaves the post out; `shut` shuts the lens.
 */
export function stampGateApproachShot({ kite = 'flying', post = true, shut = false }: { kite?: 'flying' | { held: number } | null; post?: boolean; shut?: boolean } = {}): StampGateShot {
  const evaluation = painting(STAMP_GATE_APPROACH_PAINTING), { depths } = STAMP_GATE_APPROACH;
  const kitePlane: PlaneProps | null = kite && { id: 'kite', depth: kite === 'flying' ? kiteDepth : kiteDepth(paintMoment(kite.held)), source: layersOf(evaluation, ['kite']) };
  return {
    camera: {
      stage: stampStage(APPROACH_FRAME, 4), fov: 35, lens: { bloom: 0, shutter: shut ? 'shut' : STAMP_GATE_APPROACH.shutter },
      plays: [paintCameraPlay({ kind: 'move', value: pushing }, { clock: { at: 0 }, origin: 'the camera pushes in' })],
    },
    planes: [
      { id: 'sky', depth: depths.back, source: layersOf(evaluation, ['sky']) },
      ...(post ? [{ id: 'post', depth: depths.post, source: layersOf(evaluation, ['post']) }] : []),
      ...(kitePlane ? [kitePlane] : []),
    ],
  };
}

/** The frames the checks read at one of STAMP_GATE_APPROACH's seconds, RGB bytes, the shutter shut: the kite flying, held, left out, and the post left out. */
export type StampGateApproachFrames = Readonly<Record<'flying' | 'held' | 'noKite' | 'noPost', ArrayLike<number>>>;

/** The past frame with the shutter open, RGB bytes: the kite flying, held at its depth then, and left out. */
export type StampGateApproachOpenFrames = Readonly<Record<'flying' | 'held' | 'noKite', ArrayLike<number>>>;

/** A box of frame px, end exclusive. */
type ApproachBox = { readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number };

/** Where the post and kite overlap at both seconds, frame px: inside the post's paint and the kite's, clear of their edges. */
const OVERLAP: ApproachBox = { x0: 77, y0: 52, x1: 83, y1: 68 };

/** The mean of each channel's difference between `a` and `b` over `box`, RGB bytes a frame wide. */
function meanApart(a: ArrayLike<number>, b: ArrayLike<number>, { x0, y0, x1, y1 }: ApproachBox): number {
  let sum = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) for (let c = 0; c < 3; c++) sum += Math.abs(a[(y * APPROACH_FRAME.width + x) * 3 + c] - b[(y * APPROACH_FRAME.width + x) * 3 + c]);
  return sum / ((x1 - x0) * (y1 - y0) * 3);
}

/**
 * How many texels across its centre row the kite's rim spreads over in RGB frame `a`, read against `b`, the frame
 * without it: those a tenth to nine tenths of the way from `b` to the kite's middle, in the channel it most differs
 * from the sky in.
 */
function kiteRim(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const { x, y } = STAMP_GATE_APPROACH.kite, row = y * APPROACH_FRAME.width, middle = (row + x) * 3, sky = row * 3;
  const channel = [0, 1, 2].reduce((best, c) => (Math.abs(a[middle + c] - b[sky + c]) > Math.abs(a[middle + best] - b[sky + best]) ? c : best));
  let rim = 0;
  for (let at = 0; at < APPROACH_FRAME.width; at++) {
    const i = (row + at) * 3 + channel, covered = (a[i] - b[i]) / (a[middle + channel] - b[i]);
    if (covered > 0.1 && covered < 0.9) rim++;
  }
  return rim;
}

/** How much wider the flying kite's rim is than the held one's, open, at least: the push alone blurs the held one. */
const BLURRED_BY_APPROACH = 1.5;

/** How many times nearer a frame's overlap lies to the plane in front alone than to the one behind alone, at least. */
const IN_FRONT = 4;

const levelsText = (n: number) => n.toFixed(1);

/**
 * Whether the approach draws each frame as a kite held at its depth then; passes the post where it crosses its depth
 * (the overlap read against the frame without each); and, the shutter open, blurs the kite along its approach, its
 * rim wider than a held kite's, which only the push blurs.
 */
export function checkStampGateShotApproach(frames: { readonly behind: StampGateApproachFrames; readonly past: StampGateApproachFrames; readonly open: StampGateApproachOpenFrames }): StampGateWashCheck[] {
  const { at } = STAMP_GATE_APPROACH, held = { behind: stampGateFrameDifference(frames.behind.flying, frames.behind.held), past: stampGateFrameDifference(frames.past.flying, frames.past.held) };
  const facing = (seen: StampGateApproachFrames) => ({ postOnly: meanApart(seen.flying, seen.noKite, OVERLAP), kiteOnly: meanApart(seen.flying, seen.noPost, OVERLAP) });
  const behind = facing(frames.behind), past = facing(frames.past);
  const rims = { flying: kiteRim(frames.open.flying, frames.open.noKite), held: kiteRim(frames.open.held, frames.open.noKite), shut: kiteRim(frames.past.flying, frames.past.noKite) };
  return [
    {
      id: 'shot/approach: depth each frame', passed: stampGateFramePasses(held.behind) && stampGateFramePasses(held.past),
      detail: `flying, the kite lies ${stampGateFrameDifferenceText(held.behind)} from it held at its depth at ${at.behind} s, and ${stampGateFrameDifferenceText(held.past)} at ${at.past} s (${STAMP_GATE_FRAME_TOLERANCE.max} levels allowed)`,
    },
    {
      id: 'shot/approach: passes', passed: behind.kiteOnly >= IN_FRONT * behind.postOnly && past.postOnly >= IN_FRONT * past.kiteOnly,
      detail: `where they overlap, at ${at.behind} s the shot lies ${levelsText(behind.postOnly)} levels from it without the kite and ${levelsText(behind.kiteOnly)} without the post; at ${at.past} s, ${levelsText(past.postOnly)} and ${levelsText(past.kiteOnly)} (the plane in front ${IN_FRONT} times nearer wanted)`,
    },
    {
      id: 'shot/approach: blur', passed: rims.flying >= BLURRED_BY_APPROACH * rims.held && rims.held >= rims.shut,
      detail: `the shutter open at ${at.past} s, the flying kite's rim spreads over ${rims.flying} texels across its middle; held at its depth then, over ${rims.held}; shut, over ${rims.shut} (flying ${BLURRED_BY_APPROACH} times held's, held no less than shut, wanted)`,
    },
  ];
}
