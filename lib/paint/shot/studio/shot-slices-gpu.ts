// shot-slices-gpu.ts: slices' studio half (shot-slices.ts): each output px reads the input its cell shows, moved as
// its cell is, the cell drawn as shotSlicesCell draws it, its seed as shotSlicesSeed mixes it.

import { SHOT_SLICES_HASH_WGSL, shotSlicesShareCut, slices } from '../models/shot-slices.ts';
import { defineShotEffectGpu } from './shot-effect-gpu.ts';

export const slicesGpu = defineShotEffectGpu(slices, {
  uniforms: ({ cells, size, shift, share, seed, reroll }) => [cells === 'rects' ? 1 : 0, size, shift, shotSlicesShareCut(share), seed, reroll === 'drawing' ? 1 : 0],
  wgsl: /* wgsl */ `
${SHOT_SLICES_HASH_WGSL}
fn shotSlicesDraw(base: u32, k: u32) -> u32 { return shotSlicesHash(base + k); }
fn shotEffect(p: vec2f) -> ShotFilm {
  let rects = shotParam(0u) > 0.5;
  let size = shotParam(1u);
  let shift = i32(shotParam(2u));
  let cell = vec2i(select(0, i32(floor(p.x / size)), rects), i32(floor(p.y / size)));
  let seed = select(u32(shotParam(4u)), shotSlicesHash(u32(shotParam(4u)) ^ shotSlicesHash(shotRedrawSeed())), shotParam(5u) > 0.5);
  let base = shotSlicesHash(seed ^ shotSlicesHash(bitcast<u32>(cell.x) ^ shotSlicesHash(bitcast<u32>(cell.y))));
  let span = u32(2 * shift + 1);
  var moved = vec2i(0);
  if ((shotSlicesDraw(base, 0u) >> 16u) < u32(shotParam(3u))) {
    moved = vec2i(i32(shotSlicesDraw(base, 1u) % span) - shift, select(0, i32(shotSlicesDraw(base, 2u) % span) - shift, rects));
  }
  return shotRead(shotSlicesDraw(base, 3u) % SHOT_READS, p - vec2f(moved));
}`,
});
