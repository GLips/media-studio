// stamp-gate-shot-dom-page.ts: the gate's shot over a page (ENGINE 6.3), held as a PaintedShot holds one (an element
// the frame's size, scaled into the page, holding canvas pairs) and read by its DOM adapter (shot-dom-points.ts). The
// heron, a clear back, is drawn as a glaze, then pinned to an element. A violet wash glazed over a coloured HTML block
// is photographed as the browser composites it, and matched per channel to the wash drawn over a flat picture.
//
// Negative space: frames read back are drawn on canvases off the page. A WebGPU canvas on the page is presented as
// the page renders, and reads back clear after that: the glaze on the page is read by a screenshot.

import { paintingProblemsError } from '#lib/paint/document/models/painting-problem.ts';
import type { StampPoint } from '#lib/paint/painting/models/stamp-region.ts';
import { createStampPaintGpuOwner } from '#lib/paint/painting/studio/stamp-paint-gpu-owner.ts';
import { compilePaintedShot, shotCanvasLaying, type CompiledPaintedShot, type ShotPage } from '#lib/paint/shot/models/shot-compile.ts';
import type { ShotPinCentres } from '#lib/paint/shot/models/shot-placement.ts';
import type { PaintedShotProps } from '#lib/paint/shot/models/shot-props.ts';
import { createShotCanvasSurface, disposeShotCanvasSurface, type ShotCanvasSurface } from '#lib/paint/shot/studio/shot-canvas-surface.ts';
import {
  createShotPageWatch, SHOT_CANVAS_STYLE, SHOT_FILTER_CANVAS_STYLE, shotCanvasFillProblems, shotHtmlBehind, type ShotCanvasElements,
} from '#lib/paint/shot/studio/shot-dom-points.ts';
import { createPaintedShotRenderer, type PaintedShotRenderer } from '#lib/paint/shot/studio/shot-renderer.ts';
import { gpuEachInTurn } from '#lib/platform/gpu/models/gpu-in-turn.ts';
import { browserModuleScreenshot } from '#lib/platform/browser/studio/browser-module-screenshot.ts';
import {
  STAMP_GATE_GLAZE_BACK, STAMP_GATE_GLAZE_BLOCK, STAMP_GATE_GLAZE_CANVASES, STAMP_GATE_GLAZE_REGIONS, stampGateGlazeAlpha, stampGateGlazeMean, stampGateGlazeOverShot,
  stampGateGlazePageShot, type StampGateGlazeRegion, type StampGateRgb,
} from '../models/stamp-gate-glaze.ts';
import type { StampGateWashCheck } from '../models/stamp-gate-layer.ts';
import { stampGateSheetBrushOf } from '../models/stamp-gate-sheets.ts';
import { STAMP_GATE_SHOT_PAGE_IDS, stampGateClearAlpha, stampGateClearBackShot, stampGatePinnedHeronShot } from '../models/stamp-gate-shots.ts';
import { stampGateShotFrames } from './stamp-gate-shot-frames.ts';
import { stampGateSheetImageUrl } from './stamp-gate-sheet-owner.ts';

type ShotFrame = PaintedShotProps['camera']['stage']['frame'];
type ClearAlpha = ReturnType<typeof stampGateClearAlpha>;

/** Where a gate shot's element lies on its page, page px, and its scale. */
type ShotPageAt = { readonly left: number; readonly top: number; readonly scale: number };

/** Where the gate's shot element lies on its page: off the page's corner, scaled, as a player shows a frame. */
const SHOT_PAGE_AT: ShotPageAt = { left: 37, top: 23, scale: 0.75 };

/** Where the glaze's shot element lies: on whole page px, unscaled, so its screenshot is its canvases' texels. */
const GLAZE_PAGE_AT: ShotPageAt = { left: 37, top: 23, scale: 1 };

/** A shot canvas's elements as the page holds them (ShotCanvasElements): its filter, then its colour. */
const SHOT_CANVAS_PAIR = '<canvas data-filter></canvas><canvas></canvas>';

/** The pinned element's size, frame px; its centre is where it's placed. */
const PIN_SIZE = { width: 20, height: 12 } as const;

/** Where the heron's paint is pinned in turn, frame px from its centroid where its document puts it: clear of the frame's edges. */
const PIN_MOVES: readonly StampPoint[] = [{ x: 18, y: 9 }, { x: -6, y: 14 }];

