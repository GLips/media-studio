// stamp-gate-shot-dom-page.ts: the gate's shot over a page (ENGINE 6.3), held as a PaintedShot holds one (shot-canvas.ts
// makes its element and canvases) and read by its DOM adapter (shot-dom-points.ts). The heron, a clear back, is drawn
// as a glaze, then pinned to an element. A violet wash glazed over an HTML block, from a later canvas and as a clear
// back, is photographed as the browser composites it, matched per channel to the wash over a flat picture.
//
// Negative space: frames read back are drawn on canvases off the page. A WebGPU canvas on the page is presented as
// the page renders, and reads back clear after that: the glaze on the page is read by a screenshot.

import { paintingProblemsError } from '#lib/paint/document/models/painting-problem.ts';
import type { StampPoint } from '#lib/paint/painting/models/stamp-region.ts';
import { compilePaintedShot, shotCanvasLayings, type CompiledPaintedShot, type ShotCanvasLaying, type ShotPage } from '#lib/paint/shot/models/shot-compile.ts';
import type { ShotPinCentres } from '#lib/paint/shot/models/shot-placement.ts';
import { createShotCanvasElements, placeShotCanvas, shotElementStyle, type ShotCanvasElements } from '#lib/paint/shot/studio/shot-canvas.ts';
import { createShotPageWatch, shotCanvasFillProblems, shotGlazeIsolationProblems, shotHtmlBehind } from '#lib/paint/shot/studio/shot-dom-points.ts';
import { gpuEachInTurn } from '#lib/platform/gpu/models/gpu-in-turn.ts';
import { browserModuleScreenshot } from '#lib/platform/browser/studio/browser-module-screenshot.ts';
import {
  STAMP_GATE_GLAZE_BACK, STAMP_GATE_GLAZE_BLOCK, STAMP_GATE_GLAZE_CANVASES, STAMP_GATE_GLAZE_CLEAR_CANVASES, STAMP_GATE_GLAZE_PAGES, stampGateGlazeAlpha,
  stampGateGlazeClearBackShot, stampGateGlazeLetThrough, stampGateGlazeMean, stampGateGlazeOverShot, stampGateGlazePageShot, type StampGateGlazeRegion, type StampGateRgb,
} from '../models/stamp-gate-glaze.ts';
import type { StampGateWashCheck } from '../models/stamp-gate-layer.ts';
import { stampGateShotSpanned, type StampGateShot } from '../models/stamp-gate-shot-span.ts';
import { STAMP_GATE_SHOT_PAGE_IDS, stampGateClearAlpha, stampGateClearBackShot, stampGatePinnedHeronShot } from '../models/stamp-gate-shots.ts';
import { stampGateCanvasBytes } from './stamp-gate-page-surface.ts';
import { stampGateShotFrames, withGateShotRenderer } from './stamp-gate-shot-frames.ts';

type ShotFrame = StampGateShot['camera']['stage']['frame'];
type ClearAlpha = ReturnType<typeof stampGateClearAlpha>;

/** Where a gate shot's element lies on its page, page px, and its scale. */
type ShotPageAt = { readonly left: number; readonly top: number; readonly scale: number };

/** Where the gate's shot element lies on its page: off the page's corner, scaled, as a player shows a frame. */
const SHOT_PAGE_AT: ShotPageAt = { left: 37, top: 23, scale: 0.75 };

/** Where the glaze's shot element lies: on whole page px, unscaled, so its screenshot is its canvases' texels. */
const GLAZE_PAGE_AT: ShotPageAt = { left: 37, top: 23, scale: 1 };

/** Where a shot canvas lies in a gate page's HTML: each is filled as PaintedShotCanvas fills its span (placeShotCanvas). */
const SHOT_CANVAS = '<span data-shot-canvas></span>';

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
 * How far apart the share of the page outside the shot a glaze over nothing lets through may lie across channels:
 * one alpha lets it through, so only rounding parts them.
 */
const GLAZE_ONE_ALPHA = 0.02;

/**
 * A gate shot on its page: its element `holder`, its canvases in document order, and `page`, an element of its box
 * behind it outside the shot, clear unless coloured: what a clear back's glaze over nothing lets through.
 */
type GateShotPage = { readonly holder: HTMLDivElement; readonly canvases: readonly ShotCanvasElements[]; readonly page: HTMLDivElement };

/**
 * An element the frame's size as a PaintedShot's own, on the page as `at` says over a page element of its box, holding
 * `html`, each SHOT_CANVAS in it a shot canvas; removed after `use`.
 */
