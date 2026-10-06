// ─── Which of a file's names are globals ──────────────────────────────
//
// A name read where no lexical scope of the file binds it is a global (or a name nothing declares). Scopes are the
// module, a function's parameters and body (where `var` hoists), a block's let, const, class and function, a catch's
// parameter, a for head, a class expression's own name, a static block, a namespace's body and an enum's members.
// Value imports, enums and `import x = require()` bind; a `declare` binds nothing, as it names the global itself.
// Every scope's names are gathered before any read resolves, so a function declared below its use binds it.
//
// Types are erased, so a name in one (`el: HTMLElement`, an overload's parameter) reads nothing.

import { childAt, childrenAt, childrenOf, isIdentifier, memberName, type AstNode } from './source-tree.ts';

type LexicalScope = { names: Set<string>; parent: LexicalScope | undefined; hoists: boolean };

const FUNCTIONS = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression']);
const BLOCKS = new Set(['BlockStatement', 'StaticBlock', 'ForStatement', 'ForInStatement', 'ForOfStatement', 'SwitchStatement', 'CatchClause']);
const LABELLED = new Set(['LabeledStatement', 'BreakStatement', 'ContinueStatement']);
const KEYED = new Set(['Property', 'PropertyDefinition', 'MethodDefinition', 'AccessorProperty']);
/**
 * The TypeScript nodes that hold values: an expression under an assertion, a parameter property's default, a
 * namespace's or an enum's body, `export =`. Every other TS node is a type, or a signature with no body, and is skipped.
 */
const TS_HOLDING_VALUES = new Set([
  'TSAsExpression', 'TSSatisfiesExpression', 'TSNonNullExpression', 'TSTypeAssertion', 'TSInstantiationExpression',
  'TSParameterProperty', 'TSModuleDeclaration', 'TSModuleBlock', 'TSEnumDeclaration', 'TSEnumBody', 'TSEnumMember',
  'TSExportAssignment',
]);

const openScope = (parent: LexicalScope, hoists: boolean): LexicalScope => ({ names: new Set(), parent, hoists });

function hoistedScope(scope: LexicalScope): LexicalScope {
  let at = scope;
  while (!at.hoists && at.parent) at = at.parent;
  return at;
}

const isBound = (name: string, scope: LexicalScope | undefined): boolean => scope !== undefined && (scope.names.has(name) || isBound(name, scope.parent));

/** Whether an identifier reads a binding: not a property name, an object key, a label or an export's outer name. */
function isReference(node: AstNode, parent: AstNode | undefined): boolean {
  if (!parent) return true;
  if (parent.type === 'MemberExpression') return parent.property !== node || Boolean(parent.computed);
  if (LABELLED.has(parent.type)) return false;
  if (parent.type === 'ExportSpecifier') return parent.local === node;
  // A shorthand `{ window }` is its key and its value at once, and the value is a read.
  const isKey = KEYED.has(parent.type) && parent.key === node && !parent.computed;
  return !isKey || (parent.type === 'Property' && Boolean(parent.shorthand) && parent.value === node);
}

