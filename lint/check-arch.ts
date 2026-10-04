// ─── npm run check:arch ───────────────────────────────────────────────
//
// Every structural check over one candidate snapshot, its findings compared to
// a baseline. Exits 1 on a new finding, a stale baseline entry or a crashed
// check. Advisory checks print and never block.
//
//   npm run check:arch                        the studio's working tree, untracked files included
//   npm run check:arch -- --snapshot index    the studio's index, what its next commit holds (pre-commit's)
//   npm run check:arch -- --rev main          a committed tree of the studio's
//   npm run check:arch -- --scope workspace   work/'s working tree with the studio's (its hook adds --snapshot index)
//   npm run check:arch -- --list              every baselined finding, not just counts
//   npm run check:arch -- --update-baseline   rewrite the scope's baseline to today's findings
//
// Snapshots: lint/candidate-snapshot.ts. Scopes: lint/structural/arch-verdict.ts.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { judgeArchitecture } from './structural/arch-verdict.ts';
import { parseBaseline, rebaselineTier } from './baseline.ts';
import { describeLeftOutOfIndex, listLeftOutOfIndex, parseLiveSnapshot } from './candidate-snapshot.ts';
import { judgedRepositoryRoot, type CheckTarget } from './structural/check-context.ts';
import { STRUCTURAL_CHECKS } from './structural/registry.ts';
import { isSourcePath } from './structural/source-tree.ts';
import { STUDIO_WORKSPACE_MOUNT } from './policy/studio-tree.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const { values } = parseArgs({
  options: {
    rev: { type: 'string' }, snapshot: { type: 'string' }, scope: { type: 'string', default: 'public' }, list: { type: 'boolean' },
    'update-baseline': { type: 'boolean' },
  },
});
if (values.scope !== 'public' && values.scope !== 'workspace') throw new Error(`--scope is public or workspace, not ${values.scope}`);
if (values.scope === 'workspace' && values.rev) throw new Error('--rev names a commit of the studio\'s; the workspace scope reads work/\'s working tree or index');
if (values.rev && values.snapshot) throw new Error('--rev reads a commit, so it takes no --snapshot');
const live = parseLiveSnapshot(values.snapshot ?? 'worktree');
const target: CheckTarget = values.scope === 'workspace'
  ? { scope: 'workspace', snapshot: live }
  : { scope: 'public', snapshot: values.rev ? { kind: 'commit', rev: values.rev } : live };
const { context, baselineFile, findings, advisories, crashed, fresh, stale, baselined } = judgeArchitecture(root, target);

if (values['update-baseline']) {
  if (crashed.length) throw new Error(`not rewriting the baseline while a check crashes:\n${crashed.join('\n')}`);
  // The file on disk is what's rewritten, so its oxlint entries are the ones kept, staged or not.
  const file = join(root, baselineFile);
  const onDisk = parseBaseline(existsSync(file) ? readFileSync(file, 'utf8') : undefined);
  writeFileSync(file, `${JSON.stringify(rebaselineTier(onDisk, 'structural', findings), null, 2)}\n`);
  console.log(`Wrote ${findings.length} findings to ${baselineFile}: stage it${target.scope === 'workspace' ? ' in work/' : ''} for the hook to read it.`);
  process.exit(0);
}

const { snapshot } = target;
const SNAPSHOT_READ = { worktree: 'working tree, untracked files included', index: 'index, what the commit holds' };
const read = snapshot.kind === 'commit' ? `commit ${snapshot.rev}` : SNAPSHOT_READ[snapshot.kind];
const where = target.scope === 'workspace' ? `work/'s ${read}, with the studio's` : `the studio's ${read}`;
console.log(`check:arch over ${where}: ${context.tree.sources.length} source files of ${context.tree.paths.size} files\n`);
if (snapshot.kind === 'index') {
  const leftOut = describeLeftOutOfIndex(listLeftOutOfIndex({ root: judgedRepositoryRoot(root, target), gitEnv: process.env }), {
    mount: target.scope === 'workspace' ? STUDIO_WORKSPACE_MOUNT : '', isSource: isSourcePath, unstagedRead: 'checked as staged',
  });
  if (leftOut.length) console.log(`${leftOut.join('\n')}\n`);
}

console.log('Baseline (reports, doesn\'t block):');
for (const check of STRUCTURAL_CHECKS.filter((candidate) => !candidate.advisory)) {
  const ours = baselined.filter((finding) => finding.check === check.id);
  const perFile = new Map<string, number>();
  for (const finding of ours) perFile.set(finding.path, (perFile.get(finding.path) ?? 0) + 1);
  console.log(`  ${check.id.padEnd(18)} ${String(ours.length).padStart(4)} in ${perFile.size} files`);
  for (const [path, count] of perFile) {
    if (!values.list) console.log(`      ${String(count).padStart(3)}  ${path}`);
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
  console.log(`\nStale baseline entries (blocks until the baseline is rewritten with --update-baseline), ${stale.length}:`);
  for (const entry of stale) console.log(`  ${entry.path}  [${entry.check}] ${entry.key} ×${entry.count}`);
}
if (crashed.length) console.log(`\nCrashed (blocks):\n${crashed.join('\n')}`);

const failed = fresh.length > 0 || stale.length > 0 || crashed.length > 0;
console.log(failed ? '\ncheck:arch failed.' : '\ncheck:arch passed.');
process.exitCode = failed ? 1 : 0;
