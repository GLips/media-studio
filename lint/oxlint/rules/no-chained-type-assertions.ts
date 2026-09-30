// ─── no-chained-type-assertions ────────────────────────────────
//
// Makes sure: no assertion routes through `unknown` to reach its target, in the
// `as`, angle-bracket or mixed spelling. A single assertion keeps TypeScript's
// one check, that the two types overlap, so changing a field on `User` breaks it
// at compile time; a chain through `unknown` still compiles.
//
// A chain of `as const` links alone is legal: they narrow literals and claim
// nothing. NEGATIVE SPACE: the split spelling, `const b: unknown = a; b as T`,
// is two statements, and no rule reads it.
// ──────────────────────────────────────────────────────────────────────

import { defineSourceRule } from "../lib/rule-file.ts";
import { type ESTree } from "@oxlint/plugins";

type TypeAssertion = ESTree.TSAsExpression | ESTree.TSTypeAssertion;

function isTypeAssertion(node: ESTree.Node): node is TypeAssertion {
  return node.type === "TSAsExpression" || node.type === "TSTypeAssertion";
}

function isConstAssertion(node: TypeAssertion): boolean {
  return (
    node.typeAnnotation.type === "TSTypeReference" &&
    node.typeAnnotation.typeName.type === "Identifier" &&
    node.typeAnnotation.typeName.name === "const"
  );
}

// Only the outermost link reports, so one chain is one diagnostic. No parenthesis walk is needed
// on the way up: oxlint surfaces no ParenthesizedExpression node, so `(a as unknown) as T` arrives
// as directly nested assertions. Verified against oxlint 1.77.0, and the spec asserts the
// parenthesized spelling still reports exactly once.
function isOutermostAssertion(node: TypeAssertion): boolean {
  return !isTypeAssertion(node.parent) || node.parent.expression !== node;
}

export const noChainedTypeAssertionsRule = defineSourceRule({
  meta: {
    type: "problem",
    messages: {
      chained:
        "This assertion chain routes around the compiler instead of answering it — `as unknown as T` removes even the overlap check a single assertion keeps. Parse the value at its boundary and return a named type, or fix the type that made the direct assertion fail.",
    },
  },
  create(context) {

    const checkAssertion = (node: TypeAssertion) => {
      if (!isOutermostAssertion(node)) return;

      let links = 0;
      let hasNonConstLink = false;
      let current: ESTree.Expression = node;
      while (isTypeAssertion(current)) {
        links += 1;
        hasNonConstLink ||= !isConstAssertion(current);
        current = current.expression;
      }

      if (links > 1 && hasNonConstLink) context.report({ node, messageId: "chained" });
    };

    return {
      TSAsExpression: checkAssertion,
      TSTypeAssertion: checkAssertion,
    };
  },
});
