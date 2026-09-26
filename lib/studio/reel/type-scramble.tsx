// type-scramble.tsx: ScrambleText, characters decoding from code glyphs into a word under glitch hits. What it shows
// when, and each hit's split, slices and ghost, are models/reel/type.ts's.

import { useId } from 'react';
import { useStudioFontsReady } from '../fonts/fonts.ts';
import { DISPLAY_FONT, MONO_FONT } from '#models/type/faces.ts';
import { H, W } from '#models/frame/frame.ts';
import { motionEchoAttrs, pieceMotionAttrs } from '../probe/motion-tag.ts';
import { hashRandom } from '#models/motion/random.ts';
import { labelAt, leftOf, scrambleAt, scrambleFinish, wordGlitchAt, type Align, type Setting } from '#models/reel/type.ts';
import { faceStyle, layer, measureWord } from './type-measure.ts';
import { IndexLabel } from './type.tsx';

// An RGB split over what's behind, in blended passes: lens.tsx's channelSplitPrimitives needs an opaque input. Per
// channel, a multiply by white with that channel zeroed scales it by 1 − the copy's alpha; a plus-lighter adds the
// copy's channel times its alpha: plain "over", so a half-clear ghost lands true. Red from one copy, green and blue
// the other.
const SPLIT_BLEND_PASSES = [
  { side: 1, blend: 'multiply', matrix: '0 0 0 0 0  0 0 0 0 1  0 0 0 0 1  0 0 0 1 0' },
  { side: 1, blend: 'plus-lighter', matrix: '1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0' },
  { side: -1, blend: 'multiply', matrix: '0 0 0 0 1  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0' },
  { side: -1, blend: 'plus-lighter', matrix: '0 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 1 0' },
] as const;

/**
 * Characters decoding from code glyphs into `text` left to right, glitch hits splitting its colour channels, slicing
 * it and leaving a ghost: the reference's CODE, or a HUD label's decode (`mono`). A scrambled glyph centres on its
 * letter's place. Still once all letters lock and 0.09 s past the last hit. Defaults: caps 306 px (28% of frame height).
 */
