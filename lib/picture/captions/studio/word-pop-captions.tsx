// word-pop-captions.tsx: short pages of heavy Archivo in the lower third, each word popping in as it's spoken and the
// word being said lit, for a teaser or a vertical cut. Its pages are too short to read as subtitles, so its sidecar
// pages by the readable rule.

import { backOutEase, motionCurves, seg } from '#lib/picture/motion/models/motion.ts';
import { layoutGlyphLine, type GlyphLineSlot } from '#lib/picture/type/models/glyph-layout.ts';
import { DISPLAY_FONT, MONO_ADVANCE_EM, MONO_FONT } from '#lib/picture/type/models/faces.ts';
import { useStudioFontsReady } from '#lib/picture/type/studio/fonts.ts';
import type { CaptionBand, CaptionBandRule } from '../models/caption-band.ts';
import { READABLE_CAPTION_RULE, type CaptionMeasure, type CaptionPagingRule } from '../models/caption-pages.ts';
import type { CaptionWord } from '../models/caption-track.ts';
import type { CaptionRenderProps, CaptionStyle } from './caption-style.tsx';

const WEIGHT = 800, SIZE = 64, LINE = 1.1, KEY_EM = 0.8, KEY_PAD_EM = 0.25;
const POP = 0.14, OUT = 0.2;
const popEase = backOutEase(0.12);

/** Two short lines, lifted higher than the pill's band and narrower; on a vertical frame, clear of a feed's bottom fifth. */
export const wordPopCaptionBand: CaptionBandRule = ({ width, height }) => {
  const scale = Math.min(width, height) / 1080;
  const bottom = Math.round(height > width ? height * 0.24 : 120 * scale);
  return { scale, bottom, maxWidth: Math.min(Math.round(820 * scale), width - Math.round(160 * scale)), top: height - bottom - Math.round(2 * SIZE * LINE * scale + 30 * scale) };
};

const WORD_POP_RULE: CaptionPagingRule = { maxChars: 18, maxLines: 2, maxSeconds: 2.5, pauseBreak: 0.35, holdGap: 0.4, leadIn: 0, hang: 0.3 };

export function wordPopCaptions({ band = wordPopCaptionBand, rule }: { band?: CaptionBandRule; rule?: Partial<CaptionPagingRule> } = {}): CaptionStyle {
  return { name: 'word pops', rule: { ...WORD_POP_RULE, ...rule }, sidecarRule: READABLE_CAPTION_RULE, band, measure: archivoCaptionMeasure, Caption: WordPopCaption };
}

// Archivo's own metrics, so a line breaks where it would set: a keycap is a blank as wide as its mono key and padding.
function archivoCaptionMeasure({ scale, maxWidth }: CaptionBand): CaptionMeasure {
  const size = SIZE * scale, axes = { wght: WEIGHT, wdth: 100 };
  const slotsOf = (word: CaptionWord): GlyphLineSlot[] => {
    const chars = (text: string) => [...text].map((char) => ({ char, axes }));
    return word.key ? [{ blank: (word.text.length * MONO_ADVANCE_EM + 2 * KEY_PAD_EM) * KEY_EM * size }, ...chars(word.trail)] : chars(word.text);
  };
  return {
    maxWidth,
    lineWidth: (words) => layoutGlyphLine(words.flatMap((word, k) => [...(k ? [{ char: ' ', axes }] : []), ...slotsOf(word)]), size).width,
  };
}

function WordPopCaption({ state: { page, held }, band: { bottom, maxWidth, scale }, t }: CaptionRenderProps) {
  useStudioFontsReady();
  const out = held.after ? 1 : 1 - seg(t, page.end - OUT, page.end, motionCurves.dissolve);
  const size = SIZE * scale;
  return (
    <div
      data-framing="caption"
      data-strength={1}
      style={{
        position: 'absolute', left: '50%', bottom, transform: 'translateX(-50%)', width: 'max-content', maxWidth, opacity: out,
        font: `${WEIGHT} ${size}px/${LINE} ${DISPLAY_FONT}`, color: '#fff', textAlign: 'center',
        // An outline under the fill, so white type holds over a white page as well as a dark one.
        WebkitTextStroke: `${0.07 * size}px rgba(10, 14, 22, 0.9)`, paintOrder: 'stroke fill',
        textShadow: `0 ${4 * scale}px ${18 * scale}px rgba(0, 0, 0, 0.45)`,
      }}
    >
      {page.lines.map((line, j) => (
        <div key={j} style={{ whiteSpace: 'nowrap' }}>
          {line.map((word, i) => {
            const k = popEase(seg(t, word.start, word.start + POP));
            const lit = word.emphasis || (t >= word.start && t < word.end + 0.05);
            return (
              <span key={i}>
                {i > 0 && ' '}
                <span style={{ display: 'inline-block', opacity: Math.min(1, k * 2), transform: `translateY(${(1 - k) * 0.25 * size}px) scale(${0.7 + 0.3 * k})`, color: lit ? '#ffd43b' : undefined }}>
                  {word.key ? <PopKeycap size={size}>{word.text}</PopKeycap> : word.text}{word.trail}
                </span>
              </span>
            );
          })}
        </div>
      ))}
    </div>
  );
}

const PopKeycap = ({ size, children }: { size: number; children: string }) => (
  <span style={{
    font: `700 ${KEY_EM * size}px ${MONO_FONT}`, padding: `0 ${KEY_PAD_EM * KEY_EM * size}px`, borderRadius: 0.2 * size,
    background: 'rgba(255, 255, 255, 0.16)', border: `${0.04 * size}px solid currentColor`, textShadow: 'none', WebkitTextStroke: 0,
  }}>{children}</span>
);
