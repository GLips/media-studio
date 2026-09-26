// Stand-ins the storyboard frames are drawn with, until each bar is rebuilt on the reel pieces.

import type { CSSProperties, ReactNode } from 'react';
import { DISPLAY_FONT, MONO_FONT, useVideoFormat } from '#studio';
import { P } from './look.ts';

export const Field = ({ color }: { color: string }) => <div style={{ position: 'absolute', inset: 0, background: color }} />;

export const Slam = ({ text, x, y, size, color, stretch = 100, weight = 900, style }: { text: string; x: number; y: number; size: number; color: string; stretch?: number; weight?: number; style?: CSSProperties }) => (
  <div style={{ position: 'absolute', left: x, top: y, font: `${weight} ${size}px/0.84 ${DISPLAY_FONT}`, fontStretch: `${stretch}%`, letterSpacing: '-0.035em', color, whiteSpace: 'nowrap', ...style }}>{text}</div>
);

export function Mono({ text, x, y, size = 15, color = P.cream, align = 'left', style }: { text: string; x: number; y: number; size?: number; color?: string; align?: 'left' | 'right'; style?: CSSProperties }) {
  const { width } = useVideoFormat();
  return <div style={{ position: 'absolute', top: y, ...(align === 'left' ? { left: x } : { right: width - x }), font: `500 ${size}px/1 ${MONO_FONT}`, letterSpacing: '0.12em', textTransform: 'uppercase', color, whiteSpace: 'nowrap', ...style }}>{text}</div>;
}

/** A capture crop on a card in perspective, with a shadow: a stand-in for CapturePlane. */
export function Card({ children, x, y, w, h, rx = 0, ry = 0, rz = 0, shadow = 0.45 }: { children: ReactNode; x: number; y: number; w: number; h: number; rx?: number; ry?: number; rz?: number; shadow?: number }) {
  return (
    <div style={{ position: 'absolute', inset: 0, perspective: 1400 }}>
      <div style={{ position: 'absolute', left: x, top: y, width: w, height: h, transform: `rotateX(${rx}deg) rotateY(${ry}deg) rotateZ(${rz}deg)`, borderRadius: 22, overflow: 'hidden',
        boxShadow: `0 60px 120px rgba(0,0,0,${shadow}), 0 20px 40px rgba(0,0,0,${shadow * 0.6}), inset 0 0 0 1px rgba(255,255,255,0.18)` }}>
        {children}
      </div>
    </div>
  );
}
