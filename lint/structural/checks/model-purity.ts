// ─── (c) Model purity ─────────────────────────────────────────────────
//
// A model (a lib feature's `models/`, a project's `x-model.ts`, its painting sources and its
// `timeline.ts`) loads in plain Node with no browser or I/O code behind it. From each model,
// every runtime import is followed transitively through first-party code, and a
// chain is refused where it reaches render or Node-side code (a feature's
// `studio/`, and `#studio`; its `engine/`; cli; harness; a scene), a package beyond the allowlist, a
// builtin, or a browser or I/O global: a name no scope of the file binds, or one read off globalThis.
//
// An `import type` is erased and isn't followed: flagging it would force types
// to be duplicated. Evaluator tests, importing it under `node --test`, hold that a model loads.

import type { StudioPosition } from '../../policy/studio-tree.ts';
import type { AstNode, SourceFile } from '../source-tree.ts';
import type { CheckContext, Finding, ImportEdge, StructuralCheck } from '../check-context.ts';

const ID = 'model-purity';

/**
 * The only packages a model may import, by name: three's math classes and Remotion's pure easing. Anything else from
 * either package pulls in its renderer.
 */
export const MODEL_PACKAGE_ALLOWLIST: Readonly<Record<string, readonly string[]>> = {
  three: ['Vector3', 'Matrix4', 'Quaternion', 'Euler', 'MathUtils'],
  remotion: ['interpolate', 'Easing', 'spring'],
};

/** Globals that mean a browser or I/O. `fetch` and `process` exist in Node, and are I/O all the same. */
const IMPURE_GLOBALS = new Set([
  'window', 'document', 'navigator', 'location', 'localStorage', 'sessionStorage', 'requestAnimationFrame',
  'cancelAnimationFrame', 'getComputedStyle', 'HTMLElement', 'HTMLCanvasElement', 'Image', 'OffscreenCanvas',
  'fetch', 'XMLHttpRequest', 'WebSocket', 'process',
]);
const GLOBAL_OBJECTS = new Set(['globalThis', 'self']);

/** Positions a model may pass through: pure until shown otherwise, and scanned in turn. */
const isScannable = (position: StudioPosition) =>
  position.kind === 'models' ||
  (position.kind === 'project' && ['model', 'painting-source', 'timeline', 'shared', 'unclassified', 'media', 'sfx', 'brand'].includes(position.role));

const isModel = (position: StudioPosition) =>
  position.kind === 'models' || (position.kind === 'project' && ['model', 'painting-source', 'timeline'].includes(position.role));
/** A model's spec is its evaluator, run by `node --test`: it may use node:test and fixtures, and isn't loaded as a model. */
const isSpec = (path: string) => /\.test\.tsx?$/.test(path);

export const modelPurityCheck: StructuralCheck = {
  id: ID,
  run(context) {
    const findings: Finding[] = [];
    for (const file of context.tree.sources) {
      if (isSpec(file.path) || !isModel(context.positionOf(file.path))) continue;
      const reported = new Set<string>();
      const report = (first: ImportEdge | undefined, chain: readonly string[], offense: string, line: number) => {
        const key = first ? `${first.scanned.specifier} → ${offense}` : offense;
        if (reported.has(key)) return;
        reported.add(key);
        const via = chain.length > 1 ? ` (via ${chain.slice(1).join(' → ')})` : '';
        findings.push({ check: ID, path: file.path, line, key, message: `a model reaches ${offense}${via}` });
      };
      const seen = new Set<string>([file.path]);
      const visit = (current: SourceFile, chain: readonly string[], first: ImportEdge | undefined) => {
        for (const global of impureGlobalsIn(current)) {
          report(first, chain, `the global ${global.name}`, first ? first.line : current.lineOf(global.offset));
        }
        for (const edge of context.edgesFrom(current)) {
          if (edge.scanned.typeOnly) continue;
          const head = first ?? edge;
          const offense = offenseOf(context, edge);
          if (offense) {
            report(head, chain, offense, head.line);
            continue;
          }
          if (edge.target.kind !== 'module' || seen.has(edge.target.path)) continue;
          seen.add(edge.target.path);
          const next = context.fileAt(edge.target.path);
          if (next) visit(next, [...chain, edge.target.path], head);
        }
      };
      visit(file, [file.path], undefined);
    }
    return findings;
  },
};

