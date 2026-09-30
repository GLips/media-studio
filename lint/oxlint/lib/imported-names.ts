// Every name a file takes from a NAMED SET of modules, under the exporting module's spelling, for
// the rules that fence on names (`View` from react-native). Exact module names, never a pattern:
// a predicate is an off-switch anyone can widen.
//
// Read through scope analysis, so `RN.View` off a namespace is seen and a shadowing local is not.
//
// NEGATIVE SPACE, unreported: a non-literal key or specifier; names bound in a `.then` callback;
// `let RN; RN = require("m")`; the inner name of a nested destructure; a pattern binding nothing;
// `.default` interop hops; a namespace passed on as a value; re-exports, which rules read
// themselves.

import type { Definition, ESTree, SourceCode, Variable, Visitor } from "@oxlint/plugins";
import { staticModuleSpecifier } from "./module-source-visitor.ts";
import { staticKeyName } from "./static-key-name.ts";
import {
  outermostTransparentWrapper,
  withoutTransparentWrappers,
} from "./transparent-wrappers.ts";

/** The exporting module's name for a specifier, which a local alias cannot change. */
export function exportedName(name: ESTree.ModuleExportName): string {
  return name.type === "Literal" ? name.value : name.name;
}

/**
 * The module a runtime load expression names: `require("m")`, `import("m")`, `await import("m")`.
 * These bind through an ordinary variable or none, so scope analysis cannot answer them and the
 * specifier only exists on the initializer. `require.resolve` is deliberately absent: it loads
 * nothing.
 *
 * `sourceCode` is for `require` alone, a plain identifier a file may rebind; a local or parameter
 * named `require` loads nothing.
 */
function runtimeImportSpecifier(
  node: ESTree.Node | null | undefined,
  sourceCode: SourceCode,
): string | undefined {
  if (node === null || node === undefined) return undefined;
  // `require("m") as never` and `(await import("m"))!` load the same module. Stripped at both
  // levels, because the cast can sit inside the await or around it.
  const outer = withoutTransparentWrappers(node);
  const loaded =
    outer.type === "AwaitExpression" ? withoutTransparentWrappers(outer.argument) : outer;
  if (loaded.type === "ImportExpression") return staticModuleSpecifier(loaded.source)?.specifier;
  if (loaded.type !== "CallExpression") return undefined;
  if (loaded.callee.type !== "Identifier" || loaded.callee.name !== "require") return undefined;
  if (isRebound(loaded.callee, sourceCode)) return undefined;
  return staticModuleSpecifier(loaded.arguments[0])?.specifier;
}

/**
 * Whether this `require` is the file's own rather than the module loader.
 *
 * Asks the RESOLVED reference, not a name lookup, which reads `type require` or the loader's own
 * `declare function require` as rebinds and turns the fence off. Unresolved is the loader;
 * resolved is a rebind unless every definition is ambient (`env: node` gives none).
 */
function isRebound(identifier: ESTree.IdentifierReference, sourceCode: SourceCode): boolean {
  const scope = sourceCode.getScope(identifier);
  const reference = scope.references.find(
    (candidate) => candidate.identifier.range[0] === identifier.range[0],
  );
  const variable = reference?.resolved;
  if (variable === null || variable === undefined) return false;
  // An ambient declaration binds nothing of its own. `declare` sits on the DECLARATION, but a
  // `Variable` definition's node is the DECLARATOR inside it, so `declare var require` (how
  // @types/node spells the loader) needs the climb, or every `require()` in the file goes unfenced.
  return variable.defs.some((definition) => {
    const declaration: ESTree.Node | null | undefined =
      definition.node.type === "VariableDeclarator" ? definition.parent : definition.node;
    if (declaration === null || declaration === undefined) return true;
    return !("declare" in declaration && declaration.declare === true);
  });
}

/**
 * Calls back once per load expression that binds NO name and has a member read taken off it,
 * `require("m").View`, handing over the module object, whose parent is the read.
 *
 * PRIVATE, and it must stay so: two copies of this walk once disagreed on the same cast, one rule
 * catching it and another not. A rule that needs this needs `visitImportedNames`.
 */
