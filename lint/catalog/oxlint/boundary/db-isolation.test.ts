import { describeRule } from "../lib/rule-spec.ts";
import { dbIsolationRule } from "./db-isolation.ts";

// `dbDir()` resolves to `infrastructure/db` in BOTH declared trees, so the fence is
// live in both — but the database only exists in `packages/core/src`, which is where
// the layers that may reach it are. The one `apps/web/src` case below is there because
// the alias is spellable in that tree too and nothing else in this spec would say so.
const UI = "/repo/web/src/features/billing/ui/table.tsx";
const SERVICE = "/repo/web/src/features/billing/service/charge.ts";
const IMPORT_DB = `import { runWrite } from "#web/infrastructure/db/run-write";`;

describeRule("boundary/db-isolation", dbIsolationRule, {
  obvious: [
    {
      name: "a service module reaching the DB directly",
      filename: SERVICE,
      code: IMPORT_DB,
      errors: [{ messageId: "dbOutsideDataLayer" }],
    },
    {
      // The other declared tree, and a client position. `apps/web/src` has no `infrastructure/db`
      // today and the alias is still spellable there, so the fence stands before the directory
      // exists rather than being a core-only invariant nobody noticed was core-only.
      name: "a UI component in the web tree reaching the schema",
      filename: UI,
      code: `import { invoices } from "#web/infrastructure/db/schema/invoices";`,
      errors: [{ messageId: "dbOutsideDataLayer" }],
    },
  ],

  adversarial: [
    {
      name: "a dynamic import is a call expression, not an import declaration",
      filename: SERVICE,
      code: `export const load = async () => (await import("#web/infrastructure/db/run-read")).runRead;`,
      errors: [{ messageId: "dbOutsideDataLayer" }],
    },
    {
      name: "a backtick specifier on the CommonJS spelling, where the literal arm alone misses it",
      filename: SERVICE,
      code: `export const runWrite = require(\`#web/infrastructure/db/run-write\`).runWrite;`,
      errors: [{ messageId: "dbOutsideDataLayer" }],
    },
    {
      name: "a re-export carries the same runtime dependency an import does",
      filename: SERVICE,
      code: `export { runWrite } from "#web/infrastructure/db/run-write";`,
      errors: [{ messageId: "dbOutsideDataLayer" }],
    },
    {
      name: "a star re-export names no binding to notice",
      filename: SERVICE,
      code: `export * from "#web/infrastructure/db/schema/invoices";`,
      errors: [{ messageId: "dbOutsideDataLayer" }],
    },
    {
      name: "a type-only import still couples the layer to the schema's shape",
      filename: SERVICE,
      code: `import type { Invoice } from "#web/infrastructure/db/schema/invoices";`,
      errors: [{ messageId: "dbOutsideDataLayer" }],
    },
    {
      name: "a directory that merely ends in 'repo' is not the repo layer",
      filename: "/repo/web/src/features/billing/legacy-repo/queries.ts",
      code: IMPORT_DB,
      errors: [{ messageId: "dbOutsideDataLayer" }],
    },
  ],

  legal: [
    {
      name: "the repo layer",
      filename: "/repo/web/src/features/billing/repo/queries.ts",
      code: IMPORT_DB,
    },
    {
      name: "the controllers layer, for projects with no repo/",
      filename: "/repo/web/src/features/billing/controllers/list.ts",
      code: IMPORT_DB,
    },
    {
      name: "infrastructure IS the DB layer",
      filename: "/repo/web/src/infrastructure/db/tk-database.ts",
      code: `import { drizzle } from "drizzle-orm/node-postgres";`,
    },
    {
      // The one case that reads the `infrastructure` entry in `DATA_ACCESS_PROFILES`. The file
      // above passes on its specifier alone — a raw ORM package is `boundary/sdk-containment`'s
      // subject, not this rule's — so it stays green whatever the profile gate answers. This one
      // names the db ALIAS from an infrastructure file that is not the db directory, which only
      // the profile can permit. `placement/no-raw-result` reads the same list from the other side.
      name: "an infrastructure module outside db/ may still name the db alias",
      filename: "/repo/web/src/infrastructure/tk-core.ts",
      code: `import { runWrite } from "#web/infrastructure/db/run-write";`,
    },
    {
      // Package-root config, outside `packages/core/src` and therefore outside every declared
      // tree. It needs no exemption in the rule for the same reason `vite.config.ts` does not.
      name: "the ORM config file",
      filename: "/repo/web/drizzle.config.ts",
      code: `import { schema } from "#web/infrastructure/db/schema/index.server";`,
    },
    {
      name: "a test may reach across every boundary",
      filename: "/repo/web/src/features/billing/service/charge.test.ts",
      code: IMPORT_DB,
    },
    {
      name: "a neighbouring infrastructure module is not the db module",
      filename: SERVICE,
      code: `import { logger } from "#web/infrastructure/telemetry";`,
    },
    {
      name: "a specifier that merely starts with the db path is a different module",
      filename: SERVICE,
      code: `import { dbless } from "#web/infrastructure/dbless";`,
    },
  ],
});