export function ScrambleText({
  t, text, x = W / 2, y, cap = 306, color = '#f3f0e7', align = 'center', mono = false, weight, stretch, spacing,
  seed = text, charset, delay, each, rate, hits = [], split = 13, cursor, label, labelColor = color, motion,
}: {
  /** Seconds since the scramble starts. */
  t: number;
  text: string;
  /** Where `align` puts the text, and its baseline. The default centres the caps in the frame. */
  x?: number;
  y?: number;
  cap?: number;
  color?: string;
  align?: Align;
  /** Set in MONO_FONT (weight 500) rather than Archivo Black at width 62. */
  mono?: boolean;
  weight?: number;
  stretch?: number;
  spacing?: number;
  seed?: string | number;
  charset?: string;
  delay?: number;
  each?: number;
  rate?: number;
  /** Seconds after `t` 0 that glitch hits land: the reference's three 16ths are `[0, 1, 2].map((n) => (n * spb) / 4)`. */
  hits?: readonly number[];
  /** A hit's colour split in px, the red channel one way and green and blue the other. */
  split?: number;
  /** A block cursor after the text in this colour, flickering through the glitch. */
  cursor?: string;
  /** An index label, e.g. "(04)", in with the scramble and taking its glitch. */
  label?: string;
  labelColor?: string;
  motion?: string | false;
}) {
  const id = useId();
  const setting: Setting = mono
    ? { family: MONO_FONT, cap, weight: weight ?? 500, stretch: 100, spacing: spacing ?? 0 }
    : { family: DISPLAY_FONT, cap, weight: weight ?? 900, stretch: stretch ?? 62, spacing: spacing ?? -0.02 };
  const ready = useStudioFontsReady();
  if (!ready || t < 0) return null;
  const set = measureWord(text, setting);
  const base = y ?? H / 2 + cap / 2;
  const left = leftOf(x, set.width, align);
  const timing = { seed, charset, delay, each, rate };
  const glitch = wordGlitchAt(t, hits, split, seed, cap);
  const settled = !glitch && t >= scrambleFinish(text, { delay, each });
  const cursorOn = cursor && (settled || hashRandom(seed, 'cursor', Math.floor(t * 60 + 1e-6)) < 0.5);
  const face = faceStyle(setting, set.size);
  const tracking = setting.spacing * set.size;
  const drawAt = (tt: number) => (
    <>
      {scrambleAt(text, tt, timing).map((s, i) => {
        const c = set.chars[i];
        if (!s.char.trim()) return null;
        return s.locked
          ? <text key={i} x={left + c.x} y={base} style={face}>{s.char}</text>
          : <text key={i} x={left + c.x + (c.w - tracking) / 2} y={base} textAnchor="middle" style={face}>{s.char}</text>;
      })}
      {cursorOn && <rect x={left + set.width + 0.1 * cap} y={base - cap} width={0.22 * cap} height={cap} fill={cursor} />}
      {label && <IndexLabel text={label} {...labelAt({ x: left, y: base - cap })} t={tt} color={labelColor} />}
    </>
  );
  const shown = scrambleAt(text, t, timing);
  const tag = pieceMotionAttrs(motion, text, {
    kind: 'scramble-text', values: { locked: shown.filter((s) => s.locked).length / Math.max(1, shown.length), split: glitch?.split ?? 0 },
  });
  if (!glitch) {
    return (
      <svg width={W} height={H} style={layer}>
        <g {...tag} fill={color}>{drawAt(t)}</g>
      </svg>
    );
  }
  const bands = glitch.slices;
  // The ghost is the frame before, as a video's echo is.
  const copies = (main: Record<string, string>) => (
    <>
      {glitch.ghost && <g {...motionEchoAttrs} opacity={0.5} transform={`translate(${glitch.ghost.x} ${glitch.ghost.y})`}>{drawAt(t - 1 / 30)}</g>}
      <g {...main} clipPath={bands.length ? `url(#${id}-rest)` : undefined}>{drawAt(t)}</g>
      {bands.map((s, i) => (
        <g key={i} {...motionEchoAttrs} clipPath={`url(#${id}-band${i})`}>
          <g transform={`translate(${s.dx} 0)`}>{drawAt(t)}</g>
        </g>
      ))}
    </>
  );
  return (
    <>
      {SPLIT_BLEND_PASSES.map((pass, n) => (
        <svg key={n} width={W} height={H} style={{ ...layer, mixBlendMode: pass.blend }}>
          <defs>
            <filter id={`${id}-pass${n}`} colorInterpolationFilters="sRGB">
              <feColorMatrix values={pass.matrix} />
            </filter>
            {n === 0 && bands.length > 0 && (
              <clipPath id={`${id}-rest`}>
                <path clipRule="evenodd" d={`M${-W} ${-H}H${2 * W}V${2 * H}H${-W}Z${bands.map((s) => `M${-W} ${base + s.y}H${2 * W}v${s.h}H${-W}Z`).join('')}`} />
              </clipPath>
            )}
            {n === 0 && bands.map((s, i) => (
              <clipPath key={i} id={`${id}-band${i}`}>
                <rect x={-W} y={base + s.y} width={3 * W} height={s.h} />
              </clipPath>
            ))}
          </defs>
          {/* Only the last pass carries the tag; the others are copies for the look. */}
          <g {...(n < SPLIT_BLEND_PASSES.length - 1 ? motionEchoAttrs : {})} filter={`url(#${id}-pass${n})`} fill={color} transform={`translate(${(pass.side * glitch.split) / 2} 0)`}>
            {copies(n === SPLIT_BLEND_PASSES.length - 1 ? tag : {})}
          </g>
        </svg>
      ))}
    </>
  );
}