/** How far pinned paint's centroid may lie from its element's centre, frame px: a px or two. */
const PIN_TOLERANCE = 1.5;

/** How far an element's measured centre may lie from where it was placed, frame px: CSS lays boxes on a 1/64 px grid. */
const PIN_MEASURE_SLACK = 0.05;

/** How much of the heron's paint may go missing as it's pinned elsewhere, a share of its texels: none past the frame. */
const PIN_LOST = 0.02;

/** How long a resize may take to be heard, ms: a ResizeObserver reports at the page's next frame. */
const PIN_RESIZE_WAIT = 2000;

/**
 * How far the page's glaze may stray from the wash drawn over a flat picture of what's behind it, each channel's
 * mean, encoded bytes. The glaze is a line in the page's colour, exact over white (lens-passes.ts); the light's curve
 * bends from it most in a channel the page holds dark. Laid by its alpha alone, it strays tens.
 */
const GLAZE_TOLERANCE = 8;

/** How far a bare colour's mean may stray from its bytes: the page's rounding and the back's dither. */
const GLAZE_BARE_TOLERANCE = 1;

/**
 * An element the frame's size as a PaintedShot's own, on the page as `at` says, holding `html` (each canvas styled as
 * a shot's, a `data-filter` one as a filter); removed after `use`.
 */
async function withShotElement<T>({ width, height }: ShotFrame, html: string, use: (holder: HTMLDivElement) => Promise<T> | T, at = SHOT_PAGE_AT): Promise<T> {
  const holder = document.createElement('div');
  Object.assign(holder.style, {
    position: 'absolute', left: `${at.left}px`, top: `${at.top}px`, width: `${width}px`, height: `${height}px`, overflow: 'hidden',
    transform: `scale(${at.scale})`, transformOrigin: '0 0',
  });
  holder.innerHTML = html;
  for (const canvas of holder.querySelectorAll('canvas')) Object.assign(canvas.style, canvas.hasAttribute('data-filter') ? SHOT_FILTER_CANVAS_STYLE : SHOT_CANVAS_STYLE);
  document.body.append(holder);
  try {
    return await use(holder);
  } finally {
    holder.remove();
  }
}

/** The shot canvases `holder` holds, in document order: each `data-filter` canvas and the colour canvas after it. */
function shotCanvasPairs(holder: Element): ShotCanvasElements[] {
  return [...holder.querySelectorAll<HTMLCanvasElement>('canvas[data-filter]')].map((filter) => {
    // SAFETY: SHOT_CANVAS_PAIR lays a colour canvas straight after each filter.
    const colour = filter.nextElementSibling as HTMLCanvasElement;
    return { filter, colour };
  });
}

/** A shot canvas's elements off the page, where they read back what they're drawn. */
const offPageCanvases = (): ShotCanvasElements => ({ filter: document.createElement('canvas'), colour: document.createElement('canvas') });

/** `props` compiled for `canvases` on `page`; a problem keeping it from being drawn throws. */
function compiledGateShot(props: PaintedShotProps, canvases: readonly string[], page: ShotPage): CompiledPaintedShot {
  const { shot, problems } = compilePaintedShot(props, canvases, page);
  if (!shot) throw paintingProblemsError('stamp gate shot page', problems);
  return shot;
}

/**
 * `shot` drawn into `pairs` (its canvases, on the page or off it), each laid as it says, on a device owner of its own
 * with the gate's brushes and images, its renderer handed to `use`; disposed after.
 */
async function withGateShotRenderer<T>(shot: CompiledPaintedShot, pairs: readonly ShotCanvasElements[], use: (renderer: PaintedShotRenderer) => Promise<T>): Promise<T> {
  const owner = await createStampPaintGpuOwner(stampGateSheetImageUrl), surfaces: ShotCanvasSurface[] = [];
  try {
    await gpuEachInTurn(pairs, async (pair, index) => surfaces.push(await createShotCanvasSurface(owner, pair, shotCanvasLaying(shot, index), shot.camera.stage.frame)));
    const renderer = await createPaintedShotRenderer(owner, surfaces, shot, { brushOf: stampGateSheetBrushOf });
    try {
      return await use(renderer);
    } finally {
      renderer.dispose();
    }
  } finally {
    for (const surface of surfaces) disposeShotCanvasSurface(surface);
    owner.dispose();
  }
}

