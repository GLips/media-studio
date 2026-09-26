import { describeRule } from "../lib/rule-spec.ts";
import { serverImportContextRule } from "./server-import-context.ts";

// The CLIENT contexts this rule fences — routes, a feature's `ui/`, `shared/ui/` —
// are `apps/web/src`'s, so that tree carries most of the fixtures. `packages/core/src`
// carries the two cases only it can state: its source root is a client-safe package
// entry that is not a unit barrel, and its `index.server.ts` beside it is a server
// context by suffix alone.
const UI = "/repo/web/src/features/billing/ui/panel.tsx";
const SHARED_UI = "/repo/web/src/shared/ui/summary.tsx";
const IMPORT_SERVER_BARREL = `import { chargeCard } from "#/features/billing/index.server";`;

describeRule("api/server-import-context", serverImportContextRule, {
  obvious: [
    {
      name: "a client-context component importing a feature's server barrel",
      filename: UI,
      code: `import { chargeCard } from "#web/features/billing/index.server";`,
      errors: [{ message: "*/index.server is a server-only barrel and this is a client context. Routes are isomorphic; use the client-safe barrel index there. This rule answers the CONTEXT question only — which server context may reach a given barrel is boundary/import-policy's answer, and from inside a feature that is controllers/, service/ and a .server module at the feature ROOT. Not the feature's own index.server, which is a barrel and may name nothing outside its feature; not repo/, which is a leaf; not infrastructure/, which sits below features/." }],
    },
    {
      name: "route files are isomorphic and cannot reach a server barrel",
      filename: "/repo/web/src/routes/dashboard.tsx",
      code: `import { chargeCard } from "#web/features/billing/index.server";`,
      errors: [{ messageId: "serverBarrelInClientContext" }],
    },
  ],

  adversarial: [
    {
      name: "a relative path to a server barrel, where a pattern anchored on the alias would miss",
      filename: SHARED_UI,
      code: `import { auditLog } from "../../features/billing/index.server";`,
      errors: [{ messageId: "serverBarrelInClientContext" }],
    },
    {
      name: "a dynamic import is a call expression, not an import declaration",
      filename: SHARED_UI,
      code: `export const lazyCharge = async () => (await import("#web/features/billing/index.server")).chargeCard;`,
      errors: [{ messageId: "serverBarrelInClientContext" }],
    },
    {
      name: "a re-export pushes the server barrel through the client module just the same",
      filename: SHARED_UI,
      code: `export { refund } from "#web/features/checkout/index.server";`,
      errors: [{ messageId: "serverBarrelInClientContext" }],
    },
    {
      name: "a star re-export names no binding to notice",
      filename: SHARED_UI,
      code: `export * from "#web/domains/pricing/index.server";`,
      errors: [{ messageId: "serverBarrelInClientContext" }],
    },
    {
      name: "a type-only import of the server barrel still pulls the module into the client graph",
      filename: UI,
      code: `import type { Charge } from "#web/features/billing/index.server";\nexport const charges: Charge[] = [];`,
      errors: [{ messageId: "serverBarrelInClientContext" }],
    },
    {
      name: "a directory that merely ends in a server layer's name is still a client context",
      filename: "/repo/web/src/features/billing/legacy-service/charge.ts",
      code: `import { chargeCard } from "#web/features/billing/index.server";`,
      errors: [{ messageId: "serverBarrelInClientContext" }],
    },
    {
      // The near side of the cession below. A file that NAMES a barrel is not a unit's public
      // surface, and `api/barrel-direction` never looks at it — so if the cession were written
      // against `namesBarrel` rather than `isUnitClientBarrel`, this edge would be reported by
      // neither rule and read as clean.
      name: "a nested ui/index.ts names a barrel but is not a unit's surface, so it stays here",
      filename: "/repo/web/src/features/billing/ui/index.ts",
      code: `export { auditLog } from "#web/features/audit/index.server";`,
      errors: [{ messageId: "serverBarrelInClientContext" }],
    },
    {
      // The bare specifier, which this rule could not see while it held its own matcher requiring
      // a leading `/`. `lib/server-barrel-specifier.ts` is now the one place either api rule
      // decides what names the barrel.
      name: "a bare specifier with no leading segment names the barrel too",
      filename: UI,
      code: `import { chargeCard } from "index.server";
export const charge = () => chargeCard();`,
      errors: [{ messageId: "serverBarrelInClientContext" }],
    },
    {
      // The core tree's client-safe package entry. It is spelled `index` — `clientEntry` in that
      // tree's `sourceRootPositions` — so it LOOKS like the one file this rule cedes, and it is
      // not: `isUnitClientBarrel` asks for a feature or a domain unit, and the source root is
      // neither. Ceding on the filename instead would leave the package's public entry free to
      // pull `index.server.ts` — the schema barrel and the raw repo modules — into every consumer.
      name: "the core tree's source-root entry names index and is not a unit's barrel, so it is fenced",
      filename: "/repo/web/src/index.ts",
      code: `export * from "./index.server";`,
      errors: [{ messageId: "serverBarrelInClientContext" }],
    },
  ],

  legal: [
    {
      name: "the controllers layer is a server context",
      filename: "/repo/web/src/features/billing/controllers/charge.ts",
      code: `import { auditLog } from "#web/features/audit/index.server";`,
    },
    {
      name: "the repo layer is a server context",
      filename: "/repo/web/src/features/billing/repo/totals.ts",
      code: IMPORT_SERVER_BARREL,
    },
    {
      name: "the service layer is a server context",
      filename: "/repo/web/src/features/billing/service/charge.ts",
      code: IMPORT_SERVER_BARREL,
    },
    {
      name: "infrastructure is a server context",
      filename: "/repo/web/src/infrastructure/db/run-write.ts",
      code: IMPORT_SERVER_BARREL,
    },
    {
      name: "a .server.ts file is server-only whatever directory it sits in",
      filename: "/repo/web/src/features/billing/ui/loader.server.ts",
      code: `import { chargeCard } from "#web/features/billing/index.server";`,
    },
    {
      // The other half of the core source-root pair above: same directory, and the suffix is the
      // whole difference. `index.server.ts` is the package's server-only entry and is where the
      // re-export the client entry may not write belongs.
      name: "the core tree's server-only package entry is a server context by its suffix alone",
      filename: "/repo/web/src/index.server.ts",
      code: `export * from "./index";\nexport { chargeCard } from "#/features/billing/index.server";`,
    },
    {
      name: "a route names itself a server context, which is the only way routes/ gets one — boundary/route-thinness has no arm here for exactly this reason",
      filename: "/repo/web/src/routes/api.invoices.server.ts",
      code: `import { chargeCard } from "#web/features/billing/index.server";`,
    },
    {
      name: "a module whose name merely starts with the server barrel's",
      filename: UI,
      code: `import { SERVER_TIMEOUT_MS } from "#web/features/billing/index.server-config";`,
    },
    {
      name: "the client-safe barrel is what a client context is meant to import",
      filename: UI,
      code: `import { billingLabel } from "#web/features/billing";`,
    },
    {
      name: "a test may reach across every boundary",
      filename: "/repo/web/src/features/billing/ui/panel.test.tsx",
      code: `import { chargeCard } from "#web/features/billing/index.server";`,
    },
    {
      // Ceded to `api/barrel-direction`, which reports both of these. Not silence: this rule's
      // message tells the reader to "use the client-safe barrel index there", and these files ARE
      // index — while its stated fastest fix, renaming to `*.server`, deletes the unit's public
      // surface. The barrel rule names a fix a barrel can act on.
      name: "a unit's own client barrel is api/barrel-direction's subject, not this rule's",
      filename: "/repo/web/src/features/billing/index.ts",
      code: `export * from "./index.server";`,
    },
    {
      name: "and a domain barrel likewise, where this rule would otherwise be the second reporter",
      filename: "/repo/web/src/domains/pricing/index.ts",
      code: `export { priceTable } from "./index.server";`,
    },
  ],
});
