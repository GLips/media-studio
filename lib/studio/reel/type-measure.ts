// type-measure.ts: a kinetic type piece's word as the browser sets it, measured once in a hidden SVG, and the face
// and layer styles the pieces draw it with.

import type { CSSProperties } from 'react';
import type { Setting, SetWord } from '#models/reel/type.ts';
import { MONO_CAP_EM, MONO_FONT } from '#models/type/faces.ts';
import { clamp } from '#models/motion/motion.ts';

// Cap height over the em: Archivo's measures 0.686–0.688 at every weight and width; JetBrains Mono's is 730/1000.
const capOfEm = (family: string) => (family === MONO_FONT ? MONO_CAP_EM : 0.687);

// No ligatures: one glyph a character, so every letter has a place of its own.
export const faceStyle = ({ family, weight, stretch }: Setting, size: number): CSSProperties => ({
  fontFamily: family, fontSize: size, fontWeight: weight, fontStretch: `${stretch}%`, fontKerning: 'normal', fontVariantLigatures: 'none',
});

const SVG_NS = 'http://www.w3.org/2000/svg';
const setWords = new Map<string, SetWord>();
let typeProbe: SVGSVGElement | null = null;

// Measured in a hidden SVG of its own under <body>, so no transform around a piece (the Studio's preview scale, a
// camera) reaches the numbers. SVG counts characters in UTF-16 units: one a character for anything a reel sets.
export function measureWord(text: string, setting: Setting): SetWord {
  const size = setting.cap / capOfEm(setting.family);
  const key = JSON.stringify([text, setting.family, size, setting.weight, setting.stretch, setting.spacing]);
  const known = setWords.get(key);
  if (known) return known;
  if (!typeProbe?.isConnected) {
    typeProbe = document.createElementNS(SVG_NS, 'svg');
    typeProbe.setAttribute('style', 'position:absolute;left:0;top:0;width:0;height:0;overflow:hidden;visibility:hidden;pointer-events:none');
    document.body.appendChild(typeProbe);
  }
  const el = document.createElementNS(SVG_NS, 'text');
  Object.assign(el.style, faceStyle(setting, size), { fontSize: `${size}px`, letterSpacing: `${setting.spacing}em`, whiteSpace: 'pre' });
  el.textContent = text;
  typeProbe.appendChild(el);
  const chars = [...text].map((char, i) => {
    const x = el.getStartPositionOfChar(i).x;
    return { char, x, w: el.getEndPositionOfChar(i).x - x };
  });
  el.remove();
  const last = chars.at(-1);
  // The word's box ends at its last letter's advance, without the tracking after it.
  const word = { size, chars, width: last ? last.x + last.w - setting.spacing * size : 0 };
  setWords.set(key, word);
  return word;
}

export const layer: CSSProperties = { position: 'absolute', left: 0, top: 0, overflow: 'visible', pointerEvents: 'none' };

/** `rest` moved along the width axis until its word is `widen` wider. */
export function widerSetting(text: string, rest: Setting, widen: number): Setting {
  if (!widen) return rest;
  const width = measureWord(text, rest).width;
  const guess = clamp(rest.stretch * (1 + widen), 62, 125);
  const guessed = measureWord(text, { ...rest, stretch: guess }).width;
  if (guessed === width) return rest;
  // Advance widths run near linear along the axis, so one secant step lands within a pixel or two.
  return { ...rest, stretch: clamp(rest.stretch + ((guess - rest.stretch) * widen * width) / (guessed - width), 62, 125) };
}
