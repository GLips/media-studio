import type { PaintingDocument } from '#lib/paint/document/models/painting-document.ts';
import { painting } from '#lib/paint/document/models/painting-source.ts';
import { shotFigure, shotPlace } from '#lib/paint/shot/models/shot-figure.ts';
import type { PlaneProps } from '#lib/paint/shot/models/shot-props.ts';
import { subjectFigureSheet } from '#lib/paint/subject-painting/models/subject-figure-card.ts';
import type { Subject } from '#lib/paint/subject/models/subject.ts';
import { checkLookGraph, type LookStep } from './look-step.ts';

/** Place each visible sheet of a resolved look. The scene supplies the subject's page size and the actor's stage position. */
export function lookPlanes(
  look: { readonly steps: readonly LookStep[]; readonly show: readonly string[] }, subject: Subject,
  size: Pick<PaintingDocument, 'widthPx' | 'heightPx'>, placement: (name: string) => Omit<PlaneProps, 'source'>,
): PlaneProps[] {
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
    const evaluation = painting({ default: () => ({ ...size, paper, medium, layers }) });
    return shotPlace(shotFigure(evaluation, name), placement(name));
  });
}
