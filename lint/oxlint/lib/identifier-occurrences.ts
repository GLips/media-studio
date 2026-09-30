import type { ESTree, Visitor } from "@oxlint/plugins";

/**
 * Visits each place a bare name appears, once per span.
 *
 * For rules about a NAME rather than a call: importing, aliasing or namespacing `createServerFn`
 * all reach the same constructor. Deduped because a shorthand import specifier is two Identifier
 * nodes over one span, which would draw two diagnostics on one word.
 */
export function visitIdentifierNamed(
  name: string,
  onOccurrence: (node: ESTree.Node) => void,
): Visitor {
  const seenOffsets = new Set<number>();
  return {
    Identifier(node) {
      if (node.name !== name) return;
      const [start] = node.range;
      if (seenOffsets.has(start)) return;
      seenOffsets.add(start);
      onOccurrence(node);
    },
  };
}
