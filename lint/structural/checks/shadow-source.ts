// ─── Shadow source: the web app's shadows live in one module ──────────
//
// Only WEB_SHADOW_MODULE writes a shadow, so every shadow the app draws is
// read in one file and changed by one named entry. Elsewhere in the web app a
// `boxShadow` key or member, or a `box-shadow` in a stylesheet, is a finding.
//
// Negative space: lib's scenes draw their own shadows, which belong to the
// picture, not to the app's look, so they aren't this check's subject. A
// `box-shadow` inside a string in TypeScript isn't read.

import { WEB_SHADOW_MODULE } from '../../policy/studio-tree.ts';
import { walkAst, type AstNode } from '../source-tree.ts';
import type { Finding, StructuralCheck } from '../check-context.ts';

const ID = 'shadow-source';
const STYLESHEET = /\.s?css$/;
const STYLESHEET_SHADOW = /\bbox-shadow\b/g;
const MESSAGE = `writes a shadow; add a named entry to ${WEB_SHADOW_MODULE} and apply it by name, so that file stays every shadow the app draws`;

export const shadowSourceCheck: StructuralCheck = {
  id: ID,
  run(context) {
    const isWeb = (path: string) => {
      const { kind } = context.positionOf(path);
      return (kind === 'web-client' || kind === 'web-server') && path !== WEB_SHADOW_MODULE;
    };
    const findings: Finding[] = [];
    for (const file of context.tree.sources) {
      if (!isWeb(file.path)) continue;
      walkAst(file.program, (node) => {
        if (namesBoxShadow(node)) findings.push({ check: ID, path: file.path, line: file.lineOf(node.start), key: 'boxShadow', message: MESSAGE });
      });
    }
    const stylesheets = [...context.tree.paths].filter((path) => STYLESHEET.test(path) && isWeb(path));
    context.tree.readTexts(stylesheets).forEach((text, i) => {
      const source = text.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, ' '));
      for (const match of source.matchAll(STYLESHEET_SHADOW)) {
        const line = source.slice(0, match.index).split('\n').length;
        findings.push({ check: ID, path: stylesheets[i], line, key: 'box-shadow', message: MESSAGE });
      }
    });
    return findings;
  },
};

/** A `boxShadow` property key (`{ boxShadow: … }`, a style prop's object) or member (`style.boxShadow`, `s['boxShadow']`). */
function namesBoxShadow(node: AstNode): boolean {
  const named = (key: AstNode, computed: unknown) =>
    (!computed && key.type === 'Identifier' && key.name === 'boxShadow') || (key.type === 'Literal' && key.value === 'boxShadow');
  if (node.type === 'Property') return named(node.key as AstNode, node.computed);
  if (node.type === 'MemberExpression') return named(node.property as AstNode, node.computed);
  return false;
}
