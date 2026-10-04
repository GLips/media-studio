// painting-still.ts: a painting source solved and shown, for `studio paint still` and `studio paint check --solve`.
// Checked first as `studio paint check` checks it; then its brushes and paper resolved from work/styles/ and handed,
// with the values, to studio/painting-still-page.ts, which bundles the source in, solves its sheets on the GPU and
// returns the painting (and each film alone over the paper) as PNGs, with what each sheet's solve decided; and those
// written. Every sheet's paper is resolved, each own sheet's too.

import { mkdirSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { withBrowserModulePage } from '#lib/platform/browser/engine/browser-module-page.ts';
import { STUDIO_STYLES_DIR } from '#lib/platform/project/engine/studio-project.ts';
import { paintingBrushRefs } from '../models/painting-brush-refs.ts';
import type { PaintingProblem } from '../models/painting-problem.ts';
import { PAINTING_SOURCE_SUFFIX } from '../models/painting-source.ts';
import type { PaintingStill, PaintingStillOutcome, PaintingStillRequest } from '../models/painting-still-request.ts';
import { checkPaintingSourceFile, paintingStylesBrushOf, readPaintingSourceStyles } from './painting-source-load.ts';

const STILL_PAGE = fileURLToPath(new URL('../studio/painting-still-page.ts', import.meta.url));

/**
 * A still's run: the source's problems; its still when none is an error and the solve painted it; else what the solve
 * refused, when it got that far.
 */
export type PaintingStillRun = { readonly problems: readonly PaintingProblem[]; readonly still: PaintingStill | null; readonly refused: string | null };

/**
 * The source at `file` at the values `texts` give by name, painted against this machine's styles; `films`: each alone
 * too; `at`: only the prefix landing by that scene second (null for all of it); `dampWindows`: its lines with them.
 */
export async function paintPaintingSourceStill(
  file: string, texts: Readonly<Record<string, string>>, { films, at, dampWindows }: { films: boolean; at: number | null; dampWindows: boolean },
): Promise<PaintingStillRun> {
  const { problems, evaluation } = await checkPaintingSourceFile(file, texts);
  if (!evaluation) return { problems, still: null, refused: null };
  const styles = await readPaintingSourceStyles([evaluation], 'paint still'), brushOf = paintingStylesBrushOf(styles);
  const request: PaintingStillRequest = {
    texts, films, at, dampWindows,
    brushes: Object.fromEntries(paintingBrushRefs(evaluation.tree).map((ref) => [`${ref.style}/${ref.brush}`, brushOf(ref)])),
    packUrls: Object.fromEntries([...styles.values()].flatMap(({ packUrls }) => Object.entries(packUrls))),
  };
  const outcome = await withBrowserModulePage(
    { entry: STILL_PAGE, filesDir: STUDIO_STYLES_DIR, alias: { '@painting-source': resolve(file) } },
    (call) => call<PaintingStillOutcome>('drawPaintingStill', request),
  );
  return 'still' in outcome ? { problems, still: outcome.still, refused: null } : { problems, still: null, refused: outcome.refused };
}

/** A source file's name without `.painting.ts` (or `.ts`): its outputs' default stem. */
export function paintingSourceStem(file: string): string {
  const name = basename(file);
  return name.endsWith(PAINTING_SOURCE_SUFFIX) ? name.slice(0, -PAINTING_SOURCE_SUFFIX.length) : name.replace(/\.ts$/, '');
}

/** A still's PNG, as its page hands it back (a data URL), written to `file`. */
export function writePaintingStillPng(file: string, url: string) {
  writeFileSync(file, Buffer.from(url.slice(url.indexOf(',') + 1), 'base64'));
}

/** `still`'s painting and each film written under `out`: `painting.png` and `films/<layer>.png`. Where it wrote them. */
export function writePaintingSolveImages(still: PaintingStill, out: string): { painting: string; films: string } {
  const painting = join(out, 'painting.png'), films = join(out, 'films');
  mkdirSync(films, { recursive: true });
  writePaintingStillPng(painting, still.png);
  for (const { name, png } of still.films) writePaintingStillPng(join(films, `${name}.png`), png);
  return { painting, films };
}
