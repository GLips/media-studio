// ─── (d) No scratch ───────────────────────────────────────────────────
//
// No tracked text file refers to `scratch/`: code, shell, Markdown or config.
// scratch/ is a gitignored workspace, so a reference to it works on one machine
// and nowhere else. Reads every text file in the snapshot, not just source, so
// a shell script or a README pointing at a scratch script is caught too.
//
// Prose (Markdown) may name the scratch/ directory as a workspace ("a scratch
// project in `scratch/<name>/`"), but not a path to anything in it: a specific
// file or folder there is still a reference that works on one machine.
//
// Exempt: `.gitignore`, which is how scratch/ stays untracked, and `lint/`,
// whose own pattern and specs have to name it. A binary file is skipped.

import type { Finding, StructuralCheck } from '../check-context.ts';

const ID = 'no-scratch';
/**
 * `scratch` as a path segment: `$repo/scratch/x.sh`, `'scratch/x'`, `"$repo/scratch"` and `join(root, 'scratch')`
 * match; `my-scratch/` and prose ("start from scratch") don't.
 */
const SCRATCH_REFERENCE = /(?<![\w.-])scratch\/|[/'"`]scratch(?![\w.-])/;

/** In prose, what follows each `scratch/`: flagged when its first segment names something, not a placeholder. */
const PROSE_SCRATCH_PATH = /(?<![\w.-])scratch\/([^\s`'"()[\]]*)/g;
const namesSomethingInScratch = (line: string) =>
  [...line.matchAll(PROSE_SCRATCH_PATH)].some(([, rest]) => {
    const segment = rest.split('/')[0].replace(/[.,:;!?]+$/, '');
    return segment !== '' && !/[<>*{}]/.test(segment);
  });

const isExempt = (path: string) => path === '.gitignore' || path.startsWith('lint/');

export const noScratchCheck: StructuralCheck = {
  id: ID,
  run(context) {
    const paths = [...context.tree.paths].filter((path) => !isExempt(path)).toSorted();
    const texts = context.tree.readTexts(paths);
    const findings: Finding[] = [];
    paths.forEach((path, i) => {
      const text = texts[i];
      if (text.includes('\0')) return;
      const refers = path.endsWith('.md') ? namesSomethingInScratch : (line: string) => SCRATCH_REFERENCE.test(line);
      text.split('\n').forEach((line, index) => {
        if (!refers(line)) return;
        findings.push({
          check: ID, path, line: index + 1, key: line.trim().slice(0, 160),
          message: 'refers to scratch/, a gitignored workspace: move what it needs into the repo, or drop the reference',
        });
      });
    });
    return findings;
  },
};
