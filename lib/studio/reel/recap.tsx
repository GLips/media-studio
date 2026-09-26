// recap.tsx: a showreel's finale devices, after the reference reel's last bars (study 07-13.00-16.40). RecapGrid lays
// earlier shots out in a grid and pops them in on the beat, each still playing; GlitchFlash slices and colour-splits
// whatever it wraps on the hits it's given; Shake jolts what it wraps on an impact; FadeToBlack takes the picture
// down over the music's last sixteenth. Each is a pure function of `t`, seconds on the author's clock, with the times
// things happen given on that same clock. Their poses, layout and timing are models/reel/recap.ts; this draws them.

import { useId, type CSSProperties, type ReactNode } from 'react';
import type { Rect } from '#models/camera/camera.ts';
import type { FrameSize } from '#models/frame/frame.ts';
import { clamp } from '#models/motion/motion.ts';
import { useVideoFormat } from '../composition/video-format.ts';
import { motionEchoAttrs, pieceMotionAttrs } from '../probe/motion-tag.ts';
import { hashRandom } from '#models/motion/random.ts';
import {
  GLITCH_LOOK, RECAP_EPS, glitchCuts, recapPlan, recapShotScale, shakeOffset, type GlitchHit, type GlitchLook, type RecapExit, type RecapLayout, type RecapTileLook,
} from '#models/reel/recap.ts';
import { channelSplitPrimitives } from './lens.tsx';

const frameFill = ({ width, height }: FrameSize): CSSProperties => ({ position: 'absolute', left: 0, top: 0, width, height });

// ---------- RecapGrid ----------

/** What a tile tells its shot. */
export type RecapTileView = {
  /**
   * The scale the tile draws its whole-frame shot at (0.49 in a 2×2, 0.33 in a 3×3). A canvas in the shot can render
   * at the frame's width × scale and be scaled back up, rather than render a whole frame to be shown a third of the size.
   */
  scale: number;
};

export type RecapTile = {
  /**
   * Draws the whole frame's shot, ground included, at the shot's own time `t`: an earlier bar's component at its own
   * clock, so the replay plays live. It's drawn as an echo (motionEchoAttrs): its tags, framing marks and sound cues
   * counted where the shot first played, so the replay doesn't count them twice.
   */
  shot: (t: number, view: RecapTileView) => ReactNode;
  /** The shot's time at the grid's `at`, the moment the tile opens on; it plays on from there. Default 0. */
  from?: number;
  /** How this tile leaves at the grid's `exit`, instead of the exit's style. */
  exit?: RecapExit;
};

/**
 * Earlier shots, still playing, popping into a grid from `at` (on `t`'s clock): the reference's 2×2, then 3×3. Each
 * tile scales about its centre, overshooting, smeared by its speed; the grid's size picks the reference's spacing and
 * pop. It draws `ground`, a whole shot: stop drawing it to cut away.
 *
 *   <RecapGrid t={s.t} at={beats.at(25)} tiles={shots} />
 */
export function RecapGrid({ t, tiles, radius, ground = '#0c0c0e', blur = 0.3, motion, ...layout }: Omit<RecapLayout, 'tiles'> & {
  t: number;
  tiles: readonly RecapTile[];
  radius?: number;
  ground?: string;
  /**
   * A moving tile's smear, as a share of its edges' travel in a frame; 0 turns it off. 0.3 gives the reference's edge
   * softness frame for frame (16 px on a 2×2's first frame); 0.5, a 180° shutter at 30 fps, mushes the tile's middle,
   * which a true zoom blur would leave sharp.
   */
  blur?: number;
  /** The grid's name in the motion tracks, `recap` by default; its tiles are `tile 0`… inside it. `false` tracks neither. */
  motion?: string | false;
}) {
  const format = useVideoFormat(), fill = frameFill(format);
  const u = t - (layout.at ?? 0);
  if (u < -RECAP_EPS) return null;
  const { look, rects, starts, tileLook } = recapPlan({ ...layout, tiles }, format);
  const startRank = starts.map((s, i) => starts.filter((o, j) => o < s || (o === s && j < i)).length);

  return (
    <div {...pieceMotionAttrs(motion, 'recap', { kind: 'recap-grid' })} style={{ ...fill, background: ground, overflow: 'hidden' }}>
      {tiles.map((tile, i) => {
        const here = tileLook(i, u);
        if (!here) return null;
        // The smear follows the scale's speed now, the slower of just before and just after: a frame on the kink where
        // a move stops (the CRT's line reaching its dot) is drawn still, not streaked by the move that just ended.
        const h = 0.002, before = tileLook(i, u - h), after = tileLook(i, u + h);
        const speed = (axis: 'sx' | 'sy') => {
          const back = before ? (here[axis] - before[axis]) / h : undefined;
          const ahead = after ? (after[axis] - here[axis]) / h : undefined;
          if (back === undefined || ahead === undefined) return back ?? ahead ?? 0;
          return Math.abs(back) < Math.abs(ahead) ? back : ahead;
        };
        const vx = speed('sx'), vy = speed('sy');
        // A box smear L px long spreads like a Gaussian of σ = L / √12; an edge moves half the size change.
        const sigma = (v: number, size: number) => (Math.abs(v) * blur * size) / (2 * format.fps * Math.sqrt(12));
        const rect = rects[i];
        const scale = recapShotScale(rect, format);
        const tag = motion === false ? {} : pieceMotionAttrs(undefined, `tile ${i}`, {
          kind: 'recap-tile', values: { pop: here.pop, exit: here.exit }, stagger: { group: 'tiles', index: startRank[i], count: tiles.length },
        });
        return (
          <RecapTileFrame key={i} rect={rect} look={here} smear={[sigma(vx, rect.w), sigma(vy, rect.h)]} radius={radius ?? look.radius} tag={tag}>
            <div {...motionEchoAttrs} style={{ ...fill, left: (rect.w - format.width * scale) / 2, top: (rect.h - format.height * scale) / 2, transform: `scale(${scale})`, transformOrigin: '0 0' }}>
              {tile.shot((tile.from ?? 0) + u, { scale })}
            </div>
          </RecapTileFrame>
        );
      })}
    </div>
  );
}