async function withShotElement<T>(frame: ShotFrame, html: string, use: (shot: GateShotPage) => Promise<T> | T, at = SHOT_PAGE_AT): Promise<T> {
  const box = { x: at.left, y: at.top, w: frame.width * at.scale, h: frame.height * at.scale };
  const page = document.createElement('div'), holder = document.createElement('div');
  Object.assign(page.style, { position: 'absolute', left: `${box.x}px`, top: `${box.y}px`, width: `${box.w}px`, height: `${box.h}px` });
  Object.assign(holder.style, shotElementStyle(box, frame));
  holder.innerHTML = html;
  const canvases = [...holder.querySelectorAll<HTMLElement>('[data-shot-canvas]')].map((host) => placeShotCanvas(host));
  document.body.append(page, holder);
  try {
    return await use({ holder, canvases, page });
  } finally {
    page.remove();
    holder.remove();
  }
}

/** `props` compiled for `canvases` on `page`, to be drawn at 0 s; a problem keeping it from being drawn throws. */
function compiledGateShot(props: StampGateShot, canvases: readonly string[], page: ShotPage): CompiledPaintedShot {
  const { shot, problems } = compilePaintedShot(stampGateShotSpanned(props, [0]), canvases, page);
  if (!shot) throw paintingProblemsError('stamp gate shot page', problems);
  return shot;
}