/** `canvas`'s RGBA bytes, unpremultiplied, as the browser reads it back. */
function canvasBytes(canvas: HTMLCanvasElement): Uint8ClampedArray {
  const context = Object.assign(document.createElement('canvas'), { width: canvas.width, height: canvas.height }).getContext('2d')!;
  context.drawImage(canvas, 0, 0);
  return context.getImageData(0, 0, canvas.width, canvas.height).data;
}

/** Once the page has rendered twice: a WebGPU canvas drawn before is presented by then. */
const pageFramesPassed = () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

/** Whether HTML lies behind the first canvas: text before it does, nothing before the shot's own doesn't, a wrapper's background does. */
async function checkHtmlBehind(frame: ShotFrame): Promise<StampGateWashCheck> {
  const behind = (html: string) => withShotElement(frame, html, (holder) => shotHtmlBehind(holder, shotCanvasPairs(holder)[0].filter));
  const text = await behind(`<p>behind</p>${SHOT_CANVAS_PAIR}`), own = await behind(`${SHOT_CANVAS_PAIR}<p>over</p>`), backed = await behind(`<div style="background: #335">${SHOT_CANVAS_PAIR}</div>`);
  return {
    id: 'shot/page: html behind', passed: text && !own && backed,
    detail: `text before the canvas ${text}, the shot's own canvas first ${own}, a wrapper's background ${backed} (true, false, true wanted)`,
  };
}

/**
 * A canvas in a positioned wrapper still fills its shot; one in a wrapper with an identity transform, about to slide,
 * is refused. A glaze in a translucent wrapper is refused, cut off from the HTML behind it; an opaque canvas in one isn't.
 */
async function checkCanvasFill(frame: ShotFrame): Promise<StampGateWashCheck[]> {
  const problems = (html: string, names: readonly string[], shot: CompiledPaintedShot | null) => withShotElement(frame, html, (holder) => shotCanvasFillProblems(holder, shotCanvasPairs(holder), names, shot).map(({ message }) => message));
  const nested = await problems(`<div style="position: absolute; left: 30px; top: 10px; width: 50%; height: 50%">${SHOT_CANVAS_PAIR}</div>`, ['paint'], null);
  const slid = await problems(`<div style="position: absolute; inset: 0; transform: translateX(0px)">${SHOT_CANVAS_PAIR}</div>`, ['paint'], null);
  const glaze = compiledGateShot(stampGateGlazePageShot(), STAMP_GATE_GLAZE_CANVASES, { htmlBehind: false }), faded = '<div style="opacity: 0.5">';
  const glazeFaded = await problems(`${SHOT_CANVAS_PAIR}${faded}${SHOT_CANVAS_PAIR}</div>`, STAMP_GATE_GLAZE_CANVASES, glaze);
  const opaqueFaded = await problems(`${faded}${SHOT_CANVAS_PAIR}</div>${SHOT_CANVAS_PAIR}`, STAMP_GATE_GLAZE_CANVASES, glaze);
  return [{
    id: 'shot/page: canvas fill', passed: !nested.length && slid.length === 1 && slid[0].includes('transform'),
    detail: `in a positioned wrapper: ${nested.join('; ') || 'fills its shot'}; in a wrapper at translateX(0px): ${slid.join('; ') || 'not refused'}`,
  }, {
    id: 'shot/page: glaze isolated', passed: glazeFaded.length === 1 && glazeFaded[0].includes('opacity') && !opaqueFaded.length,
    detail: `a glaze in a wrapper at opacity 0.5: ${glazeFaded.join('; ') || 'not refused'}; the opaque back in one: ${opaqueFaded.join('; ') || 'drawn'}`,
  }];
}

const pointText = ({ x, y }: StampPoint) => `${x.toFixed(2)}, ${y.toFixed(2)}`;

/**
 * The heron as a clear back over a paragraph, a glaze: clear at its corners and where unpainted, at least half opaque
 * in its paint. Pinned by its paint's centroid to an element placed at each of PIN_MOVES, its centroid lands on the
 * element's centre, none lost; resized, the element is heard by the page watch.
 */
