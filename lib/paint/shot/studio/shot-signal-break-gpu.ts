import { signalBreak } from '../models/shot-signal-break.ts';
import { defineShotEffectGpu } from './shot-effect-gpu.ts';

export const signalBreakGpu = defineShotEffectGpu(signalBreak, {
  uniforms: ({ hits, decay, tear, fringe, dropout, posterize }) => [decay, tear, fringe, dropout, Number(posterize), hits.length, ...hits],
  wgsl: /* wgsl */ `
fn signalHit() -> f32 {
  var strength = 0.0;
  for (var i = 0u; i < u32(shotParam(5u)); i++) {
    let elapsed = shotSeconds() - shotParam(6u + i);
    if (elapsed >= 0.0) { strength = max(strength, 1.0 - smoothstep(0.0, shotParam(0u), elapsed)); }
  }
  return strength;
}
fn signalRead(q: vec2f) -> ShotFilm {
  let over = shotReadNearest(0u, q);
  if (SHOT_READS == 1u) { return over; }
  return shotOver(over, shotReadNearest(1u, q));
}
fn shotEffect(p: vec2f) -> ShotFilm {
  let hit = signalHit();
  let seed = bitcast<u32>(shotDrawing());
  let row = shotBlock(p, vec2f(1.0, 8.0)).y;
  let band = shotNoise(vec2i(0, row), seed);
  let cell = shotBlock(p, vec2f(112.0, 52.0));
  let packet = shotNoise(cell, seed);
  if (packet < shotParam(3u) * hit) { return shotFilmClear(); }
  let torn = band < 0.014 + 0.28 * hit;
  let slipped = packet > 1.0 - 0.44 * hit;
  let side = shotNoise(vec2i(1, row), seed) * 2.0 - 1.0;
  let dx = select(0.0, (shotNoise(cell, seed + 7u) - 0.5) * hit, slipped);
  let tear = select(dx, side * (0.12 + hit), torn) * shotParam(1u);
  let q = p + vec2f(round(tear), select(0.0, round(34.0 * (packet - 0.5) * hit), slipped));
  let split = vec2f(round(shotParam(2u) * (0.07 + hit * select(0.55, 1.0, torn))), 0.0);
  let r = signalRead(q - split);
  let g = signalRead(q);
  let b = signalRead(q + split);
  let taken = vec3f(r.taken.r, g.taken.g, b.taken.b);
  var rgb = vec3f(r.light.r, g.light.g, b.light.b);
  if (shotParam(4u) > 0.5 && hit > 0.35) {
    let coverage = max(taken, vec3f(0.0001));
    // Quantize in display space to preserve shadow steps in dark painted interiors.
    let steps = shotPosterize(sqrt(clamp(rgb / coverage, vec3f(0.0), vec3f(1.0))), 7.0 - 3.0 * hit);
    rgb = steps * steps * coverage;
  }
  return ShotFilm(rgb, taken, vec3f(r.emission.r, g.emission.g, b.emission.b));
}`,
});
