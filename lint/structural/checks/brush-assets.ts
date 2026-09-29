// ─── Brush assets stay out of git ─────────────────────────────────────
//
// A painting style's brushes come from a pack someone bought (docs/private-styles.md), and a licence covers their
// copy, not a repository's. So the studio, which is public, tracks no brush archive (`.brushset`, `.abr`) anywhere,
// but for the few authored as test fixtures, listed here one by one; and the workspace tracks nothing under a style's
// `brushes/`, which each machine regenerates from its own copy of the pack (work/.gitignore holds it out already;
// this catches a forced add).
//
// Negative space: an archive elsewhere in work/ isn't refused. The workspace is private, and whether a pack may sit
// in it is its owner's call.

import { STUDIO_WORKSPACE_MOUNT } from '../../policy/studio-tree.ts';
import type { Finding, StructuralCheck } from '../check-context.ts';

const ID = 'brush-assets';
const BRUSH_ARCHIVE = /\.(brushset|abr)$/i;
const STYLE_BRUSHES = new RegExp(`^${STUDIO_WORKSPACE_MOUNT}/styles/[^/]+/brushes/`);

/** Brush archives the studio tracks on purpose: made for a test, never bought. Each is named here to be allowed. */
const AUTHORED_BRUSH_FIXTURES: readonly string[] = [];

export const brushAssetsCheck: StructuralCheck = {
  id: ID,
  run(context) {
    const findings: Finding[] = [];
    for (const path of [...context.tree.paths].sort()) {
      const report = (message: string) => findings.push({ check: ID, path, line: 1, key: 'tracked', message });
      if (STYLE_BRUSHES.test(path)) {
        report('a style\'s brushes/ is imported from a bought pack on each machine, never tracked: git rm --cached it');
      } else if (!path.startsWith(`${STUDIO_WORKSPACE_MOUNT}/`) && BRUSH_ARCHIVE.test(path) && !AUTHORED_BRUSH_FIXTURES.includes(path)) {
        report('a brush archive is a licensed pack, and the studio is public: import it into a style in work/styles/ instead (docs/private-styles.md), or, if you authored it as a test fixture, list it in AUTHORED_BRUSH_FIXTURES');
      }
    }
    return findings;
  },
};
