// shot-effects-builtin.ts: the studio halves of the effects the studio ships, in every shot's effect table. A
// project's own join them through PaintedShot's `effects`, made the same way (shot-effect-gpu.ts).

import { offsetCopiesGpu } from './shot-offset-copies-gpu.ts';
import type { ShotEffectGpu } from './shot-effect-gpu.ts';

export const SHOT_EFFECTS_BUILTIN: readonly ShotEffectGpu[] = [offsetCopiesGpu];
