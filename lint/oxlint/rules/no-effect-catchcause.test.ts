import { describeRule } from "../lib/rule-spec.ts";
import { noEffectCatchCauseRule } from "./no-effect-catchcause.ts";

const SERVICE = "lib/footage/library/engine/add-to-library.ts";
const IMPORTS = `import { Effect } from "effect";\nimport { probeTake } from "./media-probe.ts";`;

describeRule("no-effect-catchcause", noEffectCatchCauseRule, {
  obvious: [
    {
      name: "the cause catcher data-last in a pipe",
      filename: SERVICE,
      code: `${IMPORTS}\nexport const addTake = (id: string) =>\n  probeTake(id).pipe(Effect.catchCause(() => Effect.succeed({ added: false })));`,
      errors: [{ messageId: "causeCaught" }],
    },
    {
      name: "the same call written data-first",
      filename: SERVICE,
      code: `${IMPORTS}\nexport const addTake = (id: string) =>\n  Effect.catchCause(probeTake(id), () => Effect.succeed({ added: false }));`,
      errors: [{ messageId: "causeCaught" }],
    },
  ],

  adversarial: [
    {
      name: "imported bare, with no member expression to match",
      filename: SERVICE,
      code: `import { catchCause, succeed } from "effect/Effect";\nimport { probeTake } from "./media-probe.ts";\nexport const addTake = (id: string) => catchCause(probeTake(id), () => succeed(null));`,
      errors: [{ messageId: "causeCaught" }],
    },
    {
      // Passed as a value rather than called. A CallExpression-only rule sees nothing here, and the
      // defect is caught all the same as soon as the pipeline runs.
      name: "referenced as a value and applied elsewhere",
      filename: SERVICE,
      code: `${IMPORTS}\nconst quiet = Effect.catchCause;\nexport const addTake = (id: string) => quiet(probeTake(id), () => Effect.succeed(null));`,
      errors: [{ messageId: "causeCaught" }],
    },
    {
      // The precise spelling of the same decision, and the one reached for once the first is
      // refused — it does not even have the excuse of catching declared errors alongside.
      name: "the defect catcher, which is the retry after the cause catcher is refused",
      filename: SERVICE,
      code: `${IMPORTS}\nexport const addTake = (id: string) =>\n  probeTake(id).pipe(Effect.catchDefect(() => Effect.succeed(null)));`,
      errors: [{ messageId: "defectCaught" }],
    },
    {
      // No handler at all, so nothing even pretends to recover: the defect becomes a success.
      name: "the cause discarded outright, the step past catching it",
      filename: SERVICE,
      code: `${IMPORTS}\nexport const addTake = (id: string) => probeTake(id).pipe(Effect.ignoreCause);`,
      errors: [{ messageId: "causeIgnored" }],
    },
  ],

  legal: [
    {
      name: "catching the errors the type declares",
      filename: SERVICE,
      code: `${IMPORTS}\nexport const addTake = (id: string) =>\n  probeTake(id).pipe(Effect.catchTag("ProbeFailed", () => Effect.succeed({ added: false })));`,
    },
    {
      name: "catch takes the error channel and leaves defects travelling",
      filename: SERVICE,
      code: `${IMPORTS}\nexport const addTake = (id: string) =>\n  probeTake(id).pipe(Effect.catch(() => Effect.succeed({ added: false })));`,
    },
    {
      // Reading the cause is the opposite of swallowing it: the failure carries on to the runtime
      // boundary with a log line attached. A rule matching the word "cause" would report here.
      name: "observing the cause without catching it",
      filename: SERVICE,
      code: `import { Cause, Effect } from "effect";\nimport { probeTake } from "./media-probe.ts";\nexport const addTake = (id: string) =>\n  probeTake(id).pipe(Effect.tapCause((cause) => Effect.logError(Cause.pretty(cause))));`,
    },
    {
      // A prefix of the name, not the name: the exact match leaves every cause the predicate
      // rejects travelling, which a rule matching `catchCause*` would report anyway.
      name: "a cause catcher narrowed to one known failure",
      filename: SERVICE,
      code: `${IMPORTS}\nimport { isProbeTimeout } from "./media-probe.ts";\nexport const addTake = (id: string) =>\n  probeTake(id).pipe(Effect.catchCauseIf(isProbeTimeout, () => Effect.succeed({ added: false })));`,
    },
    {
      name: "sandbox exposes the cause in the error channel without handling it",
      filename: SERVICE,
      code: `${IMPORTS}\nexport const addTake = (id: string) => probeTake(id).pipe(Effect.sandbox);`,
    },
  ],
});
