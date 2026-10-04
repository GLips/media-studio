// stamp-gate-shot-dom-page.ts: the gate's shot over a page (ENGINE 6.3), held as a PaintedShot holds one (an element
// the frame's size, scaled into the page) and read by its DOM adapter (shot-dom-points.ts): HTML behind the first
// canvas, a canvas that can't fill its shot, a pinned element's centre. The heron, a clear back, is drawn
// premultiplied, then pinned to an element: its paint follows the element's centre, and a resize asks for the frame.
//
// Negative space: frames are drawn on a canvas off the page. A WebGPU canvas on the page is presented as the page
// renders, and reads back clear after that.

import { paintingProblemsError } from '#lib/paint/document/models/painting-problem.ts';
import type { StampPoint } from '#lib/paint/painting/models/stamp-region.ts';
import { compilePaintedShot, shotCanvasAlphaMode, type CompiledPaintedShot } from '#lib/paint/shot/models/shot-compile.ts';
import type { ShotPinCentres } from '#lib/paint/shot/models/shot-placement.ts';
import type { PaintedShotProps } from '#lib/paint/shot/models/shot-props.ts';
import { createShotPageWatch, SHOT_CANVAS_STYLE, shotCanvasFillProblems, shotHtmlBehind } from '#lib/paint/shot/studio/shot-dom-points.ts';
import { createPaintedShotRenderer } from '#lib/paint/shot/studio/shot-renderer.ts';
import type { StampGateWashCheck } from '../models/stamp-gate-layer.ts';
import { stampGateSheetBrushOf } from '../models/stamp-gate-sheets.ts';
import { STAMP_GATE_SHOT_PAGE_IDS, stampGateClearAlpha, stampGateClearBackShot, stampGatePinnedHeronShot } from '../models/stamp-gate-shots.ts';
import { withGateSurface } from './stamp-gate-page-surface.ts';
import { stampGateSheetImageUrl } from './stamp-gate-sheet-owner.ts';

type ShotFrame = PaintedShotProps['camera']['stage']['frame'];
type ClearAlpha = ReturnType<typeof stampGateClearAlpha>;

/** Where the gate's shot element lies on its page: off the page's corner, scaled, as a player shows a frame. */
const SHOT_PAGE_AT = { left: 37, top: 23, scale: 0.75 } as const;

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

/** An element the frame's size as a PaintedShot's own, on the page, holding `html` (its canvases styled as a shot's); removed after `use`. */
async function withShotElement<T>({ width, height }: ShotFrame, html: string, use: (holder: HTMLDivElement) => Promise<T> | T): Promise<T> {
  const holder = document.createElement('div');
  Object.assign(holder.style, {
    position: 'absolute', left: `${SHOT_PAGE_AT.left}px`, top: `${SHOT_PAGE_AT.top}px`, width: `${width}px`, height: `${height}px`, overflow: 'hidden',
    transform: `scale(${SHOT_PAGE_AT.scale})`, transformOrigin: '0 0',
  });
  holder.innerHTML = html;
  for (const canvas of holder.querySelectorAll('canvas')) Object.assign(canvas.style, SHOT_CANVAS_STYLE);
  document.body.append(holder);
  try {
    return await use(holder);
  } finally {
    holder.remove();
  }
}

/** Whether HTML lies behind the first canvas: text before it does, nothing before the shot's own doesn't, a wrapper's background does. */
async function checkHtmlBehind(frame: ShotFrame): Promise<StampGateWashCheck> {
  const behind = (html: string) => withShotElement(frame, html, (holder) => shotHtmlBehind(holder, holder.querySelector('canvas')!));
  const text = await behind('<p>behind</p><canvas></canvas>'), own = await behind('<canvas></canvas><p>over</p>'), backed = await behind('<div style="background: #335"><canvas></canvas></div>');
  return {
    id: 'shot/page: html behind', passed: text && !own && backed,
    detail: `text before the canvas ${text}, the shot's own canvas first ${own}, a wrapper's background ${backed} (true, false, true wanted)`,
  };
}

