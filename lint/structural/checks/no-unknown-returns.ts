// ─── No unknown returns ───────────────────────────────────────────────
//
// Every declared return type names what the function produces: `unknown`,
// `any`, `Promise<unknown>`, `unknown[]` and an alias to one aren't contracts.
// So a caller reads a field off the result with no narrowing of its own, and a
// change to the returned type reports at each call site. A function returning
// unparsed transport data parses at that boundary and returns a named type.
//
// Negative space: only the declared annotation is read. An unannotated function
// keeps TypeScript's inference, and a returned `any` value is tsc's subject. A
// generic return (`load<T>(): T`) is silent even where every caller picks
// `unknown`: the widening is at the call, and this check's subject is the
// declaration.

import type { Finding, StructuralCheck } from '../check-context.ts';
import type { Node } from '../type-checker.ts';
import { findingAtNode, FUNCTION_LIKE_KINDS, typeCheckableNodesOfKind, typedSources, typeResolvesToFlags, UNTYPED_TYPE_FLAGS } from '../type-shapes.ts';

const ID = 'no-unknown-returns';

const MESSAGE =
  'this function hands `unknown` to every caller, and each one will invent its own narrowing. Parse the value here, ' +
  'where its origin is known, and return a named type';

export const noUnknownReturnsCheck: StructuralCheck = {
  id: ID,
  run(context) {
    const findings: Finding[] = [];
    for (const source of typedSources(context)) {
      const annotated = typeCheckableNodesOfKind(source.file, FUNCTION_LIKE_KINDS)
        .filter((fn) => (fn as Node & { type?: Node }).type !== undefined) as (Node & { type: Node; name?: Node })[];
      if (annotated.length === 0) continue;
      const types = source.typed.checker.getTypeAtLocation(annotated.map((fn) => fn.type));
      for (const [index, fn] of annotated.entries()) {
        const type = types[index];
        if (!type || !typeResolvesToFlags(source.typed, type, UNTYPED_TYPE_FLAGS)) continue;
        const returns = fn.type.getText(source.file).replace(/\s+/g, ' ');
        const key = fn.name ? `${fn.name.getText(source.file)}(): ${returns}` : `(): ${returns}`;
        findings.push(findingAtNode(ID, source, fn.type, key, MESSAGE));
      }
    }
    return findings;
  },
};
