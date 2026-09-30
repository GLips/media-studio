// Which React hook a call names, for hook-count (every hook) and no-async-effect (`useEffect`,
// `useCallback`), so the two can't disagree about `React.useEffect`.
//
// The name is the EXPORTING module's, as in lib/imported-names.ts: `useEffect as useE` is a hook
// and `createStore as useStore` is not. The object of a member read isn't checked, so
// `React.useEffect` and `whatever.useEffect` both read as `useEffect`.
//
// NEGATIVE SPACE, each a hook call reported by nobody: `React[hookName]()`; a hook through a local
// binding (`const fx = useEffect; fx()`); a member re-exported under another name; and a
// default-imported hook, whose local spelling is all there is and is what gets used.

import type { ESTree, SourceCode } from "@oxlint/plugins";
import { exportedName } from "./imported-names.ts";
import { staticKeyName } from "./static-key-name.ts";

/** React's convention, and what `use` in a call position means without a type checker. */
const HOOK_NAME = /^use[A-Z]/;

/**
 * The hook a callee names — `useEffect(…)`, `React.useEffect(…)`, `React["useEffect"](…)`, and the
 * aliased import of any of them — or undefined when the callee names no hook.
 *
 * A NAME rather than a boolean because two of the four callers need to know WHICH hook.
 */
export function hookCallName(
  callee: ESTree.CallExpression["callee"],
  sourceCode: SourceCode,
): string | undefined {
  const name = calleeName(callee, sourceCode);
  return name !== undefined && HOOK_NAME.test(name) ? name : undefined;
}

function calleeName(
  callee: ESTree.CallExpression["callee"],
  sourceCode: SourceCode,
): string | undefined {
  if (callee.type === "Identifier") return importedNameOf(callee, sourceCode) ?? callee.name;
  // `staticKeyName` resolves the quoted spelling too, so the computed arm needs no branch here.
  if (callee.type === "MemberExpression") return staticKeyName(callee.property, callee.computed);
  return undefined;
}

/**
 * The name the exporting module gave an identifier, or undefined when this file did not import it.
 *
 * Asks the RESOLVED reference rather than the scope chain by name, for the reason
 * `lib/imported-names.ts` gives: a local `const useEffect` inside a function shadowing an import is
 * a different Variable and is not a use of it.
 */
function importedNameOf(
  identifier: ESTree.IdentifierReference,
  sourceCode: SourceCode,
): string | undefined {
  const scope = sourceCode.getScope(identifier);
  const reference = scope.references.find(
    (candidate) => candidate.identifier.range[0] === identifier.range[0],
  );
  // The DEFINITION'S NODE is the whole test. Every definition is walked, as oxlint merges a type
  // and a value declaration of one name into one `Variable`.
  //
  // NO type-only arm, unlike `lib/imported-names.ts`: a callee bound only as a type is code that
  // cannot run, so the name returned for it describes nothing.
  for (const definition of reference?.resolved?.defs ?? []) {
    const specifier: ESTree.Node = definition.node;
    if (specifier.type !== "ImportSpecifier") continue;
    const name = exportedName(specifier.imported);
    // `{ default as useAuth }`: a default export has no name, so the local spelling stands;
    // returning "default" would stop it being a hook.
    return name === "default" ? undefined : name;
  }
  return undefined;
}
