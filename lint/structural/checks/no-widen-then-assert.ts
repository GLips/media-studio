// ─── No widen, then assert ────────────────────────────────────────────
//
// A value with a known type keeps it to the end of the function: no step
// assigns it to `unknown`, `object` or an opaque open record and then asserts
// the type back with nothing checked between. So a field changed on `User`
// reports at each use; the round trip can't hold the old type in place.
//
// A call is evidence, since the checker reads its return type: `const u:
// unknown = loadUser()` reports when loadUser returns User, and
// `const raw: unknown = JSON.parse(s)` doesn't, since `any` had nothing to lose.
//
// Negative space: the binding must be a `const` (a reassigned `let` may not hold
// the widened value at the assertion), the asserted expression a plain name,
// and both steps in one function: across a closure the two lines have different
// authors. Widening through a parameter is no-broad-parameters' finding.

import type { Finding, StructuralCheck } from '../check-context.ts';
import { NodeFlags, SyntaxKind, type Node, type Type, type TypedProgram } from '../type-checker.ts';
import {
  constructKey, enclosingFunctionLike, findingAtNode, isOpaqueDictionary, isTypeRequestUnsafe, NON_PRIMITIVE_TYPE_FLAGS,
  typeCheckableNodesOfKind, typedSources, typeResolvesToFlags, UNTYPED_TYPE_FLAGS,
} from '../type-shapes.ts';

const ID = 'no-widen-then-assert';

const ASSERTION_KINDS: ReadonlySet<SyntaxKind> = new Set([SyntaxKind.AsExpression, SyntaxKind.TypeAssertionExpression]);

export const noWidenThenAssertCheck: StructuralCheck = {
  id: ID,
  run(context) {
    const findings: Finding[] = [];
    for (const source of typedSources(context)) {
      const { typed } = source;
      for (const assertion of typeCheckableNodesOfKind(source.file, ASSERTION_KINDS)) {
        const { expression: subject, type: asserted } = assertion as Node & { expression?: Node; type?: Node };
        if (subject?.kind !== SyntaxKind.Identifier || !asserted) continue;
        // Asked first because it's the cheapest way to drop most assertions: this one widens, it doesn't recover.
        const assertedType = typed.checker.getTypeAtLocation(asserted);
        if (!assertedType || isBroadType(typed, assertedType)) continue;
        const declaration = widenedConstDeclaration(typed, subject);
        if (!declaration || !sameFunction(declaration, assertion)) continue;
        const { type: declaredType, initializer } = declaration as Node & { type?: Node; initializer?: Node };
        if (!initializer) continue;
        const widening = wideningOf(typed, declaredType, initializer);
        if (!widening) continue;
        // `const x = v as unknown` widened `v`; `const x: unknown = v` widened the initializer itself.
        const original = widening.throughAssertion ? (initializer as Node & { expression?: Node }).expression ?? initializer : initializer;
        if (isTypeRequestUnsafe(original)) continue;
        const originalType = typed.checker.getTypeAtLocation(original);
        if (!originalType || isBroadType(typed, originalType)) continue;
        const name = (subject as Node & { text?: string }).text ?? 'this value';
        findings.push(findingAtNode(ID, source, assertion, constructKey(source, assertion),
          `\`${name}\` had a known type, discarded it, and this assertion invents it back with nothing checked in ` +
          'between. Delete the widening and keep the original type through to here'));
      }
    }
    return findings;
  },
};

/** `unknown`, `any`, `object`, or an open dictionary with an opaque value. */
function isBroadType(typed: TypedProgram, type: Type): boolean {
  return typeResolvesToFlags(typed, type, UNTYPED_TYPE_FLAGS | NON_PRIMITIVE_TYPE_FLAGS) || isOpaqueDictionary(typed, type);
}

/** Which spelling of the widening a declaration uses, `const x: unknown = v` or `const x = v as unknown`, if either. */
function wideningOf(typed: TypedProgram, declaredType: Node | undefined, initializer: Node): { throughAssertion: boolean } | undefined {
  if (declaredType) {
    const type = typed.checker.getTypeAtLocation(declaredType);
    if (type && isBroadType(typed, type)) return { throughAssertion: false };
  }
  if (!ASSERTION_KINDS.has(initializer.kind)) return undefined;
  const assertedNode = (initializer as Node & { type?: Node }).type;
  if (!assertedNode || isTypeRequestUnsafe(assertedNode)) return undefined;
  const type = typed.checker.getTypeAtLocation(assertedNode);
  return type && isBroadType(typed, type) ? { throughAssertion: true } : undefined;
}

/**
 * The `const` declaration a name resolves to. `const` carries the ordering too: it has one declaration and can't be
 * read before it in code that compiles, so no position comparison is needed.
 */
function widenedConstDeclaration(typed: TypedProgram, identifier: Node): Node | undefined {
  const declaration = typed.checker.getSymbolAtLocation(identifier)?.declarations?.[0]?.resolve();
  if (declaration?.kind !== SyntaxKind.VariableDeclaration) return undefined;
  return (declaration.parent.flags & NodeFlags.Const) === 0 ? undefined : declaration;
}

/**
 * Compared by position, not identity: a declaration resolved through a handle comes from the program's own cache,
 * and nothing promises it's the object the walk produced; an identity test would quietly answer false.
 */
function sameFunction(a: Node, b: Node): boolean {
  const fnA = enclosingFunctionLike(a), fnB = enclosingFunctionLike(b);
  if (!fnA || !fnB) return fnA === fnB;
  return fnA.pos === fnB.pos && fnA.end === fnB.end && fnA.getSourceFile().fileName === fnB.getSourceFile().fileName;
}
