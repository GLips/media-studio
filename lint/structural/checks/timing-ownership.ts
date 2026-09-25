// ─── (a) Timing ownership ─────────────────────────────────────────────
//
// A project builds its timing only in `timeline.ts`: no other project file
// imports a timing constructor. Each imported name is followed to the module
// that defines it, so `#studio`, a relative path into lib, a project helper
// re-exporting it and a namespace import all reach the same verdict.
//
// A type-only import is left alone: it names the constructor's type and builds
// nothing. A dynamic `import()` of a module offering a constructor is reported,
// since what it takes can't be read.

import { isTimingConstructor, TIMING_CONSTRUCTORS } from '../../policy/timing-constructors.ts';
import { walkAst, type AstNode } from '../source-tree.ts';
import type { Finding, StructuralCheck } from '../check-context.ts';

const ID = 'timing-ownership';
const ALL_NAMES = [...new Set(TIMING_CONSTRUCTORS.flatMap((row) => row.names))];

export const timingOwnershipCheck: StructuralCheck = {
  id: ID,
  run(context) {
    const findings: Finding[] = [];
    for (const file of context.tree.sources) {
      const position = context.positionOf(file.path);
      if (position.kind !== 'project' || position.role === 'timeline') continue;
      for (const edge of context.edgesFrom(file)) {
        if (edge.target.kind !== 'module' || edge.scanned.typeOnly) continue;
        const target = edge.target.path;
        const report = (name: string, line: number) => findings.push({
          check: ID, path: file.path, line, key: `${name} from ${edge.scanned.specifier}`,
          message: `imports the timing constructor ${name}; a project's timing is built in its timeline.ts`,
        });
        const offers = (name: string) => context.originsOf(target, name).some(isTimingConstructor);
        if (edge.scanned.names !== '*') {
          for (const name of edge.scanned.names) if (offers(name)) report(name, edge.line);
          continue;
        }
        const namespaces = edge.scanned.bindings.filter((binding) => binding.imported === '*').map((binding) => binding.local);
        if (namespaces.length === 0) {
          const offered = ALL_NAMES.filter(offers);
          if (offered.length) report(offered.join(', '), edge.line);
          continue;
        }
        for (const { name, offset } of namespaceMembers(file.program, namespaces)) {
          if (ALL_NAMES.includes(name) && offers(name)) report(name, file.lineOf(offset));
        }
      }
    }
    return findings;
  },
};

/** `ns.name`, `ns['name']` and `const { name } = ns`, for each namespace local. */
function namespaceMembers(program: AstNode, locals: readonly string[]): { name: string; offset: number }[] {
  const found: { name: string; offset: number }[] = [];
  const isLocal = (node: unknown) => (node as AstNode | undefined)?.type === 'Identifier' && locals.includes((node as AstNode).name as string);
  walkAst(program, (node) => {
    if (node.type === 'MemberExpression' && isLocal(node.object)) {
      const property = node.property as AstNode;
      const name = node.computed ? (property.type === 'Literal' ? property.value : undefined) : property.name;
      if (typeof name === 'string') found.push({ name, offset: node.start });
    }
    if (node.type === 'VariableDeclarator' && isLocal(node.init) && (node.id as AstNode).type === 'ObjectPattern') {
      for (const property of (node.id as AstNode).properties as AstNode[]) {
        const key = property.key as AstNode | undefined;
        if (key?.type === 'Identifier') found.push({ name: key.name as string, offset: property.start });
      }
    }
  });
  return found;
}
