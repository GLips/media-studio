// painting-placements-packed.ts: painting sources compiled at their values, for their placements alone, packed for
// another process to adopt (stamp-placements-transfer.ts): how a render places its paintings once for all its pages.
// A source that won't load or compile here is left to the pages, which place it themselves. Node only.

import { STUDIO_STYLES_DIR } from '#lib/platform/project/engine/studio-project.ts';
import { readWorkspaceStampPaintStyle } from '#lib/paint/style/engine/workspace-pigment-style.ts';
import type { StampBrush } from '#lib/paint/brush/models/stamp-brush.ts';
import type { ResolvedStampPaintStyle } from '#lib/paint/style/models/style.ts';
import { stampPlacementsShareable } from '#lib/paint/painting/models/stamp-deposit-placement.ts';
import { stampPlacementsFramed, stampPlacementsPacked } from '#lib/paint/painting/models/stamp-placements-transfer.ts';
import { compilePaintingSelection } from '../models/painting-document-compile.ts';
import type { BrushRef } from '../models/painting-document.ts';
import { paintingBrushRefs } from '../models/painting-brush-refs.ts';
import { checkPaintingSourceFile } from './painting-source-load.ts';

/** What packing placements made: the buffer, how many placements it holds, and each source left out, why. */
export type PaintingPlacementsPacked = { readonly buffer: ArrayBuffer; readonly placements: number; readonly skipped: readonly string[] };

/**
 * A placer of painting sources, one at a time (`place`), at their values, as the workspace's styles resolve their
 * brushes; `packed` packs every placement they made.
 */
export function createPaintingPlacer() {
  const styles = new Map<string, Promise<ResolvedStampPaintStyle>>();
  const styleOf = (name: string) => {
    let style = styles.get(name);
    if (!style) styles.set(name, (style = readWorkspaceStampPaintStyle(STUDIO_STYLES_DIR, name, 'placing a render\'s paintings').then(({ resolved }) => resolved)));
    return style;
  };
  const skipped: string[] = [];
  return {
    async place(file: string): Promise<void> {
      try {
        const { evaluation } = await checkPaintingSourceFile(file, {});
        if (!evaluation) return;
        const resolved = new Map(await Promise.all([...new Set(paintingBrushRefs(evaluation.tree).map(({ style }) => style))].map(async (name) => [name, await styleOf(name)] as const)));
        compilePaintingSelection(evaluation, ({ style, brush }: BrushRef): StampBrush => {
          // SAFETY: a style's brushes are StampBrushes by name; a missing one throws below, as a page's would.
          const found = (resolved.get(style)?.brushes as Readonly<Record<string, StampBrush>> | undefined)?.[brush];
          if (!found) throw new Error(`the style ${style} has no brush ${brush}`);
          return found;
        });
      } catch (error) {
        skipped.push(`${file}: ${error instanceof Error ? error.message : String(error)}`);
      }
    },
    packed(): PaintingPlacementsPacked {
      const shared = stampPlacementsShareable();
      return { buffer: stampPlacementsPacked(shared), placements: shared.length, skipped };
    },
  };
}

/** Several placers' packed placements as the pieces to send one after another (stampPlacementsFramed). */
export const paintingPlacementsFramed = (packed: readonly PaintingPlacementsPacked[]): Uint8Array[] => stampPlacementsFramed(packed.map(({ buffer }) => buffer));
