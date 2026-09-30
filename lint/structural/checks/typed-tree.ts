// ─── Typed tree ───────────────────────────────────────────────────────
//
// Every governed TypeScript file is compiled by the program its position names
// (tsconfigFor), neither directly included nor reached by an import. The types
// checks read only what that program holds, so an uncompiled file is one they're
// silently blind to, and its silence reads exactly like a clean file.
//
// Negative space: a root-level tool config (vite.config.ts, remotion.config.ts)
// is exempt. It belongs to its tool, and web/vite.config.ts is compiled by the
// web app's program though its position names the repo's, so a finding there
// would be false.

import type { Finding, StructuralCheck } from '../check-context.ts';
import { isTypeScriptSource } from '../type-shapes.ts';
import { tsconfigFor } from '../type-checker.ts';

const ID = 'typed-tree';

export const typedTreeCheck: StructuralCheck = {
  id: ID,
  run(context) {
    const findings: Finding[] = [];
    for (const { path } of context.tree.sources) {
      const position = context.positionOf(path);
      if (!isTypeScriptSource(path) || position.kind === 'root-config' || context.typed(path).file) continue;
      const tsconfig = tsconfigFor(position);
      findings.push({
        check: ID, path, line: 1, key: tsconfig,
        message: `no tsconfig compiles this file (${tsconfig} neither includes it nor reaches it by an import), so no ` +
          'type check reads it: add it to that tsconfig\'s include',
      });
    }
    return findings;
  },
};
