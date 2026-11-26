// shot-channel-split-gpu.ts: channel split's studio half (shot-channel-split.ts): each channel of light, taken and
// emission from the read moved by that channel's offset.

import { channelSplit } from '../models/shot-channel-split.ts';
import { defineShotEffectGpu } from './shot-effect-gpu.ts';

export const channelSplitGpu = defineShotEffectGpu(channelSplit, {
  uniforms: () => [],
  wgsl: /* wgsl */ `
fn shotEffect(p: vec2f) -> ShotFilm {
  let r = shotRead(0u, p);
  let g = shotRead(1u, p);
  let b = shotRead(2u, p);
  return ShotFilm(vec3f(r.light.r, g.light.g, b.light.b), vec3f(r.taken.r, g.taken.g, b.taken.b), vec3f(r.emission.r, g.emission.g, b.emission.b));
}`,
});
