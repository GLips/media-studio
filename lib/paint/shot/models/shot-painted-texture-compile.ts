// shot-painted-texture-compile.ts: a shot's painted textures (ENGINE 6.3) checked and compiled as the shot loads,
// before they're drawn (shot-painted-textures.ts): each id once, a size in whole px, and a source a painted source on
// its paper, every painting it blends wrapping alike. A texture is opaque, so a transparent ground has nothing to show
// through to; and it repeats across u, v, both or neither, so a dissolve can't blend paintings that wrap otherwise.
// How it wraps is read at moment 0 and held: a callback's source is checked again at each moment.

import { paintingErrors, paintingProblem, type PaintingProblem } from '#lib/paint/document/models/painting-problem.ts';
import { paintMoment, type PaintMoment } from '#lib/paint/painting/models/stamp-paint-frame-state.ts';
import type { StampWrap } from '#lib/paint/painting/models/stamp-stage.ts';
import { shotPresentationAt, type PaintedTexture } from './shot-props.ts';
import { paintedSourceEnds, paintedSourceProblems, type PaintedSource } from './shot-selection.ts';

/**
 * A painted texture compiled: as written, and `wrap`, how it repeats (u along x, v along y; null: neither), as its
 * source read at moment 0.
 */
export type CompiledShotPaintedTexture = PaintedTexture & { readonly wrap: StampWrap | null };

/** Whether `source` blends paintings that wrap otherwise than each other, at any weight: no texture can draw that. */
const paintedSourceWrapsMixed = (source: PaintedSource) => new Set(paintedSourceEnds(source).map(({ selection }) => selection.painting.document.wrap ?? null)).size > 1;

/** How the texture of `source`, one whose paintings all wrap alike (paintedSourceWrapsMixed false), wraps. */
const paintedSourceWrap = (source: PaintedSource): StampWrap | null => paintedSourceEnds(source)[0].selection.painting.document.wrap ?? null;

/** How a texture wrapping as `wrap` repeats, in a problem's words. */
const PAINTED_WRAP_TEXT: Readonly<Record<StampWrap | 'none', string>> = { none: "doesn't wrap", x: 'wraps across x', y: 'wraps across y', xy: 'wraps both ways' };
const paintedWrapText = (wrap: StampWrap | null) => PAINTED_WRAP_TEXT[wrap ?? 'none'];

/**
 * Problems in painted texture `id`'s `source` as read at one moment: a painted source's (paintedSourceProblems), a
 * selection on a transparent ground, and paintings that wrap otherwise than each other.
 */
function paintedTextureSourceProblems(id: string, source: PaintedSource): PaintingProblem[] {
  const problems = paintedSourceProblems(id, source);
  if (paintedSourceEnds(source).some(({ selection }) => selection.ground === 'transparent')) {
    problems.push(paintingProblem('error', id, 'source', "selects on a transparent ground: a painted texture is opaque, shown on its paintings' paper"));
  }
  if (paintedSourceWrapsMixed(source)) problems.push(paintingProblem('error', id, 'source', 'blends paintings that wrap otherwise: a texture repeats across u, v, both or neither, as all it blends do'));
  return problems;
}

/**
 * A shot's painted `textures` compiled, and every problem keeping it from drawing them: an id used twice, a size that
 * isn't whole px above 0, and each source's at moment 0, as a callback is read there first. `textures` is null when
 * one is an error.
 */
export function compileShotPaintedTextures(textures: readonly PaintedTexture[]): { readonly textures: readonly CompiledShotPaintedTexture[] | null; readonly problems: readonly PaintingProblem[] } {
  const problems: PaintingProblem[] = [], seen = new Set<string>();
  const compiled = textures.map((texture): CompiledShotPaintedTexture => {
    const { id, widthPx, heightPx } = texture;
    if (seen.has(id)) problems.push(paintingProblem('error', id, 'id', 'names two painted textures: an id names one'));
    seen.add(id);
    for (const [field, px] of [['widthPx', widthPx], ['heightPx', heightPx]] as const) {
      if (!(Number.isInteger(px) && px > 0)) problems.push(paintingProblem('error', id, field, `is ${px}: a painted texture is whole px above 0`));
    }
    const first = shotPresentationAt(texture.source, paintMoment(0)), found = paintedTextureSourceProblems(id, first);
    problems.push(...found);
    return { ...texture, wrap: paintingErrors(found).length ? null : paintedSourceWrap(first) };
  });
  return { textures: paintingErrors(problems).length ? null : compiled, problems };
}

/**
 * Compiled `texture`'s source at `moment`, and its problems there: a callback's checked again, and refused wrapping
 * otherwise than at moment 0; a constant one was checked as it compiled.
 */
export function compiledPaintedTextureSourceAt(texture: CompiledShotPaintedTexture, moment: PaintMoment): { readonly source: PaintedSource; readonly problems: readonly PaintingProblem[] } {
  const source = shotPresentationAt(texture.source, moment);
  if (typeof texture.source !== 'function') return { source, problems: [] };
  const problems = paintedTextureSourceProblems(texture.id, source);
  if (!paintingErrors(problems).length && paintedSourceWrap(source) !== texture.wrap) {
    problems.push(paintingProblem('error', texture.id, 'source', `${paintedWrapText(texture.wrap)} at 0 s, and at ${moment.at} s ${paintedWrapText(paintedSourceWrap(source))}: a texture repeats as it did at 0 s, for all time`));
  }
  return { source, problems };
}
