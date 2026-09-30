// ─── no-reflect-access ─────────────────────────────────────────
//
// Makes sure: `Reflect.get` and `Reflect.apply` don't appear, in the dot or the
// bracket spelling, so a property rename reports at each read and a call's
// arity is checked. `ownKeys`, `has` and `getPrototypeOf` return honest types.
//
// `Reflect` is resolved as a reference, not matched by name: a local binding
// called `Reflect` doesn't report. RuleTester and the CLI disagree on the
// shorter ways to ask that; `resolvesToLocalBinding` says why, and
// lint/oxlintrc.test.ts proves the rule live. A Proxy trap forwarding to its
// target takes one `oxlint-disable-next-line`.
//
// NEGATIVE SPACE: `globalThis.Reflect.get`, `const R = Reflect` and
// `const { get } = Reflect` hand back the same `any` unreported; closing them
// needs types. A value-position `typeof Reflect.get` feature-detect reports.
// ──────────────────────────────────────────────────────────────────────

import { defineSourceRule } from "../lib/rule-file.ts";
import { staticKeyName } from "../lib/static-key-name.ts";
import { withoutTransparentWrappers } from "../lib/transparent-wrappers.ts";
import { type ESTree, type Scope, type SourceCode } from "@oxlint/plugins";

// Keyed by `string` on purpose: every lookup is a member name read off the AST, so a map narrowed
// to its own two keys would refuse the only argument it is ever given. The VALUE side stays a
// literal union, which is what ties each entry to a `meta.messages` key.
const BANNED_REFLECT_METHODS = new Map<string, "reflectGet" | "reflectApply">([
  ["get", "reflectGet"],
  ["apply", "reflectApply"],
]);

// Whether THIS FILE binds `Reflect` to a value. Asks the resolved reference: `isGlobalReference`
// flips between CLI and RuleTester, and a name lookup gets shadowing wrong (`type Reflect`).
// Walks `upper` because a `switch` discriminant's reference lives one scope above `getScope`'s.
// A plain `Node`: it arrives through `withoutTransparentWrappers`.
function resolvesToLocalBinding(sourceCode: SourceCode, identifier: ESTree.Node): boolean {
  let scope: Scope | null = sourceCode.getScope(identifier);
  while (scope !== null) {
    const reference = scope.references.find(
      (candidate) => candidate.identifier.range[0] === identifier.range[0],
    );
    if (reference !== undefined) {
      const variable = reference.resolved;
      return variable !== null && variable.defs.some(bindsAValue);
    }
    scope = scope.upper;
  }
  // No scope records this reference; not observed. `false` means "not a local binding", which
  // reports, the same direction as the resolver's `null` above and `bindsAValue`'s defaults: this
  // rule's failure mode is silence, so no default here chooses it.
  return false;
}

// Type-space kinds, which the resolver skips alone but not merged with a value declaration.
// `@oxlint/plugins` doesn't type them; the runtime produces them, measured. NEGATIVE SPACE: an
// instantiated namespace binds a value and still reports (telling it apart is TypeScript's
// instantiation rule). `TSEnumName` is absent: an enum emits a real object.
const TYPE_SPACE_DEFINITIONS: ReadonlySet<string> = new Set(["Type", "TSModuleName"]);

// Asked per DEFINITION, because TypeScript merges `interface Reflect` and `declare const Reflect`
// into one variable that binds nothing. Besides type-space kinds, three bind nothing: `declare`,
// a type-only import (`importKind` on the declaration or the specifier), and an alias to an
// entity (`import Reflect = NodeJS`), which claims `importKind: "value"`. Each would otherwise be
// a one-line file-wide off-switch.
function bindsAValue(definition: { type: string; node: ESTree.Node; parent: ESTree.Node | null }): boolean {
  if (TYPE_SPACE_DEFINITIONS.has(definition.type)) return false;
  if (isTypeOnlyImport(definition.node) || isTypeOnlyImport(definition.parent)) return false;
  if (isEntityAlias(definition.node)) return false;
  // `declare` sits on the DECLARATION, and a `Variable` definition's node is the DECLARATOR inside
  // it. The other arm is not a fallback: `declare class` and `declare enum` carry the flag on the
  // definition's own node.
  const declaration = definition.node.type === "VariableDeclarator" ? definition.parent : definition.node;
  // Unreachable. `false` means "binds nothing", which REPORTS; a default choosing silence hides.
  if (declaration === null) return false;
  return !("declare" in declaration && declaration.declare === true);
}

function isTypeOnlyImport(node: ESTree.Node | null): boolean {
  return node !== null && "importKind" in node && node.importKind === "type";
}

// `import X = A.B` names something that exists; `import X = require(…)` binds a module. Only the
// moduleReference separates them, as `importKind` says `"value"` for both. An alias to an
// INSTANTIATED entity does bind a value and is refused anyway: the same instantiation verdict as
// the namespace note on `TYPE_SPACE_DEFINITIONS`.
function isEntityAlias(node: ESTree.Node): boolean {
  return (
    node.type === "TSImportEqualsDeclaration" &&
    node.moduleReference.type !== "TSExternalModuleReference"
  );
}

export const noReflectAccessRule = defineSourceRule({
  meta: {
    type: "problem",
    messages: {
      reflectGet:
        "`Reflect.get` returns `any` whatever the receiver was. Use typed property access, or parse the dynamic input into a named type before reading it.",
      reflectApply:
        "`Reflect.apply` drops arity and parameter checking. Call the function directly, or spread a typed tuple if the arguments really are dynamic.",
    },
  },
  create(context) {

    return {
      // The MEMBER READ is the subject, not the call. A `CallExpression` visitor misses
      // `Reflect.get.call(null, o, k)`, `Reflect["get"].apply(…)` and `const get = Reflect.get`,
      // which read the same `any`. Visiting the read catches them, and `Reflect.get!(…)` and
      // `(Reflect.get as Getter)(…)` too, with no callee to unwrap.
      MemberExpression(node) {
        // `(Reflect as never).get(…)` and `Reflect!.get(…)` wrap the object with no change to the
        // emitted JS; `lib/transparent-wrappers.ts` owns that list so rules can't drift apart.
        const owner = withoutTransparentWrappers(node.object);
        // Resolved rather than matched by name, so a local or imported `Reflect` is left alone.
        if (
          owner.type !== "Identifier" ||
          owner.name !== "Reflect" ||
          resolvesToLocalBinding(context.sourceCode, owner)
        ) {
          return;
        }
        // `lib/static-key-name.ts` owns both spellings of the member read, and owns the negative
        // space with them: a key no single file can follow is `undefined` rather than a guess.
        const method = staticKeyName(node.property, node.computed);
        const messageId = method === undefined ? undefined : BANNED_REFLECT_METHODS.get(method);
        if (messageId !== undefined) context.report({ node, messageId });
      },
    };
  },
});
