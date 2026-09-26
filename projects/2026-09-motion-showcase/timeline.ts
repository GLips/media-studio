// The reel's timing, stated once: its scenes on the fitted drive track, each one's cues, the finale's replays of the
// bars before it, and the music's final hit. Every frame a bar, a sound or a tool cuts on is resolved from here;
// `studio clock` prints it.

import type { VideoFormat } from '#models/frame/frame.ts';
import { beatSpan, defineTimeline, recordedGrid } from '#models/timeline/timeline.ts';
import { music } from './music/index.ts';

/** The reel's frame rate and size: what every bar is laid out in, and the HUD's readout names. */
export const SHOWCASE_FORMAT = { fps: 30, width: 1920, height: 1080 } satisfies VideoFormat;

/** The fitted track the timeline is cut to, and the video's music. */
export const track = music['drive-fit'];

export const timeline = defineTimeline({
  fps: SHOWCASE_FORMAT.fps,
  grid: recordedGrid(track, { steady: true }),
  // The tracker hears a hit about 20 ms late, and the picture should lead the sound by about a frame, as the reference
  // reel's does (by 40 ms), so a beat's cut or hit is two frames before the tracker's beat frame.
  pictureLeadFrames: 2,
  // The music's attacks land about 35 ms after their frames (`studio mix` measures each sound's gap to them), so a
  // sound on the frame itself would strike that much ahead of the music's hit, heard as a flam, not one hit.
  soundLagSeconds: 0.035,
  // Each bar's length in beats, from bar 1's downbeat (the track's beat 0), and the moments the finale replays.
  scenes: {
    bounce: beatSpan(4, { cues: { launch: 3.5 } }),
    'every-color': beatSpan(4, { cues: { every: 0, color: 1, one: 2, tapLock: { at: 3, frames: 4 } } }),
    // The product's hold and the needle's first strike each get half a bar of room, and the price a whole bar: the
    // music plays drive's bars 1–7 and 9–13 to make the 44 beats.
    swatches: beatSpan(6, {
      cues: { pinkTap: 1, charcoalTap: 2 },
      // The dive into bar 4's first strike: 2.75 frames, landing a frame before the cut, however long bar 3 runs.
      moves: { dive: { from: { at: 'end', frames: -3.75 }, to: { at: 'end', frames: -1 } } },
    }),
    ink: beatSpan(6, { cues: { strike2: 2 } }),
    search: beatSpan(4, { cues: { answer: 2, listLand: 3 } }),
    'buy-more': beatSpan(4, { cues: { qty2: 1, qty3: 2 } }),
    tiers: beatSpan(4, { cues: { plateau: 3 } }),
    'pay-less': beatSpan(8, { cues: { lock: 2, stamp: 6 } }),
    // The finale cuts in on its downbeat's "and", so bar 8's poster holds over the downbeat: the 2×2 there, the 3×3 on
    // 1 (its tiles hitting together on the "and"), the flashes on 2's sixteenths, the card on 3, the name on its "and",
    // and the stop on the music's final hit. The ring-out and the hold after it run on to the video's end.
    'one-box': beatSpan(4, {
      cutIn: 0.5,
      cues: {
        twoUp: 0.5, nineUp: 1, nineUpAnd: 1.5, flashColor: 2, flashBuyMore: 2.25, flashPayLess: 2.5, field: 2.75, card: 3, name: 3.5,
        stop: 'end',
      },
    }),
  },
  // The finale's recap: each earlier bar's moment landing on the finale's beat. The 2×2's tiles each hit on its first
  // frame; the 3×3's on its "and"; each flash shows its bar's frame whole.
  replays: {
    'one-box': {
      twoUpEvery: { from: 'every-color.every', to: 'one-box.twoUp' },
      twoUpPinkTap: { from: 'swatches.pinkTap', to: 'one-box.twoUp' },
      twoUpAnswer: { from: 'search.answer', to: 'one-box.twoUp' },
      twoUpStamp: { from: 'pay-less.stamp', to: 'one-box.twoUp' },
      nineUpLaunch: { from: 'bounce.launch', to: 'one-box.nineUpAnd' },
      nineUpOne: { from: 'every-color.one', to: 'one-box.nineUpAnd' },
      nineUpTapLock: { from: 'every-color.tapLock', to: 'one-box.nineUpAnd' },
      nineUpCharcoalTap: { from: 'swatches.charcoalTap', to: 'one-box.nineUpAnd' },
      nineUpStrike: { from: 'ink.strike2', to: 'one-box.nineUpAnd' },
      nineUpListLand: { from: 'search.listLand', to: 'one-box.nineUpAnd' },
      nineUpQty2: { from: 'buy-more.qty2', to: 'one-box.nineUpAnd' },
      nineUpPlateau: { from: 'tiers.plateau', to: 'one-box.nineUpAnd' },
      nineUpLock: { from: 'pay-less.lock', to: 'one-box.nineUpAnd' },
      // COLOR three frames in, its weight almost Black as the selection closes; BUY MORE on QTY 3 as red takes the
      // bands; the poster three frames ahead of the stamp's beat, before it falls, as the field takes over.
      flashColor: { from: { cue: 'every-color.color', frames: 3 }, to: 'one-box.flashColor' },
      flashBuyMore: { from: 'buy-more.qty3', to: 'one-box.flashBuyMore' },
      flashPayLess: { from: { cue: 'pay-less.stamp', frames: -3 }, to: 'one-box.field' },
    },
  },
  // The music is a recording, re-cut only in whole bars (`studio music fit --bars`): the timeline ends on its final hit.
  landmarks: [{ name: 'the final hit', cue: 'one-box.stop', downbeat: -1 }],
  fade: { from: -9, to: -5 },
});
