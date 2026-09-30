import assert from 'node:assert/strict';
import { test } from 'node:test';
import { stillProblems, type StillImageMark, type StillMeasure, type StillPixels, type StillTextMark } from './still-check.ts';
import { STILL_UI_ZONES } from './still-presets.ts';

const box = (x: number, y: number, w: number, h: number) => ({ x, y, w, h });
const text = (t: Partial<StillTextMark> & Pick<StillTextMark, 'text' | 'ink'>): StillTextMark =>
  ({ shown: t.ink, overflowsBox: false, color: [255, 255, 255, 1], size: 40, weight: 400, ...t });
const image = (i: Partial<StillImageMark> & Pick<StillImageMark, 'rect'>): StillImageMark =>
  ({ src: '/static/page.png', shown: i.rect, natural: { w: i.rect.w, h: i.rect.h }, ...i });

/** A frame painted by `paint`, an RGB triple per pixel. */
function pixels(w: number, h: number, paint: (x: number, y: number) => readonly number[]): StillPixels {
  const rgb = new Uint8Array(w * h * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) rgb.set(paint(x, y), (y * w + x) * 3);
  return { w, h, rgb };
}
const check = (measure: Omit<StillMeasure, 'w' | 'h'>, ground: StillPixels, zones = STILL_UI_ZONES.og) =>
  stillProblems({ measure: { w: ground.w, h: ground.h, ...measure }, fits: [], ground, zones }).map((p) => [p.kind, p.problem]);

test('text reads against the ground under its whole box: a light patch under a fifth of it fails, display sizes need only 3:1', () => {
  // Dark on the left, a pale grey from x 400.
  // An OG image, dark on the left and a pale grey from x 400. Display sizes start at 25 px here.
  const ground = pixels(1200, 630, (x) => (x >= 400 ? [200, 200, 200] : [13, 13, 15]));
  const grey = [120, 120, 120, 1] as const;
  assert.deepEqual(check({
    texts: [
      text({ text: 'on the dark', ink: box(20, 20, 300, 20), size: 18 }),
      text({ text: 'running onto the pale', ink: box(20, 100, 500, 20), size: 18 }),
      // Grey on near-black is about 4:1: too little for body text, enough at display size.
      text({ text: 'grey body', ink: box(20, 180, 300, 20), color: grey, size: 18 }),
      text({ text: 'grey display', ink: box(20, 220, 300, 40), color: grey, size: 40, weight: 800 }),
    ],
    images: [],
  }, ground), [
    ['contrast', 'text "running onto the pale" is 1.7:1 against its ground, under the 4.5:1 body text needs'],
    ['contrast', 'text "grey body" is 4.4:1 against its ground, under the 4.5:1 body text needs'],
  ]);
});

test("a story's text under Instagram's bars, cut-off text and an overflowing box are problems", () => {
  const ground = pixels(1080, 1920, () => [13, 13, 15]);
  assert.deepEqual(check({
    texts: [
      text({ text: 'Tap a colour', ink: box(60, 1200, 900, 300) }),
      text({ text: 'painfulpleasures.com', ink: box(60, 1820, 400, 40) }),
      text({ text: 'off the edge', ink: box(900, 600, 300, 40), shown: box(900, 600, 180, 40) }),
      text({ text: 'too long for its box', ink: box(60, 800, 400, 40), overflowsBox: true }),
    ],
    images: [],
  }, ground, STILL_UI_ZONES.story), [
    ['ui-zone', 'text "painfulpleasures.com" is under Instagram\'s reply bar (y 1580 px–1920 px)'],
    ['clipped', 'text "off the edge" is cut off (120 px of it lost past its panel or the frame)'],
    ['clipped', 'text "too long for its box" overflows its box'],
  ]);
});

test('an image drawn from too few pixels is soft, and a crop showing blank page at an edge is empty', () => {
  // A white page whose top 230 px are blank, then a checkerboard of content; the same content below 1100 px.
  const ground = pixels(1080, 1920, (x, y) => (y < 230 || (x + y) % 2 ? [255, 255, 255] : [30, 30, 30]));
  assert.deepEqual(check({
    texts: [],
    images: [
      image({ rect: box(0, 0, 1080, 1100), natural: { w: 3300, h: 2700 } }),
      image({ src: '/static/hero.png', rect: box(0, 1100, 1080, 600), shown: box(0, 1100, 1080, 600), natural: { w: 432, h: 240 } }),
    ],
  }, ground), [
    ['empty-crop', 'the crop of the image at 0 px, 0 px (page.png) shows a 230 px empty band at its top: move its focus or crop tighter'],
    ['upscaled', "the image at 0 px, 1100 px (hero.png) is drawn at 2.5× its pixels (432×240 shown 1080 px wide), so it's soft: crop less of it, or capture or generate it bigger"],
  ]);
});
