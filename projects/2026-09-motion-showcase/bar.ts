import type { ReactNode } from 'react';
import type { BarClock } from '../../lib/models/timeline/bar-timeline.ts';
import type { Rect, SfxSound } from '../../lib/studio/api.ts';
import type { ReelHudRead, ReelHudSlot } from '../../lib/studio/reel/hud.tsx';

/**
 * One bar of the reel: what it draws at each frame of the video. `render` takes the video's frame, not the bar's, so a
 * bar can draw what carries over from the one before it, and the finale can replay any bar live.
 */
export type Bar = {
  id: string;
  /** What the bar shows, for the scene list and the per-beat note. */
  note: string;
  /** Its bar of the timeline: its frames (`from`, and `to` where the next starts), its beats and its cues. */
  clock: BarClock;
  render: (f: number) => ReactNode;
  /**
   * How the HUD reads over a part at frame `f`, judged over `box`, where the part sits on this bar's frame: its tone
   * ('dark' over a light ground), and a plate where no tone reads (`ReelHud`'s `readAt`). A recap tile replaying the
   * bar asks about the box the part covers in the tile. Light inks, no plate, if absent.
   */
  hudRead?: (slot: ReelHudSlot, f: number, box: Rect) => ReelHudRead;
  /** Video frames inside the bar where the lens kicks, as it does on the bar's first frame: a hard cut, or a slam. */
  kicks?: readonly number[];
  /** Frames a glitch starts on: the lens splits red from blue for a frame or two. */
  glitches?: readonly number[];
  /**
   * The sounds its picture lands. They play on the video's clock (`defineVideo({ sounds })`), not in the bar's scene,
   * so a whip rings on past the cut, and a recap tile replaying the bar stays silent.
   */
  sounds?: readonly BarSound[];
};

/**
 * The sound of the picture's event on video frame `at` (a needle's strike, a whip's fastest frame, a stamp's contact). It
 * lands `SOUND_LAG_SECONDS` after that frame, with the music's hits, which trail the picture. `id` is its role in the
 * bar ('needle-strike-1'), not its frame: the checks cite it, and it picks the take, so a retime changes neither.
 */
export type BarSound = { id: string; at: number; sound: SfxSound | readonly SfxSound[]; volume?: number };
