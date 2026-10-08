// stamp-paper-contact.ts: how a deposit meets the paper's tooth, from its medium and its brush's media, and what that
// makes of the brush's grain depth by pressure. The compiler, the stamps' load and `studio brushes describe` all ask
// here, so a dry brush in a wet medium is a dry brush to each of them alike.

import type { StampBrushMedia } from '#lib/paint/brush/models/stamp-brush.ts';
import type { PaintMedium } from '#lib/paint/materials/models/paint-medium.ts';

/**
 * How a deposit meets the paper. `peaks`: it catches the peaks above `tooth` of the paper's mean height, deeper as it
 * presses: a dry medium's paint, or a `dryBrush` (a dry-media brush in a wet medium), which skips the valleys,
 * leaving what's there. `valleys`: its paint settles into them. `flat`: flat colour, which the grain cuts alike.
 */
export type StampPaperContact = { kind: 'peaks'; tooth: number; dryBrush: boolean } | { kind: 'valleys' } | { kind: 'flat' };

/** How a brush of `media` meets the paper in `medium` (null: flat colour). */
export function stampBrushPaperContact(medium: PaintMedium | null, media: StampBrushMedia | undefined): StampPaperContact {
  if (!medium) return { kind: 'flat' };
  const { paperContact } = medium;
  if (paperContact.kind === 'peaks') return { kind: 'peaks', tooth: paperContact.tooth, dryBrush: false };
  return media === 'dry' ? { kind: 'peaks', tooth: paperContact.dryBrush.tooth, dryBrush: true } : { kind: 'valleys' };
}

/** Whether `contact` is a dry brush's: a dry-media brush dragged in a wet medium. */
export const isStampDryBrush = (contact: StampPaperContact): boolean => contact.kind === 'peaks' && contact.dryBrush;

/** What owns a stamp's grain response to pressure: the paper's tooth, or the brush (STAMP_PRESSURE_GRAIN_OWNER). */
export type StampGrainDepthSource = 'tooth' | 'brush';

/**
 * Who owns grain by pressure, by paper contact. On the peaks the tooth does (paintDryContact presses into it), so the
 * brush's grain depth by pressure, Photoshop's model of the same, is set aside: kept, Kyle's Nupastel laid nothing at
 * half pressure, and a dry brush in a wet medium would answer pressure twice. Elsewhere the brush owns it.
 */
export const STAMP_PRESSURE_GRAIN_OWNER = { peaks: 'tooth', valleys: 'brush', flat: 'brush' } as const satisfies Record<StampPaperContact['kind'], StampGrainDepthSource>;

/** A stamp's share of its grain's depth (STAMP_MARK.grainDepth), its pressure's share (grainDepthByPressure) taken from `source`. */
export const stampGrainDepthIn = (grainDepth: number, byPressure: number, source: StampGrainDepthSource): number =>
  grainDepth * (source === 'tooth' ? 1 : byPressure);