async function checkClearBackPinned(): Promise<StampGateWashCheck[]> {
  const plain = stampGateClearBackShot(), { frame } = plain.camera.stage, { width, height } = frame;
  const html = `<p style="margin: 0">behind</p>${SHOT_CANVAS_PAIR}<div data-pin="heron" style="position: absolute; width: ${PIN_SIZE.width}px; height: ${PIN_SIZE.height}px"></div>`;
  return withShotElement(frame, html, async (holder) => {
    const canvases = shotCanvasPairs(holder), pin = holder.querySelector<HTMLElement>('[data-pin]')!, page = { htmlBehind: shotHtmlBehind(holder, canvases[0].filter) };
    const still = compiledGateShot(plain, [], page);
    const drawnAlone = async <T,>(shot: CompiledPaintedShot, use: (draw: (pins?: ShotPinCentres) => Promise<ClearAlpha>) => Promise<T>) => {
      const drawnTo = offPageCanvases();
      return withGateShotRenderer(shot, [drawnTo], (renderer) => use(async (pins) => {
        await renderer.draw(0, 'fast', pins);
        await renderer.finish();
        return stampGateClearAlpha(stampGateGlazeAlpha(canvasBytes(drawnTo.colour), canvasBytes(drawnTo.filter)), width, height);
      }));
    };
    const alone = await drawnAlone(still, (draw) => draw());
    const clear: StampGateWashCheck = {
      id: 'shot/page: clear back',
      passed: still.clearBack && shotCanvasLaying(still, 0) === 'glaze' && alone.corner === 0 && alone.clear > 0 && alone.opaque > 0,
      detail: `laid clear (${still.clearBack}) as a ${shotCanvasLaying(still, 0)}, clear in ${alone.clear} of ${width * height} texels, at least half opaque in ${alone.opaque}, its corners at most ${alone.corner} alpha (0 wanted)`,
    };
    let heard: (() => void) | null = null;
    const pinned = compiledGateShot(stampGatePinnedHeronShot(alone.centroid), [], page), watch = createShotPageWatch(holder, canvases, [], pinned, () => heard?.());
    try {
      const landed = await drawnAlone(pinned, (draw) => PIN_MOVES.reduce(async (before, move) => {
        const done = await before, target = { x: alone.centroid.x + move.x, y: alone.centroid.y + move.y };
        Object.assign(pin.style, { left: `${target.x - PIN_SIZE.width / 2}px`, top: `${target.y - PIN_SIZE.height / 2}px` });
        const { pins, problems } = watch.read();
        if (problems.length) throw paintingProblemsError('stamp gate shot page', problems);
        return [...done, { target, measured: pins.get('paper')![0]!, drawn: await draw(pins) }];
      }, Promise.resolve<{ target: StampPoint; measured: StampPoint; drawn: ClearAlpha }[]>([])));
      const off = landed.map(({ target, drawn }) => Math.hypot(drawn.centroid.x - target.x, drawn.centroid.y - target.y));
      const lost = landed.map(({ drawn }) => 1 - drawn.opaque / alone.opaque);
      const resized = await new Promise<boolean>((resolve) => {
        const timeout = setTimeout(() => resolve(false), PIN_RESIZE_WAIT);
        heard = () => {
          clearTimeout(timeout);
          resolve(true);
        };
        pin.style.width = `${PIN_SIZE.width * 2}px`;
      });
      return [clear, {
        id: 'shot/page: pinned heron',
        passed: off.every((d) => d <= PIN_TOLERANCE) && lost.every((share) => Math.abs(share) <= PIN_LOST) && landed.every(({ target, measured }) => Math.hypot(measured.x - target.x, measured.y - target.y) < PIN_MEASURE_SLACK),
        detail: landed.map(({ target, measured, drawn }, i) => `element at ${pointText(target)} measured ${pointText(measured)}, paint's centroid ${pointText(drawn.centroid)} (${off[i].toFixed(2)} px off, ${PIN_TOLERANCE} allowed; ${drawn.opaque} texels at least half opaque, ${alone.opaque} unpinned)`).join('; '),
      }, {
        id: 'shot/page: pin resized', passed: resized,
        detail: resized ? 'the element widened, its centre moved, and the page watch asked for the frame again' : `the element widened, its centre moved, and nothing asked for the frame again within ${PIN_RESIZE_WAIT} ms`,
      }];
    } finally {
      watch.dispose();
    }
  });
}

