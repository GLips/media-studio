// One case per direction the adapter has to get right, and — because this is one
// rule where a per-directory design would be several — cases on the edges BETWEEN
// those directions, which is where a set of narrower rules has nobody to answer.
//
// The ENGINE's cases — that a path reaches the cell its author intended, and that
// one edge spelled two ways reaches one verdict — are in
// `lint/policy/import-policy.test.ts`. This file proves the ADAPTER: that the
// rule reads every place a specifier can appear, classifies the file it is
// handed, and reports what the engine returns.
//
// The repo prefix is deliberately not this machine's checkout path. The rule
// finds the source root by its own segment, so any prefix exercises the same
// code — and a spec that hardcodes one developer's home directory is a spec that
// only runs there.

import { describeRule } from "../lib/rule-spec.ts";
import { importPolicyRule } from "./import-policy.ts";

// Rooted in `web/src`, the one declared tree. It holds every position with a distinctive row —
// `routes/`, the `__root.tsx` composition root, `shared/ui/`, the source root with its router and
// generated route tree, and all three env modules — so it exercises the table widest.
const SRC = "/repo/web/src";
const SHARED_UI = `${SRC}/shared/ui/Button.tsx`;
const FEATURE_UI = `${SRC}/features/billing/ui/InvoiceTable.tsx`;
const DOMAIN = `${SRC}/domains/pricing/rate-card.ts`;
const ROUTE = `${SRC}/routes/_authed/invoices.tsx`;
const ROOT_ROUTE = `${SRC}/routes/__root.tsx`;

