// ─── Each standing doc within its word ceiling ────────────────────────
//
// docs/doc-budgets.manifest.json maps a doc to its ceiling in words; a key
// ending in `/` budgets the sum of every .md beneath it, so a new skill
// reference spends from its skill's budget. Every standing doc is budgeted
// (each CLAUDE.md, skill SKILL.md and references/, docs/*.md). Adding words
// past a ceiling costs a manifest diff someone approves.
//
// A ceiling further above its doc than 40 words or 5% fails too, and
// `check:arch --update-baseline` lowers it (and budgets a new doc); it never
// raises one. The floor is there because a reworded sentence costs the same
// words in any doc: 5% of a short doc would fail for deleting a line.

import type { Finding, StructuralCheck } from '../check-context.ts';
import type { SourceTree } from '../source-tree.ts';

const ID = 'doc-budgets';
export const DOC_BUDGETS_MANIFEST = 'docs/doc-budgets.manifest.json';
/**
 * How far a ceiling may sit above its doc: a fraction of the count, or a floor in words, whichever is larger. Constants,
 * not knobs: they are how tight the ratchet is.
 */
const CEILING_HEADROOM = 0.05;
const CEILING_FLOOR_WORDS = 40;

export const countDocWords = (text: string) => text.split(/\s+/).filter(Boolean).length;
const highestCeilingFor = (words: number) => words + Math.max(CEILING_FLOOR_WORDS, Math.ceil(words * CEILING_HEADROOM));

/** The budget key a path falls under when it's a standing doc: itself, or its skill's references/ folder. */
function standingDocBudgetKey(path: string): string | undefined {
  if (path.startsWith('work/')) return undefined;
  const reference = /^(skills\/[^/]+\/references\/).+\.md$/.exec(path);
  if (reference) return reference[1];
  return /^skills\/[^/]+\/SKILL\.md$|^docs\/[^/]+\.md$|(^|\/)CLAUDE\.md$/.test(path) ? path : undefined;
}

type DocBudgetTree = Pick<SourceTree, 'paths' | 'readTexts'>;
type DocBudgetStatus = 'ok' | 'over' | 'slack' | 'missing' | 'invalid' | 'unbudgeted';
/** A manifest entry: its ceiling when that's a positive integer, and the value as the manifest spells it, to copy back. */
type DocBudgetRow = { doc: string; ceiling: number | undefined; spelled: string; words: number | undefined; status: DocBudgetStatus };

/** The words a key counts: one file's, or a folder key's every .md beneath it; undefined when nothing's there. */
function budgetedWords(tree: DocBudgetTree, doc: string): number | undefined {
  const files = doc.endsWith('/') ? [...tree.paths].filter((path) => path.startsWith(doc) && path.endsWith('.md')) : [doc].filter((path) => tree.paths.has(path));
  return files.length ? tree.readTexts(files).reduce((sum, text) => sum + countDocWords(text), 0) : undefined;
}

/** Whether a manifest value is a ceiling: a positive whole number of words. */
const isWordCeiling = (value: unknown): value is number => Number.isInteger(value) && Number(value) > 0;

function budgetStatus(ceiling: number | undefined, words: number | undefined): DocBudgetStatus {
  if (ceiling === undefined) return 'invalid';
  if (words === undefined) return 'missing';
  if (words > ceiling) return 'over';
  return ceiling > highestCeilingFor(words) ? 'slack' : 'ok';
}

