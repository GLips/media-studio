// ─── Every source file sits in a declared position ────────────────────
//
// A file the classifier can't place is governed by no check, and a clean run
// over it would read as coverage. So it's a finding: declare its position in
// lint/policy/studio-tree.ts, or move it.

import type { Finding, StructuralCheck } from '../check-context.ts';

const ID = 'declared-tree';

export const declaredTreeCheck: StructuralCheck = {
  id: ID,
  run: (context) => context.tree.undeclared.map((path): Finding => ({
    check: ID, path, line: 1, key: 'undeclared',
    message: 'no position in the declared tree (lint/policy/studio-tree.ts) covers this file, so no check reads it',
  })),
};
