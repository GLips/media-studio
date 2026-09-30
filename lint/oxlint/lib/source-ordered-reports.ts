import type { Context, ESTree } from "@oxlint/plugins";

/** A diagnostic to be held until the file is walked. `node` is required — it is what gets sorted. */
type OrderedDiagnostic = {
  node: ESTree.Node;
  messageId: string;
  data?: Record<string, string>;
};

/**
 * Holds a rule's diagnostics until `Program:exit` and emits them in source order.
 *
 * oxlint emits in report order, so whole-file findings land after the traversal's.
 *
 * ONE OWNER: every arm reports through this, even those already in order.
 *
 * NO SPEC CAN PIN THIS (RuleTester sorts by span); check the oxlint CLI by hand.
 *
 * NEGATIVE SPACE: no `loc`-only diagnostics; sorting needs a span.
 */
export function sourceOrderedReports(context: Context) {
  const pending: OrderedDiagnostic[] = [];

  const flushInSourceOrder = () => {
    pending.sort((left, right) => left.node.range[0] - right.node.range[0]);
    for (const diagnostic of pending) context.report(diagnostic);
    pending.length = 0;
  };

  return {
    report(diagnostic: OrderedDiagnostic) {
      pending.push(diagnostic);
    },

    /**
     * Call this LAST inside the rule's own `Program:exit`, once every arm has had its say.
     *
     * There is deliberately no visitor to spread: a spread `Program:exit` and the rule's own
     * cannot coexist, the second in the object literal silently winning and taking the flush or
     * a whole arm with it. `visitImportedNames` has no `Program:exit` for the same reason.
     */
    flushInSourceOrder,
  };
}
