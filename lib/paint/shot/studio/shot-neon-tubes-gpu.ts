// shot-neon-tubes-gpu.ts: neon tubes' studio half (shot-neon.ts). A tube is the strongest of its line within `width`
// px, falling off over its last px; its gas is the palette colour whose hue lies nearest that line's paint; it burns
// toward white where the line itself is solid, covers what's behind as glass, and emits its light.

import { neonTubes } from '../models/shot-neon.ts';
import { defineShotEffectGpu } from './shot-effect-gpu.ts';

export const neonTubesGpu = defineShotEffectGpu(neonTubes, {
  // Width, core, intensity, the palette's colour count, then its colours.
  uniforms: ({ palette, width, core, intensity }) => [width, core, intensity, palette.length / 3, ...palette],
  wgsl: /* wgsl */ `
const NEON_LUMA = vec3f(0.2126, 0.7152, 0.0722);
fn neonGas(i: u32) -> vec3f { return vec3f(shotParam(4u + 3u * i), shotParam(5u + 3u * i), shotParam(6u + 3u * i)); }
// The palette colour whose hue (its channels' shares) lies nearest paint a; the first for paint too dark to have one.
fn neonGasOf(a: vec3f) -> vec3f {
  let sum = a.r + a.g + a.b;
  if (sum < 0.03) { return neonGas(0u); }
  let hue = a / sum;
  // Grey paint has no hue to match: it takes the first gas, as black does.
  if (max(hue.r, max(hue.g, hue.b)) - min(hue.r, min(hue.g, hue.b)) < 0.04) { return neonGas(0u); }
  var best = neonGas(0u);
  var nearest = 1e9;
  for (var i = 0u; i < u32(shotParam(3u)); i++) {
    let gas = neonGas(i);
    let d = distance(hue, gas / max(gas.r + gas.g + gas.b, 1e-4));
    if (d < nearest) { nearest = d; best = gas; }
  }
  return best;
}
fn shotEffect(p: vec2f) -> ShotFilm {
  let width = shotParam(0u);
  let r = i32(ceil(width));
  var tube = 0.0;
  var paint = vec3f(0.0);
  for (var y = -r; y <= r; y++) {
    for (var x = -r; x <= r; x++) {
      let film = shotRead(0u, p + vec2f(f32(x), f32(y)));
      let reach = clamp(width + 0.5 - length(vec2f(f32(x), f32(y))), 0.0, 1.0);
      let covers = dot(film.taken, NEON_LUMA) * reach;
      if (covers > tube) {
        tube = covers;
        // An ink's colour is what it lets through, its own light near nothing: what each channel passes beyond the
        // most-taken one, added to its light. Body colour reads as its light alone, at any coverage.
        let most = max(film.taken.r, max(film.taken.g, film.taken.b));
        paint = film.light + (vec3f(most) - film.taken);
      }
    }
  }
  if (tube <= 0.0) { return shotFilmClear(); }
  let solid = dot(shotRead(0u, p).taken, NEON_LUMA);
  let light = mix(neonGasOf(paint), vec3f(1.0), clamp(solid * shotParam(1u), 0.0, 1.0)) * tube;
  return ShotFilm(light, vec3f(tube), light * shotParam(2u));
}`,
});