function visitUnboundModuleObjects(
  sourceCode: SourceCode,
  onModuleObject: (specifier: string, moduleObject: ESTree.Node) => void,
): Visitor {
  const visit = (node: ESTree.Node) => {
    const specifier = runtimeImportSpecifier(node, sourceCode);
    if (specifier === undefined) return;
    // `(require("m") as never).View` is the same read with a TypeScript node wedged in.
    const moduleObject = outermostTransparentWrapper(node);
    const parent: ESTree.Node | null | undefined = moduleObject.parent;
    if (parent === null || parent === undefined) return;
    // A load nobody reads from is nothing to fence: `await import("m")` for its side effects only.
    if (parent.type !== "MemberExpression" || parent.object !== moduleObject) return;
    onModuleObject(specifier, moduleObject);
  };

  return {
    ImportExpression(node) {
      // The read hangs off the AWAIT, not the import — and a cast may sit between the two
      // (`await (import("m") as never)`), so the await is found from the outermost wrapper.
      const loaded = outermostTransparentWrapper(node);
      visit(loaded.parent?.type === "AwaitExpression" ? loaded.parent : node);
    },

    CallExpression(node) {
      visit(node);
    },
  };
}

/**
 * Calls back once per name this file takes from any of `moduleSpecifiers`, with the node to blame. The name is the EXPORTING module's: `View as Screen` reports `View`.
 *
 * A SET, since `process` and `node:process` are one module, and calling this twice would have the
 * second spread `Program` key silently overwrite the first's. Callbacks fire in no order;
 * `lib/source-ordered-reports.ts` orders.
 */