/** Every identifier in `program` that reads a name no scope of the file binds. */
export function globalReferencesIn(program: AstNode): ReadonlySet<AstNode> {
  const bindings = new Set<AstNode>();
  const reads: { node: AstNode & { name: string }; scope: LexicalScope }[] = [];
  const moduleScope: LexicalScope = { names: new Set(), parent: undefined, hoists: true };
  const bind = (pattern: AstNode | undefined, scope: LexicalScope): void => {
    if (!pattern) return;
    if (isIdentifier(pattern)) {
      bindings.add(pattern);
      scope.names.add(pattern.name);
    } else if (pattern.type === 'ObjectPattern') {
      for (const property of childrenAt(pattern, 'properties')) bind(property.type === 'Property' ? childAt(property, 'value') : property, scope);
    } else if (pattern.type === 'ArrayPattern') {
      for (const element of childrenAt(pattern, 'elements')) bind(element, scope);
    } else if (pattern.type === 'RestElement') {
      bind(childAt(pattern, 'argument'), scope);
    } else if (pattern.type === 'AssignmentPattern') {
      // Only the left of `w = window` binds; its default is a read.
      bind(childAt(pattern, 'left'), scope);
    } else if (pattern.type === 'TSParameterProperty') {
      bind(childAt(pattern, 'parameter'), scope);
    }
  };
  /** The scope `node`'s children read in, its own declarations bound where they land. */
  const scopeUnder = (node: AstNode, scope: LexicalScope): LexicalScope => {
    const { type } = node;
    if (FUNCTIONS.has(type)) {
      if (type === 'FunctionDeclaration') bind(childAt(node, 'id'), scope);
      const inner = openScope(scope, true);
      if (type === 'FunctionExpression') bind(childAt(node, 'id'), inner);
      for (const param of childrenAt(node, 'params')) bind(param, inner);
      return inner;
    }
    if (BLOCKS.has(type)) {
      const inner = openScope(scope, type === 'StaticBlock');
      if (type === 'CatchClause') bind(childAt(node, 'param'), inner);
      return inner;
    }
    if (type === 'ClassExpression' || type === 'TSEnumDeclaration' || type === 'TSModuleDeclaration') {
      if (type !== 'ClassExpression') bind(childAt(node, 'id'), scope);
      const inner = openScope(scope, type === 'TSModuleDeclaration');
      if (type === 'ClassExpression') bind(childAt(node, 'id'), inner);
      return inner;
    }
    if (type === 'ClassDeclaration') bind(childAt(node, 'id'), scope);
    // An enum's members are names in its later members' initializers.
    if (type === 'TSEnumMember') bind(childAt(node, 'id'), scope);
    if (type === 'VariableDeclaration') {
      const target = node.kind === 'var' ? hoistedScope(scope) : scope;
      for (const declarator of childrenAt(node, 'declarations')) bind(childAt(declarator, 'id'), target);
    }
    return scope;
  };
  const visit = (node: AstNode, parent: AstNode | undefined, scope: LexicalScope): void => {
    const { type } = node;
    // A value import's names are bindings of the module; the import itself is an edge, which the checks judge apart.
    if (type === 'ImportDeclaration') {
      if (node.importKind === 'type') return;
      for (const specifier of childrenAt(node, 'specifiers')) if (specifier.importKind !== 'type') bind(childAt(specifier, 'local'), moduleScope);
      return;
    }
    if (type === 'TSImportEqualsDeclaration') {
      if (node.importKind !== 'type') bind(childAt(node, 'id'), scope);
      return;
    }
    if (type.startsWith('TS') && !TS_HOLDING_VALUES.has(type)) return;
    // `declare const window: …` names the global, binding nothing; `export { x } from './m'` names another module's.
    if (node.declare === true || type === 'ExportAllDeclaration' || (type === 'ExportNamedDeclaration' && node.source) || type === 'MetaProperty') return;
    const inner = scopeUnder(node, scope);
    if (isIdentifier(node) && !bindings.has(node) && isReference(node, parent)) reads.push({ node, scope });
    for (const child of childrenOf(node)) visit(child, node, inner);
  };
  visit(program, undefined, moduleScope);
  return new Set(reads.filter((read) => !isBound(read.node.name, read.scope)).map((read) => read.node));
}

/**
 * The global an expression names, given the file's `globals` (globalReferencesIn): an unbound identifier (`Math`), or
 * a member read off an unbound holder (`globalThis.Math`, `self['fetch']`, `holders` naming which) as `via` it.
 */
export function globalNamed(node: AstNode, globals: ReadonlySet<AstNode>, holders: ReadonlySet<string>): { name: string; via?: string } | undefined {
  if (isIdentifier(node)) return globals.has(node) ? { name: node.name } : undefined;
  if (node.type !== 'MemberExpression') return undefined;
  const object = childAt(node, 'object'), name = memberName(node);
  if (!isIdentifier(object) || !globals.has(object) || !holders.has(object.name) || name === undefined) return undefined;
  return { name, via: object.name };
}
