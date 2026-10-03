// painting-summary.ts: an evaluation as `studio paint check` prints it once it's clean: the document, then its tree,
// each node with its medium and sheet, and each layer's washes with their clocks and application counts.

import { paintingSheetName } from './painting-tree.ts';
import type { PaintingEvaluation } from './painting-source.ts';

const count = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;

/** `evaluation` as lines: a header, then a line per layer and group, indented by depth. */
export function paintingEvaluationSummary({ source, values, document: paintingDocument, tree }: PaintingEvaluation): string[] {
  const shown = Object.entries(values).map(([name, value]) => `${name} ${String(value)}`).join(', ');
  const header = `${source}${shown ? ` (${shown})` : ''}: ${paintingDocument.widthPx} × ${paintingDocument.heightPx} px, ${paintingDocument.medium}, on ${paintingDocument.paper.color} paper`;
  return [header, ...tree.nodes.map((place) => {
    const indent = '  '.repeat(place.groups.length + 1), where = `${place.medium}, on ${paintingSheetName(place.sheet)}`;
    if (place.kind === 'group') return `${indent}${place.node.key}: group of ${count(place.node.children.length, 'node')}, ${where}`;
    const washes = place.node.washes.map((wash) => {
      const clock = wash.clock ? `, clocked from ${wash.clock.origin === 'set' ? 'set' : `${wash.clock.origin} s`} at ${wash.clock.dryingScale}` : '';
      const direct = wash.wetHistory === false ? ', direct' : '';
      return `${wash.key} (${count(wash.applications.length, 'application')}${direct}${clock})`;
    });
    return `${indent}${place.node.key}: layer, ${where}: ${washes.join(', ') || 'no washes'}`;
  })];
}
