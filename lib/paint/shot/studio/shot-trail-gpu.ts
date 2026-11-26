// shot-trail-gpu.ts: a trail's studio half (shot-trail.ts). Its ghosts lie as offset copies' copies do, each behind
// the one before and faded by `fade` once more, so it shades its reads with their WGSL.

import { trail } from '../models/shot-trail.ts';
import { defineShotEffectGpu } from './shot-effect-gpu.ts';
import { offsetCopiesGpu } from './shot-offset-copies-gpu.ts';

export const trailGpu = defineShotEffectGpu(trail, { uniforms: ({ fade }) => [fade], wgsl: offsetCopiesGpu.wgsl });
