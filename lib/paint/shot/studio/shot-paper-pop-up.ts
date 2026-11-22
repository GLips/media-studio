// shot-paper-pop-up.ts: a paper pop-up as one shot plane: each card names its painting once, and the plane and the
// painted textures its cards print come back together, so a scene passes both to PaintedShot and declares nothing twice.

import type { PresentationValue } from '#lib/paint/animation/models/paint-value.ts';
import type { PaintedThreeCard } from '#lib/paint/three-layers/models/painted-three-card.ts';
import type { PaintedThreePopUp, PaintedThreePopUpCard } from '#lib/paint/three-layers/models/painted-three-pop-up.ts';
import { paintedThreePopUp, type PaintedThreePopUpLook } from '#lib/paint/three-layers/studio/painted-three-pop-up.ts';
import type { PaintedTexture, PlaneProps } from '../models/shot-props.ts';
import type { PaintedSource } from '../models/shot-selection.ts';

/** A card as a pop-up plane takes it: its painting (`source`, `widthPx` × `heightPx` of its document) in place of a texture id. */
type PaperPopUpPrinted<C extends PaintedThreeCard> = Omit<C, 'print'> & { readonly source: PresentationValue<PaintedSource> };

/**
 * A pop-up plane: `id` and `depth` as any plane's; `popUp` as PaintedThreePopUp, its base and each card naming its
 * painting; `look` its cards' backs, leak and lights (PaintedThreePopUpLook).
 */
export type PaperPopUpPlaneOptions = {
  readonly id: string;
  readonly depth: number;
  readonly popUp: Omit<PaintedThreePopUp, 'base' | 'cards'> & {
    readonly base: PaperPopUpPrinted<PaintedThreeCard>;
    readonly cards: readonly PaperPopUpPrinted<PaintedThreePopUpCard>[];
  };
  readonly look?: PaintedThreePopUpLook;
};

/** The painted texture a card prints, `print` its id. */
const paperPopUpTexture = (print: string, { source, widthPx, heightPx }: PaperPopUpPrinted<PaintedThreeCard>): PaintedTexture => ({ id: print, source, widthPx, heightPx });
/** A card without its painting, to take a texture id in its place. */
const paperPopUpUnprinted = <C extends PaintedThreeCard>({ source: _source, ...card }: PaperPopUpPrinted<C>) => card;

/**
 * A paper pop-up as a three plane (paintedThreePopUp) and the painted textures its base and cards print, each named
 * `<plane id>/<card id>` (`<plane id>/base` for the base). Pass both to PaintedShot.
 */
export function paperPopUpPlane({ id, depth, popUp: { base, cards, ...placed }, look }: PaperPopUpPlaneOptions): { plane: PlaneProps; paintedTextures: PaintedTexture[] } {
  const printOf = (card: string) => `${id}/${card}`;
  const popUp: PaintedThreePopUp = {
    ...placed,
    base: { ...paperPopUpUnprinted(base), print: printOf('base') },
    cards: cards.map((card) => ({ ...paperPopUpUnprinted(card), print: printOf(card.id) })),
  };
  return {
    plane: { id, depth, source: { kind: 'three', build: paintedThreePopUp(popUp, look) } },
    paintedTextures: [paperPopUpTexture(printOf('base'), base), ...cards.map((card) => paperPopUpTexture(printOf(card.id), card))],
  };
}
