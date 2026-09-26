import { describeRule } from "../lib/rule-spec.ts";
import { noStylexBorderShorthandRule } from "./no-stylex-border-shorthand.ts";

const COMPONENT = "/repo/web/src/features/review/ui/review-panel.tsx";

describeRule("style/no-stylex-border-shorthand", noStylexBorderShorthandRule, {
  obvious: [
    {
      name: "a token inside a border shorthand, which StyleX drops",
      filename: COMPONENT,
      code: "const styles = stylex.create({ row: { borderTop: `1px solid ${colors.line}` } });",
      errors: [{ messageId: "unreadableShorthand" }],
    },
  ],

  adversarial: [
    {
      name: "a logical-side shorthand inside a conditional branch of a pseudo-element",
      filename: COMPONENT,
      code: "const styles = stylex.create({ row: { '::after': { borderInlineStart: { default: 'none', ':hover': frame.edge } } } });",
      errors: [{ messageId: "unreadableShorthand" }],
    },
  ],

  legal: [
    {
      name: "the longhands with a token, and a literal shorthand StyleX expands",
      filename: COMPONENT,
      code: "const styles = stylex.create({ row: { border: 'none', borderTopWidth: '1px', borderTopStyle: 'solid', borderTopColor: colors.line } });",
    },
  ],
});
