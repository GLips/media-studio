// ─── What the types checks ask the compiler ───────────────────────────
//
// Two questions carry the types checks, "is this key domain open" and "does
// this resolve to something broad", and each is one call to the checker. The
// compiler gives a type an index signature exactly when its key domain is open
// (Record<string, T>, { [k: string]: T }, { [K in string]: T }, Partial of any
// of them) and properties when it's closed (a literal union, an enum, keyof T),
// so no spelling is enumerated here and none can be missed.
//
// Negative space, shared by every check that asks: an uninstantiated generic
// (`{ [K in keyof T as string]: unknown }`) has no index signature until T is
// bound, so each instantiation is judged and the alias is silent. The error type
// (an unresolved name) carries `Any` and is never a subject: tsc reports it.

import type { CheckContext, Finding } from './check-context.ts';
import { SyntaxKind, TypeFlags, type Node, type SourceFile, type Type, type TypedProgram } from './type-checker.ts';

/** `unknown` and `any` together: a check that bans one alone teaches the retry to write the other. */
export const UNTYPED_TYPE_FLAGS = TypeFlags.Any | TypeFlags.Unknown;

/** The bare `object` keyword: every non-primitive, with no property readable without a cast. */
export const NON_PRIMITIVE_TYPE_FLAGS = TypeFlags.NonPrimitive;

/**
 * Containers a signature is read through, so `Promise<unknown>` and `unknown[]` answer as `unknown`. Matched by the
 * symbol's name, so an alias to one unwraps too. Shortening this list doesn't rename anything, it makes
 * `Promise<unknown>` a contract.
 */
const TRANSPARENT_CONTAINER_NAMES = new Set(['Array', 'ReadonlyArray', 'Promise', 'PromiseLike']);

const TYPESCRIPT_SOURCE = /\.(ts|tsx|mts|cts)$/;

/** Whether a governed path is TypeScript, which the types checks and typed-tree read; JavaScript has no types to judge. */
export const isTypeScriptSource = (path: string) => TYPESCRIPT_SOURCE.test(path);

export type TypedSource = { path: string; typed: TypedProgram; file: SourceFile };

/**
 * Every governed TypeScript file, with the program its position is compiled by. Driven by the tree, not the program,
 * so a file the program reaches outside the tree is never reported; a governed file the program doesn't compile is
 * skipped here and reported by typed-tree.
 */
export function typedSources(context: CheckContext): TypedSource[] {
  return context.tree.sources.flatMap(({ path }) => {
    if (!isTypeScriptSource(path)) return [];
    const { program, file } = context.typed(path);
    return file ? [{ path, typed: program, file }] : [];
  });
}

/**
 * Whether `type` is, or transparently contains, a type with any of `flags`: a union when any member does, a
 * transparent container when its element does. `seen` is a cycle guard, not a depth budget:
 * `type Nested = Promise<Nested[]>` is legal and unwraps forever, and a depth bound would answer "not broad" for an
 * honest deep nest.
 */
export function typeResolvesToFlags(typed: TypedProgram, type: Type, flags: number, seen = new Set<number>()): boolean {
  if (type.isErrorType()) return false;
  if ((type.flags & flags) !== 0) return true;
  if (seen.has(type.id)) return false;
  seen.add(type.id);
  if (type.isUnionType()) return type.getTypes().some((member) => typeResolvesToFlags(typed, member, flags, seen));
  if (type.isTypeReference() && TRANSPARENT_CONTAINER_NAMES.has(type.getSymbol()?.name ?? '')) {
    return typed.checker.getTypeArguments(type).some((argument) => typeResolvesToFlags(typed, argument, flags, seen));
  }
  return false;
}

/**
 * The value types of `type`'s index signatures, or undefined when its key domain is closed. The `Object` gate isn't
 * an optimisation: `string` is indexable by number, so without it every string is a bag. An array is excluded
 * because an open numeric domain is what an array is; a broad element is a signature check's finding instead.
 */
export function openKeyDomainValueTypes(typed: TypedProgram, type: Type): readonly Type[] | undefined {
  if ((type.flags & TypeFlags.Object) === 0) return undefined;
  const infos = typed.indexSignatures(type);
  if (infos.length === 0) return undefined;
  // Last, and only for a type that has an index signature: it's a round trip to the compiler.
  if (typed.checker.isArrayLikeType(type)) return undefined;
  return infos.map((info) => info.valueType);
}

/**
 * An open dictionary whose values say nothing. no-known-value-widening stops at the key half, so
 * `Record<string, Handler>` reports there and is silent in no-opaque-record and no-widen-then-assert.
 */
