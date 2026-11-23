// ─── no-silent-error-swallow ───────────────────────────────────
//
// Makes sure: no catch handler answers a failure with the empty effect, so
// when an add reports success and the item isn't there, you read the add, not
// every handler between it and the caller. Every catcher counts (CATCH_METHODS,
// each branch of `catchTags`), data-first and data-last.
//
// Every return the handler owns counts, at any depth, and a ternary counts as
// the branch it is: `e._tag === "Missing" ? Effect.void : Effect.fail(e)`
// swallows one failure. Two such paths are one finding, as they're one edit.
//
// Idempotent recovery (a delete's `catchTag("NotFound", () => Effect.void)`)
// reports too: return a value naming the outcome, or disable the line with
// the invariant beside it.
//
// NEGATIVE SPACE: a handler passed by name needs the type-aware tier.
// ──────────────────────────────────────────────────────────────────────

import { defineSourceRule } from "../lib/rule-file.ts";
import { calledMemberName } from "../lib/called-member-name.ts";
import { staticKeyName } from "../lib/static-key-name.ts";
import { sourceOrderedReports } from "../lib/source-ordered-reports.ts";
import { type ESTree } from "@oxlint/plugins";

const CATCH_METHODS = new Set([
  "catch",
  "catchEager",
  "catchTag",
  "catchTags",
  "catchIf",
  "catchFilter",
  "catchReason",
  "catchReasons",
]);
const VOID_EFFECT_MEMBER = "void";
const SUCCEED_METHOD = "succeed";

// `Effect.succeed(undefined)` is the same value as `Effect.void`, written around a ban on the
// shorter spelling, so both are in the set.
function isEmptyEffect(node: ESTree.Node | null | undefined): boolean {
  if (node === null || node === undefined) return false;
  if (node.type === "MemberExpression") return staticKeyName(node.property, node.computed) === VOID_EFFECT_MEMBER;
  if (node.type === "CallExpression" && calledMemberName(node.callee) === SUCCEED_METHOD) {
    const [value] = node.arguments;
    if (value === undefined) return false;
    if (value.type === "Identifier" && value.name === "undefined") return true;
    return value.type === "UnaryExpression" && value.operator === "void";
  }
  // Either arm: a `fail(e)` in one arm doesn't fix the swallow in the other.
  if (node.type === "ConditionalExpression") return isEmptyEffect(node.consequent) || isEmptyEffect(node.alternate);
  return false;
}

function isCatchCall(node: ESTree.CallExpression): boolean {
  const method = calledMemberName(node.callee);
  return method !== undefined && CATCH_METHODS.has(method);
}

/** Whether a function sits in a catch call's handler position, directly or as a tag's value. */
function isCatchHandler(handler: ESTree.Node): boolean {
  const { parent } = handler;
  if (parent === null) return false;
  // `catchTags({ NotFound: … })`: the handler is a property value, and the call two levels up.
  if (parent.type === "Property" && parent.parent?.type === "ObjectExpression") {
    const call = parent.parent.parent;
    return call?.type === "CallExpression" && isCatchCall(call);
  }
  return parent.type === "CallExpression" && isCatchCall(parent);
}

// Walked up from the return, so depth is no question: a return inside an `if`, `switch` or `try`
// reaches its handler by the same walk. The first function met owns the return.
function enclosingCatchHandler(node: ESTree.Node): ESTree.Node | undefined {
  let cursor: ESTree.Node | null = node.parent;
  while (cursor !== null) {
    if (cursor.type === "ArrowFunctionExpression" || cursor.type === "FunctionExpression" || cursor.type === "FunctionDeclaration") {
      return isCatchHandler(cursor) ? cursor : undefined;
    }
    cursor = cursor.parent;
  }
  return undefined;
}

/** A concise arrow body is an expression, with no `return` for the upward walk to start from. */
function isConciseEmptyHandler(node: ESTree.Node): boolean {
  return node.type === "ArrowFunctionExpression" && node.body.type !== "BlockStatement" && isEmptyEffect(node.body);
}

export const noSilentErrorSwallowRule = defineSourceRule({
  meta: {
    type: "problem",
    messages: {
      silentErrorSwallow:
        "This catch handler returns Effect.void, so the failure leaves the type and the program at once and the caller reads a success. Let the error propagate, map it with Effect.mapError to an error this layer declares, or recover with a value that names the outcome.",
    },
  },
  create(context) {
    // A concise body reports at its call, a block body at a `return` further down, so one owner
    // puts them back in source order.
    const ordered = sourceOrderedReports(context);
    const reported = new Set<ESTree.Node>();
    const reportHandler = (handler: ESTree.Node) => {
      if (reported.has(handler)) return;
      reported.add(handler);
      ordered.report({ node: handler, messageId: "silentErrorSwallow" });
    };

    return {
      ReturnStatement(node) {
        if (!isEmptyEffect(node.argument)) return;
        const handler = enclosingCatchHandler(node);
        if (handler !== undefined) reportHandler(handler);
      },

      CallExpression(node) {
        if (!isCatchCall(node)) return;
        // Every argument, so data-first and data-last are one case, not positional branches.
        for (const argument of node.arguments) {
          if (isConciseEmptyHandler(argument)) {
            reportHandler(argument);
            continue;
          }
          if (argument.type !== "ObjectExpression") continue;
          // `catchTags`: each tag is its own handler, so each is its own finding.
          for (const property of argument.properties) {
            if (property.type === "Property" && isConciseEmptyHandler(property.value)) reportHandler(property.value);
          }
        }
      },

      // This rule owns `Program:exit` outright; lib/source-ordered-reports.ts says why.
      "Program:exit"() {
        ordered.flushInSourceOrder();
      },
    };
  },
});
