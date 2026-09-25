// ─── (a) Timing ownership ─────────────────────────────────────────────
//
// A project builds its timing only in `timeline.ts`: no other project file
// imports a timing constructor. Each imported name is followed to the module
// that defines it, so `#studio`, a relative path into lib, a project helper
// re-exporting it and a namespace import all reach the same verdict.
//
// A type-only import is left alone: it names the constructor's type and builds
// nothing. A dynamic `import()` of a module offering a constructor is reported
// unless it destructures names that aren't one. A computed `import(expr)` is
// reported unless it destructures only names no constructor has.

import { isTimingConstructor, TIMING_CONSTRUCTORS } from '../../policy/timing-constructors.ts';
import { walkAst, type AstNode } from '../source-tree.ts';
import type { Finding, StructuralCheck } from '../check-context.ts';

const ID = 'timing-ownership';

export const timingOwnershipCheck: StructuralCheck = {
  id: ID,
  run(context) {
    const findings: Finding[] = [];
    for (const file of context.tree.sources) {
      const position = context.positionOf(file.path);
      if (position.kind !== 'project' || position.role === 'timeline') continue;
      const offers = (path: string, name: string) => context.originsOf(path, name).some(isTimingConstructor);
      const namespacesOf = (path: string, name: string) =>
        context.originsOf(path, name).filter((origin) => origin.name === '*').map((origin) => origin.path);
      for (const edge of context.edgesFrom(file)) {
        if (edge.scanned.typeOnly) continue;
        const report = (name: string, line: number) => findings.push({
          check: ID, path: file.path, line, key: `${name} from ${edge.scanned.specifier}`,
          message: `imports the timing constructor ${name}; a project's timing is built in its timeline.ts`,
        });
        if (edge.target.kind === 'computed') {
          // Its module is unknown, but names it destructures can still be told apart from every constructor's.
          const names = edge.scanned.names;
          if (names !== '*' && !names.some((name) => TIMING_CONSTRUCTORS.some((row) => row.names.includes(name)))) continue;
          findings.push({
            check: ID, path: file.path, line: edge.line, key: 'computed import',
            message: "a computed import() can't be checked for timing constructors; name the module",
          });
          continue;
        }
        if (edge.target.kind !== 'module') continue;
        const target = edge.target.path;
        // Every member read off a namespace is followed, whatever it's called: a kit may rename a constructor.
        const readMembers = (namespace: string, locals: readonly string[]) => {
          for (const { name, offset } of namespaceMembers(file.program, locals)) if (offers(namespace, name)) report(name, file.lineOf(offset));
        };
        if (edge.scanned.names !== '*') {
          for (const name of edge.scanned.names) if (offers(target, name)) report(name, edge.line);
          for (const binding of edge.scanned.bindings) {
            for (const namespace of namespacesOf(target, binding.imported)) readMembers(namespace, [binding.local]);
          }
          continue;
        }
        const namespaces = edge.scanned.bindings.filter((binding) => binding.imported === '*').map((binding) => binding.local);
        if (namespaces.length) {
          readMembers(target, namespaces);
          continue;
        }
        // A dynamic import, a side-effect import or a project's `export *`: everything the module offers is in reach.
        const offered = context.exportedNames(target).filter((name) => offers(target, name));
        if (offered.length) report(offered.join(', '), edge.line);
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