const rgbText = (rgb: readonly number[]) => rgb.map((v) => v.toFixed(1)).join(', ');

/**
 * The violet wash in a later canvas over a yellow HTML block and the back's teal, photographed as the browser lays
 * it: over each, every channel's mean within GLAZE_TOLERANCE of the wash drawn in one canvas over a flat picture of
 * that colour; the block and the back bare, their own colours.
 */
async function checkGlazeOverHtml(): Promise<StampGateWashCheck> {
  const props = stampGateGlazePageShot(), { frame } = props.camera.stage, { width, height } = frame, { x, y, width: w, height: h, rgb } = STAMP_GATE_GLAZE_BLOCK;
  const block = `<div style="position: absolute; left: ${x}px; top: ${y}px; width: ${w}px; height: ${h}px; background: rgb(${rgb.join(' ')})"></div>`;
  const shown = await withShotElement(frame, `${SHOT_CANVAS_PAIR}${block}${SHOT_CANVAS_PAIR}`, async (holder) => {
    const pairs = shotCanvasPairs(holder), shot = compiledGateShot(props, STAMP_GATE_GLAZE_CANVASES, { htmlBehind: shotHtmlBehind(holder, pairs[0].filter) });
    const problems = shotCanvasFillProblems(holder, pairs, STAMP_GATE_GLAZE_CANVASES, shot);
    if (problems.length) throw paintingProblemsError('stamp gate shot page', problems);
    return withGateShotRenderer(shot, pairs, async (renderer) => {
      await renderer.draw(0, 'fast');
      await renderer.finish();
      await pageFramesPassed();
      return (await browserModuleScreenshot({ x: GLAZE_PAGE_AT.left, y: GLAZE_PAGE_AT.top, width, height })).data;
    });
  }, GLAZE_PAGE_AT);
  const [overBlock, overBack] = await gpuEachInTurn([rgb, STAMP_GATE_GLAZE_BACK], async (under) => (await stampGateShotFrames(stampGateGlazeOverShot(under), [0])).frames[0]);
  const wanted: Readonly<Record<StampGateGlazeRegion, { readonly rgb: StampGateRgb; readonly tolerance: number }>> = {
    'glaze over the block': { rgb: stampGateGlazeMean(overBlock, width, STAMP_GATE_GLAZE_REGIONS['glaze over the block']), tolerance: GLAZE_TOLERANCE },
    'glaze over the back': { rgb: stampGateGlazeMean(overBack, width, STAMP_GATE_GLAZE_REGIONS['glaze over the back']), tolerance: GLAZE_TOLERANCE },
    'the block bare': { rgb, tolerance: GLAZE_BARE_TOLERANCE },
    'the back bare': { rgb: STAMP_GATE_GLAZE_BACK, tolerance: GLAZE_BARE_TOLERANCE },
  };
  const measured = Object.entries(wanted).map(([region, { rgb: want, tolerance }]) => {
    // SAFETY: `wanted` is keyed by StampGateGlazeRegion, each region once.
    const got = stampGateGlazeMean(shown, width, STAMP_GATE_GLAZE_REGIONS[region as StampGateGlazeRegion]);
    return { region, got, want, tolerance, apart: Math.max(...got.map((v, c) => Math.abs(v - want[c]))) };
  });
  return {
    id: 'shot/page: glaze over html', passed: measured.every(({ apart, tolerance }) => apart <= tolerance),
    detail: `${width} × ${height} px on the page: ${measured.map(({ region, got, want, apart, tolerance }) => `${region} ${rgbText(got)}, wanted ${rgbText(want)} (${apart.toFixed(1)} apart, ${tolerance} allowed)`).join('; ')}`,
  };
}

/** Shot page case `id`: the DOM adapter's reads, the clear back drawn, the heron pinned to an element, and a glaze over HTML. */
export async function checkStampGateShotPageCase(id: string): Promise<StampGateWashCheck[]> {
  if (id !== 'shot/page') throw new Error(`stamp gate: no shot page case ${JSON.stringify(id)}; the gate has ${STAMP_GATE_SHOT_PAGE_IDS.join(', ')}`);
  const { frame } = stampGateClearBackShot().camera.stage;
  return [await checkHtmlBehind(frame), ...await checkCanvasFill(frame), ...await checkClearBackPinned(), await checkGlazeOverHtml()];
}
