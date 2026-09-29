// ─── Studio temp: one owner for the temp dir ──────────────────────────
//
// Only lib/platform/temp/engine/studio-temp.ts names mkdtemp, mkdtempSync or tmpdir.
// Everything else takes its folder from studioTempRoot() or withStudioTemp(),
// which remove it when the step or the process ends, so a command that throws
// or a server that's stopped can't leak one into the system temp dir.
//
// Reads every tracked code file's text, not just the governed sources, so lint/,
// web/ and a bin script are held to it too, and any spelling is caught: a
// namespace's os.tmpdir(), a dynamic import's binding, fs.promises.mkdtemp.
// A comment naming them is caught as well; say "temp folder" instead.
//
// Exempt: the owner, and this check and its spec, which have to name them.
//
// Negative space: a literal '/tmp/…' path, a spawned mktemp and $TMPDIR aren't
// caught, and extensionless shell scripts (.githooks/) aren't read. None of the
// studio's code does any of these.

import type { Finding, StructuralCheck } from '../check-context.ts';

const ID = 'studio-temp';
const OWNER = 'lib/platform/temp/engine/studio-temp.ts';
const EXEMPT = new Set([OWNER, 'lint/structural/checks/studio-temp.ts', 'lint/structural/checks/studio-temp.test.ts']);
const CODE_FILE = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;
const TEMP_DIR_API = /\b(mkdtempSync|mkdtemp|tmpdir)\b/;

export const studioTempCheck: StructuralCheck = {
  id: ID,
  run(context) {
    const paths = [...context.tree.paths].filter((path) => CODE_FILE.test(path) && !EXEMPT.has(path)).sort();
    const texts = context.tree.readTexts(paths);
    const findings: Finding[] = [];
    paths.forEach((path, i) => {
      texts[i].split('\n').forEach((line, index) => {
        const name = TEMP_DIR_API.exec(line)?.[1];
        if (!name) return;
        findings.push({
          check: ID, path, line: index + 1, key: line.trim().slice(0, 160),
          message: `names ${name}: take a temp folder from withStudioTemp (a step's) or studioTempRoot() (the process's), in ${OWNER}, which remove it however the process ends`,
        });
      });
    });
    return findings;
  },
};
