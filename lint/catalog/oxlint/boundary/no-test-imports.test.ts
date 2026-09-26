import assert from "node:assert/strict";
import { test } from "node:test";
import { RECOMMENDED_VOCABULARY, type TreeVocabulary } from "../../policy/layout.ts";
import { describeRule } from "../lib/rule-spec.ts";
import { noTestImportsRule, testImportMessageData } from "./no-test-imports.ts";

// The RuleTester case below pins the WORDING; this pins that the wording is
// READ FROM THE TREE, and neither is the other. Both entries in `DECLARED_TREES`
// spell `sharedDir` the way `RECOMMENDED_VOCABULARY` does and both prefix `#web/`, so
// a message frozen back to a literal `#web/shared/` renders exactly the text asserted
// below and passes — declaring two trees bought nothing here, because they agree on
// the two names this message reads. Measured: deleting the derivation and hard-coding
// the rendered string leaves this whole spec green. A vocabulary that spells these
// differently is the only thing that separates the two, and a rule spec cannot declare
// a tree of its own.
test("boundary/no-test-imports sends the reader to the reporting tree's own shared directory", () => {
  const RENAMED: TreeVocabulary = {
    ...RECOMMENDED_VOCABULARY,
    aliasPrefix: "~/",
    sharedDir: "common",
  };
  assert.deepEqual(testImportMessageData(RENAMED), { shared: "~/common" });
});

// Rooted in `packages/core/src`, where the co-located `<name>.test.ts` convention and
// the DB-backed suites both live. Note what this project does NOT have: a `test/`
// directory INSIDE either source root. `packages/core/test/` sits beside `src`, outside
// every declared tree, so the `#web/test/…` cases below fence a path nothing currently
// resolves to — the invariant is live, its subject is not. One web case covers the other
// tree, where the same convention holds with none of the same layout.
const SERVICE = "/repo/web/src/features/billing/service/charge.ts";
const REPO_LAYER = "/repo/web/src/features/billing/repo/queries.ts";

describeRule("boundary/no-test-imports", noTestImportsRule, {
  obvious: [
    {
      // The message, asserted whole rather than by `messageId`, because a
      // message that stopped interpolating would report on exactly these
      // fixtures and read identically at the `messageId` level. `src/shared/` is
      // the absent half — the frozen literal this rule shipped with, which named
      // a directory no tree rooted outside `src` has. What this case cannot say
      // is that the text is DERIVED: see the derivation test at the top of the
      // file, which is the half that goes red on a freeze.
      name: "production code importing a sibling spec, and the message names the tree's own shared directory",
      filename: SERVICE,
      code: `import { makeInvoice } from "./charge.test";\nexport const charge = () => makeInvoice();`,
      errors: [
        {
          message:
            "Production code cannot import from test files. If this utility is needed by both tests and production, move it to #web/shared/ or the appropriate production directory.",
        },
      ],
    },
    {
      name: "production code importing shared test infrastructure by alias",
      filename: REPO_LAYER,
      code: `import { seedDb } from "#web/test/seed";`,
      errors: [{ messageId: "testImport" }],
    },
    {
      name: "production code importing a __tests__ directory",
      filename: REPO_LAYER,
      code: `import { fakeRow } from "../__tests__/fixtures";`,
      errors: [{ messageId: "testImport" }],
    },
    {
      // The other declared tree. Nothing about the convention is per-tree — `.test`, `__tests__/`
      // and `test/` are naming facts the catalog fixes for every tree — so the web tree's
      // production code is fenced on the same terms with none of core's layout.
      name: "a web component reaching its own spec is the same finding in the other tree",
      filename: "/repo/web/src/features/billing/ui/panel.tsx",
      code: `import { renderPanel } from "./panel.test";\nexport const Panel = () => renderPanel();`,
      errors: [{ messageId: "testImport" }],
    },
  ],

  adversarial: [
    {
      name: "a dynamic import pulls the test helper into the bundle just the same",
      filename: REPO_LAYER,
      code: `export const lazySeed = async () => (await import("#web/test/factories")).makeInvoice;`,
      errors: [{ messageId: "testImport" }],
    },
    {
      name: "a re-export carries the same dependency an import does",
      filename: REPO_LAYER,
      code: `export { makeInvoice } from "../service/charge.test";`,
      errors: [{ messageId: "testImport" }],
    },
    {
      name: "a star re-export names no binding to notice",
      filename: REPO_LAYER,
      code: `export * from "../__tests__/fixtures";`,
      errors: [{ messageId: "testImport" }],
    },
    {
      name: "the extensionless spelling, where a pattern assuming a trailing dot misses",
      filename: REPO_LAYER,
      code: `import { helper } from "./queries.test";`,
      errors: [{ messageId: "testImport" }],
    },
    {
      name: "a type-only import still binds production types to a test module's shape",
      filename: REPO_LAYER,
      code: `import type { SeededRow } from "#web/test/seed";`,
      errors: [{ messageId: "testImport" }],
    },
  ],

  legal: [
    {
      // A violation, and not this tier's. The specifier names no path a linter
      // can read, and matching it here would take a literal `src/` in the pattern
      // — root knowledge this tier does not hold, and wrong for every tree whose
      // root is spelled differently. The structural tier resolves the specifier
      // and boundary/import-policy reports it there.
      // This project's shared test root is `packages/core/test/`, a sibling of the source root and
      // outside every declared tree — so the relative climb below is the ONLY spelling that
      // reaches it, and this rule sees none of them.
      name: "a relative path into the shared test root is the structural tier's finding",
      filename: REPO_LAYER,
      code: `import { seedDb } from "../../../../test/seed";`,
    },
    {
      name: "a test file may import whatever it likes — the rule governs production code",
      filename: "/repo/web/src/features/billing/service/charge.test.ts",
      code: `import { seedDb } from "#web/test/seed";\nimport { fakeRow } from "../__tests__/fixtures";`,
    },
    {
      name: "a helper inside __tests__ may reach its neighbours",
      filename: "/repo/web/src/features/billing/__tests__/fixtures.ts",
      code: `import { seedDb } from "#web/test/seed";`,
    },
    {
      // The file `charge.test.helpers.ts` is production code — the exemption
      // predicate reads the whole suffix, and `.test.helpers` is not `.test`. A
      // specifier matcher looking for `.test.` ANYWHERE called the same module a
      // test, so one module was inside the architecture contract and outside it
      // depending on which rule asked.
      name: "a module whose name contains the suffix without ending in it is production code",
      filename: SERVICE,
      code: `import { chargeFixture } from "./charge.test.helpers";`,
    },
    {
      name: "a module whose name merely ends in the word",
      filename: SERVICE,
      code: `import { latestRate } from "#web/shared/rates/latest";`,
    },
    {
      name: "a module whose name merely contains the word",
      filename: SERVICE,
      code: `import { attestation } from "./attestation";\nimport { protestBanner } from "../ui/protest";`,
    },
    {
      name: "a directory that merely starts with the test segment is not the test root",
      filename: SERVICE,
      code: `import { quote } from "#web/testimonials/quote";`,
    },
    {
      name: "an ordinary production import",
      filename: SERVICE,
      code: `import { formatMoney } from "#web/shared/money";`,
    },
    {
      name: "a one-off script is not part of the shipped module graph",
      filename: "/repo/web/src/scripts/backfill.ts",
      code: `import { seedDb } from "#web/test/seed";`,
    },
  ],
});
