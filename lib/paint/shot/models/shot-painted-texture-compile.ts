// shot-painted-texture-compile.ts: a shot's painted textures (ENGINE 6.3) checked and compiled as the shot loads,
// before they're drawn (shot-painted-textures.ts): each id once, a size in whole px, and a source a painted source on
// its paper, every painting it blends wrapping alike. A texture is opaque, so a transparent ground has nothing to show
// through to; and it repeats across u or doesn't, so a dissolve can't blend a painting that wraps with one that
// doesn't. Whether it wraps is read at moment 0 and held: a callback's source is checked again at each moment.

import { paintingErrors, paintingProblem, type PaintingProblem } from '#lib/paint/document/models/painting-problem.ts';
import type { LayerSelection } from '#lib/paint/document/models/painting-selection.ts';
import { paintMoment, type PaintMoment } from '#lib/paint/painting/models/stamp-paint-frame-state.ts';
import type { PaintedTexture } from './shot-props.ts';
import { paintedSourceProblems, type PaintedSource } from './shot-selection.ts';

/** A painted texture compiled: as written, and `wrap`, whether it repeats across u, as its source read at moment 0. */
export type CompiledShotPaintedTexture = PaintedTexture & { readonly wrap: 'x' | null };

/** Every selection `source` names, a dissolve's ends at any weight. */
function paintedSourceSelections(source: PaintedSource): LayerSelection[] {
  return source.kind === 'layers' ? [source] : [...paintedSourceSelections(source.a), ...paintedSourceSelections(source.b)];
}

/** Whether `source` blends a painting that wraps with one that doesn't, at any weight: no texture can draw that. */
const paintedSourceWrapsMixed = (source: PaintedSource) => new Set(paintedSourceSelections(source).map(({ painting }) => painting.document.wrap ?? null)).size > 1;

/** How the texture of `source`, one whose paintings all wrap alike (paintedSourceWrapsMixed false), wraps: 'x' or null. */
const paintedSourceWrap = (source: PaintedSource): 'x' | null => paintedSourceSelections(source)[0].painting.document.wrap ?? null;

/**
 * Problems in painted texture `id`'s `source` as read at one moment: a painted source's (paintedSourceProblems), a
 * selection on a transparent ground, and paintings that wrap mixed with ones that don't.
 */
function paintedTextureSourceProblems(id: string, source: PaintedSource): PaintingProblem[] {
  const problems = paintedSourceProblems(id, source);
  if (paintedSourceSelections(source).some(({ ground }) => ground === 'transparent')) {
    problems.push(paintingProblem('error', id, 'source', "selects on a transparent ground: a painted texture is opaque, shown on its paintings' paper"));
  }
  if (paintedSourceWrapsMixed(source)) problems.push(paintingProblem('error', id, 'source', "blends a painting that wraps with one that doesn't: a texture repeats across u or doesn't"));
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
    const first = typeof texture.source === 'function' ? texture.source(paintMoment(0)) : texture.source, found = paintedTextureSourceProblems(id, first);
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
  if (typeof texture.source !== 'function') return { source: texture.source, problems: [] };
  const source = texture.source(moment), problems = paintedTextureSourceProblems(texture.id, source);
  if (!paintingErrors(problems).length && paintedSourceWrap(source) !== texture.wrap) {
    problems.push(paintingProblem('error', texture.id, 'source', `${texture.wrap ? 'wraps' : "doesn't wrap"} at 0 s, and at ${moment.at} s ${texture.wrap ? "doesn't" : 'does'}: a texture repeats across u or doesn't, for all time`));
  }
  return { source, problems };
}
