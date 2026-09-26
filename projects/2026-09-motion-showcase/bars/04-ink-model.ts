// Bar 4's model: where and when the needle strikes, how it's shot, and how each blow knocks the camera. Bar 4 draws
// the needle from these, and `studio look --graph=models` reads the tip's place on the frame from them.

import { clamp } from '#models/motion/motion.ts';
import { definePieceTracks } from '#models/motion/piece-tracks.ts';
import { needlePoseAt, needleRig, needleScreenPoint, type NeedleStrike } from '#models/reel/needle.ts';
import type { ShowcaseClock } from '../bar.ts';
import { showcaseHudBoxesIn } from '../hud.ts';
import { INK_FIRST_STRIKE, inkFieldSlotAt } from '../ink-field.ts';
import { SHOWCASE_FORMAT } from '../timeline.ts';

export type InkStrikeSpot = { frame: number; x: number; y: number };

/**
 * The strikes: the first, two beats of room, then the music's downbeat and a beat each, with INKS. on its own beat
 * before the last so its lens split never doubles a needle. Centre, left, right, centre again, on the middle rows: the
 * body runs off the top right from each, and the tip stays above the type.
 */
export function inkStrikeSpots(clock: ShowcaseClock<'ink'>): readonly InkStrikeSpot[] {
  return [
    { frame: clock.beat(0), ...INK_FIRST_STRIKE },
    { frame: clock.cues.strike2, ...inkFieldSlotAt(3, 5) },
    { frame: clock.beat(3), ...inkFieldSlotAt(11, 5) },
    { frame: clock.beat(5), ...inkFieldSlotAt(8, 4) },
  ];
}

/**
 * The needle's strikes, each landing ink `inkOf(i)`. The first opens the bar on bar 3's cut, with no frame to come in
 * on: its contact frame shows the way in too.
 */
export const inkNeedleStrikes = (spots: readonly InkStrikeSpot[], inkOf: (i: number) => string): NeedleStrike[] =>
  spots.map((s, i) => ({ at: s.frame / SHOWCASE_FORMAT.fps, x: s.x, y: s.y, ink: inkOf(i), streak: i === 0 }));

/**
 * 32 px a mm: a barrel over 300 px across. Each blow drops in over two and a half frames, one streak on the frame
 * before the contact, drives in for a frame and tears back out, gone by the fourth after. Its gunmetal is light enough
 * for the streaks to read on the field.
 */
export const INK_NEEDLE_SHOT = {
  tilt: 52, grip: 35, scale: 32, from: 15, climb: 42, enter: 2.5 / SHOWCASE_FORMAT.fps, dwell: 1 / SHOWCASE_FORMAT.fps, overdrive: 1, exit: 2.5 / SHOWCASE_FORMAT.fps, lean: 8,
  samples: 16, shadow: 0.3, color: '#5a5e65', fastShutter: 0.6,
};
/** The shot's rig on the showcase's frame: what the model poses the needle with. */
export const INK_NEEDLE_RIG = needleRig({ ...INK_NEEDLE_SHOT, format: SHOWCASE_FORMAT });

// Each blow knocks the camera left, the way the needle comes in, a frame after the contact (so the first contact stays
// on bar 3's point), then it springs back, gone 14 frames on: between strikes the field never stands still. Level, as
// a drop would push the first strike's swollen bottom row onto the HUD's beat squares.
const RECOIL = { px: 38, period: 12, decay: 7, frames: 14 };

/** The camera's knock on frame `f` from the blows of `spots`, px. */
export function inkRecoilAt(spots: readonly InkStrikeSpot[], f: number): { x: number; y: number } {
  let d = 0;
  for (const s of spots) {
    const k = f - s.frame - 1, end = RECOIL.frames - 1;
    if (k >= 0 && k < end) d += RECOIL.px * Math.exp(-k / RECOIL.decay) * Math.cos((2 * Math.PI * k) / RECOIL.period) * (1 - k / end);
  }
  return { x: -d, y: 0 };
}

// Over the last four frames the camera pushes in 2% about the frame's middle, easing in, and bar 5's 2.5% punch on
// its first frame lands the push: the field and count move into the cut rather than holding.
const CUT_PUSH = { frames: 4, amount: 0.02, power: 1.5 };

/** The push's scale about the frame's centre on frame `f` of a bar ending (exclusive) on `to`. */
export const inkCutPushAt = (to: number, f: number) => 1 + CUT_PUSH.amount * clamp((f - (to - 1 - CUT_PUSH.frames)) / CUT_PUSH.frames) ** CUT_PUSH.power;

export const inkPieceTracks = definePieceTracks<ShowcaseClock<'ink'>>('ink', (clock) => {
  const spots = inkStrikeSpots(clock);
  const strikes = inkNeedleStrikes(spots, () => '');
  return {
    tracks: {
      // The tip where the frame shows it: seen through the lens, knocked by the recoil, scaled by the cut's push.
      needle: (f) => {
        const pose = needlePoseAt(strikes, f / clock.fps, INK_NEEDLE_RIG);
        if (!pose) return null;
        const seen = needleScreenPoint(pose.tip, INK_NEEDLE_RIG), recoil = inkRecoilAt(spots, f), push = inkCutPushAt(clock.to, f);
        return {
          x: SHOWCASE_FORMAT.width / 2 + (seen.x + recoil.x - SHOWCASE_FORMAT.width / 2) * push, y: SHOWCASE_FORMAT.height / 2 + (seen.y + recoil.y - SHOWCASE_FORMAT.height / 2) * push,
          values: { height: pose.tip[2], recoil: recoil.x }, state: pose.fast ? 'fast' : 'sharp',
        };
      },
    },
    keepClear: () => showcaseHudBoxesIn('ink'),
  };
});
