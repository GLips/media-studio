import type { PaintingDocument } from '#lib/paint/document/models/painting-document.ts';
import { layersOf } from '#lib/paint/document/models/painting-selection.ts';
import type { PaintMoment } from '#lib/paint/painting/models/stamp-paint-frame-state.ts';
import { painting } from '#lib/paint/document/models/painting-source.ts';
import { shotFigure, shotPlace } from '#lib/paint/shot/models/shot-figure.ts';
import type { PlaneProps } from '#lib/paint/shot/models/shot-props.ts';
import { subjectFigureSheet } from '#lib/paint/subject-painting/models/subject-figure-card.ts';
import type { Subject } from '#lib/paint/subject/models/subject.ts';
import { checkLookGraph, type LookRedraw, type LookStep } from './look-step.ts';

/** A layer whose step redraws on its own schedule. */
type LookSheetRedraw = { readonly key: string; readonly redraw: LookRedraw };

/** Paint the visible sheets in show order, preserving their figure cards for placement or a still. */
export function lookSheets(
  look: { readonly steps: readonly LookStep[]; readonly show: readonly string[] }, subject: Subject,
  size: Pick<PaintingDocument, 'widthPx' | 'heightPx'>,
): { name: string; document: PaintingDocument; redraws: LookSheetRedraw[] }[] {
  checkLookGraph(look.steps, look.show);
  const named = new Map(look.steps.map((step) => [step.name, step]));
  const draws = new Map<string, PaintingDocument['layers']>();
  function layersOfDraw(name: string) {
    const step = named.get(name);
    if (step?.kind !== 'draw') throw new Error(`expected a draw at ${name}`);
    const layers = draws.get(name) ?? step.draw(subject);
    draws.set(name, layers);
    return layers;
  }
  return look.show.map((name) => {
    const place = named.get(name);
    if (place?.kind !== 'place' || !('sheet' in place)) throw new Error(`image placement '${name}' needs image-step composition`);
    const { paper, medium } = place;
    const layers = [subjectFigureSheet(subject, place.sheet.flatMap(layersOfDraw), { paper, key: name })];
    const redraws = place.sheet.flatMap((id) => {
      const step = named.get(id);
      const redraw = step?.kind === 'draw' && step.params.redraw;
      return redraw ? layersOfDraw(id).map((layer) => ({ key: layer.key, redraw })) : [];
    });
    return { name, document: { ...size, paper, medium, layers }, redraws };
  });
}

/** Place each visible sheet at the actor's stage position. */
export function lookPlanes(
  look: { readonly steps: readonly LookStep[]; readonly show: readonly string[] }, subject: Subject,
  size: Pick<PaintingDocument, 'widthPx' | 'heightPx'>, placement: (name: string) => Omit<PlaneProps, 'source'>,
): PlaneProps[] {
  return lookSheets(look, subject, size).map(({ name, document, redraws }) => {
    const evaluation = painting({ default: () => document });
    if (!redraws.length) return shotPlace(shotFigure(evaluation, name), placement(name));
    // A step with its own redraw schedule reseeds only its layers; the rest of the sheet keeps its marks.
    const source = ({ frame }: PaintMoment) => layersOf(evaluation, [name], {
      ground: 'transparent', redraw: new Map(redraws.map(({ key, redraw }) => [key, redraw.at(frame).token])),
    });
    return shotPlace({ kind: 'figure', card: name, source }, placement(name));
  });
}
