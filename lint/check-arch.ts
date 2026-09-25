// ─── npm run check:arch ───────────────────────────────────────────────
//
// Runs every structural check over one candidate snapshot and compares the
// findings to lint/arch-baseline.json. Exits 1 on a new finding, a stale
// baseline entry or a crashed check.
//
//   npm run check:arch                        the index: what the next commit holds
//   npm run check:arch -- --rev main          a committed tree
//   npm run check:arch -- --list              every baselined finding, not just counts
//   npm run check:arch -- --update-baseline   rewrite the baseline to today's findings
//
// The index, not the working tree: stage a file for the check to see it.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { baselineOf, compareToBaseline, type Baseline } from './structural/baseline.ts';
import { createCheckContext, type Finding } from './structural/check-context.ts';
import { STRUCTURAL_CHECKS } from './structural/registry.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE_FILE = join(root, 'lint/arch-baseline.json');

const { values } = parseArgs({ options: { rev: { type: 'string' }, list: { type: 'boolean' }, 'update-baseline': { type: 'boolean' } } });
const snapshot = values.rev ? { kind: 'commit' as const, rev: values.rev } : { kind: 'index' as const };
const context = createCheckContext(root, snapshot);

const findings: Finding[] = [];
const crashed: string[] = [];
for (const check of STRUCTURAL_CHECKS) {
  try {
    findings.push(...check.run(context));
  } catch (error) {
    crashed.push(`${check.id}: ${error instanceof Error ? error.stack : String(error)}`);
  }
}

if (values['update-baseline']) {
  if (crashed.length) throw new Error(`not rewriting the baseline while a check crashes:\n${crashed.join('\n')}`);
  writeFileSync(BASELINE_FILE, `${JSON.stringify(baselineOf(findings), null, 2)}\n`);
  console.log(`Wrote ${findings.length} findings to lint/arch-baseline.json.`);
  process.exit(0);
}

const baseline = JSON.parse(readFileSync(BASELINE_FILE, 'utf8')) as Baseline;
const { fresh, stale, baselined } = compareToBaseline(findings, baseline);
const where = snapshot.kind === 'index' ? 'the index' : `commit ${snapshot.rev}`;
console.log(`check:arch over ${where}: ${context.tree.sources.length} source files, ${context.tree.paths.size} tracked files\n`);

console.log('Baseline (reports, doesn\'t block):');
for (const check of STRUCTURAL_CHECKS) {
  const ours = baselined.filter((finding) => finding.check === check.id);
  const perFile = new Map<string, number>();
  for (const finding of ours) perFile.set(finding.path, (perFile.get(finding.path) ?? 0) + 1);
  console.log(`  ${check.id.padEnd(18)} ${String(ours.length).padStart(4)} in ${perFile.size} files`);
  for (const [path, count] of perFile) {
    if (!values.list) console.log(`      ${String(count).padStart(3)}  ${path}`);
    else for (const finding of ours.filter((f) => f.path === path)) console.log(`      ${path}:${finding.line}  ${finding.message}`);
  }
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
