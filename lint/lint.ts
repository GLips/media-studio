// ─── npm run lint ─────────────────────────────────────────────────────
//
// oxlint over the sources one scope's snapshot holds, read from disk, its errors compared to the scope's baseline
// (the file check:arch keeps, under oxlint's own rule ids). Exits 1 on a new finding or a stale baseline entry.
// Warnings print and never block.
//
//   npm run lint                              the studio's working tree, untracked files included
//   npm run lint -- --snapshot index          the sources the studio's index holds (pre-commit's)
//   npm run lint -- --scope workspace         work/'s working tree (its hook adds --snapshot index)
//   npm run lint -- --list                    every baselined finding, not just counts
//   npm run lint -- --update-baseline         rewrite the scope's oxlint entries to today's findings
//
// What oxlint enables: oxlint.config.ts. Keys and snapshots: lint/oxlint/oxlint-verdict.ts.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { parseBaseline, rebaselineTier } from './baseline.ts';
import { describeLeftOutOfIndex, listLeftOutOfIndex, parseLiveSnapshot } from './candidate-snapshot.ts';
import { judgeOxlint, oxlintScopeRoot } from './oxlint/oxlint-verdict.ts';
import { STUDIO_WORKSPACE_MOUNT } from './policy/studio-tree.ts';
import { isSourcePath } from './structural/source-tree.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const { values } = parseArgs({
  options: {
    scope: { type: 'string', default: 'public' }, snapshot: { type: 'string', default: 'worktree' }, list: { type: 'boolean' },
    'update-baseline': { type: 'boolean' },
  },
});
if (values.scope !== 'public' && values.scope !== 'workspace') throw new Error(`--scope is public or workspace, not ${values.scope}`);
const snapshot = parseLiveSnapshot(values.snapshot);
const { baselineFile, linted, findings, advisories, fresh, stale, baselined } = judgeOxlint(root, values.scope, snapshot);

if (values['update-baseline']) {
  const file = join(root, baselineFile);
  const onDisk = parseBaseline(existsSync(file) ? readFileSync(file, 'utf8') : undefined);
  writeFileSync(file, `${JSON.stringify(rebaselineTier(onDisk, 'oxlint', findings), null, 2)}\n`);
  console.log(`Wrote ${findings.length} oxlint findings to ${baselineFile}: stage it${values.scope === 'workspace' ? ' in work/' : ''} for the hook to read it.`);
  process.exit(0);
}

const owner = values.scope === 'workspace' ? 'work/\'s' : 'the studio\'s';
console.log(snapshot.kind === 'index'
  ? `lint over the ${linted.length} sources the commit holds (${owner} index), read from disk\n`
  : `lint over the ${linted.length} sources in ${owner} working tree, untracked files included\n`);
if (snapshot.kind === 'index') {
  const leftOut = describeLeftOutOfIndex(listLeftOutOfIndex({ root: oxlintScopeRoot(root, values.scope), gitEnv: process.env }), {
    mount: values.scope === 'workspace' ? STUDIO_WORKSPACE_MOUNT : '', isSource: isSourcePath, unstagedRead: 'linted as they are on disk, not as staged',
  });
  if (leftOut.length) console.log(`${leftOut.join('\n')}\n`);
}
const perRule = new Map<string, typeof baselined>();
for (const finding of baselined) perRule.set(finding.check, [...(perRule.get(finding.check) ?? []), finding]);
console.log(`Baseline (reports, doesn't block), ${baselined.length}:`);
for (const [rule, ours] of [...perRule].toSorted(([a], [b]) => a.localeCompare(b))) {
  console.log(`  ${rule.padEnd(44)} ${String(ours.length).padStart(4)} in ${new Set(ours.map((f) => f.path)).size} files`);
  if (values.list) for (const finding of ours) console.log(`      ${finding.path}:${finding.line}  ${finding.message}`);
}
if (advisories.length) {
  console.log(`\nWarnings (report, never block), ${advisories.length}:`);
  for (const finding of advisories) console.log(`  ${finding.path}:${finding.line}  [${finding.check}] ${finding.message}`);
}
if (fresh.length) {
  console.log(`\nNew (blocks), ${fresh.length}:`);
  for (const finding of fresh) console.log(`  ${finding.path}:${finding.line}  [${finding.check}] ${finding.message}`);
}
if (stale.length) {
  console.log(`\nStale baseline entries (block until the baseline is rewritten with --update-baseline), ${stale.length}:`);
  for (const entry of stale) console.log(`  ${entry.path}  [${entry.check}] ${entry.key} ×${entry.count}`);
}

const failed = fresh.length > 0 || stale.length > 0;
console.log(failed ? '\nlint failed.' : '\nlint passed.');
process.exitCode = failed ? 1 : 0;
