// ─── npm run lint ─────────────────────────────────────────────────────
//
// oxlint over the files one scope tracks, as its working tree holds them, its errors compared to the scope's
// baseline (the file check:arch keeps, under oxlint's own rule ids). Exits 1
// on a new finding or a stale baseline entry. Warnings print and never block.
//
//   npm run lint                              the studio's checkout
//   npm run lint -- --scope workspace         work/ (its pre-commit hook runs this)
//   npm run lint -- --list                    every baselined finding, not just counts
//   npm run lint -- --update-baseline         rewrite the scope's oxlint entries to today's findings
//
// What oxlint enables: oxlint.config.ts. How a finding is keyed: lint/oxlint/oxlint-verdict.ts.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { rebaselineTier, type Baseline } from './baseline.ts';
import { judgeOxlint } from './oxlint/oxlint-verdict.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const { values } = parseArgs({
  options: { scope: { type: 'string', default: 'public' }, list: { type: 'boolean' }, 'update-baseline': { type: 'boolean' } },
});
if (values.scope !== 'public' && values.scope !== 'workspace') throw new Error(`--scope is public or workspace, not ${values.scope}`);
const { baselineFile, findings, advisories, fresh, stale, baselined } = judgeOxlint(root, values.scope);

if (values['update-baseline']) {
  const file = join(root, baselineFile);
  const onDisk = existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as Baseline) : {};
  writeFileSync(file, `${JSON.stringify(rebaselineTier(onDisk, 'oxlint', findings), null, 2)}\n`);
  console.log(`Wrote ${findings.length} oxlint findings to ${baselineFile}${values.scope === 'workspace' ? ': stage it in work/' : ''}.`);
  process.exit(0);
}

console.log(`lint over ${values.scope === 'workspace' ? 'work/' : 'the studio'}'s working tree\n`);
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
