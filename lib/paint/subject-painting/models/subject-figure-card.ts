// subject-figure-card.ts: a painted subject made ready to lay over footage. Its figure goes on a figure card (an own
// sheet whose paper covers the silhouette and thins out past it with the paint), so its whites stay and its bleed
// ends as a soft glaze over what's behind; the shadow it casts on the ground stays on the scene's sheet, since the
// ground is the footage's, not the figure's paper.

import type { Key, LayerNode, Paper } from '#lib/paint/document/models/painting-document.ts';
import type { Subject } from '#lib/paint/subject/models/subject.ts';
import type { SubjectPainting } from './paint-subject.ts';
import { subjectAreaRegion } from './subject-document-geometry.ts';
import { subjectUnitPx } from './painters/subject-paint-plan.ts';

/** The painter slot holding paint on the ground the figure stands on (its cast shadow): a figure card leaves it out. */
export const SUBJECT_GROUND_SLOT = 'ground';

/** How far past its silhouette a subject's figure card thins out, as a share of the subject's height: about a watercolour bleed's reach. */
export const SUBJECT_FIGURE_CARD_FADE = 0.015;

/**
 * `painting`'s layers with its figure on a figure card of `paper`, keyed `key`: the ground slot's layers first, then
 * a group on its own sheet holding the rest, its card covering `subject`'s silhouette and thinning `fadePx` past it.
 * A hidden subject's group has no card, so shotFigure still finds `key`.
 */
export function subjectFigureCard(
  subject: Subject, { layers, report }: SubjectPainting, { key, paper, fadePx }: { readonly key: Key; readonly paper: Paper; readonly fadePx?: number },
): LayerNode[] {
  const grounded = new Set([...report.contributions, ...report.replacements].flatMap(({ slot, documentKeys }) => (slot === SUBJECT_GROUND_SLOT ? documentKeys : [])));
  const ground = layers.filter((layer) => grounded.has(layer.key)), figure = layers.filter((layer) => !grounded.has(layer.key));
  if (subject.silhouette.kind === 'hidden') return [...ground, { key, children: figure }];
  const card = { figure: subjectAreaRegion(subject.silhouette.geometry), fadePx: fadePx ?? SUBJECT_FIGURE_CARD_FADE * subjectUnitPx(subject) };
  return [...ground, { key, sheet: { kind: 'own', paper, card }, children: figure }];
}
