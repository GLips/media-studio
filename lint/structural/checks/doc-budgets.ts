// ─── Each budgeted doc within its word ceiling ────────────────────────
//
// docs/doc-budgets.manifest.json maps a doc's path to its ceiling in words. A
// doc over its ceiling fails, and so does a ceiling more than 5% above its doc:
// a ceiling only moves down on its own, so words cut stay cut unless a manifest
// diff someone reviews gives them back.
//
// Words are whitespace-separated tokens, tables and code fences included; a
// count that skipped fences would move the prose into fences. A manifest that
// is missing or doesn't parse is a finding, never an empty run, since one typo
// would otherwise leave every doc uncounted. An empty manifest is fine.

import type { Finding, StructuralCheck } from '../check-context.ts';

const ID = 'doc-budgets';
export const DOC_BUDGETS_MANIFEST = 'docs/doc-budgets.manifest.json';
/** How far a ceiling may sit above its doc. A constant, not a knob: it is how tight the ratchet is. */
const CEILING_HEADROOM = 0.05;

export const countDocWords = (text: string) => text.split(/\s+/).filter(Boolean).length;
const highestCeilingFor = (words: number) => Math.ceil(words * (1 + CEILING_HEADROOM));

export const docBudgetsCheck: StructuralCheck = {
  id: ID,
  run(context) {
    const finding = (path: string, key: string, message: string): Finding => ({ check: ID, path, line: 1, key, message });
    if (!context.tree.paths.has(DOC_BUDGETS_MANIFEST)) {
      return [finding(DOC_BUDGETS_MANIFEST, 'unreadable', 'missing: every budgeted doc goes uncounted. Commit it, `{}` if nothing is budgeted yet')];
    }
    let manifest: unknown;
    try {
      manifest = JSON.parse(context.tree.readTexts([DOC_BUDGETS_MANIFEST])[0]);
    } catch (error) {
      return [finding(DOC_BUDGETS_MANIFEST, 'unreadable', `doesn't parse (${(error as Error).message}): every budgeted doc goes uncounted`)];
    }
    if (manifest === null || typeof manifest !== 'object' || Array.isArray(manifest)) {
      return [finding(DOC_BUDGETS_MANIFEST, 'unreadable', 'must be an object of doc path → word ceiling')];
    }
    // A bad entry is its own finding and the rest are still counted: one typo shouldn't hide every other doc's count.
    return Object.entries(manifest).flatMap(([doc, ceiling]): Finding[] => {
      if (typeof ceiling !== 'number' || !Number.isInteger(ceiling) || ceiling <= 0) {
        return [finding(DOC_BUDGETS_MANIFEST, `ceiling:${doc}`, `"${doc}": the ceiling must be a positive integer, not ${JSON.stringify(ceiling)}`)];
      }
      if (!context.tree.paths.has(doc)) {
        return [finding(doc, 'missing', `budgeted in ${DOC_BUDGETS_MANIFEST}, but not in the tree: renamed or deleted? Update the manifest with it`)];
      }
      const words = countDocWords(context.tree.readTexts([doc])[0]);
      if (words > ceiling) {
        return [finding(doc, 'over', `${words} words, over its ${ceiling}-word ceiling: condense it, move material to the doc that owns it, or raise the ceiling in ${DOC_BUDGETS_MANIFEST}`)];
      }
      if (ceiling > highestCeilingFor(words)) {
        return [finding(doc, 'slack', `${words} words under a ${ceiling}-word ceiling, more than ${CEILING_HEADROOM * 100}% slack: lower it to ${highestCeilingFor(words)} or below in ${DOC_BUDGETS_MANIFEST}`)];
      }
      return [];
    });
  },
};
