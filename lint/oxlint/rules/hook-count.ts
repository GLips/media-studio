// ─── hook-count ─────────────────────────────────────────────────
//
// Shows: each exported component making 7 or more hook calls, and the count.
// Each is a hook a test must set up. A warning, since some components collect
// independent hooks by design.
//
// Per component, not per file: a component beside the custom hook extracted
// from it is the shape this rule asks for. A custom hook (lowercase `use…`) is
// never a subject, since it is the extraction's target.
//
// Hooks in nested callbacks and conditionals count, as React's own lint plugin
// counts them. What IS a hook is lib/hook-calls.ts's answer, shared with
// no-async-effect.
// ──────────────────────────────────────────────────────────────────────

import { defineSourceRule, isComponentFile } from "../lib/rule-file.ts";
import { type Range } from "@oxlint/plugins";
import { exportedComponents } from "../lib/component-declarations.ts";
import { hookCallName } from "../lib/hook-calls.ts";
import { numericRuleOption } from "../lib/rule-options.ts";

const DEFAULT_THRESHOLD = 7;

export const hookCountRule = defineSourceRule({
  meta: {
    type: "suggestion",
    schema: [
      {
        type: "object",
        properties: { threshold: { type: "integer", minimum: 1 } },
        additionalProperties: false,
      },
    ],
    defaultOptions: [{ threshold: DEFAULT_THRESHOLD }],
    messages: {
      tooManyHooks:
        "{{name}} calls {{hooks}} hooks (threshold: {{threshold}}). Group the related ones into a purpose-named custom hook — the hooks that move together, not the ones that share a type — and put it in a sibling use*.ts file. If the component is genuinely an orchestrator gathering independent hooks, leave it: this is a warning for that reason.",
    },
  },
  create(context, file) {
    if (!isComponentFile(file)) return {};

    const threshold = numericRuleOption(context.options[0], "threshold", DEFAULT_THRESHOLD);
    // Recorded on the way past and attributed at the end: a visitor reaches a component's function
    // before the hook calls inside it, so "how many hooks are in this subtree" cannot be answered
    // when the component is visited.
    const hookCalls: Range[] = [];

    return {
      CallExpression(node) {
        if (hookCallName(node.callee, context.sourceCode) !== undefined) {
          hookCalls.push(node.range);
        }
      },

      "Program:exit"(program) {
        for (const component of exportedComponents(program, context.sourceCode)) {
          if (component.fn === null) continue;

          const [start, end] = component.fn.range;
          const hooks = hookCalls.filter(([at]) => at >= start && at < end).length;
          if (hooks < threshold) continue;

          context.report({
            node: component.node,
            messageId: "tooManyHooks",
            data: { name: component.name, hooks, threshold },
          });
        }
      },
    };
  },
});
