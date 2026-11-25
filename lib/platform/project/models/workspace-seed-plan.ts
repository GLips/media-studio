// workspace-seed-plan.ts: which of the main workspace checkout's gitignored paths a new work/ worktree gets a clone of.
// Tracked code imports made files git never carries (a capture's index.ts and its PNGs, a music fit, a voice
// manifest, imported brush packs), so a fresh worktree fails the typecheck, lint and tests its gate runs until it has
// them. The plan is pure; lib/platform/project/engine/workspace-seed.ts lists the paths and clones them.

/**
 * Ignored names a worktree is better without, wherever they sit: render outputs and gate candidates (made fresh by
 * whoever renders, and large), and tool caches that pin the path they were made at (a Python venv) or are only junk.
 */
const WORKSPACE_SEED_LEFT_OUT: Readonly<Record<string, string>> = {
  'out': 'a render output',
  'candidates': 'a render output',
  '.agent_cache': 'a tool cache',
  '.venv': 'a tool cache',
  '__pycache__': 'a tool cache',
  '.DS_Store': 'a tool cache',
};

export type WorkspaceSeedPlan = {
  /** Paths relative to work/, without a trailing slash, to clone from the main checkout. */
  clone: string[];
  skipped: { path: string; reason: string }[];
};

/**
 * What to clone, from `ignored` (git's --others --ignored --directory listing of the main checkout, a folder ending
 * in /) and `exists` (whether a path relative to work/ is in the new worktree). A path is cloned only beside what the
 * worktree holds, so a project the main checkout never committed isn't half-made in it.
 */
export function planWorkspaceSeed(ignored: readonly string[], exists: (path: string) => boolean): WorkspaceSeedPlan {
  const paths = [...new Set(ignored.map((entry) => entry.replace(/\/$/, '')).filter(Boolean))].toSorted();
  const plan: WorkspaceSeedPlan = { clone: [], skipped: [] };
  for (const path of paths) {
    const segments = path.split('/');
    const leftOut = segments.find((segment) => segment in WORKSPACE_SEED_LEFT_OUT);
    // An ancestor already cloned or left out carries everything under it.
    if (plan.clone.some((done) => path.startsWith(`${done}/`))) continue;
    if (leftOut) {
      if (segments.at(-1) === leftOut) plan.skipped.push({ path, reason: WORKSPACE_SEED_LEFT_OUT[leftOut] });
      continue;
    }
    const parent = segments.slice(0, -1).join('/');
    if (exists(path)) plan.skipped.push({ path, reason: 'already there' });
    else if (parent && !exists(parent)) plan.skipped.push({ path, reason: 'its folder isn\'t in this checkout' });
    else plan.clone.push(path);
  }
  return plan;
}