function offenseOf(context: CheckContext, edge: ImportEdge): string | undefined {
  const target = edge.target;
  if (target.kind === 'builtin') return `the builtin ${target.name}`;
  if (target.kind === 'unresolved-alias') return `the unresolved alias ${target.specifier}`;
  if (target.kind === 'outside') return `${target.specifier}, outside the repo`;
  if (target.kind === 'computed') return "a computed import(), whose module can't be read";
  if (target.kind === 'package') {
    const allowed = MODEL_PACKAGE_ALLOWLIST[target.name];
    if (!allowed) return `the package ${target.name}`;
    const extra = target.names === '*' ? ['*'] : target.names.filter((name) => !allowed.includes(name));
    return extra.length ? `${extra.join(', ')} from ${target.name}` : undefined;
  }
  const position = context.positionOf(target.path);
  if (!isScannable(position)) {
    const where = position.kind === 'project' ? `the project's ${position.role} code` : `${position.kind} code`;
    return `${where} (${target.path})`;
  }
  // A gitignored generated input (a capture index, a fitted track) holds data; anything else unbacked can't be read.
  if (!target.backed && !(position.kind === 'project' && position.role === 'media')) return `${target.path}, which isn't in the snapshot`;
  return undefined;
}

/** A lexical scope: the names declared in it, and whether `var` hoists to it (a function's, or the module's). */
type LexicalScope = { names: Set<string>; parent: LexicalScope | undefined; hoists: boolean };

/** A read of a global: `name` unless some scope binds it, or `via` (globalThis, self) unless one binds that. */
type GlobalRead = { name: string; offset: number; scope: LexicalScope; via?: string };

const FUNCTIONS = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression']);
const BLOCKS = new Set(['BlockStatement', 'StaticBlock', 'ForStatement', 'ForInStatement', 'ForOfStatement', 'SwitchStatement', 'CatchClause']);
const LABELLED = new Set(['LabeledStatement', 'BreakStatement', 'ContinueStatement']);
const KEYED = new Set(['Property', 'PropertyDefinition', 'MethodDefinition', 'AccessorProperty']);

const isAstNode = (value: unknown): value is AstNode =>
  typeof value === 'object' && value !== null && 'type' in value && typeof value.type === 'string';
const isIdentifier = (value: unknown): value is AstNode & { name: string } =>
  isAstNode(value) && value.type === 'Identifier' && typeof value.name === 'string';
const isStringLiteral = (value: unknown): value is AstNode & { value: string } =>
  isAstNode(value) && value.type === 'Literal' && typeof value.value === 'string';
const isImpure = (name: string | undefined): name is string => name !== undefined && IMPURE_GLOBALS.has(name);

/** The node under `key`, if one is. */
function childAt(node: AstNode, key: string): AstNode | undefined {
  const value = node[key];
  return isAstNode(value) ? value : undefined;
}

/** The nodes listed under `key`; an array's holes (`[, b]`) are skipped. */
function childrenAt(node: AstNode, key: string): AstNode[] {
  const value = node[key];
  return Array.isArray(value) ? value.filter(isAstNode) : [];
}

/** Every node directly under `node`. A value that's no node (a regex's parts, a template's text) holds none. */
function childrenOf(node: AstNode): AstNode[] {
  const children: AstNode[] = [];
  for (const [key, value] of Object.entries(node)) {
    if (key === 'type') continue;
    if (Array.isArray(value)) children.push(...value.filter(isAstNode));
    else if (isAstNode(value)) children.push(value);
  }
  return children;
}

const openScope = (parent: LexicalScope, hoists: boolean): LexicalScope => ({ names: new Set(), parent, hoists });

function hoistedScope(scope: LexicalScope): LexicalScope {
  let at = scope;
  while (!at.hoists && at.parent) at = at.parent;
  return at;
}

