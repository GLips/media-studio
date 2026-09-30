// What counts as an exported component, for prop-count, hook-count and single-component-export,
// so the three govern one set. Read as one: `export function Name()`, `export default function`,
// an arrow in a `const`, a `memo`/`forwardRef` binding, and `export { Name }` / `export default
// Name` of a declaration made earlier. The export list resolves through oxlint's scope analysis,
// so a re-export or an imported name is not this file's component.
//
// NEGATIVE SPACE: `export * from`; an exported name bound by a parameter, a class or a later
// assignment; and an anonymous default export. Add a project's own wrapper (`observer`) to
// WRAPPER_NAMES if components arrive through it.

import type { ESTree, SourceCode } from "@oxlint/plugins";

/** React's convention, and the only signal available without a type checker. */
const COMPONENT_NAME = /^[A-Z]/;

const WRAPPER_NAMES = new Set(["memo", "forwardRef"]);

/**
 * oxlint models `function f() {}` and `const f = function () {}` as one `Function` node carrying a
 * `type` discriminant, so the two spellings need no separate handling here.
 */
export type ComponentFunction = ESTree.ArrowFunctionExpression | ESTree.Function;

export type ComponentDeclaration = {
  name: string;
  /** What a finding points at, so the diagnostic lands on the declaration rather than on its body. */
  node: ESTree.Node;
  /**
   * The function whose parameters and body are the COMPONENT'S, unwrapped from any
   * `memo`/`forwardRef` around it. Null when the wrapper was handed a reference rather than a
   * function literal — `export const Card = memo(CardImpl)` names a component whose surface is
   * declared elsewhere.
   */
  fn: ComponentFunction | null;
};

/**
 * Every exported component declaration in `program`, in source order.
 *
 * The bound VALUE is tested, not the name: `createContext(…)` and `DRAG_SLOP = 4` are PascalCase
 * too. Listed once however often exported, so `single-component-export` doesn't count two. The
 * name is the DECLARATION'S (`CardImpl` for `CardImpl as Card`): where the rules send a reader.
 */
export function exportedComponents(
  program: ESTree.Program,
  sourceCode: SourceCode,
): ComponentDeclaration[] {
  // Keyed by where the declaration starts, which both de-duplicates and gives source order.
  // `single-component-export` blames the SECOND component, and an export list sits below what it
  // names, so appending while walking would order by export statements instead.
  const found = new Map<number, ComponentDeclaration>();
  const take = (component: ComponentDeclaration | undefined) => {
    if (component !== undefined) found.set(component.node.range[0], component);
  };

  for (const statement of program.body) {
    if (statement.type !== "ExportNamedDeclaration" && statement.type !== "ExportDefaultDeclaration") {
      continue;
    }

    const declaration = statement.declaration;
    if (declaration === null || declaration === undefined) {
      if (statement.type !== "ExportNamedDeclaration") continue;
      for (const specifier of statement.specifiers) {
        take(declaredComponent(specifier.local, sourceCode));
      }
      continue;
    }

    if (declaration.type === "FunctionDeclaration") {
      take(componentOfFunctionDeclaration(declaration));
      continue;
    }

    // `export default Card`, the identifier form. The declaration it names is elsewhere in the
    // file, so it is resolved exactly as an export list's local name is.
    if (declaration.type === "Identifier") {
      take(declaredComponent(declaration, sourceCode));
      continue;
    }

    if (declaration.type !== "VariableDeclaration") continue;
    for (const declarator of declaration.declarations) take(componentOfDeclarator(declarator));
  }

  return [...found.values()].toSorted((one, other) => one.node.range[0] - other.node.range[0]);
}

/**
 * The component a local name was declared as, or undefined when the name resolves to no
 * declaration in this file — an import, a re-export's specifier, a binding of some other kind.
 */
function declaredComponent(
  local: ESTree.ModuleExportName | ESTree.Expression,
  sourceCode: SourceCode,
): ComponentDeclaration | undefined {
  // NO arm for the string-literal spelling of a local name. `export { "a-b" as Card }` is only
  // legal with a `from` clause, so it is a re-export, and a re-export's specifier resolves to no
  // reference at all — the walk below returns nothing for it without being told to.
  const scope = sourceCode.getScope(local);
  const reference = scope.references.find(
    (candidate) => candidate.identifier.range[0] === local.range[0],
  );
  // The DEFINITION'S NODE is the whole test, and it is the only one: an import's definition node is
  // an `ImportSpecifier`, a re-export's specifier resolves to no variable at all, and neither is a
  // shape either arm below matches. A second filter on the definition's KIND would say the same
  // thing twice and could only ever disagree with this one.
  for (const definition of reference?.resolved?.defs ?? []) {
    const node: ESTree.Node = definition.node;
    if (node.type === "FunctionDeclaration") return componentOfFunctionDeclaration(node);
    if (node.type === "VariableDeclarator") return componentOfDeclarator(node);
  }
  return undefined;
}

function componentOfFunctionDeclaration(
  declaration: ESTree.Function,
): ComponentDeclaration | undefined {
  if (declaration.id === null || !COMPONENT_NAME.test(declaration.id.name)) return undefined;
  return { name: declaration.id.name, node: declaration, fn: declaration };
}

function componentOfDeclarator(
  declarator: ESTree.VariableDeclarator,
): ComponentDeclaration | undefined {
  if (declarator.id.type !== "Identifier" || !COMPONENT_NAME.test(declarator.id.name)) {
    return undefined;
  }
  if (declarator.init === null || declarator.init === undefined) return undefined;

  const fn = componentFunctionOf(declarator.init);
  if (fn === undefined) return undefined;
  return { name: declarator.id.name, node: declarator, fn };
}

/**
 * The function a component binding evaluates to, `null` for a wrapper given a reference, and
 * `undefined` when the bound value is not a component at all.
 */
function componentFunctionOf(init: ESTree.Expression): ComponentFunction | null | undefined {
  if (init.type === "ArrowFunctionExpression" || init.type === "FunctionExpression") return init;
  if (init.type !== "CallExpression") return undefined;
  if (!isWrapperCallee(init.callee)) return undefined;

  const [wrapped] = init.arguments;
  if (wrapped === undefined) return null;
  if (wrapped.type === "ArrowFunctionExpression" || wrapped.type === "FunctionExpression") {
    return wrapped;
  }
  // `memo(CardImpl)` — a component, but its parameters and body are declared elsewhere.
  return null;
}

/** `memo(…)`, `forwardRef(…)`, and the namespaced spellings `React.memo(…)` / `React.forwardRef(…)`. */
function isWrapperCallee(callee: ESTree.CallExpression["callee"]): boolean {
  if (callee.type === "Identifier") return WRAPPER_NAMES.has(callee.name);
  return (
    callee.type === "MemberExpression" &&
    !callee.computed &&
    callee.property.type === "Identifier" &&
    WRAPPER_NAMES.has(callee.property.name)
  );
}
