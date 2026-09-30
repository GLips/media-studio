// ─── no-module-mocking ───────────────────────────────────────
//
// Makes sure: every test runs the real module it names, so a changed signature
// fails the tests that cover it, and a module moves without editing a mock path.
//
// Its subject is test files, so it is built on plain `defineRule`: the
// authored-source wrapper would exempt every file it reads.
//
// MOCK_METHODS holds the four spellings jest and vitest ship (`mock`, `doMock`,
// `setMock`, `unstable_mockModule`); check it when a runner majors. `vi.fn`,
// `vi.spyOn`, fake timers and MSW replace a boundary and are the fix, not the
// finding. NEGATIVE SPACE: a namespace import (`vitest.mock`), a renamed `vi`,
// and bun's `mock.module` go unreported.
// ──────────────────────────────────────────────────────────────────────

import { defineRule, type ESTree, type Scope, type SourceCode } from "@oxlint/plugins";
import { staticKeyName } from "../lib/static-key-name.ts";

const MOCK_METHODS = new Set(["doMock", "mock", "setMock", "unstable_mockModule"]);

const TEST_GLOBALS = new Map([
  ["vi", "vitest"],
  ["jest", "@jest/globals"],
]);

function importedBindingSource(variable: { defs: readonly { type: string; node: ESTree.Node; parent?: ESTree.Node | null }[] }): string | null {
  for (const definition of variable.defs) {
    if (definition.type === "ImportBinding" && definition.parent?.type === "ImportDeclaration") {
      return String(definition.parent.source.value);
    }
  }
  return null;
}

// Resolved rather than name-matched, so `import { vi } from "vitest"` and a bare global `vi` both
// report, while a local `const vi = makeHelper()` does not. A test framework object is genuinely
// ambiguous by name alone — `jest` is also a plausible variable name.
function isTestFrameworkObject(sourceCode: SourceCode, node: ESTree.Expression): boolean {
  if (node.type !== "Identifier") return false;
  const expectedSource = TEST_GLOBALS.get(node.name);
  if (expectedSource === undefined) return false;

  let scope: Scope | null = sourceCode.getScope(node);
  while (scope !== null) {
    const variable = scope.set.get(node.name);
    if (variable !== undefined) {
      // Bound locally: it counts only when the binding came from the framework's own module.
      return importedBindingSource(variable) === expectedSource;
    }
    scope = scope.upper;
  }
  // Unbound: the framework's injected global, which is how both runners expose it by default.
  return true;
}

export const noModuleMockingRule = defineRule({
  meta: {
    type: "problem",
    messages: {
      moduleMock:
        "Module mocking couples this test to import paths rather than behaviour, and it keeps passing when the real module changes. Inject the dependency, or depend on an interface a real test implementation can satisfy.",
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        if (node.callee.type !== "MemberExpression") return;
        if (!isTestFrameworkObject(context.sourceCode, node.callee.object)) return;
        const method = staticKeyName(node.callee.property, node.callee.computed);
        if (method !== undefined && MOCK_METHODS.has(method)) {
          context.report({ node, messageId: "moduleMock" });
        }
      },
    };
  },
});