/**
 * One tile: scaled about its centre and clipped to its rounded rect, with a white wash for the CRT exit. The smear is
 * an SVG blur on an unscaled wrapper, in frame pixels, so a tile squashed to a line still smears by what it travelled.
 */
function RecapTileFrame({ rect, look, smear: [bx, by], radius, tag, children }: {
  rect: Rect;
  look: RecapTileLook;
  smear: readonly [number, number];
  radius: number;
  tag: Record<string, string>;
  children: ReactNode;
}) {
  const id = useId();
  const smeared = Math.max(bx, by) >= 0.4;
  const pad = 0.1 * Math.max(rect.w, rect.h) + 3 * Math.max(bx, by);
  return (
    <>
      {smeared && (
        <svg width={0} height={0} style={{ position: 'absolute' }}>
          <filter id={id} filterUnits="userSpaceOnUse" x={-pad} y={-pad} width={rect.w + 2 * pad} height={rect.h + 2 * pad} colorInterpolationFilters="sRGB">
            <feGaussianBlur stdDeviation={`${bx} ${by}`} />
          </filter>
        </svg>
      )}
      <div style={{ position: 'absolute', left: rect.x, top: rect.y, width: rect.w, height: rect.h, filter: smeared ? `url("#${id}")` : undefined }}>
        <div {...tag} style={{ position: 'absolute', inset: 0, overflow: 'hidden', borderRadius: look.dot ? '50%' : radius, transform: `scale(${look.sx}, ${look.sy})` }}>
          {children}
          {look.white > 0 && <div style={{ position: 'absolute', inset: 0, background: '#fff', opacity: look.white }} />}
        </div>
      </div>
    </>
  );
}

// ---------- GlitchFlash ----------

const IDENTITY_MATRIX = '1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 1 0';
const INVERT_MATRIX = '-1 0 0 0 1 0 -1 0 0 1 0 0 -1 0 1 0 0 0 1 0';

/**
 * Glitches what it wraps on each hit: slices shifted sideways (new each frame), red and blue split apart, and
 * optionally a flash and an inversion; clean between hits. `hits` are times on `t`'s clock, or `{ at, …look }`. Wrap
 * a whole opaque shot and what takes the hit with it (a HUD).
 *
 *   <GlitchFlash t={s.t} hits={sixteenths} duration={beats.spb / 4}>{shot}</GlitchFlash>
 */
