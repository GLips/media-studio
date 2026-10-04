// workspace-style-brush-numbers.ts: `studio brushes describe`'s reading of a workspace style, its brushes resolved
// from the packs imported on this machine, as a painting resolves them.

import { stampStyleBrushNumbers, type StampStyleBrushNumbers } from '../models/style-brush-numbers.ts';
import { readWorkspaceStampPaintStyle } from './workspace-pigment-style.ts';

/** `name`, a style in `stylesDir`, its roles as numbers to plan by. Throws as readWorkspaceStampPaintStyle does. */
export async function readWorkspaceStyleBrushNumbers(stylesDir: string, name: string): Promise<StampStyleBrushNumbers[]> {
  const { style, resolved } = await readWorkspaceStampPaintStyle(stylesDir, name, 'brushes describe');
  return stampStyleBrushNumbers(resolved, style.brushes);
}
