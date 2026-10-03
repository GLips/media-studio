// painting-still-request.ts: what a still's page (studio/painting-still-page.ts) is handed and hands back, as JSON
// across the page's boundary (engine/painting-still.ts).

import type { StampBrush } from '#lib/paint/brush/models/stamp-brush.ts';
import type { StampPaintPackUrls } from '#lib/paint/brush-packs/models/stamp-paint-pack-urls.ts';

/**
 * What a still's page is handed: the property values as `--set` wrote them, each brush the document names by
 * `<style>/<brush>`, the packs' URLs, and whether to show each film on its sheet's paper and edge too.
 */
export type PaintingStillRequest = {
  readonly texts: Readonly<Record<string, string>>; readonly brushes: Readonly<Record<string, StampBrush>>; readonly packUrls: StampPaintPackUrls; readonly films: boolean;
};

/**
 * A still as its page returns it: the painting as a PNG data URL, each layer's film when asked, the solve's lines
 * (paintingSolveLines) and what it cost, a line (paintingSolveCostsLine).
 */
export type PaintingStill = {
  readonly png: string; readonly films: readonly { readonly name: string; readonly png: string }[]; readonly lines: readonly string[]; readonly costs: string;
};

/** What a still's page returns: the still, or what the solve refused to paint (a StampSheetRefusal's message). */
export type PaintingStillOutcome = { readonly still: PaintingStill } | { readonly refused: string };
