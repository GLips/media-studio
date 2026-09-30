// ─── Barrel purity: a web feature's barrel carries nothing server-only ─
//
// Any screen may import a feature's barrel unread, so no runtime chain from
// it may reach a Node builtin or a package a browser can't run. The finding
// names the barrel and the chain, not a module in a build log.
//
// The trace stops at a module calling a server-function constructor from
// @tanstack/react-start: Start's compiler stubs those bodies out of the client
// build, with the imports only they used. Type-only edges aren't followed.
//
// Warning: any other mention of the constructor's name there (a shadow, a
// parameter, a re-export) makes it no boundary. Doubt over-reports.

import type { Finding, ImportEdge, StructuralCheck, CheckContext } from '../check-context.ts';
import { walkAst, type AstNode, type SourceFile } from '../source-tree.ts';

const ID = 'barrel-purity';
/**
 * The Node-side machinery a browser chunk can't carry. Builtins need no entry. Engine code isn't named here:
 * import-policy confines it to the engine door, which a barrel reaches only past a server function.
 */
const SERVER_ONLY_PACKAGES = ['@remotion/renderer', '@remotion/bundler', '@remotion/install-whisper-cpp', 'esbuild', 'vite'];
const SERVER_FN_MODULE = '@tanstack/react-start';
const SERVER_FN_CONSTRUCTORS = ['createServerFn', 'createMiddleware', 'createServerOnlyFn'];

export const barrelPurityCheck: StructuralCheck = {
  id: ID,
  run(context) {
    const findings: Finding[] = [];
    for (const barrel of context.tree.sources) {
      const position = context.positionOf(barrel.path);
      if (position.kind !== 'web-client' || position.place !== 'feature' || position.layer !== 'barrel') continue;
      const reported = new Set<string>();
      const visited = new Set([barrel.path]);
      const trace = (file: SourceFile, chain: readonly string[], origin: ImportEdge | undefined) => {
        if (origin && crossesServerFnBoundary(context, file)) return;
        for (const edge of context.edgesFrom(file)) {
          if (edge.scanned.typeOnly) continue;
          const first = origin ?? edge;
          const { target } = edge;
          const serverOnly = target.kind === 'builtin' ? target.name
            : target.kind === 'package' && SERVER_ONLY_PACKAGES.includes(target.name) ? target.name : undefined;
          if (serverOnly !== undefined) {
            if (reported.has(serverOnly)) continue;
            reported.add(serverOnly);
            findings.push({
              check: ID, path: barrel.path, line: first.line, key: serverOnly,
              message: `reaches the server-only ${serverOnly} (${[...chain, serverOnly].join(' → ')}), which every screen importing this barrel `
                + 'would carry into the browser; put the export behind a server function or out of the barrel',
            });
            continue;
          }
          const next = target.kind === 'module' ? context.fileAt(target.path) : undefined;
          if (!next || visited.has(next.path)) continue;
          visited.add(next.path);
          trace(next, [...chain, next.path], first);
        }
      };
      trace(barrel, [barrel.path], undefined);
    }
    return findings;
  },
};

/** Whether `file` calls a server-function constructor it imports from Start, and names that binding nowhere else. */
function crossesServerFnBoundary(context: CheckContext, file: SourceFile): boolean {
  const locals = new Set<string>();
  const namespaces = new Set<string>();
  for (const edge of context.edgesFrom(file)) {
    if (edge.scanned.typeOnly || edge.target.kind !== 'package' || edge.target.name !== SERVER_FN_MODULE) continue;
    for (const binding of edge.scanned.bindings) {
      if (binding.imported === '*') namespaces.add(binding.local);
      else if (SERVER_FN_CONSTRUCTORS.includes(binding.imported)) locals.add(binding.local);
    }
  }
  if (locals.size === 0 && namespaces.size === 0) return false;
  const calls = new Set<AstNode>();
  let otherwise = false;
  walkAst(file.program, (node, parent) => {
    if (node.type === 'ImportDeclaration') return false;
    if (node.type === 'CallExpression') {
      const callee = node.callee as AstNode;
      const member = callee.type === 'MemberExpression' && !callee.computed ? callee : undefined;
      if (callee.type === 'Identifier' && locals.has(callee.name as string)) calls.add(callee);
      const object = member?.object as AstNode | undefined;
      if (object?.type === 'Identifier' && namespaces.has(object.name as string)
        && SERVER_FN_CONSTRUCTORS.includes((member!.property as AstNode).name as string)) calls.add(object);
    }
    if (node.type !== 'Identifier' || calls.has(node)) return;
    const name = node.name as string;
    // A non-computed member's property (`x.createServerFn`) or an object key names no binding.
    const isPropertyName = (parent?.type === 'MemberExpression' && parent.property === node && !parent.computed)
      || (parent?.type === 'Property' && parent.key === node && !parent.computed && !parent.shorthand);
    if ((locals.has(name) || namespaces.has(name)) && !isPropertyName) otherwise = true;
  });
  return calls.size > 0 && !otherwise;
}
