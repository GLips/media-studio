import assert from 'node:assert/strict';
import { test } from 'node:test';
import { findFrameGlitches, frameGlitchText, measureFrameCells } from './frame-glitch-check.ts';

const W = 320, H = 180;
// Scenes cut at frames 30 and 45 of 60, at 30 fps.
const fps = 30, scenes = [[0, 30], [30, 45], [45, 60]].map(([from, to]) => ({ id: `s${from}`, from, to, visible: { from, to }, start: from / fps, dur: (to - from) / fps, lines: [] }));

/** A frame painted pixel by pixel: `paint` gives each pixel's grey. */
const frame = (paint: (x: number, y: number) => number) => {
  const rgba = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) rgba.fill(paint(x, y), (y * W + x) * 4, (y * W + x) * 4 + 3);
  return measureFrameCells(rgba, W, H);
};
// A picture: textured mid-grey, as footage is.
const picture = (x: number, y: number) => 100 + ((x * 7 + y * 13) % 60);
const black = () => 0;
const judge = (paints: ((x: number, y: number) => number)[]) => findFrameGlitches(paints.map(frame), 0, { fps, scenes });

test('a torn frame and a flickering inset are glitches, named by their frames and where they are', () => {
  const torn = (x: number, y: number) => (y > H / 2 ? 0 : picture(x, y));
  // A corner inset showing its #202020 backdrop for a frame, three times in half a second.
  const blankInset = (x: number, y: number) => (x > W * 0.75 && y > H * 0.6 ? 32 : picture(x, y));
  const frames = Array.from({ length: 60 }, (_, k) => (k === 12 ? torn : [50, 53, 56].includes(k) ? blankInset : picture));
  const glitches = judge(frames);
  assert.deepEqual(glitches.map(frameGlitchText), [
    'frame 12 blank at x 0–100%, y 53–100% of the frame',
    'frame 50 blank at x 77–100%, y 61–100% of the frame',
    'frame 53 blank at x 77–100%, y 61–100% of the frame',
    'frame 56 blank at x 77–100%, y 61–100% of the frame',
  ]);
});

test('a fade to black, a snap to black before a cut, a black card and caption pills coming and going are design', () => {
  const dim = (k: number) => (x: number, y: number) => Math.round(picture(x, y) * (1 - k / 6));
  // A title on black: the text's band textured, the rest black.
  const card = (x: number, y: number) => (y > H * 0.4 && y < H * 0.6 && x > W * 0.3 && x < W * 0.7 ? picture(x, y) : 0);
  // Caption pages on a dark pill, a frame apart: blank runs, but too long to flicker.
  const pill = (x: number, y: number) => (y > H * 0.75 && x > W * 0.2 && x < W * 0.8 ? 32 : picture(x, y));
  const frames = Array.from({ length: 60 }, (_, k) => {
    if (k >= 4 && k < 10) return dim(k - 3); // fades out over 6 frames…
    if (k >= 10 && k < 14) return black; // …holds black, and snaps back in
    if (k >= 26 && k < 30) return black; // snaps to black, then the cut…
    if (k >= 30 && k < 45) return card; // …to a card on black, till the next cut
    if (k >= 46 && k < 60 && k !== 53) return pill;
    return picture;
  });
  assert.deepEqual(judge(frames), []);
});
