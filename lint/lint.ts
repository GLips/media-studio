// ─── npm run lint ─────────────────────────────────────────────────────
//
// oxlint over the sources one scope's snapshot holds, read from disk, its errors compared to the scope's baseline
// (the file check:arch keeps, under oxlint's own rule ids). Exits 1 on a new finding or a stale baseline entry.
// Warnings print and never block.
//
//   npm run lint                              the studio's working tree, untracked included, and work/'s if there
//   npm run lint -- --scope public            the studio alone (its hook adds --snapshot index)
//   npm run lint -- --scope workspace         work/ alone (its hook adds --snapshot index)
//   npm run lint -- --list                    every baselined finding, not just counts
//   npm run lint -- --update-baseline         shrink each baseline's oxlint entries; scoped, --admit-new grows them
//
// What oxlint enables: oxlint.config.ts. Keys: lint/oxlint/oxlint-verdict.ts. Scopes: lint/gate-scope.ts; none
// named, lint/gate-every-scope.ts.

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import type { BaselineRewrite } from './baseline.ts';
import { describeLeftOutOfIndex } from './candidate-snapshot.ts';
import { judgeEveryGateScope } from './gate-every-scope.ts';
import { describeUnexcused, gateRunSnapshot, parseBaselineRewrite, parseGateScope, rewriteGateBaseline, type GateScope } from './gate-scope.ts';
import { judgeOxlint } from './oxlint/oxlint-verdict.ts';

const script = fileURLToPath(import.meta.url);
const root = join(dirname(script), '..');

const { values } = parseArgs({
  options: {
    scope: { type: 'string' }, snapshot: { type: 'string' }, list: { type: 'boolean' },
    'update-baseline': { type: 'boolean' }, 'admit-new': { type: 'boolean' },
  },
});

type LintRunOptions = { snapshot?: string; list?: boolean };

const baselineRewrite = parseBaselineRewrite(values);
const passed = values.scope === undefined
  ? await judgeEveryGateScope(root, 'lint', script, process.argv.slice(2))
  : reportOxlint(parseGateScope(values.scope), values, baselineRewrite);
process.exitCode = passed ? 0 : 1;

/** One scope linted and printed, its baseline rewritten as `rewrite` says. Returns whether it passed. */
function reportOxlint(scope: GateScope, options: LintRunOptions, rewrite: BaselineRewrite | undefined): boolean {
  const snapshot = gateRunSnapshot(options.snapshot, rewrite !== undefined);
  const { repository, linted, findings, advisories, fresh, stale, baselined } = judgeOxlint(root, scope, snapshot);

  const owner = scope === 'workspace' ? 'work/\'s' : 'the studio\'s';
  const where = snapshot.kind === 'index'
    ? `the ${linted.length} sources the commit holds (${owner} index), read from disk`
    : `the ${linted.length} sources in ${owner} working tree, untracked files included`;
  const leftOut = snapshot.kind === 'index' ? describeLeftOutOfIndex(repository, 'from disk') : [];

  if (rewrite) {
    const { file, unexcused } = rewriteGateBaseline(root, scope, 'oxlint', findings, rewrite);
    console.log(`Wrote ${findings.length - unexcused.length} oxlint findings to ${file}, counted over ${where}: stage it${scope === 'workspace' ? ' in work/' : ''} for the hook to read it.`);
    if (leftOut.length) console.log(`\n${leftOut.join('\n')}`);
    const unexcusedLines = describeUnexcused(scope, unexcused);
    if (unexcusedLines.length) console.log(`\n${unexcusedLines.join('\n')}`);
    return unexcused.length === 0;
  }

  console.log(`lint over ${where}\n`);
  if (leftOut.length) console.log(`${leftOut.join('\n')}\n`);
  const perRule = new Map<string, typeof baselined>();
  for (const finding of baselined) perRule.set(finding.check, [...(perRule.get(finding.check) ?? []), finding]);
  console.log(`Baseline (reports, doesn't block), ${baselined.length}:`);
  for (const [rule, ours] of [...perRule].toSorted(([a], [b]) => a.localeCompare(b))) {
    console.log(`  ${rule.padEnd(44)} ${String(ours.length).padStart(4)} in ${new Set(ours.map((f) => f.path)).size} files`);
    if (options.list) for (const finding of ours) console.log(`      ${finding.path}:${finding.line}  ${finding.message}`);
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
    console.log(`\nStale baseline entries (block until the baseline is rewritten: stage the fixes, then --update-baseline), ${stale.length}:`);
    for (const entry of stale) console.log(`  ${entry.path}  [${entry.check}] ${entry.key} ×${entry.count}`);
  }

  const failed = fresh.length > 0 || stale.length > 0;
  console.log(failed ? '\nlint failed.' : '\nlint passed.');
  return !failed;
}
