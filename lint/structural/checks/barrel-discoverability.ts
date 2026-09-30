// ─── A barrel names everything it offers, by its own name ─────────────
//
// A barrel is the map a reader greps for what a unit offers, so it lists each
// name: no `export *` (bare or `as ns`), which hides names and lets later
// exports go public unreviewed, and no rename (`a as b`, `default as B`, types
// included), which leaves the public name and its definition no shared text.
//
// Barrels are what studio-tree.ts classifies as one (`lib/api.ts`, each web
// feature's `index.ts`), so a new barrel kind is covered once declared there.
// Other modules re-export as they like. A bare `export default` is silent.

import type { StudioPosition } from '../../policy/studio-tree.ts';
import type { Finding, StructuralCheck } from '../check-context.ts';
import { walkAst, type AstNode } from '../source-tree.ts';

const ID = 'barrel-discoverability';

const isBarrel = (position: StudioPosition) =>
  ('barrel' in position && position.barrel) || ('layer' in position && position.layer === 'barrel');

/** An export clause's name: an identifier, or a string literal (`export { x as 'y' }`). */
const nameOf = (node: AstNode) => (node.type === 'Identifier' ? node.name : node.value) as string;

export const barrelDiscoverabilityCheck: StructuralCheck = {
  id: ID,
  run(context) {
    const findings: Finding[] = [];
    for (const file of context.tree.sources) {
      if (!isBarrel(context.positionOf(file.path))) continue;
      const push = (node: AstNode, key: string, message: string) =>
        findings.push({ check: ID, path: file.path, line: file.lineOf(node.start), key, message });
      walkAst(file.program, (node) => {
        if (node.type === 'ExportAllDeclaration') {
          const from = (node.source as AstNode).value as string;
          const namespace = node.exported ? ` as ${nameOf(node.exported as AstNode)}` : '';
          push(node, `*${namespace} from ${from}`, `\`export *${namespace} from '${from}'\` hides what this barrel offers: list each public name`);
          return false;
        }
        if (node.type !== 'ExportSpecifier') return;
        const local = nameOf(node.local as AstNode), exported = nameOf(node.exported as AstNode);
        if (local === exported) return;
        push(node, exported, `\`${local} as ${exported}\` renames on the way out, so a grep for either misses the other: rename the definition to ${exported}`);
      });
    }
    return findings;
  },
};