export function visitImportedNames(
  sourceCode: SourceCode,
  moduleSpecifiers: readonly string[],
  onImportedName: (name: string, node: ESTree.Node, moduleSpecifier: string) => void,
): Visitor {
  const take = onImportedName;

  /**
   * The key of a read straight off the load expression, which binds nothing:
   * `(await import("m")).View`. There is no Variable for scope analysis to answer about, so this is
   * the one spelling that has to come off the AST — and the one a fence on bindings alone leaves
   * open. `visitUnboundModuleObjects` above owns the walk that gets here.
   */
  const takeUnboundMemberRead = (specifier: string, moduleObject: ESTree.Node) => {
    if (!moduleSpecifiers.includes(specifier)) return;
    // Narrowing only, not a decision: `visitUnboundModuleObjects` has already established that
    // this parent is a MemberExpression reading off `moduleObject`. There is no other caller.
    const read = moduleObject.parent;
    if (read === null || read === undefined || read.type !== "MemberExpression") return;
    const key = staticKeyName(read.property, read.computed);
    if (key !== undefined) take(key, read, specifier);
  };

  const takePatternKeys = (pattern: ESTree.Node, specifier: string) => {
    if (pattern.type !== "ObjectPattern") return;
    for (const property of pattern.properties) {
      // A rest element (`const { View, ...rest } = RN`) names no key, and is not a Property node.
      if (property.type !== "Property") continue;
      const key = staticKeyName(property.key, property.computed);
      if (key !== undefined) take(key, property, specifier);
    }
  };

  /**
   * The names read off a binding that IS the module: a namespace import, a default import, or
   * `const RN = require("m")`. Both spellings of a read count — `RN.View` and `const { View } = RN`
   * reach the same export, and only the first one looks like a member access.
   */
  const takeNamespaceReads = (variable: Variable, specifier: string) => {
    // NOT filtered on `reference.init`, though a destructured binding does list its own pattern
    // site as a reference. Nothing that arrives here has one: a namespace binding is never written,
    // and a `const RN = require("m")` initializer is the call rather than the identifier, so its
    // init reference matches none of the shapes below.
    for (const reference of variable.references) {
      // `(RN as never).View` reads the same binding with a TypeScript node wedged in.
      const read = outermostTransparentWrapper(reference.identifier);
      const parent: ESTree.Node | null | undefined = read.parent;
      if (parent === null || parent === undefined) continue;
      if (parent.type === "MemberExpression" && parent.object === read) {
        const key = staticKeyName(parent.property, parent.computed);
        if (key !== undefined) take(key, parent, specifier);
        continue;
      }
      // `<RN.View />` is the same read in JSX's own node shapes, never computed; missing it misses
      // every use site that renders. No object check, unlike the arm above: only the leftmost name
      // in `<A.B.C />` resolves to a binding, so the reference is always its parent's object.
      if (parent.type === "JSXMemberExpression") {
        // `<RN.View>…</RN.View>` names the binding twice and resolves both, so the closing tag has
        // to be dropped or one element draws two diagnostics. Climbing first is what keeps
        // `<RN.A.View>` working: the reference's parent there is the INNER member expression.
        let outermost: ESTree.Node = parent;
        while (outermost.parent?.type === "JSXMemberExpression") outermost = outermost.parent;
        if (outermost.parent?.type === "JSXClosingElement") continue;
        take(parent.property.name, parent, specifier);
        continue;
      }
      if (parent.type === "VariableDeclarator" && parent.init === read) {
        takePatternKeys(parent.id, specifier);
      }
    }
  };

  const takeFromImportBinding = (variable: Variable, definition: Definition) => {
    const specifier = definition.node;

    // `import RN = require("m")` binds a value but reaches no ImportDeclaration: its specifier hangs
    // off the module reference, which may name a local namespace (`import RN = NS`) instead. Its
    // type-only spelling needs no guard: a type-position read is a TSQualifiedName, which
    // `takeNamespaceReads` never matches.
    if (specifier.type === "TSImportEqualsDeclaration") {
      const reference = specifier.moduleReference;
      if (reference.type !== "TSExternalModuleReference") return;
      if (!moduleSpecifiers.includes(reference.expression.value)) return;
      takeNamespaceReads(variable, reference.expression.value);
      return;
    }

    const declaration = definition.parent;
    if (declaration === null || declaration.type !== "ImportDeclaration") return;
    const from = declaration.source.value;
    if (!moduleSpecifiers.includes(from)) return;
    // A type-only import is erased: it binds no runtime value, so it reads nothing from the module.
    // Scope analysis creates the Variable either way, so this is not optional.
    if (declaration.importKind === "type") return;

    if (specifier.type !== "ImportSpecifier") {
      takeNamespaceReads(variable, from);
      return;
    }
    if (specifier.importKind === "type") return;
    const name = exportedName(specifier.imported);
    // `{ default as RN }` is the default export wearing a named specifier's node shape — it binds
    // the module object rather than an export named `default`, so reads through it are the
    // namespace's, not a name called "default".
    if (name === "default") {
      takeNamespaceReads(variable, from);
      return;
    }
    take(name, specifier, from);
  };

  /**
   * Declarators whose pattern has already been read. Every name a destructure binds is its own
   * Variable pointing at the SAME declarator, so without this each key draws one diagnostic per
   * name bound. Per file: `create` builds this visitor once per source file.
   */
  const patternsRead = new Set<ESTree.Node>();

  const takeFromRuntimeImportBinding = (variable: Variable, definition: Definition) => {
    const declarator = definition.node;
    if (declarator.type !== "VariableDeclarator") return;
    const specifier = runtimeImportSpecifier(declarator.init, sourceCode);
    if (specifier === undefined || !moduleSpecifiers.includes(specifier)) return;

    // Only a binding that IS the whole module object reads members off it. An array pattern
    // (`const [RN] = require("m")`) binds an element of it, which is not the module.
    if (declarator.id === definition.name) {
      takeNamespaceReads(variable, specifier);
      return;
    }

    // Otherwise the name sits inside a destructure: read the keys of the declarator's OWN pattern,
    // never climb up from the binding. `const { env: { KEY } } = require("m")` binds only `KEY`, so
    // a climb reports nothing though the file takes `env`; reading the pattern also agrees with the
    // namespace spelling through `takeNamespaceReads`.
    if (patternsRead.has(declarator)) return;
    patternsRead.add(declarator);
    takePatternKeys(declarator.id, specifier);
  };

  return {
    ...visitUnboundModuleObjects(sourceCode, takeUnboundMemberRead),

    // No `Program:exit` here, ever: a consuming rule owns it for its ordered flush, and of a spread
    // key and an owned one the second silently wins. Scope analysis is complete before traversal,
    // so `Program` sees the same.
    Program() {
      // Every scope, not just the module one: `function f() { const { View } = require("m") }`
      // binds inside a function scope, and a module-scope-only sweep calls that file clean.
      for (const scope of sourceCode.scopeManager.scopes) {
        for (const variable of scope.variables) {
          // NOT `defs[0]`. A name declared in type space first — `type View = number` above
          // `import { View } from "react-native"` — makes the type declaration definition zero, and
          // reading only that one turns the fence off for a name in legal, compiling TypeScript.
          // The first definition that BINDS is the one, and a name has at most one.
          const definition = variable.defs.find(
            (candidate) => candidate.type === "ImportBinding" || candidate.type === "Variable",
          );
          if (definition === undefined) continue;
          if (definition.type === "ImportBinding") takeFromImportBinding(variable, definition);
          else takeFromRuntimeImportBinding(variable, definition);
        }
      }
    },
  };
}
