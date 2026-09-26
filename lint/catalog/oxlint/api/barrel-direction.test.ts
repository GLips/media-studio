import { describeRule } from "../lib/rule-spec.ts";
import { barrelDirectionRule } from "./barrel-direction.ts";

// A unit's barrels are `packages/core/src`'s shape — the spine is where
// `index.server.ts` re-exports the schema barrel and the raw repo modules — so the
// fixtures are rooted there. Two cases sit in `apps/web/src` instead, because the
// web tree layers features the same way and its barrels are `.tsx`.
const FEATURE_BARREL = "/repo/web/src/features/billing/index.ts";
const DOMAIN_BARREL = "/repo/web/src/domains/pricing/index.ts";

describeRule("api/barrel-direction", barrelDirectionRule, {
  obvious: [
    {
      name: "a client barrel re-exporting its server barrel wholesale",
      filename: FEATURE_BARREL,
      code: `export * from "./index.server";`,
      errors: [
        {
          message:
            "Barrel index must not import from index.server — this pulls server-only code into client bundles. If the export is client-safe (types, createServerFn references), re-export it from controllers/ instead. If it is server-only, it belongs in index.server only.",
        },
      ],
    },
    {
      // The message is asserted, and the layer name's ABSENCE is the assertion that matters: a
      // domain is unlayered, so a message telling this file to re-export through `controllers/`
      // names a directory the domain may not create. This rule is the only reporter on a client
      // barrel, so whatever it says here is all an adopter gets.
      name: "the rule governs the domains layer too, and a domain has no layer to re-export through",
      filename: DOMAIN_BARREL,
      code: `export { priceTable } from "./index.server";`,
      errors: [
        {
          message:
            "Barrel index must not import from index.server — this pulls server-only code into client bundles. A domain is unlayered, so there is no client-safe layer to re-export through: move the client-safe part into the domain's own modules, and leave the server-only part in index.server, which a server context imports directly.",
        },
      ],
    },
  ],

  adversarial: [
    {
      name: "a plain import is not a re-export at all",
      filename: FEATURE_BARREL,
      code: `import { auditLog } from "./index.server";\nexport const audited = auditLog;`,
      errors: [{ messageId: "clientBarrelImportsServerBarrel" }],
    },
    {
      name: "a dynamic import is a call expression, not a module declaration",
      filename: FEATURE_BARREL,
      code: `export const lazyCharge = async () => (await import("./index.server")).chargeCard;`,
      errors: [{ messageId: "clientBarrelImportsServerBarrel" }],
    },
    {
      name: "the barrel reaching its own server sibling through the path alias, not a relative path",
      filename: FEATURE_BARREL,
      code: `export { chargeCard } from "#/features/billing/index.server";`,
      errors: [{ messageId: "clientBarrelImportsServerBarrel" }],
    },
    {
      name: "another feature's server barrel leaks into client bundles just the same",
      filename: FEATURE_BARREL,
      code: `export { auditLog } from "../audit/index.server";`,
      errors: [{ messageId: "clientBarrelImportsServerBarrel" }],
    },
    {
      name: "an explicit file extension on the specifier",
      filename: FEATURE_BARREL,
      code: `export { chargeCard } from "./index.server.ts";`,
      errors: [{ messageId: "clientBarrelImportsServerBarrel" }],
    },
    {
      // The bare form, which under a baseUrl-style resolution IS the source root's server barrel.
      // It is the spelling the two rules disagreed about while each held its own matcher, and it
      // is pinned here because `lib/server-barrel-specifier.ts` is now the one place either can
      // change it.
      name: "a bare specifier with no leading segment names the barrel too",
      filename: FEATURE_BARREL,
      code: `export * from "index.server";`,
      errors: [{ messageId: "clientBarrelImportsServerBarrel" }],
    },
    {
      // In the web tree, where a feature barrel is routinely `.tsx` because the feature's public
      // surface includes components. Both declared trees layer features, so the rule has to reach
      // the same file in either.
      name: "a barrel spelled index.tsx is still the barrel, in the other declared tree",
      filename: "/repo/web/src/features/billing/index.tsx",
      code: `import type { Charge } from "./index.server";\nexport type Alias = Charge;`,
      errors: [{ messageId: "clientBarrelImportsServerBarrel" }],
    },
  ],

  legal: [
    {
      name: "the server barrel may re-export the client barrel — the superset direction",
      filename: "/repo/web/src/features/billing/index.server.ts",
      code: `export * from "./index";\nexport { chargeCard } from "./repo/charge";`,
    },
    {
      name: "a client barrel re-exporting its own client-safe internals is the whole point",
      filename: FEATURE_BARREL,
      code: `export { startCheckout } from "./controllers/start";\nexport * from "./service/quote";`,
    },
    {
      name: "a neighbour whose name merely starts with the barrel's",
      filename: FEATURE_BARREL,
      code: `export { CHECKOUT_TIMEOUT_MS } from "./index.server-config";`,
    },
    {
      // Legal in BOTH rules, and not because either ceded it: `controllers/` is a server context,
      // so reaching the server barrel from there is the arrangement the pair exists to permit.
      // The name must not say `api/server-import-context` governs this file: that rule returns
      // early here, so such a name would read as coverage nothing gives.
      name: "a server-context module reaching the server barrel is what the pair is for, not a gap",
      filename: "/repo/web/src/features/billing/controllers/charge.ts",
      code: `import { chargeCard } from "../index.server";\nexport const charge = () => chargeCard();`,
    },
    {
      // Not this rule's subject, and it is `api/server-import-context`'s — a barrel by NAME is not
      // a unit's public surface. The two rules split on exactly this file, so if the cession were
      // written against "names a barrel" rather than "is a unit's barrel", nothing would report
      // here at all.
      name: "a nested ui/index.ts is not the feature's public barrel",
      filename: "/repo/web/src/features/billing/ui/index.ts",
      code: `export { auditLog } from "../index.server";`,
    },
    {
      name: "a directory that merely starts with 'features' holds no governed barrel",
      filename: "/repo/web/src/features-legacy/billing/index.ts",
      code: `export * from "./index.server";`,
    },
    {
      // `src/index.ts` in the core tree names `index.server` too and is NOT silent — it is a
      // source-root file rather than a unit's surface, so `api/server-import-context` owns it.
      // Asserted from the other end in that rule's spec; here it only has to stay out of this one.
      name: "a shared barrel is outside the two layers this template governs",
      filename: "/repo/web/src/shared/index.ts",
      code: `export * from "./index.server";`,
    },
  ],
});
