import type { LayerNode, PaintingDocument } from '#lib/paint/document/models/painting-document.ts';
import { layersOf } from '#lib/paint/document/models/painting-selection.ts';
import type { PaintMoment } from '#lib/paint/painting/models/stamp-paint-frame-state.ts';
import { painting, type PaintingEvaluation } from '#lib/paint/document/models/painting-source.ts';
import { shotFigure, shotPlace } from '#lib/paint/shot/models/shot-figure.ts';
import type { PlaneProps } from '#lib/paint/shot/models/shot-props.ts';
import { subjectFigureSheet } from '#lib/paint/subject-painting/models/subject-figure-card.ts';
import type { Subject } from '#lib/paint/subject/models/subject.ts';
import { drawingSchedule, type RedrawToken } from '#lib/timing/drawings/models/drawing-schedule.ts';
import { checkLookGraph, type LookRedraw, type LookStep } from './look-step.ts';

/** A layer whose step redraws on its own schedule. */
type LookSheetRedraw = { readonly key: string; readonly redraw: LookRedraw };

type LookGraph = { readonly steps: readonly LookStep[]; readonly show: readonly string[] };

/** The token a draw with no redraw schedule, or one painted with no moment, deals its marks by: one drawing held throughout. */
const LOOK_HELD_TOKEN: RedrawToken = drawingSchedule('held').at(0).token;

/**
 * Paint the visible sheets in show order, preserving their figure cards for placement or a still. A sheet placed with
 * `card: 'none'` is its group alone, on no card. `at` (scene seconds) resolves each draw's redraw token, which the
 * draw deals its own choices by; left out, every draw deals by the held token.
 */
export function lookSheets(
  look: LookGraph, subject: Subject, size: Pick<PaintingDocument, 'widthPx' | 'heightPx'>, { at }: { readonly at?: number } = {},
): { name: string; document: PaintingDocument; redraws: LookSheetRedraw[] }[] {
  checkLookGraph(look.steps, look.show);
  const named = new Map(look.steps.map((step) => [step.name, step]));
  const draws = new Map<string, PaintingDocument['layers']>();
  function layersOfDraw(name: string) {
    const step = named.get(name);
    if (step?.kind !== 'draw') throw new Error(`expected a draw at ${name}`);
    const { redraw } = step.params;
    const layers = draws.get(name) ?? step.draw(subject, redraw && at !== undefined ? redraw.at(at).token : LOOK_HELD_TOKEN);
    draws.set(name, layers);
    return layers;
  }
  return look.show.map((name) => {
    const place = named.get(name);
    if (place?.kind !== 'place' || !('sheet' in place)) throw new Error(`image placement '${name}' needs image-step composition`);
    const { paper, medium } = place;
    const children = place.sheet.flatMap(layersOfDraw);
    const sheet: LayerNode = place.card === 'none' ? { key: name, children } : subjectFigureSheet(subject, children, { paper, key: name });
    const redraws = place.sheet.flatMap((id) => {
      const step = named.get(id);
      const redraw = step?.kind === 'draw' && step.params.redraw;
      return redraw ? layersOfDraw(id).map((layer) => ({ key: layer.key, redraw })) : [];
    });
    return { name, document: { ...size, paper, medium, layers: [sheet] }, redraws };
  });
}

/**
 * Place each visible sheet at the actor's stage position as a figure: a sheet on no card is a figure of its paint
 * alone. A sheet holding a redrawn step is painted again for each set of tokens its frames show.
 */
export function lookPlanes(
  look: LookGraph, subject: Subject, size: Pick<PaintingDocument, 'widthPx' | 'heightPx'>, placement: (name: string) => Omit<PlaneProps, 'source'>,
): PlaneProps[] {
  return lookSheets(look, subject, size).map(({ name, document, redraws }) => {
    if (!redraws.length) return shotPlace(shotFigure(painting({ default: () => document }), name), placement(name));
    // Each token set's sheet is painted once: a draw dealing its own marks needs them dealt again, and seeking back
    // to a token set reuses the evaluation it made.
    const evaluations = new Map<string, PaintingEvaluation>();
    const evaluationAt = (frame: number) => {
      const key = JSON.stringify(redraws.map(({ redraw }) => redraw.at(frame).token));
      const known = evaluations.get(key);
      if (known) return known;
      const [sheet] = lookSheets({ steps: look.steps, show: [name] }, subject, size, { at: frame });
      const made = painting({ default: () => sheet.document });
      evaluations.set(key, made);
      return made;
    };
    // A step with its own redraw schedule reseeds only its layers; the rest of the sheet keeps its marks.
    const source = ({ frame }: PaintMoment) => layersOf(evaluationAt(frame), [name], {
      ground: 'transparent', redraw: new Map(redraws.map(({ key, redraw }) => [key, redraw.at(frame).token])),
    });
    return shotPlace({ kind: 'figure', card: name, source }, placement(name));
  });
}
