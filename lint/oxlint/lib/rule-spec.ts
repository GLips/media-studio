import type { Rule } from "@oxlint/plugins";
// node:test, not bun:test: oxlint's RuleTester shares the AST with Rust by zero-copy raw transfer,
// which needs an ArrayBuffer JavaScriptCore can't allocate, so every spec runs under Node >= 22.
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { RuleTester } from "oxlint/plugins-dev";

RuleTester.describe = describe;
RuleTester.it = it;

export type Violation = RuleTester.InvalidTestCase;
export type Legal = RuleTester.ValidTestCase;

/**
 * Fixture filenames are repo-relative (`web/src/routes/x.tsx`) and RuleTester joins them to this
 * root, the real checkout, so a rule placing a file or resolving a `#` import reads the studio's own
 * tree and package.json rather than a stand-in.
 */
const STUDIO_ROOT = fileURLToPath(new URL("../../..", import.meta.url)).replace(/\/$/, "");

/**
 * Every spec proves three kinds, because a rule that stops matching fails silent:
 *   obvious      the violation the rule's header names.
 *   adversarial  the same violation spelled the way the rule's natural pattern misses.
 *   legal        code that looks like the violation and is allowed; over-matching trains people to ignore rules.
 * An empty kind throws, so a stubbed spec can't pass.
 */
export function describeRule(
  ruleId: string,
  rule: Rule,
  cases: { obvious: Violation[]; adversarial: Violation[]; legal: Legal[] },
): void {
  for (const kind of ["obvious", "adversarial", "legal"] as const) {
    if (cases[kind].length === 0) {
      throw new Error(`${ruleId}: the ${kind} case list is empty, so it asserts nothing`);
    }
  }

  // Three runs rather than one, so the reporter names which kind failed.
  const tester = new RuleTester({ cwd: STUDIO_ROOT });
  tester.run(`${ruleId} (obvious)`, rule, { valid: [], invalid: cases.obvious });
  tester.run(`${ruleId} (adversarial)`, rule, { valid: [], invalid: cases.adversarial });
  tester.run(`${ruleId} (legal)`, rule, { valid: cases.legal, invalid: [] });
}
