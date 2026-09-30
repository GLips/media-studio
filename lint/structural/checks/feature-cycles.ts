// ─── No feature imports a feature that imports it back ────────────────
//
// At any depth: A → B → C → A is one cycle, reported once with every member.
// While features form no cycle, any one of them can move or be deleted by
// editing only its importers. No visibility grant makes a cycle legal; the fix
// is to move what both need into a feature of its own.
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
    return stronglyConnectedComponents([...edgesOf.keys()].sort(), targetsOf).map((component): Finding => {
      const members = [...component].sort();
      const inCycle = new Set(members);
      const pairs = members.flatMap((from) => [...(targetsOf.get(from) ?? [])].filter((to) => inCycle.has(to)).sort().map((to) => `${from} → ${to}`));
      // Filed on the first member's first file into the cycle, so one cycle keeps one address run to run and sits on
      // a source file (a feature's folder classifies as nothing).
      const anchor = edgesOf.get(members[0])!
        .filter((cross) => inCycle.has(cross.importee))
        .sort((a, b) => a.edge.from.path.localeCompare(b.edge.from.path) || a.edge.line - b.edge.line)[0];
      return {
        check: ID, path: anchor.edge.from.path, line: anchor.edge.line, key: members.join(' ↔ '),
        message: `feature cycle ${members.join(' ↔ ')} (${pairs.join(', ')}): move what they share into a feature both import`,
      };
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
