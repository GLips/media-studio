import { describeRule } from "../lib/rule-spec.ts";
import { noSilentErrorSwallowRule } from "./no-silent-error-swallow.ts";

const SERVICE = "lib/footage/library/engine/add-to-library.ts";
const IMPORTS = `import { Effect, pipe } from "effect";\nimport { probeTake } from "./media-probe.ts";`;

describeRule("no-silent-error-swallow", noSilentErrorSwallowRule, {
  obvious: [
    {
      name: "catch returning the empty effect, data-last inside a pipe",
      filename: SERVICE,
      code: `${IMPORTS}\nexport const addTake = (id: string) =>\n  probeTake(id).pipe(Effect.catch(() => Effect.void));`,
      errors: [{ messageId: "silentErrorSwallow" }],
    },
    {
      name: "catchTag on one named error",
      filename: SERVICE,
      code: `${IMPORTS}\nexport const addTake = (id: string) =>\n  probeTake(id).pipe(Effect.catchTag("ProbeFailed", () => Effect.void));`,
      errors: [{ messageId: "silentErrorSwallow" }],
    },
  ],

  adversarial: [
    {
      // The handler is argument two here and argument one in the piped form. A rule reading
      // `arguments[0]` reports on one spelling of the same swallow and stays silent on the other.
      name: "the data-first spelling, where the handler is not the first argument",
      filename: SERVICE,
      code: `${IMPORTS}\nexport const addTake = (id: string) =>\n  Effect.catch(probeTake(id), () => Effect.void);`,
      errors: [{ messageId: "silentErrorSwallow" }],
    },
    {
      name: "data-first catchTag, where the handler is the third argument",
      filename: SERVICE,
      code: `${IMPORTS}\nexport const addTake = (id: string) =>\n  Effect.catchTag(probeTake(id), "ProbeFailed", () => Effect.void);`,
      errors: [{ messageId: "silentErrorSwallow" }],
    },
    {
      name: "the standalone pipe function rather than the method",
      filename: SERVICE,
      code: `${IMPORTS}\nexport const addTake = (id: string) =>\n  pipe(probeTake(id), Effect.catch(() => Effect.void));`,
      errors: [{ messageId: "silentErrorSwallow" }],
    },
    {
      name: "the catchTags object form, where the handler is a property value",
      filename: SERVICE,
      code: `${IMPORTS}\nexport const addTake = (id: string) =>\n  probeTake(id).pipe(\n    Effect.catchTags({\n      ProbeFailed: () => Effect.void,\n      FfprobeMissing: (error) => Effect.fail(error),\n    }),\n  );`,
      errors: [{ messageId: "silentErrorSwallow" }],
    },
    {
      // Narrowing by predicate is narrowing by tag with more steps: the failure it matches still
      // leaves the type, and the caller still reads a success.
      name: "a catcher narrowed by predicate, which swallows what it matches",
      filename: SERVICE,
      code: `${IMPORTS}\nimport { isProbeFailed } from "./media-probe.ts";\nexport const addTake = (id: string) =>\n  probeTake(id).pipe(Effect.catchIf(isProbeFailed, () => Effect.void));`,
      errors: [{ messageId: "silentErrorSwallow" }],
    },
    {
      name: "a reason inside a tagged error, handled through the catchReasons object form",
      filename: SERVICE,
      code: `${IMPORTS}\nexport const addTake = (id: string) =>\n  probeTake(id).pipe(\n    Effect.catchReasons("ProbeError", {\n      ProbeFailed: () => Effect.void,\n      Timeout: (reason) => Effect.fail(reason),\n    }),\n  );`,
      errors: [{ messageId: "silentErrorSwallow" }],
    },
    {
      // A log line before the return is what the swallow looks like once someone has felt uneasy
      // about it. The handler still returns nothing, and the error is still gone from the type.
      name: "a block body that logs first and swallows anyway",
      filename: SERVICE,
      code: `${IMPORTS}\nexport const addTake = (id: string) =>\n  probeTake(id).pipe(\n    Effect.catch((error) => {\n      console.error(error);\n      return Effect.void;\n    }),\n  );`,
      errors: [{ messageId: "silentErrorSwallow" }],
    },
    {
      // One tag answered with the empty effect, the rest re-failed: a considered-looking swallow, and
      // a scan of the block's top-level statements sees only `return Effect.fail(e)`.
      name: "a conditional return, where only one path answers with the empty effect",
      filename: SERVICE,
      code: `${IMPORTS}\nexport const addTake = (id: string) =>\n  probeTake(id).pipe(\n    Effect.catch((error) => {\n      if (error._tag === "ProbeFailed") return Effect.void;\n      return Effect.fail(error);\n    }),\n  );`,
      errors: [{ messageId: "silentErrorSwallow" }],
    },
    {
      // Two swallowing returns are ONE handler and one edit. A per-return report would leave the
      // second diagnostic standing after the fix that removes both.
      name: "two swallowing paths in one handler are one finding",
      filename: SERVICE,
      code: `${IMPORTS}\nexport const addTake = (id: string) =>\n  probeTake(id).pipe(\n    Effect.catch((error) => {\n      switch (error._tag) {\n        case "ProbeFailed":\n          return Effect.void;\n        default:\n          return Effect.succeed(undefined);\n      }\n    }),\n  );`,
      errors: [{ messageId: "silentErrorSwallow" }],
    },
    {
      name: "the empty effect built by hand, around a ban on the short name",
      filename: SERVICE,
      code: `${IMPORTS}\nexport const addTake = (id: string) =>\n  probeTake(id).pipe(Effect.catch(() => Effect.succeed(undefined)));`,
      errors: [{ messageId: "silentErrorSwallow" }],
    },
    {
      name: "the combinator imported bare, with no Effect namespace to match on",
      filename: SERVICE,
      code: `import { catchTag } from "effect/Effect";\nimport * as Eff from "effect/Effect";\nimport { probeTake } from "./media-probe.ts";\nexport const addTake = (id: string) => catchTag(probeTake(id), "ProbeFailed", () => Eff.void);`,
      errors: [{ messageId: "silentErrorSwallow" }],
    },
  ],

  legal: [
    {
      name: "recovering with a value the caller can use",
      filename: SERVICE,
      code: `${IMPORTS}\nexport const addTake = (id: string) =>\n  probeTake(id).pipe(Effect.catchTag("ProbeFailed", () => Effect.succeed({ added: false })));`,
    },
    {
      name: "mapping the failure to an error this layer declares",
      filename: SERVICE,
      code: `${IMPORTS}\nimport { LibraryUnavailable } from "./library-errors.ts";\nexport const addTake = (id: string) =>\n  probeTake(id).pipe(Effect.catch((cause) => Effect.fail(new LibraryUnavailable({ cause }))));`,
    },
    {
      name: "a handler that does real recovery work in a generator",
      filename: SERVICE,
      code: `${IMPORTS}\nimport { reindexLibrary } from "./library-index.ts";\nexport const addTake = (id: string) =>\n  probeTake(id).pipe(\n    Effect.catchTag("FfprobeMissing", () =>\n      Effect.gen(function* () {\n        yield* reindexLibrary(id);\n        return { added: true };\n      }),\n    ),\n  );`,
    },
    {
      // Not a catch: `tap` runs alongside the value and changes no failure channel, so the empty
      // effect there is a no-op, not a swallow. Reporting it would train people past the rule.
      name: "the empty effect in a combinator that is not catching anything",
      filename: SERVICE,
      code: `${IMPORTS}\nexport const addTake = (id: string) => probeTake(id).pipe(Effect.tap(() => Effect.void));`,
    },
    {
      // The walk from a `return` stops at the first function it meets: the mapper's `Effect.void`
      // is the mapper's value, and the handler re-fails.
      name: "a return inside a nested callback is that callback's, not the handler's",
      filename: SERVICE,
      code: `${IMPORTS}\nexport const addTake = (id: string) =>\n  probeTake(id).pipe(\n    Effect.catch((error) => {\n      const quiet = [error].map(() => {\n        return Effect.void;\n      });\n      return Effect.fail(quiet);\n    }),\n  );`,
    },
    {
      name: "the empty effect as a normal branch of a program, nowhere near a catch",
      filename: SERVICE,
      code: `${IMPORTS}\nexport const notify = (shouldSend: boolean) =>\n  shouldSend ? probeTake("take-1") : Effect.void;`,
    },
  ],
});
