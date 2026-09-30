// ─── No broad parameters ──────────────────────────────────────────────
//
// Every parameter names what it accepts: none is `unknown` or `any`, so no body
// reads a value it has to check first, and none is `object`, so no property read
// needs a cast and a wrong argument fails at the call site. A rest, a defaulted
// and a constructor parameter property are inputs like any other.
//
// Exempt: a parameter named `cause` (a `catch` binding is unknown, so what's
// forwarded into `new Error(msg, { cause })` has no type to name; by name, so
// the hole stays greppable), and the subject of the function's own type
// predicate (`value is T`), since a guard exists to type what has no type and
// no-runtime-typeof asks for exactly that signature. A parser taking `unknown`
// still reports: write it as a guard or an assertion.
//
// Negative space: an unannotated parameter is strict mode's complaint, and the
// `this` annotation is no input: no caller passes it.

import type { Finding, StructuralCheck } from '../check-context.ts';
import { SyntaxKind, type Node } from '../type-checker.ts';
import {
  findingAtNode, FUNCTION_LIKE_KINDS, NON_PRIMITIVE_TYPE_FLAGS, typeCheckableNodesOfKind, typedSources,
  typePredicateSubjects, typeResolvesToFlags, UNTYPED_TYPE_FLAGS, type TypedSource,
} from '../type-shapes.ts';

const ID = 'no-broad-parameters';

const ALLOWED_UNKNOWN_PARAMETER_NAMES = new Set(['cause']);

export const noBroadParametersCheck: StructuralCheck = {
  id: ID,
  run(context) {
    const findings: Finding[] = [];
    for (const source of typedSources(context)) {
      const { typed } = source;
      for (const fn of typeCheckableNodesOfKind(source.file, FUNCTION_LIKE_KINDS)) {
        const annotated = ((fn as Node & { parameters?: readonly Node[] }).parameters ?? [])
          .filter((parameter) => (parameter as Node & { type?: Node }).type !== undefined && !isReceiver(parameter));
        if (annotated.length === 0) continue;
        const annotations = annotated.map((parameter) => (parameter as Node & { type: Node }).type);
        const types = typed.checker.getTypeAtLocation(annotations);
        let vouchedFor: ReadonlySet<string> | undefined;
        for (const [index, parameter] of annotated.entries()) {
          const type = types[index], annotation = annotations[index];
          if (!type || !annotation) continue;
          const untyped = typeResolvesToFlags(typed, type, UNTYPED_TYPE_FLAGS);
          if (!untyped && !typeResolvesToFlags(typed, type, NON_PRIMITIVE_TYPE_FLAGS)) continue;
          const name = parameterName(source, parameter);
          if (untyped && ALLOWED_UNKNOWN_PARAMETER_NAMES.has(name)) continue;
          // Resolving the function's declarations is a round trip, so it's asked only once a parameter is broad.
          vouchedFor ??= typePredicateSubjects(typed, fn);
          if (vouchedFor.has(name)) continue;
          const key = `${name}: ${annotation.getText(source.file).replace(/\s+/g, ' ')}`;
          findings.push(findingAtNode(ID, source, annotation, key, untyped
            ? `parameter \`${name}\` accepts a value without saying what it is. Name the type the caller already has, ` +
              'and run the schema or parser at the I/O boundary instead of pushing `unknown` inward'
            : `parameter \`${name}\` is \`object\`, which admits every non-primitive and allows no property read ` +
              'without a cast. Accept a named type'));
        }
      }
    }
    return findings;
  },
};

function isReceiver(parameter: Node): boolean {
  const name = (parameter as Node & { name?: Node & { text?: string } }).name;
  return name?.kind === SyntaxKind.Identifier && name.text === 'this';
}

/** A destructured or rest parameter has no single name, so it's quoted as written: one subject, not one of its fields. */
function parameterName(source: TypedSource, parameter: Node): string {
  const name = (parameter as Node & { name?: Node & { text?: string } }).name;
  if (!name) return '?';
  return name.kind === SyntaxKind.Identifier && name.text !== undefined ? name.text : name.getText(source.file).replace(/\s+/g, ' ');
}
