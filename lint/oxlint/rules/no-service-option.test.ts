import { describeRule } from "../lib/rule-spec.ts";
import { noServiceOptionRule } from "./no-service-option.ts";

const SERVICE = "lib/footage/library/engine/add-to-library.ts";
const IMPORTS = `import { Effect, Option } from "effect";\nimport { Metrics } from "./library-metrics.ts";`;

describeRule("no-service-option", noServiceOptionRule, {
  obvious: [
    {
      name: "the optional lookup inside a generator",
      filename: SERVICE,
      code: `${IMPORTS}\nexport const addTake = Effect.gen(function* () {\n  const metrics = yield* Effect.serviceOption(Metrics);\n  return Option.isSome(metrics) ? metrics.value.count() : 0;\n});`,
      errors: [{ messageId: "optionalService" }],
    },
    {
      name: "the same lookup composed into a pipeline",
      filename: SERVICE,
      code: `${IMPORTS}\nexport const metricsOrNone = Effect.serviceOption(Metrics).pipe(\n  Effect.map(Option.getOrNull),\n);`,
      errors: [{ messageId: "optionalService" }],
    },
  ],

  adversarial: [
    {
      name: "imported bare, with no member expression to match",
      filename: SERVICE,
      code: `import { serviceOption } from "effect/Effect";\nimport { Metrics } from "./library-metrics.ts";\nexport const metricsOrNone = serviceOption(Metrics);`,
      errors: [{ messageId: "optionalService" }],
    },
    {
      name: "referenced as a value and applied elsewhere",
      filename: SERVICE,
      code: `${IMPORTS}\nconst lookup = Effect.serviceOption;\nexport const metricsOrNone = lookup(Metrics);`,
      errors: [{ messageId: "optionalService" }],
    },
  ],

  legal: [
    {
      name: "yielding the service, which keeps it a requirement of the effect",
      filename: SERVICE,
      code: `${IMPORTS}\nexport const addTake = Effect.gen(function* () {\n  const metrics = yield* Metrics;\n  return metrics.count();\n});`,
    },
    {
      // The neighbour the exact-name match exists to protect: `Effect.service` keeps the service in
      // the requirements type, so an absent layer is still a compile error.
      name: "the neighbouring accessor that keeps the service a requirement",
      filename: SERVICE,
      code: `${IMPORTS}\nexport const metrics = Effect.service(Metrics);`,
    },
    {
      name: "an Option in the domain has nothing to do with service wiring",
      filename: SERVICE,
      code: `${IMPORTS}\nexport const firstTakeName = (names: ReadonlyArray<string>) =>\n  names.length === 0 ? Option.none() : Option.some(names[0]);`,
    },
    {
      name: "the no-op layer the rule pushes toward, where the choice is made in composition",
      filename: SERVICE,
      code: `import { Layer } from "effect";\nimport { Metrics } from "./library-metrics.ts";\nexport const metricsNoopLayer = Layer.succeed(Metrics, { count: () => 0 });`,
    },
    {
      name: "a similarly named config key is not the accessor",
      filename: SERVICE,
      code: `${IMPORTS}\nexport const defaults = { serviceOptions: { retries: 3 } };`,
    },
  ],
});
