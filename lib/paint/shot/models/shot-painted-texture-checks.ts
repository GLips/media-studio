// shot-painted-texture-checks.ts: what a shot's painted textures (ENGINE 6.3) must be before they're drawn
// (shot-painted-textures.ts): each id once, a size in whole px, and a source a painted source on its paper, every
// painting it blends wrapping alike. A texture is opaque, so a transparent ground has nothing to show through to; and
// it repeats across u or doesn't, so a dissolve can't blend a painting that wraps with one that doesn't.

import { paintingProblem, type PaintingProblem } from '#lib/paint/document/models/painting-problem.ts';
import type { LayerSelection } from '#lib/paint/document/models/painting-selection.ts';
import { paintMoment, type PaintMoment } from '#lib/paint/painting/models/stamp-paint-frame-state.ts';
import type { PaintedTexture } from './shot-props.ts';
import { paintedSourceProblems, type PaintedSource } from './shot-selection.ts';

/** `texture`'s source at `moment`: a constant as it is, a callback called. */
export const paintedTextureSourceAt = ({ source }: PaintedTexture, moment: PaintMoment): PaintedSource =>
  typeof source === 'function' ? source(moment) : source;

/** Every selection `source` names, a dissolve's ends at any weight. */
function paintedSourceSelections(source: PaintedSource): LayerSelection[] {
  return source.kind === 'layers' ? [source] : [...paintedSourceSelections(source.a), ...paintedSourceSelections(source.b)];
}

/**
 * How the texture of `source` wraps: 'x' when every painting it names wraps, null when none does, 'mixed' when they
 * differ, which no texture can draw.
 */
export function paintedSourceWrap(source: PaintedSource): 'x' | null | 'mixed' {
  const wraps = new Set(paintedSourceSelections(source).map(({ painting }) => painting.document.wrap ?? null));
  return wraps.size > 1 ? 'mixed' : (wraps.values().next().value ?? null);
}

/**
 * Problems in painted texture `id`'s `source` as read at one moment: a painted source's (paintedSourceProblems), a
 * selection on a transparent ground, and paintings that wrap mixed with ones that don't.
 */
export function paintedTextureSourceProblems(id: string, source: PaintedSource): PaintingProblem[] {
  const problems = paintedSourceProblems(id, source);
  if (paintedSourceSelections(source).some(({ ground }) => ground === 'transparent')) {
    problems.push(paintingProblem('error', id, 'source', "selects on a transparent ground: a painted texture is opaque, shown on its paintings' paper"));
  }
  if (paintedSourceWrap(source) === 'mixed') problems.push(paintingProblem('error', id, 'source', 'blends a painting that wraps with one that doesn\'t: a texture repeats across u or doesn\'t'));
  return problems;
}

/**
 * Every problem in a shot's painted `textures` that keeps it from drawing them: an id used twice, a size that isn't
 * whole px above 0, and each source's at moment 0 (paintedTextureSourceProblems), as a callback is read there first.
 */
export function shotPaintedTexturesProblems(textures: readonly PaintedTexture[]): PaintingProblem[] {
  const problems: PaintingProblem[] = [], seen = new Set<string>();
  for (const texture of textures) {
    const { id, widthPx, heightPx } = texture;
    if (seen.has(id)) problems.push(paintingProblem('error', id, 'id', 'names two painted textures: an id names one'));
    seen.add(id);
    for (const [field, px] of [['widthPx', widthPx], ['heightPx', heightPx]] as const) {
      if (!(Number.isInteger(px) && px > 0)) problems.push(paintingProblem('error', id, field, `is ${px}: a painted texture is whole px above 0`));
    }
    problems.push(...paintedTextureSourceProblems(id, paintedTextureSourceAt(texture, paintMoment(0))));
  }
  return problems;
}
