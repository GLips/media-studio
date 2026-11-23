// ─── effect-native-failures ────────────────────────────────────
//
// Makes sure: the engine of an Effect-native feature (EFFECT_NATIVE_FEATURES
// in studio-tree.ts) fails only through the error channel. No `throw`, no
// `try`, no native `Error` built or extended: an expected failure is a
// Schema.TaggedError yielded or failed, so its type names every way the call
// can go wrong and a caller recovers by tag. A thrown value is a defect, which
// runStudioEffect reports with its stack.
//
// A promise from the world outside Effect enters through Effect.tryPromise,
// whose `catch` maps the rejection to a tagged error.
//
// NEGATIVE SPACE: specs, and the feature's models and studio code, aren't
// read. A global error constructor reached through `globalThis` isn't.
// ──────────────────────────────────────────────────────────────────────

import { defineSourceRule } from "../lib/rule-file.ts";
import { effectNativeRole } from "../../policy/studio-tree.ts";
import { type ESTree } from "@oxlint/plugins";

const NATIVE_ERRORS = new Set(["Error", "TypeError", "RangeError", "SyntaxError", "ReferenceError", "AggregateError"]);

const isNativeError = (node: ESTree.Node | null) => node?.type === "Identifier" && NATIVE_ERRORS.has(node.name);

export const effectNativeFailuresRule = defineSourceRule({
  meta: {
    type: "problem",
    messages: {
      thrown:
        "A throw in Effect-native engine code is a defect, not a failure: no type names it and no caller can recover by tag. Fail with a Schema.TaggedError (`return yield* new ItemMissing({ … })`).",
      tryCatch:
        "try/catch in Effect-native engine code catches what Effect already carries typed. Recover by tag with Effect.catchTag, or bring a promise in through Effect.tryPromise with a `catch` that maps to a tagged error.",
      nativeError:
        "A native Error has no tag, so a caller can't tell this failure from any other. Declare a Schema.TaggedError whose message says what went wrong.",
    },
  },
  create(context, file) {
    if (effectNativeRole(file.position) !== "engine") return {};

    const reportExtends = (node: ESTree.Class) => {
      if (isNativeError(node.superClass)) context.report({ node: node.superClass ?? node, messageId: "nativeError" });
    };
    return {
      ThrowStatement(node) {
        context.report({ node, messageId: "thrown" });
      },
      TryStatement(node) {
        context.report({ node, messageId: "tryCatch" });
      },
      NewExpression(node) {
        if (isNativeError(node.callee)) context.report({ node, messageId: "nativeError" });
      },
      // `Error("…")` constructs one without `new`.
      CallExpression(node) {
        if (isNativeError(node.callee)) context.report({ node, messageId: "nativeError" });
      },
      ClassDeclaration: reportExtends,
      ClassExpression: reportExtends,
    };
  },
});
