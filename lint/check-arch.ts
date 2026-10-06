// ─── npm run check:arch ───────────────────────────────────────────────
//
// Every structural check over one candidate snapshot, its findings compared to
// a baseline. Exits 1 on a new finding, a stale baseline entry or a crashed
// check. Advisory checks print and never block.
//
//   npm run check:arch                        the studio's working tree, untracked included, and work/'s if there
//   npm run check:arch -- --scope public      the studio alone (its hook adds --snapshot index)
//   npm run check:arch -- --scope workspace   work/ alone, read with the studio's (its hook adds it too)
//   npm run check:arch -- --rev main          a committed tree of the studio's
//   npm run check:arch -- --list              every baselined finding, not just counts
//   npm run check:arch -- --update-baseline   shrink each baseline to its index; scoped, --admit-new grows it
//
// Snapshots: lint/candidate-snapshot.ts. Scopes: lint/gate-scope.ts; none named, lint/gate-every-scope.ts.

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import type { BaselineRewrite } from './baseline.ts';
import { judgeArchitecture } from './structural/arch-verdict.ts';
import { describeLeftOutOfIndex } from './candidate-snapshot.ts';
import { judgeEveryGateScope } from './gate-every-scope.ts';
import { describeUnexcused, gateRunSnapshot, parseBaselineRewrite, parseGateScope, rewriteGateBaseline, type GateScope } from './gate-scope.ts';
import type { CheckTarget } from './structural/check-context.ts';
import { STRUCTURAL_CHECKS } from './structural/registry.ts';

const script = fileURLToPath(import.meta.url);
const root = join(dirname(script), '..');

const { values } = parseArgs({
  options: {
    rev: { type: 'string' }, snapshot: { type: 'string' }, scope: { type: 'string' }, list: { type: 'boolean' },
    'update-baseline': { type: 'boolean' }, 'admit-new': { type: 'boolean' },
  },
});

type ArchRunOptions = { rev?: string; snapshot?: string; list?: boolean };

const baselineRewrite = parseBaselineRewrite(values);
// A commit is the studio's, so --rev alone judges the studio.
const passed = values.scope === undefined && values.rev === undefined
  ? await judgeEveryGateScope(root, 'check:arch', script, process.argv.slice(2))
  : reportArchitecture(parseGateScope(values.scope ?? 'public'), values, baselineRewrite);
process.exitCode = passed ? 0 : 1;

/** One scope judged and printed, its baseline rewritten as `rewrite` says. Returns whether it passed. */
function reportArchitecture(scope: GateScope, options: ArchRunOptions, rewrite: BaselineRewrite | undefined): boolean {
  if (scope === 'workspace' && options.rev) throw new Error('--rev names a commit of the studio\'s; the workspace scope reads work/\'s working tree or index');
  if (options.rev && (options.snapshot || rewrite)) throw new Error('--rev reads a commit, so it takes no --snapshot and rewrites no baseline');
  const live = gateRunSnapshot(options.snapshot, rewrite !== undefined);
  const target: CheckTarget = scope === 'workspace'
    ? { scope, snapshot: live }
    : { scope, snapshot: options.rev ? { kind: 'commit', rev: options.rev } : live };
  const { context, repository, findings, advisories, crashed, fresh, stale, baselined } = judgeArchitecture(root, target);

  const { snapshot } = target;
  const SNAPSHOT_READ = { worktree: 'working tree, untracked files included', index: 'index, what the commit holds' };
  const read = snapshot.kind === 'commit' ? `commit ${snapshot.rev}` : SNAPSHOT_READ[snapshot.kind];
  const where = scope === 'workspace' ? `work/'s ${read}, with the studio's` : `the studio's ${read}`;
  const leftOut = snapshot.kind === 'index' ? describeLeftOutOfIndex(repository, 'as staged') : [];

  if (rewrite) {
    if (crashed.length) throw new Error(`not rewriting the baseline while a check crashes:\n${crashed.join('\n')}`);
    const { file, unexcused } = rewriteGateBaseline(root, scope, 'structural', findings, rewrite);
    console.log(`Wrote ${findings.length - unexcused.length} findings to ${file}, counted over ${where}: stage it${scope === 'workspace' ? ' in work/' : ''} for the hook to read it.`);
    if (leftOut.length) console.log(`\n${leftOut.join('\n')}`);
    const unexcusedLines = describeUnexcused(scope, unexcused);
    if (unexcusedLines.length) console.log(`\n${unexcusedLines.join('\n')}`);
    return unexcused.length === 0;
  }

  console.log(`check:arch over ${where}: ${context.tree.sources.length} source files of ${context.tree.paths.size} files\n`);
  if (leftOut.length) console.log(`${leftOut.join('\n')}\n`);

  console.log('Baseline (reports, doesn\'t block):');
  for (const check of STRUCTURAL_CHECKS.filter((candidate) => !candidate.advisory)) {
    const ours = baselined.filter((finding) => finding.check === check.id);
    const perFile = new Map<string, number>();
    for (const finding of ours) perFile.set(finding.path, (perFile.get(finding.path) ?? 0) + 1);
    console.log(`  ${check.id.padEnd(18)} ${String(ours.length).padStart(4)} in ${perFile.size} files`);
    for (const [path, count] of perFile) {
      if (!options.list) console.log(`      ${String(count).padStart(3)}  ${path}`);
      else for (const finding of ours.filter((f) => f.path === path)) console.log(`      ${path}:${finding.line}  ${finding.message}`);
    }
  }

  if (advisories.length) {
    console.log('\nAdvisory (reports, never blocks):');
    for (const finding of advisories) console.log(`  ${finding.path}  [${finding.check}] ${finding.message}`);
  }
  if (fresh.length) {
    console.log(`\nNew (blocks), ${fresh.length}:`);
    for (const finding of fresh) console.log(`  ${finding.path}:${finding.line}  [${finding.check}] ${finding.message}`);
  }
  if (stale.length) {
    console.log(`\nStale baseline entries (block until the baseline is rewritten: stage the fixes, then --update-baseline), ${stale.length}:`);
    for (const entry of stale) console.log(`  ${entry.path}  [${entry.check}] ${entry.key} ×${entry.count}`);
  }
  if (crashed.length) console.log(`\nCrashed (blocks):\n${crashed.join('\n')}`);

  const failed = fresh.length > 0 || stale.length > 0 || crashed.length > 0;
  console.log(failed ? '\ncheck:arch failed.' : '\ncheck:arch passed.');
  return !failed;
}
