// shot-paper-pop-up.ts: a paper pop-up as one shot plane: each sheet names its painting once, and the plane and the
// painted textures its sheets print come back together, so a scene passes both to PaintedShot and declares nothing
// twice.

import type { PresentationValue } from '#lib/paint/animation/models/paint-value.ts';
import type { PaintedThreePopUp, PaintedThreePopUpSheet } from '#lib/paint/three-layers/models/painted-three-pop-up.ts';
import type { PaintedThreeSheet } from '#lib/paint/three-layers/models/painted-three-sheet.ts';
import { paintedThreePopUp, type PaintedThreePopUpLook } from '#lib/paint/three-layers/studio/painted-three-pop-up.ts';
import type { PaintedTexture, PlaneProps } from '../models/shot-props.ts';
import type { PaintedSource } from '../models/shot-selection.ts';

/** A sheet as a pop-up plane takes it: its painting (`source`, `widthPx` × `heightPx` of its document) in place of a texture id. */
type PaperPopUpPrinted<S extends PaintedThreeSheet> = Omit<S, 'print'> & { readonly source: PresentationValue<PaintedSource> };

/**
 * A pop-up plane: `id` and `depth` as any plane's; `popUp` as PaintedThreePopUp, its base and each sheet naming its
 * painting; `look` its sheets' backs, leak and lights (PaintedThreePopUpLook).
 */
export type PaperPopUpPlaneOptions = {
  readonly id: string;
  readonly depth: number;
  readonly popUp: Omit<PaintedThreePopUp, 'base' | 'sheets'> & {
    readonly base: PaperPopUpPrinted<PaintedThreeSheet>;
    readonly sheets: readonly PaperPopUpPrinted<PaintedThreePopUpSheet>[];
  };
  readonly look?: PaintedThreePopUpLook;
};

/** The painted texture a sheet prints, `print` its id. */
const paperPopUpTexture = (print: string, { source, widthPx, heightPx }: PaperPopUpPrinted<PaintedThreeSheet>): PaintedTexture => ({ id: print, source, widthPx, heightPx });
/** A sheet without its painting, to take a texture id in its place. */
const paperPopUpUnprinted = <S extends PaintedThreeSheet>({ source: _source, ...sheet }: PaperPopUpPrinted<S>) => sheet;

/**
 * A paper pop-up as a three plane (paintedThreePopUp) and the painted textures its base and sheets print, each named
 * `<plane id>/<sheet id>` (`<plane id>/base` for the base). Pass both to PaintedShot.
 */
export function paperPopUpPlane({ id, depth, popUp: { base, sheets, ...placed }, look }: PaperPopUpPlaneOptions): { plane: PlaneProps; paintedTextures: PaintedTexture[] } {
  const printOf = (sheet: string) => `${id}/${sheet}`;
  const popUp: PaintedThreePopUp = {
    ...placed,
    base: { ...paperPopUpUnprinted(base), print: printOf('base') },
    sheets: sheets.map((sheet) => ({ ...paperPopUpUnprinted(sheet), print: printOf(sheet.id) })),
  };
  return {
    plane: { id, depth, source: { kind: 'three', build: paintedThreePopUp(popUp, look) } },
    paintedTextures: [paperPopUpTexture(printOf('base'), base), ...sheets.map((sheet) => paperPopUpTexture(printOf(sheet.id), sheet))],
  };
}
