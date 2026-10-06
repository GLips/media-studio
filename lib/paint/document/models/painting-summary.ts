// painting-summary.ts: an evaluation as `studio paint check` prints it once it's clean: the document, then its tree,
// each node with its medium and sheet, and each layer's washes with their clocks and application counts; and what the
// check left to a solve.

import type { AnyApplication } from './painting-document.ts';
import { paintingApplicationOwner } from './painting-problem.ts';
import { paintingSheetName } from './painting-tree.ts';
import type { PaintingEvaluation } from './painting-source.ts';

const count = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;

/** `evaluation` as lines: a header, then a line per layer and group, indented by depth. */
export function paintingEvaluationSummary({ source, values, document: paintingDocument, tree }: PaintingEvaluation): string[] {
  const shown = Object.entries(values).map(([name, value]) => `${name} ${String(value)}`).join(', ');
  const scale = paintingDocument.dryingScale === undefined ? '' : ` at dryingScale ${paintingDocument.dryingScale}`;
  const header = `${source}${shown ? ` (${shown})` : ''}: ${paintingDocument.widthPx} × ${paintingDocument.heightPx} px, ${paintingDocument.medium}, on ${paintingDocument.paper.color} paper${scale}`;
  return [header, ...tree.nodes.map((place) => {
    const own = place.node.sheet?.kind === 'own' && place.node.sheet.dryingScale !== undefined ? ` at dryingScale ${place.node.sheet.dryingScale}` : '';
    const indent = '  '.repeat(place.groups.length + 1), where = `${place.medium}, on ${paintingSheetName(place.sheet)}${own}`;
    if (place.kind === 'group') return `${indent}${place.node.key}: group of ${count(place.node.children.length, 'node')}, ${where}`;
    const washes = place.node.washes.map((wash) => {
      const clock = wash.clock ? `, clocked from ${wash.clock.origin === 'set' ? 'set' : `${wash.clock.origin} s`}` : '';
      const direct = wash.wetHistory === false ? ', direct' : '';
      return `${wash.key} (${count(wash.applications.length, 'application')}${direct}${clock})`;
    });
    return `${indent}${place.node.key}: layer, ${where}: ${washes.join(', ') || 'no washes, clear'}`;
  })];
}

/**
 * What the check of `evaluation` left to a solve, as its summary says it: the `on`s it didn't find can never hold
 * (it reads the water each application states, never the paper as it is when one lands); null for none.
 */
export function paintingCheckLeftToSolve({ tree, warnings }: PaintingEvaluation): string | null {
  const neverHold = new Set(warnings.filter(({ field }) => field === 'on').map(({ owner }) => owner));
  const gates = tree.layers.flatMap(({ node }) => node.washes).reduce((sum, wash) => {
    const applications: readonly AnyApplication[] = wash.applications;
    return sum + applications.filter((application, i) => 'on' in application && application.on !== undefined && !neverHold.has(paintingApplicationOwner(wash, application, i))).length;
  }, 0);
  return gates ? `${count(gates, '`on` gate')} not checked: --solve decides ${gates === 1 ? 'it' : 'them'}` : null;
}
