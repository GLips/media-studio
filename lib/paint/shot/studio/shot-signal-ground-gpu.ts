import { signalGround } from '../models/shot-signal-ground.ts';
import { defineShotEffectGpu } from './shot-effect-gpu.ts';

export const signalGroundGpu = defineShotEffectGpu(signalGround, {
  uniforms: ({ seed }) => [seed],
  wgsl: /* wgsl */ `
fn shotEffect(p: vec2f) -> ShotFilm {
  let redraw = shotRedrawSeed();
  let seed = u32(shotParam(0u));
  let tile = shotBlock(p, vec2f(94.0, 48.0));
  let field = shotNoise(tile, seed + redraw + 1u);
  let grain = shotNoise(shotBlock(p, vec2f(3.0)), seed + redraw);
  let check = shotBlock(p, vec2f(8.0));
  let lit = select(grain > 0.81, ((check.x + check.y) & 1) == 0, field > 0.82);
  let phosphor = array<vec3f, 3>(vec3f(0.035,0.65,0.48), vec3f(0.67,0.018,0.29), vec3f(0.09,0.11,0.74));
  let bank = u32(shotNoise(tile, seed + 103u) * 3.0);
  let base = mix(vec3f(0.003,0.005,0.012), vec3f(0.02,0.015,0.065), field);
  let rgb = base + select(vec3f(0.0), phosphor[bank] * field * field * 0.53, lit);
  return ShotFilm(rgb, vec3f(1.0), vec3f(0.0));
}`,
});
