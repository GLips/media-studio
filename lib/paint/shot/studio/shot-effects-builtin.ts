// shot-effects-builtin.ts: the studio halves of the effects the studio ships, in every shot's effect table. A
// project's own join them through PaintedShot's `effects`, made the same way (shot-effect-gpu.ts).

import { channelSplitGpu } from './shot-channel-split-gpu.ts';
import { shotEffectTable, type ShotEffectGpu } from './shot-effect-gpu.ts';
import { offsetCopiesGpu } from './shot-offset-copies-gpu.ts';

const SHOT_EFFECTS_BUILTIN: readonly ShotEffectGpu[] = [offsetCopiesGpu, channelSplitGpu];

/** The effect table a shot drawn with `effects` holds: the built-ins, then those. */
export const shotEffectTableWithBuiltins = (effects: readonly ShotEffectGpu[]) => shotEffectTable([...SHOT_EFFECTS_BUILTIN, ...effects]);