const isBound = (name: string, scope: LexicalScope | undefined): boolean => scope !== undefined && (scope.names.has(name) || isBound(name, scope.parent));

/** `globalThis.fetch`'s name, or `globalThis['fetch']`'s. */
function memberName(member: AstNode): string | undefined {
  const property = childAt(member, 'property');
  if (member.computed) return isStringLiteral(property) ? property.value : undefined;
  return isIdentifier(property) ? property.name : undefined;
}

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

/**
 * Reads of an impure global (`document`, `globalThis.document`, `globalThis['fetch']`, `const { fetch } = globalThis`),
 * each resolved through the file's lexical scopes: a local, parameter or import of the same name shadows the global.
 * Every scope's names are gathered before any read resolves, so a function declared below its use still binds it.
 */
function impureGlobalsIn(file: SourceFile): { name: string; offset: number }[] {
  const bindings = new Set<AstNode>();
  const reads: GlobalRead[] = [];
  const program: LexicalScope = { names: new Set(), parent: undefined, hoists: true };
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
    if (type === 'ClassExpression') {
      const inner = openScope(scope, false);
      bind(childAt(node, 'id'), inner);
      return inner;
    }
    if (type === 'ClassDeclaration') bind(childAt(node, 'id'), scope);
    if (type === 'VariableDeclaration') {
      const target = node.kind === 'var' ? hoistedScope(scope) : scope;
      for (const declarator of childrenAt(node, 'declarations')) bind(childAt(declarator, 'id'), target);
    }
    return scope;
  };
  const readsAt = (node: AstNode, parent: AstNode | undefined, scope: LexicalScope) => {
    const init = childAt(node, 'init'), id = childAt(node, 'id');
    if (node.type === 'VariableDeclarator' && isIdentifier(init) && GLOBAL_OBJECTS.has(init.name) && id?.type === 'ObjectPattern') {
      for (const property of childrenAt(id, 'properties')) {
        const key = childAt(property, 'key');
        if (isIdentifier(key) && isImpure(key.name)) reads.push({ name: key.name, offset: property.start, scope, via: init.name });
      }
    }
    const object = childAt(node, 'object'), name = node.type === 'MemberExpression' ? memberName(node) : undefined;
    if (isIdentifier(object) && GLOBAL_OBJECTS.has(object.name) && isImpure(name)) reads.push({ name, offset: node.start, scope, via: object.name });
    if (isIdentifier(node) && isImpure(node.name) && !bindings.has(node) && isReference(node, parent)) reads.push({ name: node.name, offset: node.start, scope });
  };
  const visit = (node: AstNode, parent: AstNode | undefined, scope: LexicalScope): void => {
    const { type } = node;
    // A value import's names are bindings of the module; the import itself is an edge, judged apart.
    if (type === 'ImportDeclaration') {
      if (node.importKind === 'type') return;
      for (const specifier of childrenAt(node, 'specifiers')) if (specifier.importKind !== 'type') bind(childAt(specifier, 'local'), program);
      return;
    }
    // Types are erased (`el: HTMLElement` loads nothing), but an enum or `import x = require()` binds a value.
    if (type.startsWith('TS') && !type.endsWith('Expression')) {
      const bindsValue = (type === 'TSEnumDeclaration' && !node.declare) || (type === 'TSImportEqualsDeclaration' && node.importKind !== 'type');
      if (bindsValue) bind(childAt(node, 'id'), scope);
      return;
    }
    // `declare const window: …` names the global, binding nothing; `export { x } from './m'` names another module's.
    if (node.declare === true || type === 'ExportAllDeclaration' || (type === 'ExportNamedDeclaration' && node.source) || type === 'MetaProperty') return;
    const inner = scopeUnder(node, scope);
    readsAt(node, parent, scope);
    for (const child of childrenOf(node)) visit(child, node, inner);
  };
  visit(file.program, undefined, program);
  return reads.filter((read) => !isBound(read.via ?? read.name, read.scope)).map(({ name, offset }) => ({ name, offset }));
}
