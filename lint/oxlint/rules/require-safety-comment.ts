// ─── require-safety-comment ────────────────────────────────────
//
// Makes sure: every type assertion carries a `SAFETY:` comment naming the
// invariant, so `rg "SAFETY:"` audits every place the code overrules the
// compiler, and a type change says what to recheck.
//
// One marker only; a second spelling splits the search. One comment covers
// every assertion in the statement below it, so `value as unknown as User`
// passes with one; no-chained-type-assertions is what refuses that chain.
// `as const` needs none: it narrows a literal and can't be wrong.
// ──────────────────────────────────────────────────────────────────────

import { defineSourceRule } from "../lib/rule-file.ts";
import { type ESTree } from "@oxlint/plugins";

type TypeAssertion = ESTree.TSAsExpression | ESTree.TSTypeAssertion;

const SAFETY_COMMENT = /\bSAFETY\s*:/u;

// The walk up stops at a node sitting directly in a statement list, so an assertion inside a call
// argument finds the comment above its statement, never one above an unrelated earlier one. Testing the PARENT, not statement kinds, is what makes `export const x = raw as T`
// work: the comment sits above the ExportNamedDeclaration wrapper, not the VariableDeclaration.
const STATEMENT_LIST_PARENTS = new Set([
  "BlockStatement",
  "ClassBody",
  "Program",
  "StaticBlock",
  "SwitchCase",
  "TSModuleBlock",
]);

// `as const` is not an assertion about provenance — it narrows a literal the compiler can already
// see, and cannot be wrong. Asking for a justification would train people to write empty ones.
function isConstAssertion(node: TypeAssertion): boolean {
  return (
    node.typeAnnotation.type === "TSTypeReference" &&
    node.typeAnnotation.typeName.type === "Identifier" &&
    node.typeAnnotation.typeName.name === "const"
  );
}

export const requireSafetyCommentRule = defineSourceRule({
  meta: {
    type: "problem",
    messages: {
      missingSafetyComment:
        "This type assertion states no reason. Add a `// SAFETY:` comment naming the invariant that makes it true — what was already checked, and where. If no such invariant exists, parse the value instead of asserting it.",
    },
  },
  create(context) {

    function hasSafetyComment(node: TypeAssertion): boolean {
      let current: ESTree.Node = node;
      while (true) {
        const comments = context.sourceCode.getCommentsBefore(current);
        // `comment.end <= node.start` is load-bearing: getCommentsBefore on an outer node returns
        // comments before *that* node, which for a trailing same-line comment can sit after the
        // assertion itself. A justification written after the code it justifies is not one.
        if (comments.some((comment) => comment.end <= node.start && SAFETY_COMMENT.test(comment.value))) {
          return true;
        }
        const parent: ESTree.Node | null = current.parent;
        // `Program` is the one node with no parent, and it is in the set above — so the walk always
        // stops at an enclosing statement list before it can reach it. The null branch is how that
        // is stated to the compiler, not a case that runs.
        if (parent === null || STATEMENT_LIST_PARENTS.has(parent.type)) return false;
        current = parent;
      }
    }

    const checkAssertion = (node: TypeAssertion) => {
      if (isConstAssertion(node) || hasSafetyComment(node)) return;
      context.report({ node, messageId: "missingSafetyComment" });
    };

    return {
      TSAsExpression: checkAssertion,
      // The angle-bracket spelling is a different node for the same operation. A rule that visits
      // only TSAsExpression is bypassed by a syntax an agent picks for style reasons, not evasion.
      TSTypeAssertion: checkAssertion,
    };
  },
});
