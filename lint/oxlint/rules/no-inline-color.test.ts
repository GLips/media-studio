import { describeRule } from "../lib/rule-spec.ts";
import { noInlineColorRule } from "./no-inline-color.ts";

const COMPONENT = "web/src/features/billing/ui/panel.tsx";

describeRule("no-inline-color", noInlineColorRule, {
  obvious: [
    {
      name: "a hex literal in an inline style object",
      filename: COMPONENT,
      code: `export const Panel = () => <div style={{ color: "#0a0c10" }} />;`,
      errors: [{ messageId: "rawColor" }],
    },
    {
      name: "an rgba value in a style table",
      filename: COMPONENT,
      code: `export const styles = { background: "rgba(10, 12, 16, 0.5)" };`,
      errors: [{ messageId: "rawColor" }],
    },
    {
      name: "a hex on a component's color prop",
      filename: COMPONENT,
      code: `export const Row = () => <Text c="#0a0c10" />;`,
      errors: [{ messageId: "rawColor" }],
    },
  ],

  adversarial: [
    {
      name: "hsla is a color function too, and single quotes are the same string",
      filename: COMPONENT,
      code: `export const styles = { shadow: 'hsla(210, 20%, 5%, 0.4)' };`,
      errors: [{ messageId: "rawColor" }],
    },
    {
      name: "the three-digit hex shorthand is still a hex",
      filename: COMPONENT,
      code: `export const styles = { accent: "#fff" };`,
      errors: [{ messageId: "rawColor" }],
    },
    {
      name: "a hex buried inside a longer value, where the string is not itself a color",
      filename: COMPONENT,
      code: `export const styles = { gradient: "linear-gradient(90deg, #0a0c10, transparent)" };`,
      errors: [{ messageId: "rawColor" }],
    },
    {
      name: "a backtick is a spelling of a string literal, not a different kind of value",
      filename: COMPONENT,
      code: "export const styles = { border: `#0a0c10` };",
      errors: [{ messageId: "rawColor" }],
    },
    {
      name: "an expression container around the prop value ships the same color",
      filename: COMPONENT,
      code: `export const Row = () => <Box bg={"#0a0c10"} />;`,
      errors: [{ messageId: "rawColor" }],
    },
    {
      // One keyword between the prop and its literal, and a rule reading the container's
      // expression directly is off. no-inline-style-prop reads the same lib/transparent-wrappers.ts.
      name: "a cast, a satisfies and a non-null assertion each wedge a node between prop and literal",
      filename: COMPONENT,
      code: `export const Row = () => <><Text c={"#0a0c10" as Color} /><Box bg={"#fff" satisfies Color} /><Text c={"#abc"!} /></>;`,
      errors: [
        { messageId: "rawColor" },
        { messageId: "rawColor" },
        { messageId: "rawColor" },
      ],
    },
    {
      name: "a colour literal inside a utility class is still a raw colour",
      filename: COMPONENT,
      code: `export const s = { className: "bg-[#0a0c10]", hover: "hover:text-[rgb(10,12,16)]" };`,
      errors: [{ messageId: "rawColor" }, { messageId: "rawColor" }],
    },
    {
      name: "a bare colour beside a utility class in the same string",
      filename: COMPONENT,
      code: `export const styles = { className: "text-[13px] #0a0c10" };`,
      errors: [{ messageId: "rawColor" }],
    },
    {
      name: "a computed key hides nothing, because the value is what is off-system",
      filename: COMPONENT,
      code: `export const styles = (prop: string) => ({ [prop]: "#0a0c10" });`,
      errors: [{ messageId: "rawColor" }],
    },
    {
      name: "a shared module outside the primitives layer is not exempt",
      filename: "web/src/shared/palette.ts",
      code: `export const palette = { brand: "#0a0c10" };`,
      errors: [{ messageId: "rawColor" }],
    },
    {
      // StyleX treats `defineVars` as a variable definition only in a `.stylex.ts` file, so a
      // `theme.ts` beside the token source is an ordinary module.
      name: "a theme.ts beside the token source is not the token source in this tree",
      filename: "web/src/shared/ui/theme.ts",
      code: `export const colors = { surface: "#0a0c10" };`,
      errors: [{ messageId: "rawColor" }],
    },
    {
      // The shape this tree actually writes styling in. The literal sits in an object handed to
      // `stylex.create`, two calls deep and inside no exported object — so a reader that walked
      // module-scope initialisers rather than every Property node sees a call expression and
      // reports nothing, while the colour ships exactly as `style={{ color: … }}` would.
      name: "a colour literal inside a stylex.create block, which is this tree's styling idiom",
      filename: COMPONENT,
      code: `import * as stylex from "@stylexjs/stylex";\nconst styles = stylex.create({ badge: { backgroundColor: "#0f172a", color: "#e2e8f0" } });\nexport const Badge = () => <span {...stylex.props(styles.badge)} />;`,
      errors: [{ messageId: "rawColor" }, { messageId: "rawColor" }],
    },
  ],

  legal: [
    {
      name: "a CSS variable token, which is the fix the message names",
      filename: COMPONENT,
      code: `export const styles = { color: "var(--app-text-secondary)" };`,
    },
    {
      name: "a theme object reference carries no literal to drift",
      filename: COMPONENT,
      code: `import { colors } from "#web/shared/ui/theme.stylex";\nexport const styles = { background: colors.surfaceInverse };`,
    },
    {
      name: "a color function wrapping a token has no literal channel",
      filename: COMPONENT,
      code: `export const styles = { border: "rgb(var(--brand-rgb))" };`,
    },
    {
      name: "an anchor href is not one of the color props",
      filename: COMPONENT,
      code: `export const A = () => <a href="#abc123" />;`,
    },
    {
      name: "a hash that carries non-hex characters is a fragment id",
      filename: COMPONENT,
      code: `export const styles = { target: "#main", key: "#zebra" };`,
    },
    {
      name: "the token source has to write the literals the tokens resolve to",
      filename: "web/src/shared/ui/theme.stylex.ts",
      code: `import * as stylex from "@stylexjs/stylex";\nexport const colors = stylex.defineVars({ surfaceInverse: "#0a0c10" });`,
    },
    {
      name: "a Remotion scene styles frames, not the app",
      filename: "work/projects/launch/scenes/intro.tsx",
      code: `export const palette = { brand: "#0a0c10" };`,
    },
    {
      name: "a test may assert on the literal a token resolves to",
      filename: "web/src/features/billing/ui/panel.test.tsx",
      code: `export const expected = { color: "#0a0c10" };`,
    },
  ],
});
