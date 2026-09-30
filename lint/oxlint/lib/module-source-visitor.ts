import type { ESTree, Visitor } from "@oxlint/plugins";

// Every place a module specifier can appear, static, dynamic, `require`, `import =` and type
// position, so no rule fencing on specifiers misses a form. CommonJS is seen, not forbidden.
// NEGATIVE SPACE: a computed specifier has nothing to fence on and is not visited.

/**
 * A diagnostic's anchor. A `TemplateElement` because a backtick specifier's honest node is the
 * quasi, not a cast StringLiteral.
 */
export type ModuleSourceNode = ESTree.StringLiteral | ESTree.TemplateElement;

export function visitModuleSources(
  onSource: (source: ModuleSourceNode, specifier: string) => void,
): Visitor {
  return {
    ImportDeclaration(node) {
      onSource(node.source, node.source.value);
    },
    ExportNamedDeclaration(node) {
      if (node.source !== null) onSource(node.source, node.source.value);
    },
    ExportAllDeclaration(node) {
      onSource(node.source, node.source.value);
    },
    ImportExpression(node) {
      onStaticSpecifier(node.source, onSource);
    },
    TSImportEqualsDeclaration(node) {
      // `import env = require("@/env.server")` binds a value at runtime and compiles under
      // `module: preserve`. It reaches no ImportDeclaration visitor and no CallExpression one.
      if (node.moduleReference.type !== "TSExternalModuleReference") return;
      onSource(node.moduleReference.expression, node.moduleReference.expression.value);
    },
    TSImportType(node) {
      // `type S = import("@/features/billing").Invoice`. Erased, and still coupling: the rows that
      // deny an area deny it for a type import too, which is what `isTypeOnlyDeclaration` below
      // reports for this node.
      onSource(node.source, node.source.value);
    },
    CallExpression(node) {
      if (!isRequireCallee(node.callee)) return;
      onStaticSpecifier(node.arguments[0], onSource);
    },
  };
}

/** Adapts `staticModuleSpecifier` to the callback shape the visitor arms above use. */
function onStaticSpecifier(
  source: ESTree.Node | undefined,
  onSource: (source: ModuleSourceNode, specifier: string) => void,
): void {
  const found = staticModuleSpecifier(source);
  if (found !== undefined) onSource(found.node, found.specifier);
}

/**
 * The one module a specifier names, with the node to blame. THE ONE OWNER of this: a second copy
 * would diverge in coverage. A backtick template without substitutions counts, since it is the
 * spelling someone reaches for to dodge a fence.
 *
 * NEGATIVE SPACE: `undefined` for a substituted template (a family) and `require(0)`. A null
 * `cooked` is unreachable, and refused.
 */
export function staticModuleSpecifier(
  source: ESTree.Node | undefined,
): { node: ModuleSourceNode; specifier: string } | undefined {
  if (source === undefined) return undefined;
  if (source.type === "Literal") {
    return typeof source.value === "string" ? { node: source, specifier: source.value } : undefined;
  }
  if (source.type !== "TemplateLiteral" || source.expressions.length > 0) return undefined;
  const [quasi] = source.quasis;
  const cooked = quasi?.value.cooked;
  if (quasi === undefined || typeof cooked !== "string") return undefined;
  return { node: quasi, specifier: cooked };
}

/**
 * `require` or `require.resolve`, and neither `foo.require` nor a computed
 * `require[key]`. The member form matters as much as the bare one: `require.resolve` binds no
 * value and still names the module, so a rule about which modules a file may reach has to see it.
 */
function isRequireCallee(callee: ESTree.CallExpression["callee"]): boolean {
  if (callee.type === "Identifier") return callee.name === "require";
  if (callee.type !== "MemberExpression" || callee.computed) return false;
  return (
    callee.object.type === "Identifier" &&
    callee.object.name === "require" &&
    callee.property.type === "Identifier" &&
    callee.property.name === "resolve"
  );
}

/**
 * A type import creates no runtime dependency. Inline `import { type A, b }` still binds `b`, so
 * every specifier must be type-only; `length > 0` keeps a bare `import "pkg"` a runtime edge.
 *
 * Pass `source.parent` from `visitModuleSources`. Dynamic forms have no type-only spelling;
 * `import type X = require(…)` does, with the module reference as the literal's parent.
 */
export function isTypeOnlyDeclaration(declaration: ESTree.Node): boolean {
  switch (declaration.type) {
    case "ImportDeclaration":
      return (
        declaration.importKind === "type" ||
        (declaration.specifiers.length > 0 &&
          declaration.specifiers.every(
            (specifier) => specifier.type === "ImportSpecifier" && specifier.importKind === "type",
          ))
      );
    case "ExportNamedDeclaration":
      return (
        declaration.exportKind === "type" ||
        (declaration.specifiers.length > 0 &&
          declaration.specifiers.every((specifier) => specifier.exportKind === "type"))
      );
    case "ExportAllDeclaration":
      return declaration.exportKind === "type";
    case "TSImportType":
      return true;
    case "TSExternalModuleReference":
      return (
        declaration.parent.type === "TSImportEqualsDeclaration" &&
        declaration.parent.importKind === "type"
      );
    default:
      return false;
  }
}