/** Whether HTML lies behind the first canvas: text before it does, nothing before the shot's own doesn't, a wrapper's background does. */
async function checkHtmlBehind(frame: ShotFrame): Promise<StampGateWashCheck> {
  const behind = (html: string) => withShotElement(frame, html, ({ holder, canvases }) => shotHtmlBehind(holder, canvases[0]));
  const text = await behind(`<p>behind</p>${SHOT_CANVAS}`), own = await behind(`${SHOT_CANVAS}<p>over</p>`), backed = await behind(`<div style="background: #335">${SHOT_CANVAS}</div>`);
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
  const problems = (html: string, names: readonly string[], layings: readonly ShotCanvasLaying[]) => withShotElement(frame, html, ({ holder, canvases }) =>
    [...shotCanvasFillProblems(holder, canvases, names), ...shotGlazeIsolationProblems(holder, canvases, names, layings)].map(({ message }) => message));
  const nested = await problems(`<div style="position: absolute; left: 30px; top: 10px; width: 50%; height: 50%">${SHOT_CANVAS}</div>`, ['paint'], ['opaque']);
  const slid = await problems(`<div style="position: absolute; inset: 0; transform: translateX(0px)">${SHOT_CANVAS}</div>`, ['paint'], ['opaque']);
  const glaze = shotCanvasLayings(compiledGateShot(stampGateGlazePageShot(), STAMP_GATE_GLAZE_CANVASES, { htmlBehind: false })), faded = '<div style="opacity: 0.5">';
  const glazeFaded = await problems(`${SHOT_CANVAS}${faded}${SHOT_CANVAS}</div>`, STAMP_GATE_GLAZE_CANVASES, glaze);
  const opaqueFaded = await problems(`${faded}${SHOT_CANVAS}</div>${SHOT_CANVAS}`, STAMP_GATE_GLAZE_CANVASES, glaze);
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
  const html = `<p style="margin: 0">behind</p>${SHOT_CANVAS}<div data-pin="heron" style="position: absolute; width: ${PIN_SIZE.width}px; height: ${PIN_SIZE.height}px"></div>`;
  return withShotElement(frame, html, async ({ holder, canvases }) => {
    const pin = holder.querySelector<HTMLElement>('[data-pin]')!, page = { htmlBehind: shotHtmlBehind(holder, canvases[0]) };
    const still = compiledGateShot(plain, [], page), [laying] = shotCanvasLayings(still);
    const drawnAlone = async <T,>(shot: CompiledPaintedShot, use: (draw: (pins?: ShotPinCentres) => Promise<ClearAlpha>) => Promise<T>) => {
      const drawnTo = createShotCanvasElements();
      return withGateShotRenderer(shot, [drawnTo], (renderer) => use(async (pins) => {
        await renderer.draw(0, 'fast', pins);
        await renderer.finish();
        return stampGateClearAlpha(stampGateGlazeAlpha(stampGateCanvasBytes(drawnTo.colour), stampGateCanvasBytes(drawnTo.filter)), width, height);
      }));
    };
    const alone = await drawnAlone(still, (draw) => draw());
    const clear: StampGateWashCheck = {
      id: 'shot/page: clear back',
      passed: still.clearBack && laying === 'glaze' && alone.corner === 0 && alone.clear > 0 && alone.opaque > 0,
      detail: `laid clear (${still.clearBack}) as a ${laying}, clear in ${alone.clear} of ${width * height} texels, at least half opaque in ${alone.opaque}, its corners at most ${alone.corner} alpha (0 wanted)`,
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

const rgbText = (rgb: readonly number[], digits = 1) => rgb.map((v) => v.toFixed(digits)).join(', ');

/** The yellow HTML block, positioned where STAMP_GATE_GLAZE_BLOCK says. */
function glazeBlockHtml() {
  const { x, y, width, height, rgb } = STAMP_GATE_GLAZE_BLOCK;
  return `<div style="position: absolute; left: ${x}px; top: ${y}px; width: ${width}px; height: ${height}px; background: rgb(${rgb.join(' ')})"></div>`;
}

/** What a glaze check wants of a region of the page: its mean, `label`ed, within `tolerance` of `rgb` in every channel. */
type GlazeWant = { readonly region: StampGateGlazeRegion; readonly label: string; readonly rgb: StampGateRgb; readonly tolerance: number };

/** Each of `wants` as `shown` (a screenshot's bytes) has it: its mean, and how far its farthest channel strays. */
const glazeMeasured = (shown: ArrayLike<number>, wants: readonly GlazeWant[]) => wants.map((want) => {
  const got = stampGateGlazeMean(shown, want.region);
  return { ...want, got, apart: Math.max(...got.map((v, c) => Math.abs(v - want.rgb[c]))) };
});

const glazeMeasuredText = (measured: ReturnType<typeof glazeMeasured>) =>
  measured.map(({ label, got, rgb, apart, tolerance }) => `${label} ${rgbText(got)}, wanted ${rgbText(rgb)} (${apart.toFixed(1)} apart, ${tolerance} allowed)`).join('; ');

/**
 * `props` compiled for `names` on `shot`'s page, refused if a canvas strays or a glaze is isolated, drawn into its
 * canvases at 0 s; then `photograph` reads the page, and all is disposed.
 */
async function drawnOnPage<T>(props: StampGateShot, names: readonly string[], { holder, canvases }: GateShotPage, photograph: () => Promise<T>): Promise<T> {
  const shot = compiledGateShot(props, names, { htmlBehind: shotHtmlBehind(holder, canvases[0]) });
  const problems = [...shotCanvasFillProblems(holder, canvases, names), ...shotGlazeIsolationProblems(holder, canvases, names, shotCanvasLayings(shot))];
  if (problems.length) throw paintingProblemsError('stamp gate shot page', problems);
  return withGateShotRenderer(shot, canvases, async (renderer) => {
    await renderer.draw(0, 'fast');
    await renderer.finish();
    return photograph();
  });
}

/** The glaze's shot element, `frame` px at GLAZE_PAGE_AT, as the browser composites it: RGBA bytes. */
const glazePhotographed = async ({ width, height }: ShotFrame) => (await browserModuleScreenshot({ x: GLAZE_PAGE_AT.left, y: GLAZE_PAGE_AT.top, width, height })).data;

/** What the page should show of the wash over a flat picture of each colour: the wash drawn over one, in turn. */
type GlazeReferences = { readonly overBlock: Uint8ClampedArray; readonly overBack: Uint8ClampedArray; readonly overWhite: Uint8ClampedArray; readonly overDark: Uint8ClampedArray };

async function glazeReferences(): Promise<GlazeReferences> {
  const { white, dark } = STAMP_GATE_GLAZE_PAGES, colours = [STAMP_GATE_GLAZE_BLOCK.rgb, STAMP_GATE_GLAZE_BACK, white, dark];
  const [overBlock, overBack, overWhite, overDark] = await gpuEachInTurn(colours, async (under) => (await stampGateShotFrames(stampGateGlazeOverShot(under), [0])).frames[0]);
  return { overBlock, overBack, overWhite, overDark };
}

/**
 * The violet wash in a later canvas over a yellow HTML block and the back's teal, photographed as the browser lays
 * it: over each, every channel's mean within GLAZE_TOLERANCE of the wash drawn in one canvas over a flat picture of
 * that colour; the block and the back bare, their own colours.
 */
async function checkGlazeOverHtml({ overBlock, overBack }: GlazeReferences): Promise<StampGateWashCheck> {
  const props = stampGateGlazePageShot(), { frame } = props.camera.stage;
  const shown = await withShotElement(frame, `${SHOT_CANVAS}${glazeBlockHtml()}${SHOT_CANVAS}`, (shot) => drawnOnPage(props, STAMP_GATE_GLAZE_CANVASES, shot, () => glazePhotographed(frame)), GLAZE_PAGE_AT);
  const measured = glazeMeasured(shown, [
    { region: 'the wash on the block', label: 'the wash over the block', rgb: stampGateGlazeMean(overBlock, 'the wash on the block'), tolerance: GLAZE_TOLERANCE },
    { region: 'the wash past the block', label: 'the wash over the back', rgb: stampGateGlazeMean(overBack, 'the wash past the block'), tolerance: GLAZE_TOLERANCE },
    { region: 'the block bare', label: 'the block bare', rgb: STAMP_GATE_GLAZE_BLOCK.rgb, tolerance: GLAZE_BARE_TOLERANCE },
    { region: 'past the block bare', label: 'the back bare', rgb: STAMP_GATE_GLAZE_BACK, tolerance: GLAZE_BARE_TOLERANCE },
  ]);
  return {
    id: 'shot/page: glaze over html', passed: measured.every(({ apart, tolerance }) => apart <= tolerance),
    detail: `${frame.width} × ${frame.height} px on the page: ${glazeMeasuredText(measured)}`,
  };
}

/**
 * The violet wash as a clear back over the yellow block, nothing in the shot past it, photographed over a white and a
 * dark page. Over the block, and over nothing on white, within GLAZE_TOLERANCE of the wash over that colour; bare,
 * the dark page. Over nothing, one alpha lets the page through in every channel.
 */
async function checkClearBackGlaze({ overBlock, overWhite, overDark }: GlazeReferences): Promise<StampGateWashCheck> {
  const props = stampGateGlazeClearBackShot(), { frame } = props.camera.stage, { white, dark } = STAMP_GATE_GLAZE_PAGES;
  const shown = await withShotElement(frame, `${glazeBlockHtml()}${SHOT_CANVAS}`, (shot) => drawnOnPage(props, STAMP_GATE_GLAZE_CLEAR_CANVASES, shot, async () => {
    const on = (rgb: StampGateRgb) => {
      shot.page.style.background = `rgb(${rgb.join(' ')})`;
      return glazePhotographed(frame);
    };
    return { white: await on(white), dark: await on(dark) };
  }), GLAZE_PAGE_AT);
  const measured = [
    ...glazeMeasured(shown.dark, [
      { region: 'the wash on the block', label: 'the wash over the block', rgb: stampGateGlazeMean(overBlock, 'the wash on the block'), tolerance: GLAZE_TOLERANCE },
      { region: 'past the block bare', label: 'the dark page bare', rgb: dark, tolerance: GLAZE_BARE_TOLERANCE },
    ]),
    ...glazeMeasured(shown.white, [
      { region: 'the wash past the block', label: 'the wash over nothing on the white page', rgb: stampGateGlazeMean(overWhite, 'the wash past the block'), tolerance: GLAZE_TOLERANCE },
    ]),
  ];
  const onDark = stampGateGlazeMean(shown.dark, 'the wash past the block'), letThrough = stampGateGlazeLetThrough(stampGateGlazeMean(shown.white, 'the wash past the block'), onDark);
  const spread = Math.max(...letThrough) - Math.min(...letThrough);
  return {
    id: 'shot/page: clear back glaze', passed: measured.every(({ apart, tolerance }) => apart <= tolerance) && spread <= GLAZE_ONE_ALPHA,
    detail: `${glazeMeasuredText(measured)}; over nothing, the page let through by ${rgbText(letThrough, 3)} (${spread.toFixed(3)} apart, ${GLAZE_ONE_ALPHA} allowed: one alpha), so over the dark page ${rgbText(onDark)} where the wash over it is ${rgbText(stampGateGlazeMean(overDark, 'the wash past the block'))}`,
  };
}

/** Shot page case `id`: the DOM adapter's reads, the clear back drawn, the heron pinned to an element, and the glazes over HTML. */
export async function checkStampGateShotPageCase(id: string): Promise<StampGateWashCheck[]> {
  if (id !== 'shot/page') throw new Error(`stamp gate: no shot page case ${JSON.stringify(id)}; the gate has ${STAMP_GATE_SHOT_PAGE_IDS.join(', ')}`);
  const { frame } = stampGateClearBackShot().camera.stage, references = await glazeReferences();
  return [await checkHtmlBehind(frame), ...await checkCanvasFill(frame), ...await checkClearBackPinned(), await checkGlazeOverHtml(references), await checkClearBackGlaze(references)];
}
