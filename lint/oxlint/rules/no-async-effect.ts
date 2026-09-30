// ─── no-async-effect ────────────────────────────────────────────
//
// Makes sure: every useEffect doing async work returns a cleanup, and no
// useCallback is async, so a `setState` after an `await` can't land on an
// unmounted component.
//
// Any `return () => …` counts as cleanup; judging what it does reports effects
// that cancel correctly. Async work is `await`, an async function, or `.then`.
// An async useCallback reports wherever it sits, since the effect calling it is
// often in another file.
//
// NEGATIVE SPACE: only `.tsx`/`.jsx` files are read, so an async effect in a
// `use-x.ts` hook module draws no report.
// ──────────────────────────────────────────────────────────────────────

import { defineSourceRule, isComponentFile } from "../lib/rule-file.ts";
import { type ESTree, type Range } from "@oxlint/plugins";
import { hookCallName } from "../lib/hook-calls.ts";
import { createRangeIndex } from "../lib/range-index.ts";

const EFFECT_HOOK = "useEffect";
const CALLBACK_HOOK = "useCallback";

const ASYNC_WORK = "asyncWork";
const CLEANUP = "cleanup";

export const noAsyncEffectRule = defineSourceRule({
  meta: {
    type: "problem",
    messages: {
      asyncEffect:
        "Async operation inside useEffect without cleanup risks memory leaks and stale state updates. Use TanStack Query for data fetching, or restructure as a single useEffect with a cancelled flag and cleanup return.",
      asyncCallback:
        "Async useCallback is typically called from useEffect without proper cleanup. Use TanStack Query for data fetching, or inline the async logic in a useEffect with a cancelled flag and cleanup return.",
    },
  },
  create(context, file) {
    if (!isComponentFile(file)) return {};

    // Async work and cleanup are both facts about the effect callback's whole subtree, which a
    // visitor cannot know when it reaches the callback. Every async spelling records its range on
    // the way past — the `async` flag is one field, so an annotated `async (): Promise<T> =>` needs
    // no separate arm the way a source-snippet pattern does.
    const index = createRangeIndex();
    const effects: { node: ESTree.CallExpression; callback: Range }[] = [];

    return {
      AwaitExpression(node) {
        index.record(ASYNC_WORK, node.range);
      },
      ArrowFunctionExpression(node) {
        if (node.async) index.record(ASYNC_WORK, node.range);
      },
      FunctionDeclaration(node) {
        if (node.async) index.record(ASYNC_WORK, node.range);
      },
      FunctionExpression(node) {
        if (node.async) index.record(ASYNC_WORK, node.range);
      },
      // An effect's cleanup is the last thing it returns; a `return () => …` anywhere inside it is
      // the signal that the author thought about unwinding.
      ReturnStatement(node) {
        const returned = node.argument;
        if (returned !== null && returned.type === "ArrowFunctionExpression") {
          index.record(CLEANUP, node.range);
        }
      },
      CallExpression(node) {
        const { callee } = node;

        if (
          callee.type === "MemberExpression" &&
          !callee.computed &&
          callee.property.type === "Identifier" &&
          callee.property.name === "then"
        ) {
          index.record(ASYNC_WORK, node.range);
          return;
        }
        if (node.arguments.length === 0) return;
        const hook = hookCallName(callee, context.sourceCode);
        const [callback] = node.arguments;
        if (hook === EFFECT_HOOK) {
          effects.push({ node, callback: callback.range });
        } else if (
          hook === CALLBACK_HOOK &&
          (callback.type === "ArrowFunctionExpression" ||
            callback.type === "FunctionExpression") &&
          callback.async
        ) {
          context.report({ node, messageId: "asyncCallback" });
        }
      },

      // The two findings are independent claims about the same file, so a component carrying both
      // reports both in one pass rather than surfacing the second only after the first is fixed.
      "Program:exit"() {
        for (const { node, callback } of effects) {
          if (index.containedIn(CLEANUP, callback)) continue;
          if (index.containedIn(ASYNC_WORK, callback)) {
            context.report({ node, messageId: "asyncEffect" });
          }
        }
      },
    };
  },
});
