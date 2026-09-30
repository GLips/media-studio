// ─── No feature imports a feature that imports it back ────────────────
//
// At any depth: A → B → C → A is a cycle. Each import within one tangle (a
// strongly connected component) is its own finding, keyed by the importee, so a
// new edge is new and cutting one shrinks the baseline. Without cycles, any
// feature can move or be deleted by editing only its importers. No grant makes
// a cycle legal; move what both need into a feature of its own.
//
// Edges come from resolved targets (feature-edges.ts), never specifier text, so
// `#lib/…` and a relative climb are the same edge. How many edges features
// share is deliberately not measured: the right count grows with the studio.

import type { Finding, StructuralCheck } from '../check-context.ts';
import { crossFeatureEdges, type CrossFeatureEdge } from './feature-edges.ts';

const ID = 'feature-cycles';

export const featureCyclesCheck: StructuralCheck = {
  id: ID,
  run(context) {
    const edgesOf = new Map<string, CrossFeatureEdge[]>();
    for (const cross of crossFeatureEdges(context)) {
      edgesOf.set(cross.importer, [...(edgesOf.get(cross.importer) ?? []), cross]);
    }
    const targetsOf = new Map([...edgesOf].map(([feature, edges]) => [feature, new Set(edges.map((edge) => edge.importee))]));
    return stronglyConnectedComponents([...edgesOf.keys()].toSorted(), targetsOf).flatMap((component) => {
      const members = component.toSorted();
      const inCycle = new Set(members);
      return members.flatMap((from) => {
        const firstInto = new Map<string, CrossFeatureEdge>();
        for (const cross of edgesOf.get(from)!) {
          if (inCycle.has(cross.importee) && !firstInto.has(cross.importee)) firstInto.set(cross.importee, cross);
        }
        return [...firstInto].toSorted(([a], [b]) => a.localeCompare(b)).map(([to, { edge }]): Finding => ({
          check: ID, path: from, line: 1, key: `→ ${to}`,
          message: `imports ${to} (first at ${edge.from.path}:${edge.line}), inside the feature cycle ${members.join(' ↔ ')}: move what they share into a feature both import`,
        }));
      });
    });
  },
};

/** Tarjan's: every cycle in one pass, so fixing one never just uncovers the next. Components of one aren't cycles. */
function stronglyConnectedComponents(nodes: readonly string[], targetsOf: ReadonlyMap<string, ReadonlySet<string>>): string[][] {
  const index = new Map<string, number>(), low = new Map<string, number>();
  const stack: string[] = [], onStack = new Set<string>(), components: string[][] = [];
  const visit = (node: string) => {
    index.set(node, index.size);
    low.set(node, index.get(node)!);
    stack.push(node);
    onStack.add(node);
    for (const target of targetsOf.get(node) ?? []) {
      if (!index.has(target)) {
        visit(target);
        low.set(node, Math.min(low.get(node)!, low.get(target)!));
      } else if (onStack.has(target)) {
        low.set(node, Math.min(low.get(node)!, index.get(target)!));
      }
    }
    if (low.get(node) !== index.get(node)) return;
    const component: string[] = [];
    let member: string;
    do {
      member = stack.pop()!;
      onStack.delete(member);
      component.push(member);
    } while (member !== node);
    if (component.length > 1) components.push(component);
  };
  for (const node of nodes) if (!index.has(node)) visit(node);
  return components;
}
