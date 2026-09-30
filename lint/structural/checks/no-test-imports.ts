// ─── No test imports: a spec is imported only by specs ────────────────
//
// A file that isn't a spec never imports one (`*.test.ts`, `*.test.tsx`, any
// source extension), by any spelling: a static or dynamic import, a re-export,
// a type. Specs importing specs is fine. So a spec can be rewritten or deleted
// and only specs break.
//
// Negative space: a spec is known by its name alone. `fixture-git.ts` and
// `tsx-test-hooks.ts` serve specs but also run in production (a scaffolded
// workspace's git, `studio mix`'s sound check), so a "fixture" or "test" word
// elsewhere in a name marks nothing. This layout has no `__tests__/` or `test/`
// folders to count.

import type { Finding, StructuralCheck } from '../check-context.ts';

const ID = 'no-test-imports';
const SPEC_FILE = /\.test\.[cm]?[jt]sx?$/;

export const noTestImportsCheck: StructuralCheck = {
  id: ID,
  run(context) {
    const findings: Finding[] = [];
    for (const file of context.tree.sources) {
      if (SPEC_FILE.test(file.path)) continue;
      for (const edge of context.edgesFrom(file)) {
        if (edge.target.kind !== 'module' || !SPEC_FILE.test(edge.target.path)) continue;
        findings.push({
          check: ID, path: file.path, line: edge.line, key: edge.scanned.specifier,
          message: `imports the spec ${edge.target.path}; only specs may. Move what both need into a module of its own`,
        });
      }
    }
    return findings;
  },
};
