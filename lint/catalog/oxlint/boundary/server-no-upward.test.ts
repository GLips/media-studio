import assert from "node:assert/strict";
import { test } from "node:test";
import { RECOMMENDED_VOCABULARY, type TreeVocabulary } from "../../policy/layout.ts";
import { describeRule } from "../lib/rule-spec.ts";
import { infraImportsUpperLayerMessageData, serverNoUpwardRule } from "./server-no-upward.ts";

// The RuleTester case below pins the WORDING; this pins that the wording is
// READ FROM THE TREE, and neither is the other. BOTH entries in `DECLARED_TREES`
// spell these four names the way `RECOMMENDED_VOCABULARY` does — so a message frozen
// back to the literal `features, domains, or routes` renders text the case below still
// accepts, in either tree. Measured: deleting the derivation and
// hard-coding the rendered string leaves this whole spec green. A second vocabulary
// is the only thing that separates the two, and a rule spec cannot declare a second
// tree.
//
// All four names are renamed at once, so no assertion here passes on an accident
// of the recommended spelling.
test("boundary/server-no-upward names the reporting tree's own upper directories", () => {
  const RENAMED: TreeVocabulary = {
    ...RECOMMENDED_VOCABULARY,
    aliasPrefix: "~/",
    infrastructureDir: "adapters",
    featuresDir: "capabilities",
    domainsDir: "core",
    routesDir: "pages",
  };
  assert.deepEqual(infraImportsUpperLayerMessageData(RENAMED), {
    infrastructureDir: "adapters",
    upperAreas: "~/capabilities, ~/core, ~/pages",
  });
});

// Both declared trees have an infrastructure layer and this rule fences both, so the
// two constants sit one per tree: `run-write.ts` is the core spine's write boundary, and
// `tk-core.ts` is the single module in the web app permitted to name `@tk/core`. Neither
// tree spells any of the four names this rule reads differently, which is why the message
// case below can be asserted whole from either.
const CORE_WRITE_BOUNDARY = "/repo/web/src/infrastructure/db/run-write.ts";
const WEB_CORE_WRAPPER = "/repo/web/src/infrastructure/tk-core.ts";

describeRule("boundary/server-no-upward", serverNoUpwardRule, {
  obvious: [
    {
      // The message, asserted whole rather than by `messageId`, because a
      // message that stopped interpolating would report on exactly these
      // fixtures and read identically at the `messageId` level. The absent half
      // is the bare English list this rule shipped with — "features, domains, or
      // routes" — which named three directories the fence was deliberately NOT
      // keyed on. What this case cannot say is that the text is DERIVED: see the
      // derivation test at the top of the file, which is the half that goes red
      // on a freeze.
      name: "infrastructure consuming the feature layer it is meant to serve, and the message names the tree's own upper directories",
      filename: CORE_WRITE_BOUNDARY,
      code: `import { renderInvoice } from "#web/features/billing";\nexport const send = () => renderInvoice();`,
      errors: [
        {
          message:
            "A module in infrastructure/ cannot import from #web/features, #web/domains, #web/routes. The infrastructure/ layer provides services to the layers above it — it does not consume them. If this module needs feature-specific behavior, accept it as a parameter.",
        },
      ],
    },
    {
      name: "infrastructure reaching into the domain layer",
      filename: WEB_CORE_WRAPPER,
      code: `import { riskBand } from "#web/domains/risk";`,
      errors: [{ messageId: "infraImportsUpperLayer" }],
    },
    {
      name: "infrastructure reaching into a route module",
      filename: WEB_CORE_WRAPPER,
      code: `import { Route } from "#web/routes/dashboard";`,
      errors: [{ messageId: "infraImportsUpperLayer" }],
    },
  ],

  adversarial: [
    {
      name: "a dynamic import reverses the dependency arrow just as surely",
      filename: WEB_CORE_WRAPPER,
      code: `export const lazyRoute = async () => (await import("#web/routes/dashboard")).Route;`,
      errors: [{ messageId: "infraImportsUpperLayer" }],
    },
    {
      name: "a re-export carries the same dependency an import does",
      filename: WEB_CORE_WRAPPER,
      code: `export { InvoiceRow } from "#web/features/billing/ui/row";`,
      errors: [{ messageId: "infraImportsUpperLayer" }],
    },
    {
      name: "a star re-export names no binding to notice",
      filename: WEB_CORE_WRAPPER,
      code: `export * from "#web/features/billing";`,
      errors: [{ messageId: "infraImportsUpperLayer" }],
    },
    {
      name: "a type-only import still couples infrastructure to a feature's internals",
      filename: CORE_WRITE_BOUNDARY,
      code: `import type { Invoice } from "#web/features/billing";`,
      errors: [{ messageId: "infraImportsUpperLayer" }],
    },
    {
      name: "a nested infrastructure module is still infrastructure",
      filename: "/repo/web/src/infrastructure/db/schema/invoices.ts",
      code: `import { markPaid } from "#web/features/billing";`,
      errors: [{ messageId: "infraImportsUpperLayer" }],
    },
  ],

  legal: [
    {
      // Upward, and reported — by boundary/import-policy, as `unclassifiedTarget`.
      // A subdivided directory names no unit, so this rule has no area to compare
      // against and stays quiet rather than guessing. The two messages are
      // jointly actionable: the fix is to name the feature, and this rule then
      // reports the edge that names it.
      name: "the bare subdivided directory is import-policy's finding, not this rule's",
      filename: WEB_CORE_WRAPPER,
      code: `import features from "#web/features";\nimport domains from "#web/domains";`,
    },
    {
      name: "infrastructure reaching sideways to its own layer",
      filename: CORE_WRITE_BOUNDARY,
      code: `import { SqlFailure } from "#web/infrastructure/db/sql-failure";\nimport { writeContext } from "./write-context";`,
    },
    {
      name: "infrastructure reaching down to shared utilities and validated config",
      filename: CORE_WRITE_BOUNDARY,
      code: `import { formatDate } from "#web/shared/date";\nimport { env } from "#web/env";`,
    },
    {
      name: "a top-level directory sharing a full prefix with a banned segment",
      filename: CORE_WRITE_BOUNDARY,
      code: `import { registry } from "#web/featuresets/registry";\nimport { legacyCart } from "#web/features-legacy/cart";`,
    },
    {
      name: "a top-level directory that diverges inside the banned segment",
      filename: CORE_WRITE_BOUNDARY,
      code: `import { featureFlags } from "#web/feature-flags";\nimport { routeTable } from "#web/routing";`,
    },
    {
      name: "a test may reach across every boundary",
      filename: "/repo/web/src/infrastructure/db/run-write.test.ts",
      code: `import { renderInvoice } from "#web/features/billing";`,
    },
    {
      name: "a directory that merely starts with the infrastructure segment is not governed",
      filename: "/repo/web/src/infrastructure-legacy/mailer/send.ts",
      code: `import { renderInvoice } from "#web/features/billing";`,
    },
    {
      name: "the feature layer importing itself is what the layering is for",
      filename: "/repo/web/src/features/billing/service/charge.ts",
      code: `import { riskBand } from "#web/domains/risk";`,
    },
  ],
});
