// shot-channel-split.ts: channel split, a built-in effect (shot-effect.ts): its input's red, green and blue each
// moved by an offset of its own. A channel moves whole: its light, what it takes of what lies behind, and its
// emission, so a fringe where only red lies takes only the red behind it and lets green and blue through untouched.
// Moving the light alone, its film kept where it was, would rim the fringe over anything coloured behind. Its studio
// half is shot-channel-split-gpu.ts.

import { defineShotEffect, type ShotEffectProblem } from './shot-effect.ts';

/** An offset, plane px: right and down. */
type ShotChannelOffset = readonly [number, number];

/** Channel split's parameters: each channel's offset, plane px. */
export type ShotChannelSplitParams = { readonly red: ShotChannelOffset; readonly green: ShotChannelOffset; readonly blue: ShotChannelOffset };

const CHANNELS = ['red', 'green', 'blue'] as const;
const DEFAULTS: ShotChannelSplitParams = { red: [6, 0], green: [0, 0], blue: [-6, 0] };

/**
 * `source` with its red, green and blue each moved by its own offset, plane px:
 * `shotPlace(channelSplit(hero, { red: [8, 0], blue: [-8, 0] }), { id, depth })`. Green stays put by default.
 */
export const channelSplit = defineShotEffect({
  name: 'channelSplit',
  inputs: ['source'],
  defaults: DEFAULTS,
  problems: (params) => CHANNELS.flatMap((channel): ShotEffectProblem[] => {
    const offset = params[channel];
    return offset.length === 2 && offset.every(Number.isFinite) ? [] : [{ field: channel, message: `[${offset.join(', ')}] isn't an offset [x, y] of finite px` }];
  }),
  // One read a channel, in red, green, blue order: the studio half takes each channel from its own.
  reads: (params) => CHANNELS.map((channel) => ({ input: 'source', map: { ma: 1, mb: 0, kx: params[channel][0], ky: params[channel][1] } })),
});
