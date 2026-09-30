// ─── No runtime typeof ────────────────────────────────────────────────
//
// No branch decides what an untyped value is from its representation: a
// `typeof` over `unknown`, `any` or `object` is a parser written inline, so when
// that input's shape changes one branch is edited and every other reader keeps
// its old assumption. Put the test in a named guard (returning `value is T`) or
// a schema, and every caller narrows through it; a `typeof` in a guard's own
// body is its parse step and is silent.
//
// Over a type, `typeof` is ordinary control flow and is silent:
// `typeof window === 'undefined'` asks about existence, and `typeof v ===
// 'string'` over `string | number` is the compiler's own narrowing.
//
// Negative space: `typeof` over a generic `T` is silent, and the type-level
// `typeof X` is a different operator.

import type { Finding, StructuralCheck } from '../check-context.ts';
import { SyntaxKind, type Node, type Type } from '../type-checker.ts';
import {
  constructKey, enclosingFunctionLike, findingAtNode, isTypeRequestUnsafe, NON_PRIMITIVE_TYPE_FLAGS, typeCheckableNodesOfKind,
  typedSources, typePredicateSubjects, UNTYPED_TYPE_FLAGS,
} from '../type-shapes.ts';

const ID = 'no-runtime-typeof';

const MESSAGE =
  'this `typeof` decides what an untyped value is from its representation: a string is not yet a UserId. Parse the ' +
  'value at its I/O boundary, or move this test into a function returning `value is T` so every caller narrows ' +
  'through one contract';

const TYPEOF_KINDS: ReadonlySet<SyntaxKind> = new Set([SyntaxKind.TypeOfExpression]);

export const noRuntimeTypeofCheck: StructuralCheck = {
  id: ID,
  run(context) {
    const findings: Finding[] = [];
    for (const source of typedSources(context)) {
      const tests = typeCheckableNodesOfKind(source.file, TYPEOF_KINDS).flatMap((node) => {
        const operand = (node as Node & { expression?: Node }).expression;
        if (!operand || isTypeRequestUnsafe(operand)) return [];
        // The nearest function only: a callback inside a guard has its own signature, and its `typeof` still reports.
        const fn = enclosingFunctionLike(node);
        return fn && typePredicateSubjects(source.typed, fn).size > 0 ? [] : [{ node, operand }];
      });
      if (tests.length === 0) continue;
      const types = source.typed.checker.getTypeAtLocation(tests.map((test) => test.operand));
      for (const [index, test] of tests.entries()) {
        const type = types[index];
        if (type && isUntypedOperand(type)) findings.push(findingAtNode(ID, source, test.node, constructKey(source, test.node), MESSAGE));
      }
    }
    return findings;
  },
};

/**
 * The operand itself, not typeResolvesToFlags' transparent reading, which is wrong here both ways: `typeof xs` over
 * `unknown[]` is statically "object", and `typeof v` over `object | string` is the compiler's own narrowing.
 */
function isUntypedOperand(type: Type): boolean {
  return !type.isErrorType() && (type.flags & (UNTYPED_TYPE_FLAGS | NON_PRIMITIVE_TYPE_FLAGS)) !== 0;
}
