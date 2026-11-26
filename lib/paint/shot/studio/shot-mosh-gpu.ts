import { mosh } from '../models/shot-mosh.ts';
import { SHOT_SLICES_HASH_WGSL } from '../models/shot-slices.ts';
import { defineShotEffectGpu } from './shot-effect-gpu.ts';

export const moshGpu = defineShotEffectGpu(mosh, {
  uniforms: ({ block, throwPx, seed, recolor }) => [block, throwPx, seed, recolor],
  wgsl: /* wgsl */ `
${SHOT_SLICES_HASH_WGSL}
fn packet(grid: vec2f, salt: u32) -> u32 {
  let cell = bitcast<vec2u>(vec2i(floor(grid)));
  return shotSlicesHash(cell.x ^ shotSlicesHash(cell.y ^ shotSlicesHash(salt + u32(shotParam(2u)))));
}
fn unit(h: u32) -> f32 { return f32(h >> 16u) / 65536.0; }

// Dark ink holds the eyes and lettering together across abrupt changes of colour table.
fn indexedColor(luma: f32, bank: u32) -> vec3f {
  let inks = array<vec3f, 6>(vec3f(0.012,0.006,0.035), vec3f(0.05,0.01,0.18),
    vec3f(0.86,0.014,0.16), vec3f(0.015,0.85,0.59), vec3f(0.99,0.65,0.065), vec3f(0.77,0.98,0.86));
  if (luma < 0.028) { return inks[0]; }
  if (luma > 0.75) { return inks[5]; }
  return inks[1u + (u32(sqrt(luma) * 5.0) + bank) % 4u];
}
fn signalGround(p: vec2f, cell: u32, tick: u32) -> ShotFilm {
  let ground = shotRead(2u, p);
  let grain = packet(floor(p / 3.0), tick);
  let checker = (u32(abs(floor(p.x / 8.0) + floor(p.y / 8.0))) & 1u) == 0u;
  let lit = select(unit(grain) > 0.83, checker, cell % 7u == 0u);
  let black = vec3f(0.005,0.008,0.025) * (0.6 + unit(cell));
  let rgb = select(black, indexedColor(0.14, grain % 4u) * (0.06 + 0.28 * unit(cell)), lit);
  return ShotFilm(rgb * ground.taken, ground.taken, vec3f(0.0));
}
fn shotEffect(p: vec2f) -> ShotFilm {
  let block = shotParam(0u);
  let tick = bitcast<u32>(shotDrawing());
  let cell = packet(p / vec2f(block, block * 0.63), tick);
  let band = packet(vec2f(0.0, p.y / (block * 0.14)), tick + 173u);
  let torn = band % 13u == 0u;
  let shifted = cell % 5u < 2u;
  let slip = select(0.0, unit(cell) * 2.0 - 1.0, shifted);
  var q = p - vec2f(select(slip, unit(band) * 2.0 - 1.0, torn) * shotParam(1u),
    select(0.0, (unit(shotSlicesHash(cell)) - 0.5) * block, shifted));
  // Holding one column across a run turns paint along the edge into long thin streaks.
  if (torn || cell % 9u == 0u) {
    let run = block * (0.25 + 0.75 * unit(band));
    q.x = floor(q.x / run) * run + floor(unit(packet(vec2f(0.0, p.y / 3.0), tick)) * block * 0.5);
  } else if (cell % 5u == 0u) {
    let pitch = max(2.0, floor(block / 8.0));
    q = (floor(q / pitch) + 0.5) * pitch;
  }
  // Before the delayed drawing exists these blocks drop out, revealing the ground.
  let film = shotRead(select(0u, 1u, shifted), q);
  let cover = max(film.taken.r, max(film.taken.g, film.taken.b));
  var output = film;
  if (cover > 0.0 && unit(shotSlicesHash(cell + 1u)) < shotParam(3u)) {
    let rgb = (film.light + vec3f(cover) - film.taken) / cover;
    let luma = max(0.0, dot(rgb, vec3f(0.2126, 0.7152, 0.0722)));
    var color = indexedColor(luma, cell % 4u);
    if (SHOT_READS == 3u && cell % 5u < 4u) {
      let mint = select(vec3f(0.02,0.44,0.41), vec3f(0.31,0.98,0.70), luma > 0.2);
      color = select(vec3f(0.008,0.007,0.034), mint, luma > 0.028);
    }
    output = ShotFilm(color * cover, vec3f(cover), film.emission);
  }
  if (SHOT_READS == 3u) { return shotOver(output, signalGround(p, cell, tick)); }
  return output;
}`,
});
