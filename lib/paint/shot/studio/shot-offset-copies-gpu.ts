// shot-offset-copies-gpu.ts: offset copies' studio half (shot-offset-copies.ts): its reads laid nearest first, each
// copy behind the one before, faded by `fade` once more each step.

import { offsetCopies } from '../models/shot-offset-copies.ts';
import { defineShotEffectGpu } from './shot-effect-gpu.ts';

export const offsetCopiesGpu = defineShotEffectGpu(offsetCopies, {
  uniforms: ({ fade }) => [fade],
  wgsl: /* wgsl */ `
fn shotEffect(p: vec2f) -> ShotFilm {
  var film = shotRead(0u, p);
  var k = 1.0;
  for (var i = 1u; i < SHOT_READS; i++) {
    k *= shotParam(0u);
    film = shotOver(film, shotFaded(shotRead(i, p), k));
  }
  return film;
}`,
});