describeRule("boundary/import-policy", importPolicyRule, {
  obvious: [
    {
      name: "a primitive taking on a feature dependency",
      filename: SHARED_UI,
      code: `import { useInvoices } from "#web/features/billing";`,
      errors: [{ messageId: "deniedDirection" }],
    },
    {
      name: "a shared helper reaching an adapter",
      filename: `${SRC}/shared/utils.ts`,
      code: `import { db } from "#web/infrastructure/media-store";`,
      errors: [{ messageId: "deniedDirection" }],
    },
    {
      name: "a domain querying, which makes an answer depend on the database",
      filename: DOMAIN,
      code: `import { invoiceRows } from "#web/features/billing/repo/invoice-rows";`,
      errors: [{ messageId: "impureDomainRuntimeImport" }],
    },
    {
      name: "a route reaching past a feature's barrel into its data layers",
      filename: ROUTE,
      code: `import { invoiceSummary } from "#web/features/billing/service/invoice-summary";`,
      errors: [{ messageId: "deniedExposure" }],
    },
    {
      name: "a feature reaching into another feature's internals",
      filename: FEATURE_UI,
      code: `import { placeOrder } from "#web/features/orders/controllers/place";`,
      errors: [{ messageId: "deniedExposure" }],
    },
    {
      name: "an adapter reaching up into a feature, an edge no rule covered before",
      filename: `${SRC}/infrastructure/telemetry/sentry.ts`,
      code: `import { useInvoices } from "#web/features/billing";`,
      errors: [{ messageId: "deniedDirection" }],
    },
    {
      name: "a route reading the server env, which is not isomorphic",
      filename: ROUTE,
      code: `import { serverEnv } from "#web/env.server";`,
      errors: [{ messageId: "deniedDirection" }],
    },
    {
      // Pairs with the `legal` case where the ROOT route does exactly this and
      // passes. Neither half proves the fence alone.
      name: "an ordinary route constructing a provider, which is a second one of whatever it built",
      filename: ROUTE,
      code: `import { createQueryClient } from "#web/infrastructure/providers/query-client";`,
      errors: [{ messageId: "deniedDirection" }],
    },
    {
      name: "a nested layout sharing the root route's filename and none of its licence",
      filename: `${SRC}/routes/_authed/__root.tsx`,
      code: `import { createQueryClient } from "#web/infrastructure/providers/query-client";`,
      errors: [{ messageId: "deniedDirection" }],
    },
    {
      name: "a service reaching infrastructure, an edge no rule covered before",
      filename: `${SRC}/features/billing/service/invoice-summary.ts`,
      code: `import { db } from "#web/infrastructure/media-store";`,
      errors: [{ messageId: "deniedDirection" }],
    },
    {
      // The client entry naming a feature. The source-root row grants routes, infrastructure,
      // shared, both env areas and the source root itself, and deliberately not this: wiring that
      // knows which features exist is a boot sequence that has to be edited to add one.
      name: "the client entry naming a feature, which the source-root row does not grant",
      filename: `${SRC}/client.tsx`,
      code: `import { listTickets } from "#web/features/billing";`,
      errors: [{ messageId: "deniedDirection" }],
    },
  ],

  adversarial: [
    {
      name: "a dynamic import is a call expression, not an import declaration",
      filename: SHARED_UI,
      code: `export const lazyDb = async () => (await import("#web/infrastructure/media-store")).db;`,
      errors: [{ messageId: "deniedDirection" }],
    },
    {
      name: "a re-export carries the same runtime dependency an import does",
      filename: `${SRC}/shared/ui/index.ts`,
      code: `export { InvoiceTable } from "#web/features/billing";`,
      errors: [{ messageId: "deniedDirection" }],
    },
    {
      name: "a star re-export names no binding to notice",
      filename: `${SRC}/shared/ui/index.ts`,
      code: `export * from "#web/domains/pricing";`,
      errors: [{ messageId: "deniedDirection" }],
    },
    {
      name: "a literal require() is the same dependency the import graph already counted",
      filename: SHARED_UI,
      code: `const db = require("#web/infrastructure/media-store");`,
      errors: [{ messageId: "deniedDirection" }],
    },
    {
      name: "require.resolve binds no value and still names the module",
      filename: SHARED_UI,
      code: `export const at = require.resolve("#web/features/billing");`,
      errors: [{ messageId: "deniedDirection" }],
    },
    {
      name: "a type-only import still couples the primitive to a domain's shape",
      filename: SHARED_UI,
      code: `import type { RateCard } from "#web/domains/pricing";`,
      errors: [{ messageId: "deniedDirection" }],
    },
    {
      name: "a side-effect import binds nothing and still drags the module in",
      filename: SHARED_UI,
      code: `import "#web/infrastructure/telemetry/sentry";`,
      errors: [{ messageId: "deniedDirection" }],
    },
    {
      name: "a sibling directory that merely starts with the primitives' segment is a different area",
      filename: `${SRC}/shared/ui-kit/Card.tsx`,
      code: `import { useInvoices } from "#web/features/billing";`,
      errors: [{ messageId: "deniedDirection" }],
    },
    {
      name: "a primitive nested in a subdirectory is still a primitive",
      filename: `${SRC}/shared/ui/table/Cell.tsx`,
      code: `import { useInvoices } from "#web/features/billing";`,
      errors: [{ messageId: "deniedDirection" }],
    },
    {
      name: "a domain naming a package at runtime, however small the package is",
      filename: DOMAIN,
      code: `import { z } from "zod";`,
      errors: [{ messageId: "impureDomainRuntimeImport" }],
    },
    {
      name: "a domain reaching the client env at runtime, which the caller could have passed",
      filename: `${SRC}/domains/pricing/index.ts`,
      code: `import { clientEnv } from "#web/env.public";`,
      errors: [{ messageId: "impureDomainRuntimeImport" }],
    },
    {
      name: "a feature barrel is not a place code lives: everything outside the feature is refused",
      filename: `${SRC}/features/billing/index.ts`,
      code: `import { z } from "zod";\nexport { Button } from "#web/shared/ui";`,
      errors: [{ messageId: "deniedDirection" }, { messageId: "deniedDirection" }],
    },
    {
      name: "a feature's errors.ts is at the root and is not the barrel, so its row is its own",
      filename: `${SRC}/features/billing/errors.ts`,
      code: `import { z } from "zod";\nimport { db } from "#web/infrastructure/media-store";`,
      errors: [{ messageId: "deniedDirection" }],
    },
    {
      name: "a repo is a leaf: another feature's barrel is still an edge out of it",
      filename: `${SRC}/features/billing/repo/invoice-rows.ts`,
      code: `import { placeOrder } from "#web/features/orders";`,
      errors: [{ messageId: "deniedDirection" }],
    },
    {
      name: "a .. segment inside an alias resolves to another area and must not read as this one",
      filename: DOMAIN,
      code: `import { db } from "#web/domains/pricing/../../infrastructure/media-store";`,
      errors: [{ messageId: "impureDomainRuntimeImport" }],
    },
    {
      name: "a .. segment cannot launder a cross-feature deep import into a same-unit one",
      filename: FEATURE_UI,
      code: `import { placeOrder } from "#web/features/billing/../orders/controllers/place";`,
      errors: [{ messageId: "deniedExposure" }],
    },
    {
      name: "import x = require() binds a value and reaches no ImportDeclaration visitor",
      filename: SHARED_UI,
      code: `import env = require("#web/env.server");\nexport const url = env;`,
      errors: [{ messageId: "deniedDirection" }],
    },
    {
      name: "a template literal with no substitutions is the spelling a quote-matcher misses",
      filename: SHARED_UI,
      code: "export const lazy = () => import(`#web/infrastructure/media-store`);",
      errors: [{ messageId: "deniedDirection" }],
    },
    {
      name: "an import() in TYPE position names the module without any import statement",
      filename: SHARED_UI,
      code: `export type Invoice = import("#web/features/billing").Invoice;`,
      errors: [{ messageId: "deniedDirection" }],
    },
    {
      name: "a new top-level directory enters as an unpoliced area, and says so with no imports at all",
      filename: `${SRC}/lib/format-date.ts`,
      code: `export const formatDate = (value: Date) => value.toISOString();`,
      errors: [{ messageId: "unclassifiedSource" }],
    },
    {
      name: "a directory inside a feature that is not a layer is reached by no policy",
      filename: `${SRC}/features/billing/helpers/format.ts`,
      code: `export const format = (value: string) => value;`,
      errors: [{ messageId: "unclassifiedSource" }],
    },
    {
      name: "an alias naming no area is loud rather than allowed by default",
      filename: FEATURE_UI,
      code: `import { formatDate } from "#web/lib/format-date";`,
      errors: [{ messageId: "unclassifiedTarget" }],
    },
    {
      // The same unpoliced area named with ONE segment, which is the spelling
      // that gets there. `src/lib.ts` and `src/lib/` are one string to a
      // classifier, so an arm reading "one segment, therefore a file in the
      // source root" hands `#web/lib` the source-root row — the permissive one —
      // while the deep spelling above stays loud. Add `src/lib/index.ts` and the
      // bare name is unmetered access to everything under it.
      name: "a bare alias naming no area is as loud as the deep one, not more permissive",
      filename: FEATURE_UI,
      code: `import { formatDate } from "#web/lib";`,
      errors: [{ messageId: "unclassifiedTarget" }],
    },
    {
      // A route reaching the composition root. Every member of that area a route
      // could name is an entrypoint or the generated route tree, and each of them
      // reaches back down to the routes — so this is a cycle through the file
      // that mounts the app, wearing the clothes of an ordinary import.
      name: "a route naming the composition root, which is a cycle back through itself",
      filename: ROUTE,
      code: `import { router } from "#web/router";`,
      errors: [{ messageId: "deniedDirection" }],
    },
  ],

  legal: [
    {
      name: "a primitive reading a shared helper — one boundary, two units, and a decided edge",
      filename: SHARED_UI,
      code: `import { cn } from "#web/shared/utils";\nimport { clientEnv } from "#web/env.public";`,
    },
    // The three below pin `staticModuleSpecifier`'s refusals from the visitModuleSources side. They
    // were asserted only through `runtimeImportSpecifier` before the two copies were merged, so
    // each of these guards could be deleted here with the suite green — which is how the two copies
    // came to have the same fix and different coverage. All three revert-probe from both sides now.
    {
      name: "a substituted template names a family of modules, so there is nothing to fence on",
      filename: SHARED_UI,
      code: "export const lazy = (name: string) => import(`#web/infrastructure/${name}`);",
    },
    {
      name: "a require with no argument loads nothing and names nothing",
      filename: SHARED_UI,
      code: `export const nothing = () => require();`,
    },
    {
      // Not merely a type narrow, though it reads as one: forced through with a cast, this hands
      // every consumer the NUMBER 0 as a specifier and the first rule to call `.split` on it dies.
      name: "a non-string literal names no module",
      filename: SHARED_UI,
      code: `export const odd = () => require(0);`,
    },
    {
      name: "a sibling primitive by alias, and the bare barrel that collects them",
      filename: SHARED_UI,
      code: `import { Text } from "#web/shared/ui/Text";\nexport { Box } from "#web/shared/ui/Box";\nimport { Icon } from "#web/shared/ui";`,
    },
    {
      name: "the packages a primitive is built from, and a scoped one that starts with @",
      filename: SHARED_UI,
      code: `import { useState } from "react";\nimport { cva } from "class-variance-authority";\nimport { useQuery } from "@tanstack/react-query";`,
    },
    {
      name: "a route composing a feature's ui, which is the exception the barrel rule grants",
      filename: ROUTE,
      code: `import { useInvoices } from "#web/features/billing";\nimport { InvoiceTable } from "#web/features/billing/ui/InvoiceTable";`,
    },
    {
      // The passing half of the fence. Which adapters the browser may take is
      // boundary/client-server-infra's question, not this rule's.
      name: "the root route mounting the providers, which is the one position that may",
      filename: ROOT_ROUTE,
      code: `import { createQueryClient } from "#web/infrastructure/providers/query-client";\nimport { AnalyticsProvider } from "#web/infrastructure/analytics";\nimport { clientEnv } from "#web/env.public";`,
    },
    {
      name: "the root route is still a route, so the routes it mounts are its own unit",
      filename: ROOT_ROUTE,
      code: `import { InvoicesScreen } from "#web/routes/_authed/invoices";\nimport { InvoiceTable } from "#web/features/billing/ui/InvoiceTable";`,
    },
    {
      name: "a controller taking the widest licence in the feature: adapter, server env, both barrels",
      filename: `${SRC}/features/billing/controllers/invoices.ts`,
      code: `import { db } from "#web/infrastructure/media-store";\nimport { serverEnv } from "#web/env.server";\nimport { rateFor } from "#web/domains/pricing";\nimport { placeOrder } from "#web/features/orders/index.server";`,
    },
    {
      name: "a feature reaching its own internals by its own alias is inside the feature",
      filename: FEATURE_UI,
      code: `import { useInvoices } from "#web/features/billing/controllers/invoices";\nimport { InvoiceError } from "#web/features/billing";`,
    },
    {
      name: "a domain barrel deep re-exporting its own modules, which barrel-only would break",
      filename: `${SRC}/domains/pricing/index.ts`,
      code: `export { rateFor } from "#web/domains/pricing/rate-card";\nexport type { Money } from "#web/domains/pricing/money";`,
    },
    {
      name: "a domain NAMING a package's type, because a type import is erased",
      // The `domain -> package` cell is `any` and the runtime-purity flag denies
      // the runtime edge, so this pair is the whole of what the flag decides.
      // A FEATURE type is a different case and is denied: that cell is `deny`,
      // and a domain that names an invoice's shape is coupled to the feature
      // whether or not the import survives the build.
      filename: DOMAIN,
      code: `import type { z } from "zod";\nimport type { ZodSchema } from "zod/v4";`,
    },
    {
      name: "a domain runtime-importing src/shared and another domain, which is its whole licence",
      filename: DOMAIN,
      code: `import { round } from "#web/shared/utils";\nimport { taxFor } from "#web/domains/tax";`,
    },
    {
      // `repo/` is the leaf that names the ORM and the read boundary.
      name: "a repo taking the ORM and the read boundary, which is what a repo is for",
      filename: `${SRC}/features/billing/repo/invoice-rows.ts`,
      code: `import { eq } from "drizzle-orm";\nimport { runRead } from "#web/infrastructure/db/run-read";`,
    },
    {
      // The server entry, reaching what the source-root row grants: infrastructure at any depth,
      // and `env`, mapped `env-server` — the same area `#web/env.server` names.
      name: "the server entry wiring the write boundary and the server env module",
      filename: `${SRC}/server.ts`,
      code: `import { runWrite } from "#web/infrastructure/db/run-write";\nimport { env } from "#web/env";`,
    },
    {
      name: "the composition root wiring routes and env, and reaching neither a feature nor a domain",
      filename: `${SRC}/router.tsx`,
      code: `import { routeTree } from "#web/routeTree.gen";\nimport { clientEnv } from "#web/env.public";\nimport { queryClient } from "#web/infrastructure/providers/query-client";`,
    },
    {
      name: "a .. that folds back to the file's own unit is still internal",
      filename: `${SRC}/features/billing/ui/InvoiceTable.tsx`,
      code: `import { useInvoices } from "#web/features/billing/ui/../controllers/invoices";`,
    },
    {
      name: "an alias climbing out of the source root names no application module",
      filename: FEATURE_UI,
      code: `import { config } from "#web/../vite.config";`,
    },
    {
      name: "the bare barrel of a top-level unit, and the same path with a trailing slash",
      filename: FEATURE_UI,
      code: `import { Button } from "#web/shared/ui";\nimport { cn } from "#web/shared/";`,
    },
    {
      name: "import type X = require() is erased, so the domain flag does not fire",
      filename: DOMAIN,
      code: `import type z = require("zod");\nexport type Schema = z.ZodType;`,
    },
    {
      name: "an asset resolving inside the source tree is not a module edge",
      filename: FEATURE_UI,
      code: `import styles from "#web/styles.css?url";\nimport logo from "#web/shared/ui/logo.svg";`,
    },
    {
      name: "a relative specifier belongs to the resolving tier, which is the only one that can place it",
      filename: SHARED_UI,
      code: `import { Text } from "./Text";\nimport { cn } from "../utils";`,
    },
    {
      name: "a test may reach across every boundary",
      filename: `${SRC}/shared/ui/Button.test.tsx`,
      code: `import { useInvoices } from "#web/features/billing";`,
    },
    {
      name: "a script is not part of the shipped module graph",
      filename: "/repo/scripts/seed.ts",
      code: `import { useInvoices } from "#web/features/billing";`,
    },
  ],
});
