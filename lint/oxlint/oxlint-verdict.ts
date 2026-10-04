// ─── npm run lint's verdict: oxlint over one scope, judged against its baseline ──
//
// A scope's sources (lint/gate-scope.ts) are those its snapshot holds (lint/candidate-snapshot.ts), and oxlint reads
// them from disk: under a hook, a file's unstaged edits are linted with it. An error is a finding, counted against the
// baseline the same snapshot holds under the id oxlint prints; a warning is advisory and never blocks.
//
// A finding's key is its line's text, trimmed: an edit above it leaves it
// baselined, and an edit to the line itself is a new finding, as the rule
// should look at it again.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { baselineTier, compareToBaseline, type BaselineComparison } from '../baseline.ts';
import { isSourcePath, listSnapshotPaths, type LiveSnapshot } from '../candidate-snapshot.ts';
import { gateBaselineFile, gateRepository, readGateBaseline, type GateRepository, type GateScope } from '../gate-scope.ts';
import type { Finding } from '../structural/check-context.ts';

export type OxlintVerdict = BaselineComparison & {
  /** The repository whose sources are linted: the studio's, or work/'s. */
  repository: GateRepository;
  baselineFile: string;
  /** The sources oxlint read, relative to the studio's root. */
  linted: readonly string[];
  findings: Finding[];
  advisories: Finding[];
};

/** oxlint's `-f json` report: `code` is `plugin(rule)`, each label a span with its 1-based line. */
type OxlintReport = {
  diagnostics: { code: string; message: string; severity: 'error' | 'warning'; filename: string; labels: { span: { line: number } }[] }[];
};

export function judgeOxlint(root: string, scope: GateScope, snapshot: LiveSnapshot): OxlintVerdict {
  const repository = gateRepository(root, scope, snapshot);
  const prefix = repository.mount ? `${repository.mount}/` : '';
  const held = listSnapshotPaths(repository);
  // An index's file deleted on disk isn't there for oxlint to read: the index run lists it as unstaged.
  const linted = held.filter(isSourcePath).map((path) => `${prefix}${path}`).filter((path) => existsSync(join(root, path)));
  const report = runOxlint(root, linted);
  const lines = new Map<string, readonly string[]>();
  const lineOf = (path: string, line: number) => {
    let text = lines.get(path);
    if (!text) lines.set(path, (text = readFileSync(join(root, path), 'utf8').split('\n')));
    return text[line - 1]?.trim() ?? '';
  };
  const findings: Finding[] = [];
  const advisories: Finding[] = [];
  for (const diagnostic of report.diagnostics) {
    const line = diagnostic.labels[0]?.span.line ?? 1;
    const finding: Finding = {
      check: diagnostic.code, path: diagnostic.filename, line,
      key: diagnostic.labels.length ? lineOf(diagnostic.filename, line) : diagnostic.message,
      message: diagnostic.message,
    };
    (diagnostic.severity === 'error' ? findings : advisories).push(finding);
  }
  const baseline = baselineTier(readGateBaseline(repository), 'oxlint');
  return { repository, baselineFile: gateBaselineFile(scope), linted, findings, advisories, ...compareToBaseline(findings, baseline) };
}

function runOxlint(root: string, files: readonly string[]): OxlintReport {
  if (files.length === 0) return { diagnostics: [] };
  const binary = join(root, 'node_modules/.bin/oxlint');
  try {
    return JSON.parse(execFileSync(binary, ['-f', 'json', ...files], { cwd: root, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })) as OxlintReport;
  } catch (failure) {
    // A finding exits non-zero with the report on stdout; a config oxlint refuses has no report, so it throws on.
    const stdout = (failure as { stdout?: string }).stdout;
    if (!stdout?.trim().startsWith('{')) throw failure;
    return JSON.parse(stdout) as OxlintReport;
  }
}
