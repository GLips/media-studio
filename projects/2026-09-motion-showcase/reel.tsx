// What every bar is drawn inside: the HUD over it, the lens over both, the grade over that, and the ending's fade over
// everything. `barScene` makes a bar the video's scene; `barPreview` makes a video of one bar alone, for building it without the other bars in the bundle.
// The frame is the video's: the HUD counts the whole reel and the fade ends it. The bar inside draws on its own
// clock's frames, the video's less its origin.

import { FilmGrain, Vignette, defineVideo, sceneForTimelineClock, type Rect } from '#studio';
import { ReelHud } from '#studio/reel/hud.tsx';
import type { ReelHudRead, ReelHudSlot } from '#models/reel/hud.ts';
import { LensFringe } from '#studio/reel/lens.tsx';
import { FadeToBlack } from '#studio/reel/recap.tsx';
import type { PlacedBar } from './bar.ts';
import { SHOWCASE_HUD } from './hud.ts';
import { SHOWCASE_FORMAT, timeline } from './timeline.ts';

/** The scene that plays `bar` where `scene` places it: the bar and the HUD through the lens, then the grade; the reel's last frames fade out. */
export function barScene({ bar, scene }: PlacedBar) {
  const { from, origin, fps } = scene;
  const kicks = [...(from > 0 ? [from] : []), ...(bar.kicks ?? []).map((f) => origin + f)].map((f) => f / fps);
  const splits = (bar.glitches ?? []).map((f) => (origin + f) / fps);
  // ReelHud asks in seconds, 4 times within the frame; a bar answers per video frame, so it's asked once a frame.
  const frameOf = (t: number) => Math.floor(t * fps + 1e-6);
  let asked = { f: NaN, reads: new Map<ReelHudSlot, ReelHudRead>() };
  const readAt = (slot: ReelHudSlot, t: number, box: Rect): ReelHudRead => {
    const f = frameOf(t);
    if (asked.f !== f) asked = { f, reads: new Map() };
    if (!asked.reads.has(slot)) asked.reads.set(slot, bar.hudRead?.(slot, f - origin, box) ?? { tone: 'light' });
    return asked.reads.get(slot)!;
  };
  // Every bar is past pacing sign-off and in polish, so the reel declares them final together; a bar sent back to be
  // rebuilt would say `blocking` here until it's done.
  return sceneForTimelineClock(bar.clock, {
    note: bar.note, rung: 'final',
    render: (s) => {
      const f = from + Math.round(s.t * fps);
      const t = f / fps;
      return (
        <>
          <LensFringe t={t} kicks={kicks} splits={splits}>
            {bar.render(f - origin)}
            <ReelHud t={t} readAt={readAt} {...SHOWCASE_HUD} />
          </LensFringe>
          <Vignette amount={0.12} />
          <FilmGrain amount={0.05} />
          <FadeToBlack t={t} end={timeline.fade.to / fps} duration={(timeline.fade.to - timeline.fade.from) / fps} />
        </>
      );
    },
  });
}

/**
 * A video of one bar alone, over its own frames: `studio look` on a scratch project exporting this renders the bar as
 * the reel will, while other bars are mid-edit. Its frame 0 is the bar's first frame; its music is silent.
 */
export function barPreview(placed: PlacedBar) {
  return defineVideo({ title: `Showcase bar ${placed.scene.n}: ${placed.bar.id}`, format: SHOWCASE_FORMAT, voice: {}, scenes: [barScene(placed)] });
}
