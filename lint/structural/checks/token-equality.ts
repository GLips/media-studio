// ─── Token equality: a web value equal to a token is written as it ────
//
// In the web app, a spacing or radius value exactly equal to a token in the
// StyleX theme (WEB_THEME_MODULE) names the token, so moving `inset` from 16px
// to 14px moves every call site. The surfaces: a Mantine prop (`gap={16}`,
// `p="16px"`) and a style object's key (`padding: 16`, `borderRadius: '10px'`).
//
// The scales are read from the theme's literals, never restated: a
// `.stylex.ts` module can't load outside StyleX's compiler. A missing scale
// throws, since an empty one would pass everything.
//
// Negative space: off-scale values pass (`gap={7}`, `width: 360`). Only an
// exact match has a fix that needs no judgement; 0 is no spacing decision.

import { WEB_THEME_MODULE } from '../../policy/studio-tree.ts';
import { walkAst, type AstNode, type SourceFile } from '../source-tree.ts';
import type { CheckContext, Finding, StructuralCheck } from '../check-context.ts';

const ID = 'token-equality';
const SPACING_PROPS = ['gap', 'p', 'px', 'py', 'pt', 'pr', 'pb', 'pl', 'm', 'mx', 'my', 'mt', 'mr', 'mb', 'ml'];
const RADIUS_PROPS = ['radius'];
const SPACING_KEYS = [
  'padding', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'paddingInline', 'paddingBlock',
  'margin', 'marginTop', 'marginRight', 'marginBottom', 'marginLeft', 'marginInline', 'marginBlock', 'gap', 'rowGap', 'columnGap',
];
const RADIUS_KEYS = ['borderRadius', 'borderTopLeftRadius', 'borderTopRightRadius', 'borderBottomLeftRadius', 'borderBottomRightRadius'];
const PX_TEXT = /^(\d+)(?:px)?$/;

export const tokenEqualityCheck: StructuralCheck = {
  id: ID,
  run(context) {
    const theme = context.fileAt(WEB_THEME_MODULE);
    if (!theme) throw new Error(`token-equality reads its scales from ${WEB_THEME_MODULE}, which the snapshot doesn't hold`);
    const spacing = pxTokens(theme, 'spacing'), radius = pxTokens(theme, 'radius');
    const scaleOf = (name: string, surface: 'prop' | 'key') =>
      (surface === 'prop' ? SPACING_PROPS : SPACING_KEYS).includes(name) ? { scale: spacing, kind: 'spacing' }
      : (surface === 'prop' ? RADIUS_PROPS : RADIUS_KEYS).includes(name) ? { scale: radius, kind: 'radius' } : undefined;
    const findings: Finding[] = [];
    for (const file of webStyleSubjects(context)) {
      walkAst(file.program, (node) => {
        const written = writtenValue(node);
        if (!written) return;
        const matched = scaleOf(written.name, written.surface);
        const token = matched?.scale.get(written.px);
        if (!matched || token === undefined) return;
        findings.push({
          check: ID, path: file.path, line: file.lineOf(node.start), key: `${written.name}=${written.px}`,
          message: `${written.name} is ${written.px}px, the ${matched.kind} token ${token}; name the token so it follows the scale`,
        });
      });
    }
    return findings;
  },
};

const webStyleSubjects = (context: CheckContext) => context.tree.sources.filter((file) => {
  const { kind } = context.positionOf(file.path);
  return (kind === 'web-client' || kind === 'web-server') && file.path !== WEB_THEME_MODULE;
});

/** A prop or key this check reads, with the whole px its value writes; undefined for anything else. */
function writtenValue(node: AstNode): { name: string; px: number; surface: 'prop' | 'key' } | undefined {
  if (node.type === 'JSXAttribute') {
    const name = (node.name as AstNode).name as string;
    const value = node.value as AstNode | null;
    const literal = value?.type === 'JSXExpressionContainer' ? value.expression as AstNode : value;
    const px = pxOf(literal);
    return px === undefined ? undefined : { name, px, surface: 'prop' };
  }
  if (node.type === 'Property' && !node.computed) {
    const key = node.key as AstNode;
    const name = key.type === 'Identifier' ? key.name as string : key.type === 'Literal' ? String(key.value) : undefined;
    const px = pxOf(node.value as AstNode);
    return name === undefined || px === undefined ? undefined : { name, px, surface: 'key' };
  }
  return undefined;
}

function pxOf(literal: AstNode | null | undefined): number | undefined {
  if (literal?.type !== 'Literal') return undefined;
  if (typeof literal.value === 'number') return Number.isInteger(literal.value) ? literal.value : undefined;
  const text = typeof literal.value === 'string' ? PX_TEXT.exec(literal.value) : null;
  return text ? Number(text[1]) : undefined;
}

/** One `export const <name> = stylex.defineVars({ … })` scale, keyed by px (rem × 16); zero never enters it. */
function pxTokens(theme: SourceFile, name: string): Map<number, string> {
  const byPx = new Map<number, string>();
  walkAst(theme.program, (node) => {
    if (node.type !== 'VariableDeclarator' || (node.id as AstNode).name !== name) return;
    const call = node.init as AstNode | null;
    const scale = call?.type === 'CallExpression' ? (call.arguments as AstNode[])[0] : undefined;
    if (scale?.type !== 'ObjectExpression') return;
    for (const property of scale.properties as AstNode[]) {
      const key = property.key as AstNode | undefined, value = property.value as AstNode | undefined;
      if (property.type !== 'Property' || key?.type !== 'Identifier' || value?.type !== 'Literal') continue;
      const raw = value.value;
      const magnitude = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number.parseFloat(raw) : NaN;
      const px = typeof raw === 'string' && raw.trim().endsWith('rem') ? magnitude * 16 : magnitude;
      if (Number.isFinite(px) && px > 0) byPx.set(Math.round(px), key.name as string);
    }
  });
  if (byPx.size === 0) {
    throw new Error(`token-equality found no "${name}" scale in ${theme.path}: it reads \`export const ${name} = stylex.defineVars({ token: '1rem' })\``);
  }
  return byPx;
}