export function GlitchFlash({ t, hits, seed = 'glitch', flashColor = '#a4a4a4', flashDuration = 0.133, children, motion, ...look }: {
  t: number;
  hits: readonly (number | GlitchHit)[];
  /** Seeds the slices and the split's jitter, so the same hits cut the same slices on every render. */
  seed?: number | string;
  /** The flash's colour at the centre; the corners are 10% darker. The reference's grey is #a4a4a4. */
  flashColor?: string;
  /** Seconds a flash takes to die away: 0.133 (8 f at 60 fps) in the reference. */
  flashDuration?: number;
  children: ReactNode;
  /** Its name in the motion tracks, `glitch` by default; it reports the hit (1-based, 0 when clean), split and flash. */
  motion?: string | false;
} & Partial<GlitchLook>) {
  const id = useId();
  const format = useVideoFormat(), fill = frameFill(format);
  const all = hits.map((h, index) => ({ ...GLITCH_LOOK, ...look, ...(typeof h === 'number' ? { at: h } : h), index }));
  const live = all.findLast((h) => t > h.at - RECAP_EPS && t < h.at + h.duration - RECAP_EPS);
  const lit = all.findLast((h) => h.flash > 0 && t > h.at - RECAP_EPS && t < h.at + flashDuration - RECAP_EPS);
  const flash = lit ? lit.flash * (1 - clamp((t - lit.at) / flashDuration)) ** 2 : 0;
  const frame = live ? Math.round((t - live.at) * format.fps) : 0;
  const cuts = live ? glitchCuts(seed, live.index, frame, live, format) : [];
  const split = live ? Math.round(live.split * (0.85 + 0.3 * hashRandom(seed, live.index, frame, 'split'))) : 0;
  const filtered = !!live && (split > 0 || cuts.length > 0 || live.invert);
  return (
    <>
      {filtered && (
        <svg width={0} height={0} style={{ position: 'absolute' }}>
          <filter id={id} filterUnits="userSpaceOnUse" primitiveUnits="userSpaceOnUse" x={0} y={0} width={format.width} height={format.height} colorInterpolationFilters="sRGB">
            <feColorMatrix in="SourceGraphic" type="matrix" values={live.invert ? INVERT_MATRIX : IDENTITY_MATRIX} result="src" />
            {cuts.map((cut, i) => <feOffset key={i} in="src" dx={cut.dx} dy={0} x={cut.x} y={cut.y} width={cut.w} height={cut.h} result={`cut${i}`} />)}
            <feMerge result="cut">
              <feMergeNode in="src" />
              {cuts.map((_, i) => <feMergeNode key={i} in={`cut${i}`} />)}
            </feMerge>
            {split > 0 && channelSplitPrimitives('cut', split, -split)}
          </filter>
        </svg>
      )}
      <div style={{ ...fill, filter: filtered ? `url("#${id}")` : undefined }}>{children}</div>
      {flash > 0 && (
        <div style={{ ...fill, pointerEvents: 'none', opacity: flash, background: `radial-gradient(ellipse at 50% 50%, ${flashColor} 35%, color-mix(in srgb, ${flashColor} 90%, #000) 100%)` }} />
      )}
      <div {...pieceMotionAttrs(motion, 'glitch', { kind: 'glitch-flash', values: { hit: live ? live.index + 1 : 0, split, flash } })} style={{ ...fill, pointerEvents: 'none' }} />
    </>
  );
}

// ---------- Shake ----------

/**
 * Jolts what it wraps on an impact at `at` (on `t`'s clock): knocked `strength` px on that frame (3, 0.3% H, in the
 * reference's end card), rattling back and settling in about 0.25 s. Still before `at` and after it settles. Wrap
 * what's hit (a card), not the frame's chrome: the reference's HUD holds still.
 */
export function Shake({ t, at, strength = 3, decay = 0.1, seed = 'jolt', children, motion }: {
  t: number;
  at: number;
  strength?: number;
  /** Seconds for the rattle to fall to 1/e of `strength`: 0.1, the reference's. It stops once under a quarter px. */
  decay?: number;
  /** Picks the directions and frequencies. The default, `jolt`, knocks right and up first, as the reference does. */
  seed?: number | string;
  children: ReactNode;
  /** Its name in the motion tracks, `shake` by default: its track is the offset, and what it wraps is measured inside it. */
  motion?: string | false;
}) {
  const fill = frameFill(useVideoFormat());
  const { x, y } = shakeOffset(t - at, strength, decay, seed);
  return (
    <div {...pieceMotionAttrs(motion, 'shake', { kind: 'shake', values: { x, y } })} style={{ ...fill, transform: x || y ? `translate(${x}px, ${y}px)` : undefined }}>
      {children}
    </div>
  );
}

// ---------- FadeToBlack ----------

/**
 * The ending: black over the whole frame, HUD included, full at `end` (on `t`'s clock: the music's silence, the last
 * frame). Brightness falls as 1 − k² over `duration`, holding nearly full, then dropping away: the reference's last
 * sixteenth, 0.133 s, black on the downbeat. Draw it last.
 */
export function FadeToBlack({ t, end, duration = 0.133, motion }: {
  t: number;
  end: number;
  duration?: number;
  /** Its name in the motion tracks, `fade` by default; it reports `k`, 0..1 through the fade. */
  motion?: string | false;
}) {
  const fill = frameFill(useVideoFormat());
  const k = clamp(1 - (end - t) / duration);
  if (k <= 0) return null;
  return <div {...pieceMotionAttrs(motion, 'fade', { kind: 'fade-to-black', values: { k } })} style={{ ...fill, background: '#000', opacity: k * k, pointerEvents: 'none' }} />;
}
