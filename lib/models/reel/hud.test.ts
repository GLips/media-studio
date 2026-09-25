import assert from 'node:assert/strict';
import { test } from 'node:test';
import { steadyBeatGrid } from '#models/timeline/beat-grid.ts';
import {
  REEL_HUD_BOOT_DECODE, REEL_HUD_GLYPHS, REEL_HUD_SWAP_DECODE, reelHudDecode, reelHudGrounds, reelHudLitSquare, reelHudReadGrounds, reelHudTimecode, reelHudToneWeights,
} from './hud.ts';

const FPS = 30;

test('the timecode shows every frame as its own FF, and the lit square steps on the frame each beat lands on', () => {
  // f / 30 lands a hair under some frames (123, 245…), which a bare floor would show as the frame before.
  const codes = Array.from({ length: 600 }, (_, f) => reelHudTimecode(f / FPS, FPS));
  assert.deepEqual(codes.filter((c, f) => c !== `00:00:${String(Math.floor(f / FPS)).padStart(2, '0')}:${String(f % FPS).padStart(2, '0')}`), []);
  assert.equal(codes[29], '00:00:00:29');
  assert.equal(codes[30], '00:00:01:00');

  // 120 BPM from frame 28: beats on 13 + 15n, and beatOf lands a hair under beats 3 and 4 (frames 73 and 88).
  const grid = steadyBeatGrid(120, 28 / FPS);
  const lit = Array.from({ length: 120 }, (_, f) => reelHudLitSquare(grid.beatOf(f / FPS), 4));
  assert.deepEqual(lit.flatMap((s, f) => (f > 0 && s !== lit[f - 1] ? [f] : [])), [13, 28, 43, 58, 73, 88, 103, 118]);
  assert.deepEqual([lit[12], lit[13], lit[28]], [2, 3, 0], 'a beat before the grid\'s first counts back into the bar before');
});

test('a decode reveals its cells left to right and locks every one by its duration', () => {
  const text = 'MOTION REEL';
  const decode = (f: number) => reelHudDecode(text, f / FPS, { duration: 0.5, schedule: REEL_HUD_BOOT_DECODE, seed: 'hud', fps: FPS });
  const frames = Array.from({ length: 16 }, (_, f) => decode(f));

  assert.deepEqual(frames[0].map((c) => c.state).slice(0, 3), ['new', 'hidden', 'hidden'], 'one cell on the first frame, at half');
  // The space is blank throughout, so the fronts are judged on the letters.
  const letters = (f: number) => frames[f].filter((_, i) => text[i] !== ' ');
  for (let f = 0; f < frames.length; f++) {
    const shown = letters(f).map((c) => c.state !== 'hidden');
    assert.ok(shown.every((s, i) => i === 0 || s <= shown[i - 1]), 'shown letters are a prefix');
    const locked = letters(f).map((c) => c.state === 'locked');
    assert.ok(locked.every((l, i) => i === 0 || l <= locked[i - 1]), 'locked letters are a prefix');
    assert.ok(letters(f).every((c) => c.state !== 'scramble' || REEL_HUD_GLYPHS.includes(c.char)));
  }
  assert.ok(frames[14].some((c) => c.state === 'scramble'), 'still decoding the frame before its duration');
  assert.deepEqual(frames[15].map((c) => c.char).join(''), text);
  assert.ok(frames[15].every((c) => c.state === 'locked'));

  // A section swap's 0.3 s over ten letters sums a hair past 0.3: the last still locks on frame 9.
  const swap = reelHudDecode('EDIT RHYTHM', 9 / FPS, { duration: 0.3, schedule: REEL_HUD_SWAP_DECODE, seed: 'hud', fps: FPS });
  assert.equal(swap.map((c) => (c.state === 'locked' ? c.char : '_')).join(''), 'EDIT RHYTHM');
});

test('a tone that changes on a frame flips on that frame however the scene reads t; one between frames mixes', () => {
  const on10 = [
    (t: number) => Math.floor(t * FPS + 1e-6) >= 10,
    (t: number) => Math.round(t * FPS) >= 10,
    (t: number) => t >= 10 / FPS,
  ];
  for (const dark of on10) {
    const toneAt = (t: number) => (dark(t) ? 'dark' : 'light');
    assert.equal(reelHudToneWeights(toneAt, 9 / FPS, FPS).light, 1);
    assert.equal(reelHudToneWeights(toneAt, 10 / FPS, FPS).dark, 1);
  }
  // A flash crossing its threshold a quarter into frame 10.
  const crossing = reelHudToneWeights((t) => (t >= 10.25 / FPS ? 'dark' : 'light'), 10 / FPS, FPS);
  assert.deepEqual([crossing.light, crossing.dark], [0.5, 0.5]);
});

test('a part reads in the inks most of its box wants, on a plate where the other inks\' grounds or busy type show', () => {
  const looks = { red: { color: '#e34920' }, black: { color: '#0a0a0c' }, cream: { color: '#efe7d6' }, page: { color: '#ffffff', busy: true } };
  const box = { x: 100, y: 50, w: 240, h: 30 };
  // A card edge at x: left of it one ground, right of it another.
  const split = (x: number, left: keyof typeof looks, right: keyof typeof looks) => reelHudGrounds(box, (p) => (p.x < x ? left : right));

  assert.deepEqual(reelHudReadGrounds(split(400, 'red', 'black'), looks), { tone: 'on-accent' });
  assert.deepEqual(reelHudReadGrounds(split(250, 'red', 'black'), looks), { tone: 'on-accent' }, 'paper inks read on both');
  assert.deepEqual(reelHudReadGrounds(split(250, 'red', 'cream'), looks), { tone: 'on-accent', plate: '#e34920' });
  assert.deepEqual(reelHudReadGrounds(split(170, 'red', 'cream'), looks), { tone: 'dark', plate: '#efe7d6' });
  assert.deepEqual(reelHudReadGrounds(split(170, 'red', 'cream'), looks, { inkFrom: 0.8 }), { tone: 'on-accent', plate: '#e34920' });
  assert.deepEqual(reelHudReadGrounds(split(120, 'cream', 'red'), looks), { tone: 'on-accent', plate: '#e34920' }, '8% of cream splits it');
  assert.deepEqual(reelHudReadGrounds(split(120, 'cream', 'red'), looks, { mixed: 0.1 }), { tone: 'on-accent' });
  assert.deepEqual(reelHudReadGrounds(split(400, 'page', 'red'), looks), { tone: 'dark', plate: '#ffffff' }, 'busy type is plated whole');
});
