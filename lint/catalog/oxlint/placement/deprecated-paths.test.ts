import { describeRule } from "../lib/rule-spec.ts";
import { deprecatedPathsRule } from "./deprecated-paths.ts";

// The old top-level lab app is reached by a relative climb from anywhere in the tree, so the row is
// a path segment rather than an alias head.
const WEB_UI = "/repo/web/src/features/lab/ui/lab-page.tsx";
const WEB_ROUTE = "/repo/web/src/routes/lab.tsx";

const IMPORT_OLD_LAB = `import { LabApp } from "../../../../lab/app/lab-app.tsx";`;

describeRule("placement/deprecated-paths", deprecatedPathsRule, {
  obvious: [
    {
      name: "a lab screen reaching the old lab app it replaced",
      filename: WEB_UI,
      code: IMPORT_OLD_LAB,
      errors: [{ message: "lab/app and lab/review/app moved into the web app: the lab is #web/features/lab/index.ts and the review screen #web/features/review/index.ts. Import the feature's barrel." }],
    },
    {
      name: "the old review app",
      filename: WEB_ROUTE,
      code: `import { ReviewApp } from "../../../lab/review/app/review-app.tsx";`,
      errors: [{ messageId: "labAppMoved" }],
    },
  ],

  adversarial: [
    {
      name: "the bare directory with no trailing slash, which a slash-anchored pattern approves",
      filename: WEB_UI,
      code: `import * as lab from "../../../../lab/app";`,
      errors: [{ messageId: "labAppMoved" }],
    },
    {
      name: "a dynamic import depends on the removed directory as surely as a static one",
      filename: WEB_ROUTE,
      code: `export const lazyTab = async () => (await import("../../../lab/app/tabs/kit.tsx")).KitTab;`,
      errors: [{ messageId: "labAppMoved" }],
    },
    {
      name: "a star re-export names no binding to notice",
      filename: WEB_UI,
      code: `export * from "../../../../lab/app/tabs/curves/curves-tab.tsx";`,
      errors: [{ messageId: "labAppMoved" }],
    },
    {
      name: "a type-only import still points at a path that will not resolve",
      filename: WEB_UI,
      code: `import type { LabTab } from "../../../../lab/app/tabs.ts";`,
      errors: [{ messageId: "labAppMoved" }],
    },
  ],

  legal: [
    {
      name: "the lab at the address it moved to",
      filename: WEB_ROUTE,
      code: `import { LabPage } from "#web/features/lab/index.ts";`,
    },
    {
      name: "a tab's composition in lib/studio, whose path also holds a lab segment",
      filename: WEB_UI,
      code: `import { KitTabStage } from "#studio/lab/kit/kit-tab-stage.tsx";`,
    },
    {
      name: "a live module whose name merely starts with a removed one",
      filename: WEB_UI,
      code: `import { shell } from "../../../../lab/app-shell/shell.ts";`,
    },
    {
      name: "a test may still reference a path under migration",
      filename: "/repo/web/src/features/lab/ui/lab-page.test.tsx",
      code: IMPORT_OLD_LAB,
    },
  ],
});
