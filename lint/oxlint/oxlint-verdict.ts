// ─── npm run lint's verdict: oxlint over one scope, judged against its baseline ──
//
// oxlint reads the working tree, but only the files the scope's index tracks:
// another session's untracked, half-written file is nobody's commit yet, and
// must not block one. The public scope is the studio's repository; the
// workspace scope is work/'s, read in this process's git environment, as
// check:arch reads it. An error is a finding, counted against the scope's
// baseline under the id oxlint prints; a warning is advisory and never blocks.
//
// A finding's key is its line's text, trimmed: an edit above it leaves it
// baselined, and an edit to the line itself is a new finding, as the rule
// should look at it again.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { STUDIO_WORKSPACE_MOUNT } from '../policy/studio-tree.ts';
import { baselineTier, compareToBaseline, type Baseline, type BaselineComparison } from '../baseline.ts';
import type { Finding } from '../structural/check-context.ts';

export type OxlintScope = 'public' | 'workspace';

export type OxlintVerdict = BaselineComparison & {
  baselineFile: string;
  findings: Finding[];
  advisories: Finding[];
};

/** oxlint's `-f json` report: `code` is `plugin(rule)`, each label a span with its 1-based line. */
type OxlintReport = {
  diagnostics: { code: string; message: string; severity: 'error' | 'warning'; filename: string; labels: { span: { line: number } }[] }[];
};

export function judgeOxlint(root: string, scope: OxlintScope): OxlintVerdict {
  const report = runOxlint(root, trackedSources(root, scope));
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
  const baselineFile = scope === 'workspace' ? `${STUDIO_WORKSPACE_MOUNT}/arch-baseline.json` : 'lint/arch-baseline.json';
  const path = join(root, baselineFile);
  const baseline = existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as Baseline) : {};
  return { baselineFile, findings, advisories, ...compareToBaseline(findings, baselineTier(baseline, 'oxlint')) };
}

const LINTED_SOURCE = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;

/** The scope's tracked sources still on disk, relative to the studio's root. */
function trackedSources(root: string, scope: OxlintScope): string[] {
  const repo = scope === 'workspace' ? join(root, STUDIO_WORKSPACE_MOUNT) : root;
  const prefix = scope === 'workspace' ? `${STUDIO_WORKSPACE_MOUNT}/` : '';
  return execFileSync('git', ['ls-files', '-z'], { cwd: repo, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    .split('\0')
    .filter((path) => LINTED_SOURCE.test(path))
    .map((path) => `${prefix}${path}`)
    .filter((path) => existsSync(join(root, path)));
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
