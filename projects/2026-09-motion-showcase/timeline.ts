// The reel's timing, stated once: its bar table on the fitted drive track, the moments one bar reaches in another, and
// the music's final hit. Every frame a bar, a sound or a tool cuts on is resolved from here; `studio clock` prints it.

import { defineBarTimeline } from '../../lib/models/timeline/bar-timeline.ts';
import { music } from './music/index.ts';

/** The fitted track the table is cut to, and the video's music. */
export const track = music['drive-fit'];

export const timeline = defineBarTimeline({
  track,
  steadyGrid: true,
  // The tracker hears a hit about 20 ms late, and the picture should lead the sound by about a frame, as the reference
  // reel's does (by 40 ms), so a beat's cut or hit is two frames before the tracker's beat frame.
  leadFrames: 2,
  // The music's attacks land about 35 ms after their frames (`studio mix` measures each sound's gap to them), so a
  // sound on the frame itself would strike that much ahead of the music's hit, heard as a flam, not one hit.
  soundLagSeconds: 0.035,
  // Each bar's length in beats, from bar 1's downbeat (the track's beat 0).
  bars: [
    { id: 'bounce', beats: 4 }, { id: 'every-color', beats: 4 },
    // The product's hold and the needle's first strike each get half a bar of room, and the price a whole bar: the
    // music plays drive's bars 1–7 and 9–13 to make the 44 beats.
    { id: 'swatches', beats: 6 }, { id: 'ink', beats: 6 }, { id: 'search', beats: 4 }, { id: 'buy-more', beats: 4 },
    { id: 'tiers', beats: 4 }, { id: 'pay-less', beats: 8 },
    // The finale cuts in on its downbeat's "and", so bar 8's poster holds over the downbeat. Its last beat is the
    // music's final hit; the ring-out and the hold after it run on to the video's end.
    { id: 'one-box', beats: 4, cutIn: 0.5 },
  ],
  // The moments the finale's recap replays, each in its own bar's beats.
  cues: {
    bounce: { launch: 3.5 },
    'every-color': { every: 0, color: 1, one: 2, tapLock: { beat: 3, frames: 4 } },
    swatches: { pinkTap: 1, charcoalTap: 2 },
    ink: { strike2: 2 },
    search: { answer: 2, listLand: 3 },
    'buy-more': { qty2: 1, qty3: 2 },
    tiers: { plateau: 3 },
    'pay-less': { lock: 2, stamp: 6 },
  },
  moves: {
    // The dive into bar 4's first strike: 2.75 frames, landing a frame before the cut, however long bar 3 runs.
    swatches: { dive: { from: { beat: 'end', frames: -3.75 }, to: { beat: 'end', frames: -1 } } },
  },
  // The music is a recording, re-cut only in whole bars (`studio music fit --bars`): the table ends on its final hit.
  landmarks: [{ name: 'the final hit', bar: 'one-box', beat: 'end', downbeat: -1 }],
  fade: { from: -9, to: -5 },
});
