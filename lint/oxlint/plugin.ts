// The studio's per-file rules, registered as one oxlint JS plugin under the `arch` prefix, so a
// diagnostic `arch(route-thinness)` names its file in rules/. Registering a rule here does not
// run it: .oxlintrc.json enables each one, and a key there naming a rule absent here makes oxlint
// refuse the whole config.

import { definePlugin } from "@oxlint/plugins";
import { hookCountRule } from "./rules/hook-count.ts";
import { noAsyncEffectRule } from "./rules/no-async-effect.ts";
import { noChainedTypeAssertionsRule } from "./rules/no-chained-type-assertions.ts";
import { noDeprecatedInputValidatorRule } from "./rules/no-deprecated-input-validator.ts";
import { noDisableValidationRule } from "./rules/no-disable-validation.ts";
import { noInlineColorRule } from "./rules/no-inline-color.ts";
import { noInlineFontSizeRule } from "./rules/no-inline-font-size.ts";
import { noInlineStylePropRule } from "./rules/no-inline-style-prop.ts";
import { noLongCommentsRule } from "./rules/no-long-comments.ts";
import { noModuleMockingRule } from "./rules/no-module-mocking.ts";
import { noPlainExportInServerFnModuleRule } from "./rules/no-plain-export-in-server-fn-module.ts";
import { noRawPrimitivesRule } from "./rules/no-raw-primitives.ts";
import { noReflectAccessRule } from "./rules/no-reflect-access.ts";
import { noStylexBorderShorthandRule } from "./rules/no-stylex-border-shorthand.ts";
import { noTypeArgumentAssertionRule } from "./rules/no-type-argument-assertion.ts";
import { noVacantSymbolNamesRule } from "./rules/no-vacant-symbol-names.ts";
import { propCountRule } from "./rules/prop-count.ts";
import { requireSafetyCommentRule } from "./rules/require-safety-comment.ts";
import { routeThinnessRule } from "./rules/route-thinness.ts";
import { serverFnPlacementRule } from "./rules/server-fn-placement.ts";
import { serverFnValidationRule } from "./rules/server-fn-validation.ts";
import { singleComponentExportRule } from "./rules/single-component-export.ts";
import { vendorComponentContainmentRule } from "./rules/vendor-component-containment.ts";

export default definePlugin({
  meta: { name: "arch" },
  rules: {
    // Any TypeScript, wherever it sits.
    "require-safety-comment": requireSafetyCommentRule,
    "no-chained-type-assertions": noChainedTypeAssertionsRule,
    "no-type-argument-assertion": noTypeArgumentAssertionRule,
    "no-reflect-access": noReflectAccessRule,
    "no-long-comments": noLongCommentsRule,
    "no-vacant-symbol-names": noVacantSymbolNamesRule,
    "no-module-mocking": noModuleMockingRule,
    "hook-count": hookCountRule,
    "prop-count": propCountRule,
    "single-component-export": singleComponentExportRule,
    "no-async-effect": noAsyncEffectRule,

    // The web app: each decides from the file's position or from what it imports.
    "route-thinness": routeThinnessRule,
    "server-fn-placement": serverFnPlacementRule,
    "server-fn-validation": serverFnValidationRule,
    "no-deprecated-input-validator": noDeprecatedInputValidatorRule,
    "no-plain-export-in-server-fn-module": noPlainExportInServerFnModuleRule,
    "no-disable-validation": noDisableValidationRule,
    "no-inline-color": noInlineColorRule,
    "no-inline-font-size": noInlineFontSizeRule,
    "no-inline-style-prop": noInlineStylePropRule,
    "no-raw-primitives": noRawPrimitivesRule,
    "no-stylex-border-shorthand": noStylexBorderShorthandRule,
    "vendor-component-containment": vendorComponentContainmentRule,
  },
});
