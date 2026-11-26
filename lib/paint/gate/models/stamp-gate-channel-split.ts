// stamp-gate-channel-split.ts: the gate's channel split over coloured footage (shot/channel-split). The figure
// image's figure, read in no plane, drawn by channelSplit, red and blue moved apart, over two footages: the dark
// green and a saturated blue. A channel moves whole, so each channel of the frame is that channel of the figure
// placed alone, moved by its offset: where only red's fringe lies, green and blue are the footage's own, untouched.

import { painting } from '#lib/paint/document/models/painting-source.ts';
import { stampStage } from '#lib/paint/painting/models/stamp-stage.ts';
import { channelSplit, type ShotChannelSplitParams } from '#lib/paint/shot/models/shot-channel-split.ts';
import { shotFigure, shotPlace } from '#lib/paint/shot/models/shot-figure.ts';
import { STAMP_GATE_FIGURE_FRAME, STAMP_GATE_FIGURE_IMAGE, stampGateFootagePlane } from './stamp-gate-figure-card.ts';
import type { StampGateShot } from './stamp-gate-shot-span.ts';

const { width, height } = STAMP_GATE_FIGURE_FRAME;

/** The footages the split is drawn over: the figure image's dark green, and a saturated blue. */
export const STAMP_GATE_CHANNEL_SPLIT_FOOTAGES = ['#26331f', '#1f3a9a'] as const;
type Footage = (typeof STAMP_GATE_CHANNEL_SPLIT_FOOTAGES)[number];

/** Each channel's offset, plane px: red and blue apart along x and a little along y, green kept. */
const SPLIT: ShotChannelSplitParams = { red: [8, 2], green: [0, 0], blue: [-8, -2] };

/** The footage `footage`, and the figure image's figure either split on a plane of its own (`split`) or placed alone. */
export function stampGateChannelSplitShot(footage: Footage = STAMP_GATE_CHANNEL_SPLIT_FOOTAGES[0], split = true): StampGateShot {
  const stage = stampStage(STAMP_GATE_FIGURE_FRAME, 2), figure = shotFigure(painting(STAMP_GATE_FIGURE_IMAGE, { revealed: true }), 'figure', { at: 0 });
  return {
    camera: { stage, fov: 35, lens: { bloom: 0, shutter: 'shut' }, plays: [] },
    planes: [stampGateFootagePlane(stage, footage), shotPlace(split ? channelSplit(figure, SPLIT) : figure, { id: 'figure', depth: 1 })],
  };
}

/** The frames over one footage, RGB bytes: the split and the figure placed alone. */
export type StampGateChannelSplitFrames = { readonly footage: Footage; readonly split: ArrayLike<number>; readonly placed: ArrayLike<number> };

/**
 * Levels a channel may stand from the figure placed alone, moved: a level of the output's ordered dither either way,
 * as a moved px meets another dither cell. Moving the light alone puts tens of levels at the fringe.
 */
const CHANNEL_SLACK = 3;
/** Levels the fringe must stand from the figure placed alone somewhere: the split moved something. */
const SPLIT_SHOWS = 20;
/** px clear of the frame's edge each comparison keeps, past the farthest offset. */
const EDGE = 10;

/** How far, levels, channel `c` of `split` at each px strays most from `placed`'s at the px its offset moved from. */
function channelStray(split: ArrayLike<number>, placed: ArrayLike<number>, c: number, [dx, dy]: readonly [number, number]) {
  let stray = 0;
  for (let y = EDGE; y < height - EDGE; y++) for (let x = EDGE; x < width - EDGE; x++) {
    stray = Math.max(stray, Math.abs(split[(y * width + x) * 3 + c] - placed[((y - dy) * width + x - dx) * 3 + c]));
  }
  return stray;
}

/** How far, levels, channel `c` of `split` strays most from `placed`'s unmoved: how much the split shows. */
function channelShown(split: ArrayLike<number>, placed: ArrayLike<number>, c: number) {
  let shown = 0;
  for (let i = c; i < split.length; i += 3) shown = Math.max(shown, Math.abs(split[i] - placed[i]));
  return shown;
}

/**
 * shot/channel-split: over each footage, every channel of the frame is that channel of the figure placed alone,
 * moved by its offset, the footage's own where no figure's channel lies; and the split moves red and blue visibly.
 */
export function checkStampGateChannelSplit(over: readonly StampGateChannelSplitFrames[]) {
  return over.flatMap(({ footage, split, placed }) => {
    const strays = (['red', 'green', 'blue'] as const).map((channel, c) => channelStray(split, placed, c, SPLIT[channel]));
    const shown = Math.min(channelShown(split, placed, 0), channelShown(split, placed, 2));
    return [
      {
        id: `shot/channel-split: each channel moves whole over ${footage}`, passed: Math.max(...strays) <= CHANNEL_SLACK,
        detail: `red, green and blue each stray at most ${strays.join(', ')} levels from the figure placed alone, moved by its channel's offset (${CHANNEL_SLACK} allowed)`,
      },
      {
        id: `shot/channel-split: the split shows over ${footage}`, passed: shown >= SPLIT_SHOWS,
        detail: `red and blue stand at least ${shown} levels from the figure placed alone, unmoved, somewhere (${SPLIT_SHOWS} or more wanted)`,
      },
    ];
  });
}
