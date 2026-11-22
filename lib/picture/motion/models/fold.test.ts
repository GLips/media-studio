import assert from 'node:assert/strict';
import { test } from 'node:test';
import { foldAbout, foldShownNormal, foldTurn, foldTurnAfter } from './fold.ts';

const close = (a: number, b: number, what: string) => assert.ok(Math.abs(a - b) < 1e-9, `${what}: ${a} is not ${b}`);

test('a fold narrows across its crease by its cosine and a fold of π mirrors over it, the crease staying put', () => {
  const pivot = { x: 10, y: 20 }, slant = Math.PI / 6;
  const along = { x: pivot.x + 30 * Math.cos(slant), y: pivot.y + 30 * Math.sin(slant) };
  const across = { x: pivot.x - 30 * Math.sin(slant), y: pivot.y + 30 * Math.cos(slant) };
  const sixty = foldAbout(Math.PI / 3, slant, pivot), flip = foldAbout(Math.PI, slant, pivot);
  close(sixty(along).x, along.x, 'along the crease nothing moves');
  close(Math.hypot(sixty(across).x - pivot.x, sixty(across).y - pivot.y), 15, 'across it, 30 px narrows to 15');
  close(flip(across).x, 2 * pivot.x - across.x, 'a flip mirrors across it');
  close(flip(across).y, 2 * pivot.y - across.y, 'a flip mirrors across it');
});

test('facing multiplies planar, and the shown normal leans the way the fold tips', () => {
  const nested = foldTurnAfter(foldTurn(Math.PI / 3, 0), foldTurn(Math.PI / 3, 0));
  close(nested.facing, 0.25, 'two nested 60° folds face +0.25');
  // A positive fold about a level crease tips the side below it away: its front's normal leans down the picture (+y).
  const tipped = foldShownNormal(foldTurn(0.5, 0));
  assert.ok(tipped.y > 0 && tipped.z > 0, `${JSON.stringify(tipped)} leans down and still faces the viewer`);
  const over = foldShownNormal(foldTurn(2.5, 0));
  assert.ok(over.z > 0, 'past π/2 the back shows, and its normal faces the viewer');
});
