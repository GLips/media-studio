import { describeRule } from "../lib/rule-spec.ts";
import { clientServerInfraRule } from "./client-server-infra.ts";

// The allowlist is the browser adapters: api-client and the query client. `studio-engine.server`
// is the app's one door into the studio's engine code, and is the server module every client case reaches for.
const PANEL = "/repo/web/src/features/billing/ui/panel.tsx";
const SHARED_UI = "/repo/web/src/shared/ui/badge.tsx";
const IMPORT_ENGINE_DOOR = `import { listStudioProjects } from "#web/infrastructure/studio-engine.server.ts";`;

describeRule("boundary/client-server-infra", clientServerInfraRule, {
  obvious: [
    {
      // `infrastructure/studio-engine.server.ts` is the web app's door to engine code, so it is the
      // whole Node side behind one specifier — and it is not on the allowlist.
      name: "a client component importing the module that wraps the engine",
      filename: PANEL,
      code: `import { listStudioProjects } from "#web/infrastructure/studio-engine.server.ts";`,
      errors: [{ message: "Client contexts may only import client-safe infrastructure/ modules. From inside a feature, move it to controllers/ or to repo/ — or use the client-safe adapter. NOT service/, and NOT renaming the file to *.server: a service layer imports no infrastructure at all, and a .server module at a feature root or as its barrel is a feature-root or feature-barrel file, which boundary/import-policy denies infrastructure to. Each of those silences this rule and lights up that one, and a pair of diagnostics forbidding each other's fix is an edit loop." }],
    },
    {
      name: "a route module is isomorphic, so its loader's imports reach the client too",
      filename: "/repo/web/src/routes/admin.tsx",
      code: `import { mailer } from "#web/infrastructure/mailer";\nexport const loader = () => mailer;`,
      errors: [{ messageId: "serverOnlyInfraInClient" }],
    },
    {
      name: "a shared module is compiled into whatever imports it, client included",
      filename: "/repo/web/src/shared/audit.ts",
      code: `import { auditSink } from "#web/infrastructure/telemetry/sink";`,
      errors: [{ messageId: "serverOnlyInfraInClient" }],
    },
  ],

  adversarial: [
    {
      name: "a dynamic import puts the module in a client chunk just as surely",
      filename: SHARED_UI,
      code: `export const lazyStripe = async () => (await import("#web/infrastructure/stripe/client")).stripe;`,
      errors: [{ messageId: "serverOnlyInfraInClient" }],
    },
    {
      name: "a re-export carries the same dependency an import does",
      filename: SHARED_UI,
      code: `export { auditSink } from "#web/infrastructure/telemetry/sink";`,
      errors: [{ messageId: "serverOnlyInfraInClient" }],
    },
    {
      name: "a star re-export names no binding to notice",
      filename: SHARED_UI,
      code: `export * from "#web/infrastructure/telemetry/sink";`,
      errors: [{ messageId: "serverOnlyInfraInClient" }],
    },
    {
      name: "a type-only import still points the client layer at a server module",
      filename: PANEL,
      code: `import type { Mailer } from "#web/infrastructure/mailer";`,
      errors: [{ messageId: "serverOnlyInfraInClient" }],
    },
    {
      name: "the allowlist is exact, so a neighbour of a client-safe module is not client-safe",
      filename: PANEL,
      code: `import { fetchStudioUrl } from "#web/infrastructure/api-client-legacy";`,
      errors: [{ messageId: "serverOnlyInfraInClient" }],
    },
    {
      name: "the bare infrastructure barrel has no path segment after it to match on",
      filename: PANEL,
      code: `import infra from "#web/infrastructure";`,
      errors: [{ messageId: "serverOnlyInfraInClient" }],
    },
    {
      name: "a directory that merely ends in 'service' is not the service layer",
      filename: "/repo/web/src/features/billing/legacy-service/charge.ts",
      code: `import { listStudioProjects } from "#web/infrastructure/studio-engine.server.ts";`,
      errors: [{ messageId: "serverOnlyInfraInClient" }],
    },
    {
      // The router sits in the source root, so no layer name in its path says "client" — the gate
      // is `isServerContext`, which answers no for that profile, and a rule keyed on a
      // `ui/`-or-`routes/` path list would let the whole engine in here.
      name: "the source-root router is a client context with no client-looking path",
      filename: "/repo/web/src/router.tsx",
      code: IMPORT_ENGINE_DOOR,
      errors: [{ messageId: "serverOnlyInfraInClient" }],
    },
    {
      // A feature's own barrel is above its layers, so it is a client context: re-exporting the
      // engine door from `index.ts` hands it to every consumer of the feature.
      name: "a feature's client barrel is not one of the layers that may reach the engine",
      filename: "/repo/web/src/features/billing/index.ts",
      code: IMPORT_ENGINE_DOOR,
      errors: [{ messageId: "serverOnlyInfraInClient" }],
    },
  ],

  legal: [
    {
      name: "a static file loads through the client-safe fetch adapter",
      filename: PANEL,
      code: `import { fetchStudioUrl } from "#web/infrastructure/api-client";`,
    },
    {
      name: "the controllers layer is a server context",
      filename: "/repo/web/src/features/billing/controllers/charge.ts",
      code: IMPORT_ENGINE_DOOR,
    },
    {
      name: "the repo layer is a server context",
      filename: "/repo/web/src/features/billing/repo/queries.ts",
      code: IMPORT_ENGINE_DOOR,
    },
    {
      name: "the service layer is a server context",
      filename: "/repo/web/src/features/billing/service/charge.ts",
      code: `import { mailer } from "#web/infrastructure/mailer";`,
    },
    {
      name: "a .server.ts file is a server context whatever directory it sits in",
      filename: "/repo/web/src/features/billing/ui/loader.server.ts",
      code: `import { listStudioProjects } from "#web/infrastructure/studio-engine.server.ts";`,
    },
    {
      // The whole allowlist, and it is hand-written in the rule rather than configured: widening
      // it is an edit to the rule AND to the Vite import-protection config, never a config value.
      name: "the two modules the allowlist names, which is the whole allowlist",
      filename: PANEL,
      code: `import { fetchStudioUrl } from "#web/infrastructure/api-client.ts";\nimport { queryClient } from "#web/infrastructure/providers/query-client.ts";`,
    },
    {
      name: "a test may reach across every boundary",
      filename: "/repo/web/src/features/billing/ui/panel.test.tsx",
      code: `import { listStudioProjects } from "#web/infrastructure/studio-engine.server.ts";`,
    },
    {
      name: "a top-level directory that merely starts with the infrastructure segment",
      filename: PANEL,
      code: `import { mailer } from "#web/infrastructure-legacy/mailer";`,
    },
    {
      name: "build config outside src/ is a different question from what a running client bundles",
      filename: "/repo/web/vite.config.ts",
      code: IMPORT_ENGINE_DOOR,
    },
  ],
});
