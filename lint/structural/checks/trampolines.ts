// ─── Exported functions that only forward a call ──────────────────────
//
// Advisory. An exported function whose whole body calls another of the
// studio's functions with its own parameters, unchanged, is another name to
// edit on every change: re-export the callee, or call it directly. Every
// governed module but specs is read; no position's job is thin wrappers.
//
// The callee must be this repo's code (imported from the tree, or declared in
// the file): a package wrapper is the one owner sdk-containment asks for, and
// JSX renders. A literal or computed argument specializes the call, so isn't
// forwarding. Read: `export function`, `export const f = () =>` and an exported
// object's methods; `export { f }` of a local wrapper isn't followed.

import type { Finding, StructuralCheck } from '../check-context.ts';
import type { AstNode, SourceFile } from '../source-tree.ts';

const ID = 'trampolines';
const SPEC = /\.test\.[cm]?[jt]sx?$/;

type Exported = { name: string; fn: AstNode };

export const trampolinesCheck: StructuralCheck = {
  id: ID,
  advisory: true,
  run(context) {
    const findings: Finding[] = [];
    for (const file of context.tree.sources) {
      if (SPEC.test(file.path)) continue;
      const imported = new Set<string>(), namespaces = new Set<string>();
      for (const edge of context.edgesFrom(file)) {
        if (edge.target.kind !== 'module' || edge.scanned.typeOnly) continue;
        for (const binding of edge.scanned.bindings) (binding.imported === '*' ? namespaces : imported).add(binding.local);
      }
      const exported = exportedFunctions(file);
      const callable = new Set([...imported, ...localFunctions(file)]);
      for (const { name, fn } of exported) {
        const callee = forwardedCallee(fn, callable, namespaces);
        if (!callee || callee === name) continue;
        findings.push({
          check: ID, path: file.path, line: file.lineOf(fn.start), key: name,
          message: `${name} only forwards to ${callee}: re-export ${callee} (under this name if it must), or call it directly`,
        });
      }
    }
    return findings;
  },
};

const isFunction = (node: AstNode | null | undefined): boolean =>
  node?.type === 'FunctionDeclaration' || node?.type === 'FunctionExpression' || node?.type === 'ArrowFunctionExpression';

function exportedFunctions(file: SourceFile): Exported[] {
  const found: Exported[] = [];
  for (const statement of file.program.body as AstNode[]) {
    const declaration = (statement.type === 'ExportNamedDeclaration' || statement.type === 'ExportDefaultDeclaration')
      ? statement.declaration as AstNode | null : null;
    if (!declaration) continue;
    if (isFunction(declaration)) {
      found.push({ name: ((declaration.id as AstNode | null)?.name as string | undefined) ?? 'default', fn: declaration });
      continue;
    }
    if (declaration.type !== 'VariableDeclaration') continue;
    for (const declarator of declaration.declarations as AstNode[]) {
      const id = declarator.id as AstNode, init = declarator.init as AstNode | null;
      if (id.type !== 'Identifier' || !init) continue;
      if (isFunction(init)) found.push({ name: id.name as string, fn: init });
      else if (init.type === 'ObjectExpression') {
        for (const property of init.properties as AstNode[]) {
          const key = property.key as AstNode | undefined, value = property.value as AstNode | undefined;
          if (property.type === 'Property' && key?.type === 'Identifier' && value && isFunction(value)) found.push({ name: `${id.name}.${key.name}`, fn: value });
        }
      }
    }
  }
  return found;
}

/** Top-level functions the file declares, exported or not: a call to one is a call to this repo's code. */
function localFunctions(file: SourceFile): string[] {
  return (file.program.body as AstNode[]).flatMap((statement) => {
    const declaration = statement.type === 'ExportNamedDeclaration' ? statement.declaration as AstNode | null : statement;
    if (declaration?.type === 'FunctionDeclaration') return [(declaration.id as AstNode).name as string];
    if (declaration?.type !== 'VariableDeclaration') return [];
    return (declaration.declarations as AstNode[]).flatMap((declarator) =>
      (declarator.id as AstNode).type === 'Identifier' && isFunction(declarator.init as AstNode | null) ? [(declarator.id as AstNode).name as string] : []);
  });
}

/** The name `fn` forwards to, when its body is one call of repo code taking only its own parameters; else undefined. */
function forwardedCallee(fn: AstNode, callable: ReadonlySet<string>, namespaces: ReadonlySet<string>): string | undefined {
  const params = (fn.params as AstNode[]).map((param) => {
    const inner = param.type === 'RestElement' ? param.argument as AstNode : param;
    return inner.type === 'Identifier' ? inner.name as string : undefined;
  });
  // A destructured or defaulted parameter reshapes what arrives, which is more than forwarding.
  if (params.some((param) => param === undefined)) return undefined;
  const body = fn.body as AstNode;
  let expression: AstNode | undefined = body;
  if (body.type === 'BlockStatement') {
    const statements = body.body as AstNode[];
    const only = statements.length === 1 ? statements[0] : undefined;
    expression = only?.type === 'ReturnStatement' ? only.argument as AstNode | undefined
      : only?.type === 'ExpressionStatement' ? only.expression as AstNode : undefined;
  }
  if (expression?.type === 'AwaitExpression') expression = expression.argument as AstNode;
  if (expression?.type !== 'CallExpression') return undefined;
  const callee = expression.callee as AstNode;
  const name = callee.type === 'Identifier' && callable.has(callee.name as string) ? callee.name as string
    : callee.type === 'MemberExpression' && !callee.computed && (callee.object as AstNode).type === 'Identifier'
      && namespaces.has((callee.object as AstNode).name as string)
      ? `${(callee.object as AstNode).name as string}.${(callee.property as AstNode).name as string}` : undefined;
  if (!name) return undefined;
  const forwardsOwn = (argument: AstNode) => {
    const inner = argument.type === 'SpreadElement' ? argument.argument as AstNode : argument;
    return inner.type === 'Identifier' && params.includes(inner.name as string);
  };
  return (expression.arguments as AstNode[]).every(forwardsOwn) ? name : undefined;
}