/** A canvas in a positioned wrapper still fills its shot; one in a wrapper with an identity transform, about to slide, is refused. */
async function checkCanvasFill(frame: ShotFrame): Promise<StampGateWashCheck> {
  const problems = (html: string) => withShotElement(frame, html, (holder) => shotCanvasFillProblems(holder, [holder.querySelector('canvas')!], ['paint']).map(({ message }) => message));
  const nested = await problems('<div style="position: absolute; left: 30px; top: 10px; width: 50%; height: 50%"><canvas></canvas></div>');
  const slid = await problems('<div style="position: absolute; inset: 0; transform: translateX(0px)"><canvas></canvas></div>');
  return {
    id: 'shot/page: canvas fill', passed: !nested.length && slid.length === 1 && slid[0].includes('transform'),
    detail: `in a positioned wrapper: ${nested.join('; ') || 'fills its shot'}; in a wrapper at translateX(0px): ${slid.join('; ') || 'not refused'}`,
  };
}

const pointText = ({ x, y }: StampPoint) => `${x.toFixed(2)}, ${y.toFixed(2)}`;

/**
 * The heron as a clear back over a paragraph: clear at its corners and where unpainted, at least half opaque in its
 * paint. Pinned by its paint's centroid to an element placed at each of PIN_MOVES, its centroid lands on the element's
 * centre, none lost; resized, the element is heard by the page watch.
 */
async function checkClearBackPinned(): Promise<StampGateWashCheck[]> {
  const plain = stampGateClearBackShot(), { frame } = plain.camera.stage, { width, height } = frame;
  const html = `<p style="margin: 0">behind</p><canvas></canvas><div data-pin="heron" style="position: absolute; width: ${PIN_SIZE.width}px; height: ${PIN_SIZE.height}px"></div>`;
  return withShotElement(frame, html, async (holder) => {
    const canvas = holder.querySelector('canvas')!, pin = holder.querySelector<HTMLElement>('[data-pin]')!, page = { htmlBehind: shotHtmlBehind(holder, canvas) };
    const compiled = (props: PaintedShotProps) => {
      const { shot, problems } = compilePaintedShot(props, [], page);
      if (!shot) throw paintingProblemsError('stamp gate shot page', problems);
      return shot;
    };
    const still = compiled(plain);
    return withGateSurface({ width, height, alphaMode: shotCanvasAlphaMode(still, 0) }, stampGateSheetImageUrl, async (surface, read) => {
      const withRenderer = async <T,>(shot: CompiledPaintedShot, use: (draw: (pins?: ShotPinCentres) => Promise<ClearAlpha>) => Promise<T>) => {
        const renderer = await createPaintedShotRenderer(surface.owner, [surface], shot, { brushOf: stampGateSheetBrushOf });
        try {
          return await use(async (pins) => {
            await renderer.draw(0, 'fast', pins);
            await renderer.finish();
            return stampGateClearAlpha(read(), width, height);
          });
        } finally {
          renderer.dispose();
        }
      };
      const alone = await withRenderer(still, (draw) => draw());
      const clear: StampGateWashCheck = {
        id: 'shot/page: clear back', passed: still.clearBack && alone.corner === 0 && alone.clear > 0 && alone.opaque > 0,
        detail: `laid clear (${still.clearBack}), its canvas clear in ${alone.clear} of ${width * height} texels, at least half opaque in ${alone.opaque}, its corners at most ${alone.corner} alpha (0 wanted)`,
      };
      let heard: (() => void) | null = null;
      const pinned = compiled(stampGatePinnedHeronShot(alone.centroid)), watch = createShotPageWatch(holder, [canvas], [], pinned, () => heard?.());
      try {
        const landed = await withRenderer(pinned, (draw) => PIN_MOVES.reduce(async (before, move) => {
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
  });
}

/** Shot page case `id`: the DOM adapter's reads, the clear back drawn, and the heron pinned to an element. */
export async function checkStampGateShotPageCase(id: string): Promise<StampGateWashCheck[]> {
  if (id !== 'shot/page') throw new Error(`stamp gate: no shot page case ${JSON.stringify(id)}; the gate has ${STAMP_GATE_SHOT_PAGE_IDS.join(', ')}`);
  const { frame } = stampGateClearBackShot().camera.stage;
  return [await checkHtmlBehind(frame), await checkCanvasFill(frame), ...await checkClearBackPinned()];
}
