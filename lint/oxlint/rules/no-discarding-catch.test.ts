import { describeRule } from "../lib/rule-spec.ts";
import { noDiscardingCatchRule } from "./no-discarding-catch.ts";

const UI = "web/src/features/review/ui/approve-button.tsx";
const IMPORTS = `import { Effect } from "effect";\nimport { approveCut } from "#web/features/review/controllers/approve";`;

describeRule("no-discarding-catch", noDiscardingCatchRule, {
  obvious: [
    {
      name: "a promise catch whose handler takes no failure",
      filename: UI,
      code: `${IMPORTS}\nexport const approve = (id: string) => approveCut(id).catch(() => "Not approved");`,
      errors: [{ messageId: "discardingCatch" }],
    },
    {
      name: "a catch on a mutation's promise",
      filename: UI,
      code: `${IMPORTS}\nexport const approve = (mutation: { mutateAsync: (id: string) => Promise<void> }) =>\n  mutation.mutateAsync("a").catch((error: unknown) => console.error(error));`,
      errors: [{ messageId: "mutationPromiseCatch" }],
    },
  ],

  adversarial: [
    {
      // Naming the failure and never reading it discards it as surely as taking none.
      name: "a handler that names the failure and never reads it",
      filename: UI,
      code: `${IMPORTS}\nexport const approve = (id: string) => approveCut(id).catch((_error) => "Not approved");`,
      errors: [{ messageId: "discardingCatch" }],
    },
    {
      name: "the data-first Effect spelling, where the handler is the second argument",
      filename: UI,
      code: `${IMPORTS}\nexport const approve = (id: string) => Effect.catch(Effect.promise(() => approveCut(id)), () => Effect.succeed(null));`,
      errors: [{ messageId: "discardingCatch" }],
    },
    {
      name: "an Effect-native engine answering every failure with an empty library",
      filename: "lib/footage/library/engine/library-index.ts",
      code: `import { Effect } from "effect";\nimport { readIndex } from "./library-store.ts";\nexport const items = readIndex.pipe(Effect.catch(() => Effect.succeed([])));`,
      errors: [{ messageId: "discardingCatch" }],
    },
    {
      name: "a function expression rather than an arrow",
      filename: UI,
      code: `${IMPORTS}\nexport const approve = (id: string) => approveCut(id).catch(function () { return null; });`,
      errors: [{ messageId: "discardingCatch" }],
    },
    {
      // Asked of the handler's scope: an inner function's own `error` isn't a read of the outer one.
      name: "a nested function's same-named parameter is not the handler's",
      filename: UI,
      code: `${IMPORTS}\nexport const approve = (id: string) => approveCut(id).catch((error) => [1].map((error) => error));`,
      errors: [{ messageId: "discardingCatch" }],
    },
  ],

  legal: [
    {
      name: "best-effort cleanup in Node-side code not yet on Effect",
      filename: "lib/output/render/engine/render-chunks.ts",
      code: `import { rm } from "node:fs/promises";\nexport const dropChunk = (path: string) => rm(path).catch(() => undefined);`,
    },
    {
      name: "a handler that answers with the failure's own sentence",
      filename: UI,
      code: `${IMPORTS}\nexport const approve = (id: string) =>\n  Effect.promise(() => approveCut(id)).pipe(Effect.catch((failure) => Effect.succeed(failure.message)));`,
    },
    {
      name: "a destructured failure reads the fields it names",
      filename: UI,
      code: `${IMPORTS}\nexport const approve = (id: string) => approveCut(id).catch(({ message }: Error) => message);`,
    },
    {
      // Negative space: a catchTag handler runs for one failure the call already names.
      name: "catchTag ignoring the value of the one failure it names",
      filename: UI,
      code: `${IMPORTS}\nexport const approve = (id: string) =>\n  Effect.promise(() => approveCut(id)).pipe(Effect.catchTag("ReviewClosed", () => Effect.succeed(null)));`,
    },
  ],
});
