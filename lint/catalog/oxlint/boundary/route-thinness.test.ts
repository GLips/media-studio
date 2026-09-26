import { describeRule } from "../lib/rule-spec.ts";
import { routeThinnessRule } from "./route-thinness.ts";

// `apps/web/src` alone. Routes are this rule's whole subject and `packages/core/src`
// has none — it declares `rootRouteName: null` because it has no composition root —
// so a `packages/core/src/routes/` fixture would name a directory that tree will never
// hold. The web tree also declares all three env modules, which is what the combined-env
// case below needs.
const ROUTE = "/repo/web/src/routes/invoices.tsx";
const NESTED_ROUTE = "/repo/web/src/routes/admin/settings.tsx";

describeRule("boundary/route-thinness", routeThinnessRule, {
  obvious: [
    {
      name: "a route reaching straight past the feature layer to the DB",
      filename: ROUTE,
      code: `import { db } from "#web/infrastructure/db";`,
      errors: [{ message: "Routes are isomorphic thin adapters. Import data through the client-safe feature barrel (#web/features/<feature>), not #web/infrastructure/db or #web/env.server or #web/env." }],
    },
    {
      name: "a route reading server-only env, which is a secret in the transport layer",
      filename: ROUTE,
      code: `import { serverEnv } from "#web/env.server";`,
      errors: [{ messageId: "serverOnlyImportInRoute" }],
    },
  ],

  adversarial: [
    {
      name: "a dynamic import is a call expression, not an import declaration",
      filename: ROUTE,
      code: `export const loader = async () => (await import("#web/env.server")).serverEnv;`,
      errors: [{ messageId: "serverOnlyImportInRoute" }],
    },
    {
      name: "a re-export carries the same runtime dependency an import does",
      filename: ROUTE,
      code: `export { serverEnv } from "#web/env.server";`,
      errors: [{ messageId: "serverOnlyImportInRoute" }],
    },
    {
      name: "a star re-export names no binding to notice",
      filename: ROUTE,
      code: `export * from "#web/infrastructure/db/schema/invoices";`,
      errors: [{ messageId: "serverOnlyImportInRoute" }],
    },
    {
      name: "a type-only import still couples the route to the schema's shape",
      filename: ROUTE,
      code: `import type { Invoice } from "#web/infrastructure/db/schema/invoices";`,
      errors: [{ messageId: "serverOnlyImportInRoute" }],
    },
    {
      name: "the DB module has subpaths, so matching the client module alone misses the schema",
      filename: NESTED_ROUTE,
      code: `import { invoices } from "#web/infrastructure/db/schema/invoices";`,
      errors: [{ messageId: "serverOnlyImportInRoute" }],
    },
    {
      // The SINGLE-env option. Nothing in this specifier says "server" — the
      // ban comes from the tree declaring `env` as an `env-server` module, so a
      // rule that matched the `.server` spelling read this as client-safe and
      // let the secrets through in silence.
      name: "the combined env module, which carries the secrets the split one isolates",
      filename: ROUTE,
      code: `import { env } from "#web/env";`,
      errors: [{ messageId: "serverOnlyImportInRoute" }],
    },
    {
      name: "a route nested two directories deep is still the transport layer",
      filename: NESTED_ROUTE,
      code: `import { db } from "#web/infrastructure/db";`,
      errors: [{ messageId: "serverOnlyImportInRoute" }],
    },
    {
      // The one file a wider import licence could plausibly have exempted.
      name: "the root route has a wider import licence and is not exempt from this one",
      filename: "/repo/web/src/routes/__root.tsx",
      code: `import { db } from "#web/infrastructure/db";`,
      errors: [{ messageId: "serverOnlyImportInRoute" }],
    },
  ],

  legal: [
    {
      name: "the client-safe feature barrel, which is how a route is meant to get data",
      filename: ROUTE,
      code: `import { billingLabel } from "#web/features/billing";`,
    },
    {
      name: "the client env module, which carries nothing secret",
      filename: ROUTE,
      code: `import { env } from "#web/env.public";`,
    },
    {
      name: "an infrastructure module whose name merely starts like the DB one",
      filename: ROUTE,
      code: `import { dbtLogger } from "#web/infrastructure/dbt-logger";`,
    },
    {
      name: "an env module whose name merely starts like the server one",
      filename: ROUTE,
      code: `import { flags } from "#web/env.server-flags";`,
    },
    {
      name: "a directory that merely starts with 'routes' is not the routes layer",
      filename: "/repo/web/src/routes-legacy/invoices.tsx",
      code: `import { db } from "#web/infrastructure/db";`,
    },
    {
      name: "the service layer, which is allowed the dependencies a route is not",
      filename: "/repo/web/src/features/billing/service/charge.ts",
      code: `import { serverEnv } from "#web/env.server";`,
    },
    {
      name: "a server barrel is api/server-import-context's arm, not a third one here",
      filename: ROUTE,
      code: `import { listInvoices } from "#web/features/billing/index.server";`,
    },
    {
      name: "a route file named .server.ts is a server context that may name a server barrel, so an arm here would deny what that rule permits",
      filename: "/repo/web/src/routes/api.invoices.server.ts",
      code: `import { listInvoices } from "#web/features/billing/index.server";`,
    },
    {
      name: "a route's test may reach across every boundary",
      filename: "/repo/web/src/routes/invoices.test.tsx",
      code: `import { db } from "#web/infrastructure/db";`,
    },
    {
      // `#` is Node's subpath-imports prefix; `#web/` is the alias. A different `#` specifier is
      // a well-formed import rather than a typo nobody writes: `#infrastructure/db` is a different
      // subpath entry, and a matcher testing for `#` plus the segment would claim it.
      name: "a subpath specifier that shares the alias prefix's first character and not the prefix",
      filename: ROUTE,
      code: `import { connect } from "#infrastructure/db";`,
    },
  ],
});
