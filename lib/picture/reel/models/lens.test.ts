import assert from 'node:assert/strict';
import { test } from 'node:test';
import { lensFringeAt } from './lens.ts';

const FPS = 30;

test('a kick peaks on its cut\'s own frame and is back at rest when kickDecay ends; a split shows whole px for splitFor', () => {
  const kick = (f: number) => lensFringeAt(f / FPS, FPS, { radial: 0.5, kicks: [10 / FPS] }).radial;
  assert.equal(kick(9), 0.5);
  assert.equal(kick(10), 2.5);
  const decay = [11, 12, 13, 14].map(kick);
  assert.ok(decay.every((px, i) => px < (i ? decay[i - 1] : 2.5) && px > 0.5), `falls away over the next frames: ${decay}`);
  assert.ok(Math.abs(kick(15) - 0.5) < 1e-9, '1/6 s on, at rest');

  // A split starting on a frame shows for two at 30 fps: 0.05 s is a frame and a half.
  const split = (f: number) => lensFringeAt(f / FPS, FPS, { radial: 0.5, splits: [20 / FPS] });
  assert.deepEqual([19, 22].map(split), [{ radial: 0.5, red: 0, blue: 0 }, { radial: 0.5, red: 0, blue: 0 }]);
  for (const { red, blue } of [20, 21].map(split)) {
    assert.ok(Number.isInteger(red) && red >= 5 && red <= 9, `red ${red}`);
    assert.ok(Number.isInteger(blue) && blue <= -5 && blue >= -9, `blue ${blue}`);
  }
});
