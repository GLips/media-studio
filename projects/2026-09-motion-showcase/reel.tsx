// What every bar is drawn inside: the HUD over it, the lens over both, the grade over that, and the ending's fade over
// everything. `barScene` makes a bar the video's scene; `barPreview` makes a video of one bar alone, for building it without the other bars in the bundle.

import { FPS, FilmGrain, Vignette, defineScene, defineVideo, type Rect } from '../../lib/studio/api.ts';
import { ReelHud, type ReelHudRead, type ReelHudSlot } from '../../lib/studio/reel/hud.tsx';
import { LensFringe } from '../../lib/studio/reel/lens.tsx';
import { FadeToBlack } from '../../lib/studio/reel/recap.tsx';
import type { Bar } from './bar.ts';
import { END_FRAME, P, SECTION_TITLES, barFrame, beatAtFrame, track } from './timeline.ts';

/** The HUD as every bar wears it, but for its tones and plates: what tools/hud-legibility.ts renders alone. */
export const SHOWCASE_HUD = {
  size: 20, title: 'PAINFUL PLEASURES', subtitle: 'THE NEW BUY BOX', readout: '120 BPM   30 FPS   1920×1080',
  // The first label decodes with the rest of the HUD at boot, not on bar 1's downbeat, so the pickup's HUD is whole.
  sections: SECTION_TITLES.map((title, i) => ({ at: i === 0 ? 0 : barFrame(i + 1) / FPS, title })),
  palette: { ink: P.ink, paper: P.cream, accent: P.red },
  beatOf: (t: number) => beatAtFrame(t * FPS),
  duration: END_FRAME / FPS,
};

/** The scene that plays `bar`: the bar and the HUD through the lens, then the grade; the reel's last frames fade out. */
export function barScene(bar: Bar) {
  const kicks = [...(bar.from > 0 ? [bar.from] : []), ...(bar.kicks ?? [])].map((f) => f / FPS);
  const splits = (bar.glitches ?? []).map((f) => f / FPS);
  // ReelHud asks in seconds, 4 times within the frame; a bar answers per video frame, so it's asked once a frame.
  const frameOf = (t: number) => Math.floor(t * FPS + 1e-6);
  let asked = { f: NaN, reads: new Map<ReelHudSlot, ReelHudRead>() };
  const readAt = (slot: ReelHudSlot, t: number, box: Rect): ReelHudRead => {
    const f = frameOf(t);
    if (asked.f !== f) asked = { f, reads: new Map() };
    if (!asked.reads.has(slot)) asked.reads.set(slot, bar.hudRead?.(slot, f, box) ?? { tone: 'light' });
    return asked.reads.get(slot)!;
  };
  return defineScene({
    id: bar.id, note: bar.note, min: (bar.to - bar.from) / FPS, lead: 0, tail: 0, cut: true,
    render: (s) => {
      const f = bar.from + Math.round(s.t * FPS);
      const t = f / FPS;
      return (
        <>
          <LensFringe t={t} kicks={kicks} splits={splits}>
            {bar.render(f)}
            <ReelHud t={t} readAt={readAt} {...SHOWCASE_HUD} />
          </LensFringe>
          <Vignette amount={0.12} />
          <FilmGrain amount={0.05} />
          <FadeToBlack t={t} end={(END_FRAME - 5) / FPS} />
        </>
      );
    },
  });
}

/**
 * A video of one bar alone, over its own frames: `studio look` on a scratch project exporting this renders the bar as
 * the reel will, while other bars are mid-edit. Its frame 0 is the bar's first frame; its music is silent.
 */
export function barPreview(bar: Bar, index: number) {
  return defineVideo({ title: `Showcase bar ${index + 1}: ${bar.id}`, voice: {}, scenes: [barScene(bar)] });
}

export const reelTrack = track;
