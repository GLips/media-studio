// pill-captions.tsx: the house caption, a page of text in a navy pill at the foot of the frame, fading in and out
// around its words and swapping in place where one page runs into the next.

import { FONT } from '#lib/picture/type/models/faces.ts';
import { motionCurves, seg } from '#lib/picture/motion/models/motion.ts';
import { pillCaptionBand, type CaptionBandRule } from '../models/caption-band.ts';
import { READABLE_CAPTION_RULE, type CaptionPagingRule } from '../models/caption-pages.ts';
import type { CaptionWord } from '../models/caption-track.ts';
import type { CaptionRenderProps, CaptionStyle } from './caption-style.tsx';

const FADE_IN = 0.2, FADE_OUT = 0.15;

/**
 * The pill, by default in the house band with the readable rule. A video whose frame leaves a strip of its own for
 * captions (a walkthrough's screen box) names that `band`, and a `rule` that fits it.
 */
export function pillCaptions({ band = pillCaptionBand, rule }: { band?: CaptionBandRule; rule?: Partial<CaptionPagingRule> } = {}): CaptionStyle {
  return { name: 'pill', rule: { ...READABLE_CAPTION_RULE, ...rule }, band, Caption: PillCaption };
}

function PillCaption({ state: { page, held }, band: { bottom, maxWidth, scale }, t }: CaptionRenderProps) {
  const k = Math.min(held.before ? 1 : seg(t, page.start, page.start + FADE_IN, motionCurves.cubic.entrance), held.after ? 1 : 1 - seg(t, page.end - FADE_OUT, page.end, motionCurves.dissolve));
  return (
    <div
      data-framing="caption"
      data-strength={1}
      style={{
        position: 'absolute',
        left: '50%',
        bottom,
        transform: 'translateX(-50%)',
        maxWidth,
        width: 'max-content',
        padding: `${20 * scale}px ${34 * scale}px`,
        borderRadius: 18 * scale,
        background: 'rgba(14, 22, 36, 0.82)',
        color: '#fff',
        font: `600 ${40 * scale}px/${54 * scale}px ${FONT}`,
        textAlign: 'center',
        opacity: k,
      }}
    >
      {page.lines.map((line, j) => <div key={j}>{line.map((word, i) => <PillWord key={i} word={word} first={i === 0} scale={scale} />)}</div>)}
    </div>
  );
}

function PillWord({ word, first, scale }: { word: CaptionWord; first: boolean; scale: number }) {
  const space = first ? '' : ' ';
  if (word.key) return <>{space}<CaptionKeycap scale={scale}>{word.text}</CaptionKeycap>{word.trail}</>;
  return <>{space}{word.emphasis ? <span style={{ fontWeight: 800, color: '#ffd166' }}>{word.text}</span> : word.text}</>;
}

/** A key as captions draw one, sized to sit in a line of 40 px type at `scale`. */
export function CaptionKeycap({ scale, children }: { scale: number; children: string }) {
  return (
    <span style={{
      font: `600 ${32 * scale}px ui-monospace, Menlo, monospace`, padding: `${2 * scale}px ${12 * scale}px`, borderRadius: 8 * scale,
      border: `${1 * scale}px solid #4a515b`, background: '#1b1f24', color: '#3bc9db', whiteSpace: 'nowrap',
    }}>{children}</span>
  );
}
