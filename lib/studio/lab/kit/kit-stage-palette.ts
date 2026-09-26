// kit-stage-palette.ts: the colours a Kit pieces stage lets a piece take, by name, for its colour choices.
import { LAB_COLORS } from '../lab-format.ts';

/** Showcase colours a piece's stroke, heading or accent can take. */
export const KIT_ACCENT_OPTIONS = [
  { value: LAB_COLORS.red, label: 'Red-orange' },
  { value: LAB_COLORS.cobalt, label: 'Cobalt' },
  { value: LAB_COLORS.cream, label: 'Cream' },
  { value: LAB_COLORS.pass, label: 'Green' },
] as const;

export type KitAccentColor = (typeof KIT_ACCENT_OPTIONS)[number]['value'];

/** Grounds for the cards that draw white type (Text's default), so all of them are dark. */
export const KIT_DARK_GROUND_OPTIONS = [
  { value: LAB_COLORS.ink, label: 'Ink' },
  { value: '#1d1f7a', label: 'Deep cobalt' },
  { value: '#b8330f', label: 'Deep red' },
] as const;

export type KitDarkGround = (typeof KIT_DARK_GROUND_OPTIONS)[number]['value'];
