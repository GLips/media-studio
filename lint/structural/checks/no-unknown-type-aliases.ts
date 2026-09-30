// ─── No unknown type aliases ──────────────────────────────────────────
//
// No type name resolves to `unknown` or `any`, through any depth of alias, so
// nobody follows `ApiPayload` through two files to learn it decides nothing,
// and a one-line alias can't hide a broad type from no-broad-parameters and
// no-unknown-returns. Reporting here and at each use isn't double counting: one
// edit to the alias clears them all.
//
// A generic alias is judged like any other: `type Boxed<T> = T` is silent
// because a type parameter isn't `unknown`, while `type Boxed<T> = unknown`,
// which ignores its parameter, reports. An alias inside a function or a
// namespace is an alias, and one to a package's broad type reports here, the
// only place in the tree it can.

import type { Finding, StructuralCheck } from '../check-context.ts';
import { SyntaxKind, type Node } from '../type-checker.ts';
import { findingAtNode, typeCheckableNodesOfKind, typedSources, typeResolvesToFlags, UNTYPED_TYPE_FLAGS } from '../type-shapes.ts';

const ID = 'no-unknown-type-aliases';

const ALIAS_KINDS: ReadonlySet<SyntaxKind> = new Set([SyntaxKind.TypeAliasDeclaration]);

export const noUnknownTypeAliasesCheck: StructuralCheck = {
  id: ID,
  run(context) {
    const findings: Finding[] = [];
    for (const source of typedSources(context)) {
      for (const alias of typeCheckableNodesOfKind(source.file, ALIAS_KINDS)) {
        const name = (alias as Node & { name?: Node & { text?: string } }).name;
        const symbol = name ? source.typed.checker.getSymbolAtLocation(name) : undefined;
        if (!name || !symbol) continue;
        if (!typeResolvesToFlags(source.typed, source.typed.checker.getDeclaredTypeOfSymbol(symbol), UNTYPED_TYPE_FLAGS)) continue;
        const text = name.text ?? '?';
        findings.push(findingAtNode(ID, source, name, text,
          `type alias \`${text}\` names a contract and then declines to state one: it resolves to \`unknown\`. Keep ` +
          '`unknown` visible at the parse boundary where it is honest, and give this name the parsed type'));
      }
    }
    return findings;
  },
};
