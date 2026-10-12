// ─── A skill's links resolve where the skill runs ─────────────────────
//
// Skills run from another project's directory, so a skill reaches a file as
// `${CLAUDE_PLUGIN_ROOT}/<path>` (the plugin root is this repo's root) or by a
// Markdown link relative to its own file, and each must be in the tree. A bare
// `docs/` or `lib/` path, `npm run` and `node cli/` work only inside a
// checkout, so a skill names the `studio` verb or `#studio` export instead.
//
// Negative space: `$(studio home)/lib/…` is allowed (the reader resolves the
// root first), and so are `#lib/…` imports in a project's code. Only a
// Markdown link's target is read as relative; prose isn't guessed at.

import type { Finding, StructuralCheck } from '../check-context.ts';

const ID = 'skill-links';
const PLUGIN_ROOT_PATH = /\$\{CLAUDE_PLUGIN_ROOT\}\/([^\s)`'"\]>]+)/g;
const MARKDOWN_LINK = /\]\(([^)\s]+)\)/g;
/** A link a skill's reader follows elsewhere: a URL, an anchor, or a plugin-root path (read above). */
const NOT_RELATIVE = /^(?:[a-z][\w+.-]*:|#|\$)/i;
const CHECKOUT_ONLY = [
  { pattern: /(?<![\w.#/$@-])(?:docs|lib)\/[\w./-]+/, why: 'a repo path resolves only inside a checkout: name the `studio` verb or the `#studio` export, or link a skill reference' },
  { pattern: /\bnpm run\b|\bnode cli\//, why: 'npm scripts and cli/ run only inside a checkout: name the `studio` verb' },
];

/** `path` normalised (`a/./b/../c` → `a/c`); undefined when it climbs out of the repo. */
function normaliseSkillLinkPath(path: string): string | undefined {
  const out: string[] = [];
  for (const segment of path.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment !== '..') out.push(segment);
    else if (out.pop() === undefined) return undefined;
  }
  return out.join('/');
}

export const skillLinksCheck: StructuralCheck = {
  id: ID,
  run(context) {
    const docs = [...context.tree.paths].filter((path) => path.startsWith('skills/') && path.endsWith('.md')).toSorted();
    const resolves = (target: string | undefined) =>
      target !== undefined && (context.tree.paths.has(target) || [...context.tree.paths].some((path) => path.startsWith(`${target}/`)));
    return context.tree.readTexts(docs).flatMap((text, i): Finding[] => {
      const doc = docs[i], folder = doc.slice(0, doc.lastIndexOf('/'));
      const findings: Finding[] = [];
      text.split('\n').forEach((line, index) => {
        const report = (key: string, message: string) => findings.push({ check: ID, path: doc, line: index + 1, key, message });
        for (const [, path] of line.matchAll(PLUGIN_ROOT_PATH)) {
          const target = path.replace(/[.,:;]+$/, '').replace(/#.*$/, '');
          if (!resolves(normaliseSkillLinkPath(target))) report(target, `\${CLAUDE_PLUGIN_ROOT}/${target} isn't in the repo: the plugin root is the repo's root`);
        }
        for (const [, link] of line.matchAll(MARKDOWN_LINK)) {
          if (NOT_RELATIVE.test(link)) continue;
          const target = link.replace(/#.*$/, '');
          if (!resolves(normaliseSkillLinkPath(`${folder}/${target}`))) report(link, `${link} resolves to nothing beside ${doc}`);
        }
        for (const { pattern, why } of CHECKOUT_ONLY) {
          const found = pattern.exec(line);
          if (found) report(found[0], `${found[0]}: ${why}`);
        }
      });
      return findings;
    });
  },
};
