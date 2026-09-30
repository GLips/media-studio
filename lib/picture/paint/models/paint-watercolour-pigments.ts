// paint-watercolour-pigments.ts: a watercolour palette as a painter describes it: a full-strength swatch over white
// and over black, a thin wash's tint where the swatch alone thins wrong, and habits on paper. Fitted to stated facts
// about how these paints look, thin and mix (vid-109's fit, 38 facts with their reasons), not measured; no measured
// or licensed data. Chosen for the watercolor style's references: teals, blues, greens, warm rocks and pine darks,
// which come from phthalo green + sienna and ultramarine + umber, not a black.

import type { PaintPigmentAppearance } from './paint-pigment.ts';

export const WATERCOLOUR_PIGMENTS = {
  // No tint: a lavender or clean-blue one greys ultramarine's yellow and earth mixes (its tint needs it to pass
  // orange-red), at 8, 12 or 16 bands alike. So its tints thin greyer than real ones.
  ultramarine: { id: 'ultramarine', name: 'ultramarine (PB29)', overWhite: '#2b3994', overBlack: '#110d27', granulation: 0.9, flocculation: 0.35, staining: 0.1 },
  phthaloBlue: { id: 'phthaloBlue', name: 'phthalo blue (PB15:3)', overWhite: '#1c4383', overBlack: '#0e0d08', tint: { color: '#67b4e9', strength: 0.15 }, granulation: 0, flocculation: 0, staining: 0.9 },
  cerulean: { id: 'cerulean', name: 'cerulean (PB35)', overWhite: '#3986bc', overBlack: '#385681', tint: { color: '#cddeeb', strength: 0.15 }, granulation: 0.8, flocculation: 0.2, staining: 0.1 },
  // Kowalski's teal lake and pines: turquoise with phthalo blue, emerald with hansa, near-black with burnt sienna.
  phthaloGreen: { id: 'phthaloGreen', name: 'phthalo green (PG7)', overWhite: '#095d51', overBlack: '#041415', tint: { color: '#83cab3', strength: 0.25 }, granulation: 0, flocculation: 0, staining: 0.9 },
  hansaYellow: { id: 'hansaYellow', name: 'hansa yellow (PY97)', overWhite: '#f4c419', overBlack: '#5d6b19', granulation: 0, flocculation: 0, staining: 0.5 },
  // Warm rock, sand and muted greens.
  yellowOchre: { id: 'yellowOchre', name: 'yellow ochre (PY43)', overWhite: '#c89742', overBlack: '#756b36', granulation: 0.3, flocculation: 0.1, staining: 0.2 },
  quinacridoneRose: { id: 'quinacridoneRose', name: 'quinacridone rose (PV19)', overWhite: '#c42c62', overBlack: '#230919', granulation: 0, flocculation: 0, staining: 0.8 },
  cadmiumRed: { id: 'cadmiumRed', name: 'cadmium red (PR108)', overWhite: '#d12e22', overBlack: '#812519', tint: { color: '#f5b4a2', strength: 0.25 }, granulation: 0.15, flocculation: 0, staining: 0.2 },
  burntSienna: { id: 'burntSienna', name: 'burnt sienna (PBr7)', overWhite: '#9c4d26', overBlack: '#1a1e1f', granulation: 0.4, flocculation: 0.1, staining: 0.3 },
  burntUmber: { id: 'burntUmber', name: 'burnt umber (PBr7)', overWhite: '#5c412f', overBlack: '#1b1b1e', granulation: 0.8, flocculation: 0.25, staining: 0.3 },
} as const satisfies Record<string, PaintPigmentAppearance>;