export function isOpaqueDictionary(typed: TypedProgram, type: Type): boolean {
  const values = openKeyDomainValueTypes(typed, type);
  return values !== undefined && values.some((value) => typeResolvesToFlags(typed, value, UNTYPED_TYPE_FLAGS | NON_PRIMITIVE_TYPE_FLAGS));
}

/**
 * Every node of one of `kinds`, in document order, that the checker can be asked about, collected in one pass so a
 * caller can ask about all of them in one request (a request per node is thousands of round trips).
 */
export function typeCheckableNodesOfKind(file: SourceFile, kinds: ReadonlySet<SyntaxKind>): Node[] {
  const found: Node[] = [];
  const walk = (node: Node): void => {
    if (kinds.has(node.kind) && !isTypeRequestUnsafe(node)) found.push(node);
    node.forEachChild(walk);
  };
  walk(file);
  return found;
}

/**
 * The `const` of `as const` parses as a type reference named `const`, and asking the checker about it panics
 * TypeScript 7.0.2's response encoder, failing the whole check. `const` can't name a type, so the predicate is
 * exact; `[]` and `[1] as const` themselves answer fine and stay subjects.
 */
export function isTypeRequestUnsafe(node: Node): boolean {
  if (node.kind !== SyntaxKind.TypeReference) return false;
  return (node as Node & { typeName?: { text?: string } }).typeName?.text === 'const';
}

/** A finding placed at a node, with the line the compiler's parse already knows. */
export function findingAtNode(check: string, source: TypedSource, node: Node, key: string, message: string): Finding {
  const { line } = source.file.getLineAndCharacterOfPosition(node.getStart(source.file));
  return { check, path: source.path, line: line + 1, key, message };
}

/** A node's text on one line, clipped: what a finding's key names a construct by. */
export function constructKey(source: TypedSource, node: Node): string {
  const text = node.getText(source.file).replace(/\s+/g, ' ').trim();
  return text.length > 80 ? `${text.slice(0, 79)}…` : text;
}

/**
 * Every node that declares a call signature. Spelled once because the checks reading signatures must agree on the
 * set: one that forgets `MethodSignature` is silent on every interface and reads as clean.
 */
export const FUNCTION_LIKE_KINDS: ReadonlySet<SyntaxKind> = new Set([
  SyntaxKind.ArrowFunction,
  SyntaxKind.CallSignature,
  SyntaxKind.ConstructSignature,
  SyntaxKind.Constructor,
  SyntaxKind.ConstructorType,
  SyntaxKind.FunctionDeclaration,
  SyntaxKind.FunctionExpression,
  SyntaxKind.FunctionType,
  SyntaxKind.GetAccessor,
  SyntaxKind.MethodDeclaration,
  SyntaxKind.MethodSignature,
  SyntaxKind.SetAccessor,
]);

/**
 * The nearest enclosing function, or undefined at the top level. The first one only: a callback inside a type guard
 * has its own signature, so the guard's promise doesn't reach into it.
 */
export function enclosingFunctionLike(node: Node): Node | undefined {
  for (let current = node.parent; current !== undefined && current.kind !== SyntaxKind.SourceFile; current = current.parent) {
    if (FUNCTION_LIKE_KINDS.has(current.kind)) return current;
  }
  return undefined;
}

/**
 * Every name a type predicate on `fn` vouches for (`value is T`, `asserts value is T`), `this` included. Reads every
 * declaration of its symbol, because an overloaded guard declares the predicate on its overloads and widens the
 * implementation's return to `boolean`.
 */
export function typePredicateSubjects(typed: TypedProgram, fn: Node): ReadonlySet<string> {
  const names = new Set<string>();
  const declarations: Node[] = [fn];
  const name = (fn as Node & { name?: Node }).name;
  if (name) {
    for (const handle of typed.checker.getSymbolAtLocation(name)?.declarations ?? []) {
      const other = handle.resolve();
      if (other) declarations.push(other);
    }
  }
  for (const declaration of declarations) {
    const returnType = (declaration as Node & { type?: Node }).type;
    if (returnType?.kind !== SyntaxKind.TypePredicate) continue;
    // `this is T` carries a ThisType node, which has no text: read only text and a receiver guard isn't a guard.
    const subject = (returnType as Node & { parameterName?: Node & { text?: string } }).parameterName;
    if (subject?.kind === SyntaxKind.ThisType) names.add('this');
    else if (subject?.text !== undefined) names.add(subject.text);
  }
  return names;
}
