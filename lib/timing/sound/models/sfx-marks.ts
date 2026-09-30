// sfx-marks.ts: what a mounted `<Sfx>` (lib/timing/sound/studio/sfx.tsx) marks on each frame for the probe to read, and
// what lib/output/sfx-cues/models/cue-events.ts turns into the moments a cue list can mark.

import type { SfxRequest } from './library.ts';

/** The artifact the probe emits for each frame: the `<Sfx>` marks on it. */
export const sfxMarkArtifactName = (frame: number) => `sfx-${frame}.json`;

/**
 * What an `<Sfx>` marks: a `click` or `key` a library piece emits (CursorPath, TakeCursor), which a cue list plays
 * itself, or a sound a scene `placed` by hand, which always plays from the scene.
 */
export type SfxMarkedEvent = 'click' | 'key' | 'placed';

/** What an `<Sfx>` writes on its mark: when it lands as seconds from the frame it's on. */
export type SfxMarkAttr = { event: SfxMarkedEvent; fromNow: number; request: SfxRequest; volume: number };
/**
 * One mounted `<Sfx>` on one frame, landing `at` video seconds, in the scene it's mounted in. A sound on the video's
 * own clock (`VideoDef.sounds`) is in no scene: its event takes the scene it lands in.
 */
export type SfxMark = Omit<SfxMarkAttr, 'fromNow'> & { scene?: string; at: number };
