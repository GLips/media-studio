// Bar 1's model: the red drop's bounce, the one set of numbers bar 1 draws it from and `studio look --graph=models`
// reads, with its box's clearance from the HUD.

import { definePieceTracks } from '#models/motion/piece-tracks.ts';
import { bouncingBallAt, type BallPose, type BounceParams } from '#models/reel/bounce.ts';
import type { ShowcaseClock } from '../bar.ts';
import { showcaseHudBoxesIn } from '../hud.ts';
import { SHOWCASE_FORMAT } from '../timeline.ts';

/** The words' floor, which the drop lands on. */
export const BOUNCE_GROUND_Y = 930;

// Landings on the pickup's hit and the bar's four beats; with no drop the loop runs back a beat, so on frame 0 the
// drop is 4 frames up out of a landing on beat −2 (frame −4), at the left edge. The last is the pad.
export const BOUNCE_LANDING_BEATS = [-1, 0, 1, 2, 3];
export const BOUNCE_BALL_SIZE = 340;
const BALL_STEP = 280;
/** The pad: BOX's full stop, as far right as its crouch (4.2:1, 697 px across as it leaves) stays inside the frame. */
export const BOUNCE_PAD_X = 1555;

/** The drop's bounce on bar 1's clock. */
export function bounceBallParams(clock: ShowcaseClock<'bounce'>): BounceParams {
  return {
    beats: BOUNCE_LANDING_BEATS.map((n) => clock.beat(n) / clock.fps), spb: clock.spb, drop: false,
    size: BOUNCE_BALL_SIZE, height: 440, groundY: BOUNCE_GROUND_Y, step: BALL_STEP, x: BOUNCE_PAD_X - (BOUNCE_LANDING_BEATS.length - 1) * BALL_STEP,
    launch: {
      // The swell covers the bar's last frame exactly there, not the 0.2 ms before that spb's rounding gives.
      fill: (clock.to - 1) / clock.fps,
      // Deeper than the piece's crouch (3.9:1, 0.139 × size), so the press reads as loading the spring at speed: from
      // the landing's 3.4:1 it spreads about 13 px and sinks about 7 px a frame until it leaves. A deeper dent would sink
      // its bottom into the HUD's bottom row.
      anticipation: { squash: 4.2, dent: 0.16 * BOUNCE_BALL_SIZE },
    },
  };
}

/** The box round the ball's ellipse: `w` along `angle`, `h` across it. */
function ballBox({ x, y, w, h, angle }: BallPose) {
  const a = (angle * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  const hw = Math.hypot((w / 2) * c, (h / 2) * s), hh = Math.hypot((w / 2) * s, (h / 2) * c);
  return { x: x - hw, y: y - hh, w: 2 * hw, h: 2 * hh };
}

export const bouncePieceTracks = definePieceTracks<ShowcaseClock<'bounce'>>('bounce', (clock) => {
  const ball = bounceBallParams(clock);
  return {
    tracks: {
      ball: (f) => {
        const pose = bouncingBallAt(f / clock.fps, ball, SHOWCASE_FORMAT);
        // Once it swells it's becoming bar 2's ground, meant to cover the HUD, so it keeps clear of nothing.
        const growing = pose.phase === 'swell' || pose.phase === 'field';
        return { x: pose.x, y: pose.y, values: { w: pose.w, h: pose.h, vy: pose.vy }, state: pose.phase, box: growing ? undefined : ballBox(pose) };
      },
    },
    keepClear: () => showcaseHudBoxesIn('bounce'),
  };
});