/** The manifest's rows, then a row per standing doc it leaves out; or why it can't be read. */
function readDocBudgets(tree: DocBudgetTree): { rows: DocBudgetRow[] } | { unreadable: string } {
  if (!tree.paths.has(DOC_BUDGETS_MANIFEST)) return { unreadable: 'missing: every budgeted doc goes uncounted. Commit it, `{}` if nothing is budgeted yet' };
  let manifest: unknown;
  try {
    manifest = JSON.parse(tree.readTexts([DOC_BUDGETS_MANIFEST])[0]);
  } catch (error) {
    return { unreadable: `doesn't parse (${error instanceof Error ? error.message : String(error)}): every budgeted doc goes uncounted` };
  }
  if (manifest === null || typeof manifest !== 'object' || Array.isArray(manifest)) return { unreadable: 'must be an object of doc path → word ceiling' };
  // A bad entry is its own row and the rest are still counted: one typo shouldn't hide every other doc's count.
  const rows = Object.entries(manifest).map(([doc, value]): DocBudgetRow => {
    const words = budgetedWords(tree, doc);
    const ceiling = isWordCeiling(value) ? value : undefined;
    return { doc, ceiling, spelled: JSON.stringify(value), words, status: budgetStatus(ceiling, words) };
  });
  const standing = new Set([...tree.paths].flatMap((path) => standingDocBudgetKey(path) ?? []));
  const unbudgeted = [...standing].filter((doc) => !Object.hasOwn(manifest, doc)).toSorted();
  return { rows: [...rows, ...unbudgeted.map((doc): DocBudgetRow => ({ doc, ceiling: undefined, spelled: '', words: budgetedWords(tree, doc), status: 'unbudgeted' }))] };
}

const RATCHET = 'npm run check:arch -- --update-baseline';

function rowFinding({ doc, ceiling, spelled, words, status }: DocBudgetRow): Finding[] {
  const finding = (path: string, key: string, message: string): Finding[] => [{ check: ID, path, line: 1, key, message }];
  switch (status) {
    case 'invalid': return finding(DOC_BUDGETS_MANIFEST, `ceiling:${doc}`, `"${doc}": the ceiling must be a positive integer, not ${spelled}`);
    case 'missing': return finding(doc, 'missing', `budgeted in ${DOC_BUDGETS_MANIFEST}, but not in the tree: renamed or deleted? Update the manifest with it`);
    case 'over': return finding(doc, 'over', `${words} words, over its ${String(ceiling)}-word ceiling: condense it, move material to the doc that owns it, or raise the ceiling in ${DOC_BUDGETS_MANIFEST}`);
    case 'slack': return finding(doc, 'slack', `${words} words under a ${String(ceiling)}-word ceiling, more slack than the ratchet allows: \`${RATCHET}\` lowers it to ${highestCeilingFor(words ?? 0)}`);
    case 'unbudgeted': return finding(doc, 'unbudgeted', `a standing doc (${words} words) with no ceiling in ${DOC_BUDGETS_MANIFEST}: \`${RATCHET}\` budgets it at its size`);
    case 'ok': break;
  }
  return [];
}

export const docBudgetsCheck: StructuralCheck = {
  id: ID,
  run(context) {
    const budgets = readDocBudgets(context.tree);
    if ('unreadable' in budgets) return [{ check: ID, path: DOC_BUDGETS_MANIFEST, line: 1, key: 'unreadable', message: budgets.unreadable }];
    return budgets.rows.flatMap(rowFinding);
  },
};

/** The findings `ratchetDocBudgets` settles, which a baseline rewrite that ran it doesn't count. */
export const isRatchetedDocBudgetFinding = (finding: Finding) => finding.check === ID && (finding.key === 'slack' || finding.key === 'unbudgeted');

/**
 * The manifest's text with every slack ceiling lowered to the most the ratchet allows and every unbudgeted standing doc
 * budgeted at its size, keys sorted; undefined when nothing moves or the manifest can't be read. Over, missing and
 * invalid entries are copied as they're spelled: each is a decision someone owes, not one this makes.
 */
export function ratchetDocBudgets(tree: DocBudgetTree): { manifestText: string; moves: string[] } | undefined {
  const budgets = readDocBudgets(tree);
  if ('unreadable' in budgets) return undefined;
  const moves: string[] = [];
  const entries = budgets.rows.map(({ doc, ceiling, spelled, words, status }): [string, string] => {
    if ((status === 'slack' || status === 'unbudgeted') && words !== undefined) {
      moves.push(`${doc}: ${status === 'slack' ? String(ceiling) : 'unbudgeted'} → ${highestCeilingFor(words)} (${words} words)`);
      return [doc, String(highestCeilingFor(words))];
    }
    return [doc, spelled];
  });
  const lines = entries.toSorted(([a], [b]) => a.localeCompare(b)).map(([doc, value]) => `  ${JSON.stringify(doc)}: ${value}`);
  return moves.length ? { manifestText: `{\n${lines.join(',\n')}\n}\n`, moves } : undefined;
}
