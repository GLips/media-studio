// ─── CSS tokens: a web stylesheet names colors and sizes by token ─────
//
// Every color and absolute font-size in the web app's stylesheets is a token
// reference (`var(--…)`), so no stylesheet keeps an old value. The style lint
// rules never read a `.css` file, so this check does.
//
// A custom-property definition (`--x: #fff`) is skipped by shape: defining a
// token is writing its raw value. `em` and `%` sizes pass, since no absolute
// token can say "1.3× the text around it". Spacing is token-equality's and
// `box-shadow` shadow-source's, so one violation gives one finding.
//
// Negative space: no stylesheet is exempt whole. The app's tokens live in its
// StyleX theme, not in a stylesheet.

import type { Finding, StructuralCheck } from '../check-context.ts';

const ID = 'css-tokens';
const STYLESHEET = /\.s?css$/;
/** A hex color, or a color function with a digit of its own: `rgb(var(--brand))` holds none and passes. */
const RAW_COLOR = /#[0-9a-fA-F]{3,8}\b|(?:rgb|rgba|hsl|hsla)\([^)]*[0-9]/;
const RAW_FONT_SIZE = /\bfont-size\s*:\s*[^;{}]*\b[\d.]+(?:px|rem|pt)\b/;
const CUSTOM_PROPERTY_DEFINITION = /^\s*--[\w-]+\s*:/;

export const cssTokensCheck: StructuralCheck = {
  id: ID,
  run(context) {
    const stylesheets = [...context.tree.paths].filter((path) => {
      if (!STYLESHEET.test(path)) return false;
      const kind = context.positionOf(path).kind;
      return kind === 'web-client' || kind === 'web-server';
    });
    const findings: Finding[] = [];
    context.tree.readTexts(stylesheets).forEach((text, i) => {
      const path = stylesheets[i];
      // Blanked, not stripped, so offsets still map to lines; `//` isn't a CSS comment (`url(https://…)`).
      const source = text.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, ' '));
      const lineAt = (offset: number) => source.slice(0, offset).split('\n').length;
      for (const { declaration, offset } of cssDeclarations(source)) {
        if (CUSTOM_PROPERTY_DEFINITION.test(declaration)) continue;
        const color = RAW_COLOR.exec(declaration);
        if (color) {
          findings.push({
            check: ID, path, line: lineAt(offset + color.index), key: color[0],
            message: `raw color ${color[0]}; reference a color token (var(--…)) so every theme follows`,
          });
        }
        const size = RAW_FONT_SIZE.exec(declaration);
        if (size) {
          findings.push({
            check: ID, path, line: lineAt(offset + size.index), key: 'font-size',
            message: 'raw font-size; reference the type scale (var(--…)), or size relatively in em or %',
          });
        }
      }
    });
    return findings;
  },
};

/**
 * Each declaration and where it starts: a span ending at `;` or `}`. Declarations, not lines, so a value wrapped onto
 * the next line is still read with its property; a span ending at `{` is a selector (`#abcdef {`), never a value.
 */
function* cssDeclarations(source: string): Generator<{ declaration: string; offset: number }> {
  let start = 0;
  for (let at = 0; at < source.length; at++) {
    const char = source[at];
    if (char !== ';' && char !== '{' && char !== '}') continue;
    if (char !== '{') yield { declaration: source.slice(start, at), offset: start };
    start = at + 1;
  }
}
