// shot-paper-pop-up.ts: a paper pop-up as one shot plane: its prints name their paintings once, every sheet naming
// the print it shows (and any glow map) by key, and the plane and the painted textures come back together, so a scene
// passes both to PaintedShot and declares nothing twice. Many sheets sharing a print share one painted texture.

import type { PresentationValue } from '#lib/paint/animation/models/paint-value.ts';
import type { PaintedThreePopUp, PaintedThreePopUpSheet } from '#lib/paint/three-layers/models/painted-three-pop-up.ts';
import type { PaintedThreeSheet } from '#lib/paint/three-layers/models/painted-three-sheet.ts';
import { paintedThreePopUp, type PaintedThreePopUpLook } from '#lib/paint/three-layers/studio/painted-three-pop-up.ts';
import type { PaintedTexture, PlaneProps } from '../models/shot-props.ts';
import type { PaintedSource } from '../models/shot-selection.ts';

/** A print: its painting (`source`, `widthPx` × `heightPx` of its document). A glow map is one too, black where nothing glows. */
export type PaperPopUpPrint = { readonly source: PresentationValue<PaintedSource>; readonly widthPx: number; readonly heightPx: number };

/** A sheet as a pop-up plane takes it: `print` (and a sheet's `glow`) a key of the plane's prints, its size the print's. */
type PaperPopUpPrinted<S extends PaintedThreeSheet> = Omit<S, 'widthPx' | 'heightPx'>;

/**
 * A pop-up plane: `id` and `depth` as any plane's; `popUp` as PaintedThreePopUp, with `prints` by key, its base and each
 * sheet naming one; `look` its sheets' backs, leak and lights (PaintedThreePopUpLook).
 */
export type PaperPopUpPlaneOptions = {
  readonly id: string;
  readonly depth: number;
  readonly popUp: Omit<PaintedThreePopUp, 'base' | 'sheets'> & {
    readonly prints: Readonly<Record<string, PaperPopUpPrint>>;
    readonly base: PaperPopUpPrinted<PaintedThreeSheet>;
    readonly sheets: readonly PaperPopUpPrinted<PaintedThreePopUpSheet>[];
  };
  readonly look?: PaintedThreePopUpLook;
};

/**
 * A paper pop-up as a three plane (paintedThreePopUp) and the painted textures its prints paint, one per print key,
 * each named `<plane id>/<key>`, however many sheets show it. Pass both to PaintedShot. Refuses a sheet naming a print
 * or glow map that isn't one of its prints.
 */
export function paperPopUpPlane({ id, depth, popUp: { prints, base, sheets, ...placed }, look }: PaperPopUpPlaneOptions): { plane: PlaneProps; paintedTextures: PaintedTexture[] } {
  const textureOf = (key: string) => `${id}/${key}`;
  const printOf = (sheet: string, key: string) => {
    const print = prints[key];
    if (!print) throw new Error(`paper pop-up ${id}: sheet ${sheet} names print ${key}, which isn't one of its prints (${Object.keys(prints).join(', ')})`);
    return print;
  };
  const sized = <S extends PaintedThreeSheet>(sheet: string, each: PaperPopUpPrinted<S>) => {
    const { widthPx, heightPx } = printOf(sheet, each.print);
    return { ...each, print: textureOf(each.print), widthPx, heightPx };
  };
  const popUp: PaintedThreePopUp = {
    ...placed,
    base: sized('base', base),
    sheets: sheets.map((sheet) => {
      if (sheet.glow !== undefined) printOf(sheet.id, sheet.glow);
      return { ...sized(sheet.id, sheet), ...(sheet.glow !== undefined && { glow: textureOf(sheet.glow) }) };
    }),
  };
  return {
    plane: { id, depth, source: { kind: 'three', build: paintedThreePopUp(popUp, look) } },
    paintedTextures: Object.entries(prints).map(([key, { source, widthPx, heightPx }]) => ({ id: textureOf(key), source, widthPx, heightPx })),
  };
}
