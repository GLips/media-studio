import type { ReactNode } from 'react';
import type { TimelineBinding, TimelineSceneClock } from '#models/timeline/bind-timeline.ts';
import type { ResolvedScene, ResolvedSceneClock } from '#models/timeline/timeline.ts';
import type { Rect, SfxSound } from '#studio';
import type { ReelHudRead, ReelHudSlot } from '#models/reel/hud.ts';
import type { timeline } from './timeline.ts';

/** The clock video.tsx hands bar `K`: its frames from its own origin (its beat 0), its beats, cues and moves, resolved on the reel's timeline. */
export type ShowcaseClock<K extends (typeof timeline.keys)[number]> = TimelineSceneClock<typeof timeline, K>;
/** The bars video.tsx hands bar `K` to replay, by the names timeline.ts declares, each mapped onto `K`'s frames. */
export type ShowcaseReplays<K extends (typeof timeline.keys)[number]> = Parameters<TimelineBinding<typeof timeline, K, Bar>>[1];

/**
 * One bar of the reel: what it draws on each frame of its clock, counted from its beat 0, not the video's. It answers
 * on any frame, before its cut or after it, so a bar can draw what carries over from the one before it, and the finale
 * can replay any bar live. Every frame below is on the bar's clock.
 */
export type Bar = {
  id: string;
  /** What the bar shows, for the scene list and the per-beat note. */
  note: string;
  /** Its scene's clock: its frames (`from`, and `to` where the next starts), its beats and its cues. */
  clock: ResolvedSceneClock;
  render: (f: number) => ReactNode;
  /**
   * How the HUD reads over a part on frame `f`, judged over `box`, where the part sits on this bar's picture: its tone
   * ('dark' over a light ground), and a plate where no tone reads (`ReelHud`'s `readAt`). A recap tile replaying the
   * bar asks about the box the part covers in the tile. Light inks, no plate, if absent.
   */
  hudRead?: (slot: ReelHudSlot, f: number, box: Rect) => ReelHudRead;
  /** Frames inside the bar where the lens kicks, as it does on the bar's first frame: a hard cut, or a slam. */
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
 * The sound of the picture's event on the bar's frame `at` (a needle's strike, a whip's fastest frame, a stamp's contact). It
 * lands the timeline's `soundLagSeconds` after that frame, with the music's hits, which trail the picture. `id` is its
 * role in the bar ('needle-strike-1'), not its frame: the checks cite it, and it picks the take, so a retime changes
 * neither.
 */
export type BarSound = { id: string; at: number; sound: SfxSound | readonly SfxSound[]; volume?: number };

/** A bar with the scene the timeline places it in on the video: where reel.tsx plays it and video.tsx places its sounds. */
export type PlacedBar = { bar: Bar; scene: ResolvedScene };
