import { describeRule } from "../lib/rule-spec.ts";
import { noManualTagComparisonRule } from "./no-manual-tag-comparison.ts";

const SERVICE = "lib/footage/library/engine/take-decision.ts";
const ROUTE = "web/src/features/projects/ui/take-row.tsx";
const IMPORTS = `import { Effect, Match, Predicate } from "effect";`;

describeRule("no-manual-tag-comparison", noManualTagComparisonRule, {
  obvious: [
    {
      name: "an if-chain over a union's tags",
      filename: SERVICE,
      code: `${IMPORTS}\nexport const decide = (reading) => {\n  if (reading._tag === "alive") return "keep";\n  if (reading._tag === "gone") return "reap";\n  return "skip";\n};`,
      errors: [{ messageId: "manualComparison" }, { messageId: "manualComparison" }],
    },
    {
      name: "a switch on the tag",
      filename: SERVICE,
      code: `export const label = (run) => {\n  switch (run._tag) {\n    case "open": return "Open";\n    default: return "Ended";\n  }\n};`,
      errors: [{ messageId: "manualSwitch" }],
    },
  ],

  adversarial: [
    {
      name: "the literal on the left, Yoda-style",
      filename: SERVICE,
      code: `export const isOpen = (run) => "open" === run._tag;`,
      errors: [{ messageId: "manualComparison" }],
    },
    {
      name: "optional chaining wraps the read in a ChainExpression",
      filename: SERVICE,
      code: `export const isOpen = (run) => run?._tag !== "open";`,
      errors: [{ messageId: "manualComparison" }],
    },
    {
      name: "the tag compared to a named constant rather than a literal",
      filename: SERVICE,
      code: `const OPEN = "open";\nexport const isOpen = (run) => run._tag === OPEN;`,
      errors: [{ messageId: "manualComparison" }],
    },
    {
      name: "the tag destructured under its own name",
      filename: SERVICE,
      code: `export const isOpen = ({ _tag }) => _tag === "open";`,
      errors: [{ messageId: "manualComparison" }],
    },
    {
      // Recovering one error by tag is what Effect.catchTag spells, so a broad catch isn't exempt.
      name: "recovering one error by tag inside a broad catch",
      filename: SERVICE,
      code: `${IMPORTS}\nexport const tolerant = (work) => work.pipe(\n  Effect.catch((error) => error._tag === "NotFound" ? Effect.succeed(null) : Effect.fail(error)),\n);`,
      errors: [{ messageId: "manualComparison" }],
    },
    {
      name: "a component branching on the tag in JSX",
      filename: ROUTE,
      code: `export function TakeRow({ run }) {\n  return run._tag === "open" ? <span>open</span> : null;\n}`,
      errors: [{ messageId: "manualComparison" }],
    },
    {
      name: "the tag tested against an inline array of tags",
      filename: SERVICE,
      code: `export const settled = (reading) => ["alive", "gone"].includes(reading._tag);`,
      errors: [{ messageId: "inlineTagList" }],
    },
    {
      name: "the tag tested against an inline set of tags",
      filename: SERVICE,
      code: `export const settled = (reading) => new Set(["alive", "gone"]).has(reading._tag);`,
      errors: [{ messageId: "inlineTagList" }],
    },
  ],

  legal: [
    {
      name: "exhaustive dispatch with Match.valueTags",
      filename: SERVICE,
      code: `${IMPORTS}\nexport const decide = (reading) => Match.valueTags(reading, { alive: () => "keep", gone: () => "reap" });`,
    },
    {
      name: "a single-variant guard through Predicate.isTagged",
      filename: SERVICE,
      code: `${IMPORTS}\nexport const isRun = (principal) => Predicate.isTagged(principal, "Run");`,
    },
    {
      name: "recovering one error with catchTag",
      filename: SERVICE,
      code: `${IMPORTS}\nexport const tolerant = (work) => work.pipe(Effect.catchTag("NotFound", () => Effect.succeed(null)));`,
    },
    {
      name: "two values compared for being the same variant",
      filename: SERVICE,
      code: `export const sameVariant = (a, b) => a._tag === b._tag;`,
    },
    {
      name: "building a tagged literal is construction, not comparison",
      filename: SERVICE,
      code: `export const skip = () => ({ _tag: "Skip", cause: "recording-unreadable" });`,
    },
    {
      name: "a field named tag without the underscore",
      filename: SERVICE,
      code: `export const isRelease = (commit) => commit.tag === "release";`,
    },
    {
      name: "a named set of tags asked with has",
      filename: SERVICE,
      code: `const RETRYABLE_REFUSAL_TAGS = new Set(["Busy", "Stale"]);\nexport const retryable = (refusal) => RETRYABLE_REFUSAL_TAGS.has(refusal._tag);`,
    },
    {
      name: "a switch on a discriminant other than _tag",
      filename: SERVICE,
      code: `export const label = (write) => {\n  switch (write.verb) {\n    case "close": return "Close";\n    default: return "Other";\n  }\n};`,
    },
    {
      name: "a tag read used as a table key",
      filename: SERVICE,
      code: `const LABELS = { open: "Open", ended: "Ended" };\nexport const label = (run) => LABELS[run._tag];`,
    },
  ],
});
