// subject-paint-colour.ts: the colour arithmetic every subject painter derives its shades, lights and tints with,
// channel by channel on `#rrggbb` as the subject holds a local colour. Pigment mixing stays the medium's: these only
// pick the colours a painter asks it to lay.

import type { SubjectHex } from '#lib/paint/subject/models/subject.ts';

const hexChannels = (hex: SubjectHex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);

const channelsHex = (rgb: readonly number[]): SubjectHex =>
  `#${rgb.map((c) => Math.round(Math.max(0, Math.min(1, c)) * 255).toString(16).padStart(2, '0')).join('')}`;

/** `hex` moved `share` of the way toward `toward`, channel by channel. */
export function blendSubjectHex(hex: SubjectHex, toward: SubjectHex, share: number): SubjectHex {
  const a = hexChannels(hex), b = hexChannels(toward);
  return channelsHex(a.map((c, i) => c + (b[i] - c) * share));
}

/** Relative luminance, 0..1, by Rec. 709 weights on the channels as written. */
export function subjectHexLuminance(hex: SubjectHex): number {
  const [r, g, b] = hexChannels(hex);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** `hex` moved `share` of the way to the grey of its own luminance: a less saturated local colour. */
export function mutedSubjectHex(hex: SubjectHex, share: number): SubjectHex {
  const grey = Math.round(subjectHexLuminance(hex) * 255).toString(16).padStart(2, '0');
  return blendSubjectHex(hex, `#${grey}${grey}${grey}`, share);
}
