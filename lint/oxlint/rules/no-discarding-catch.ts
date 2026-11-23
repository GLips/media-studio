// ─── no-discarding-catch ───────────────────────────────────────
//
// Makes sure: no catch handler throws away the failure it was handed. A
// `.catch`, `Effect.catch` or `catchEager` handler that never reads its
// failure answers every one alike: a missing file and a crashed ffmpeg become
// one fallback. A `.catch` on `mutateAsync(…)` reports too: a server
// function's typed failures arrive in its answer.
//
// It reads the web app, where a failure meets a person, and the Effect-native
// features (studio-tree.ts). A log line counts as a read. A boundary with one
// answer for any failure disables the rule on its line.
//
// NEGATIVE SPACE: `catchTag` and the narrowing catchers name the one failure
// they run for. A handler passed by name, `.then(ok, onRejected)` and
// `Effect.orElse*` aren't read, nor older Node-side best-effort cleanup.
// ──────────────────────────────────────────────────────────────────────

import { defineSourceRule, webPlaceOf } from "../lib/rule-file.ts";
import { effectNativeRole } from "../../policy/studio-tree.ts";
import { calledMemberName } from "../lib/called-member-name.ts";
import { staticKeyName } from "../lib/static-key-name.ts";
import { type ESTree, type SourceCode } from "@oxlint/plugins";

const DISCARDING_CATCH_METHODS = new Set(["catch", "catchEager"]);
const MUTATION_PROMISE_METHOD = "mutateAsync";

type HandlerFunction = ESTree.ArrowFunctionExpression | ESTree.Function;

function isHandlerFunction(node: ESTree.Node): node is HandlerFunction {
  return node.type === "ArrowFunctionExpression" || node.type === "FunctionExpression";
}

// Asks the handler's scope, so a same-named binding in a nested function isn't taken for a read.
function discardsItsFailure(sourceCode: SourceCode, handler: HandlerFunction): boolean {
  const [failure] = handler.params;
  if (failure === undefined) return true;
  // A destructured failure reads the fields it names.
  if (failure.type !== "Identifier") return false;
  const parameter = sourceCode.getDeclaredVariables(handler).find((variable) => variable.name === failure.name);
  return parameter !== undefined && parameter.references.length === 0;
}

/** `mutation.mutateAsync(…).catch(…)`: the call the `.catch` hangs off is a mutation's promise. */
function isMutationPromiseCatch(node: ESTree.CallExpression): boolean {
  const { callee } = node;
  if (callee.type !== "MemberExpression") return false;
  if (staticKeyName(callee.property, callee.computed) !== "catch") return false;
  const { object } = callee;
  return object.type === "CallExpression" && calledMemberName(object.callee) === MUTATION_PROMISE_METHOD;
}

export const noDiscardingCatchRule = defineSourceRule({
  meta: {
    type: "problem",
    messages: {
      discardingCatch:
        "This catch handler never reads the failure it was handed, so every failure gets the same answer and nobody can tell which one happened. Handle the failure by its tag, or let it propagate.",
      mutationPromiseCatch:
        "A server function's typed failures arrive in mutateAsync's answer, so its rejection is only ever a defect. Read the answer instead of catching the promise.",
    },
  },
  create(context, file) {
    if (webPlaceOf(file.position) === undefined && effectNativeRole(file.position) === undefined) return {};

    return {
      CallExpression(node) {
        if (isMutationPromiseCatch(node)) {
          context.report({ node, messageId: "mutationPromiseCatch" });
          return;
        }
        const method = calledMemberName(node.callee);
        if (method === undefined || !DISCARDING_CATCH_METHODS.has(method)) return;
        for (const argument of node.arguments) {
          if (isHandlerFunction(argument) && discardsItsFailure(context.sourceCode, argument)) {
            context.report({ node: argument, messageId: "discardingCatch" });
          }
        }
      },
    };
  },
});
