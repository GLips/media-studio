import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { LayerNode } from '#lib/paint/document/models/painting-document.ts';
import { SUBJECT_HIDDEN, subjectVisible } from '#lib/paint/subject/models/subject-geometry.ts';
import { defineSubject } from '#lib/paint/subject/models/subject.ts';
import { paintSubject, requireSubjectPainting } from './paint-subject.ts';
import { defineSubjectPainter } from './subject-painter.ts';
import { SUBJECT_FIGURE_CARD_FADE, subjectFigureCard } from './subject-figure-card.ts';

const ring = [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 100 }, { x: 0, y: 100 }];
const post = defineSubject({
  id: 'post', materials: [{ id: 'wood', localColor: '#8a5a30' }],
  parts: [{ id: 'pole', material: 'wood', visibility: subjectVisible({ rings: [ring] }) }], silhouette: subjectVisible({ rings: [ring] }),
});

const layerOf = (key: string): LayerNode => ({ key, washes: [] });
/** A painter laying a shadow on the ground and a form wash, a layer each. */
const groundAndForm = defineSubjectPainter<object>()({
  id: 'ground-and-form', evidence: [], defaults: {}, slots: ['ground', 'form'], replaceAllAt: 'form', controls: [], intents: [],
  paint: (context) => (['ground', 'form'] as const).map((slot) => ({ key: context.paintKey(slot), slot, targets: [context.paintedParts(slot)[0].ref], layers: [layerOf(context.paintKey(slot))] })),
});

test("a subject's figure card holds all it paints but its ground, round its silhouette, fading a share of its height", () => {
  const paper = { color: '#f4f2ed', absorbency: 0.5 } as const;
  const [ground, card] = subjectFigureCard(post, requireSubjectPainting(paintSubject(post, groundAndForm)), { key: 'post-card', paper });
  assert.equal(ground.key, 'post.ground');
  assert.deepEqual(card, {
    key: 'post-card', sheet: { kind: 'own', paper, card: { figure: { kind: 'polygon', rings: [ring] }, fadePx: SUBJECT_FIGURE_CARD_FADE * 100 } }, children: [layerOf('post.form')],
  });
});

test("a hidden subject's figure is still a group keyed as its card would be, on no card, so a shot names it at every moment", () => {
  const paper = { color: '#f4f2ed', absorbency: 0.5 } as const, painted = requireSubjectPainting(paintSubject(post, groundAndForm));
  assert.deepEqual(subjectFigureCard({ ...post, silhouette: SUBJECT_HIDDEN }, painted, { key: 'post-card', paper }), [layerOf('post.ground'), { key: 'post-card', children: [layerOf('post.form')] }]);
});
