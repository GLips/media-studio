// ─── check:arch's verdict over one scope ──────────────────────────────
//
// Every check run over the scope's tree, and what it finds judged against the
// scope's baseline. The public scope judges the studio's files against
// lint/arch-baseline.json. The workspace scope reads the studio's files too
// (your projects import them) but judges only work/'s, against the
// work/arch-baseline.json in work/'s index, so a baseline edit counts once it's
// staged, as the file it excuses does.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { STUDIO_WORKSPACE_MOUNT } from '../policy/studio-tree.ts';
import { compareToBaseline, type Baseline, type BaselineComparison } from './baseline.ts';
import { createCheckContext, type CheckContext, type CheckTarget, type Finding } from './check-context.ts';
import { ROLLING_OUT, STRUCTURAL_CHECKS } from './registry.ts';

export type ArchVerdict = BaselineComparison & {
  context: CheckContext;
  /** The scope's baseline, relative to the studio's root. */
  baselineFile: string;
  /** The scope's blocking findings, before the baseline excuses any. */
  findings: Finding[];
  advisories: Finding[];
  crashed: string[];
};

export function judgeArchitecture(root: string, target: CheckTarget): ArchVerdict {
  const context = createCheckContext(root, target);
  const judged = (finding: Finding) => finding.path.startsWith(`${STUDIO_WORKSPACE_MOUNT}/`) === (target.scope === 'workspace')
    && (!ROLLING_OUT.has(finding.check) || finding.path.startsWith('web/'));
  const findings: Finding[] = [];
  const advisories: Finding[] = [];
  const crashed: string[] = [];
  try {
    for (const check of STRUCTURAL_CHECKS) {
      const rollingOut = ROLLING_OUT.has(check.id);
      // A check not yet switched on keeps only web findings, which the workspace never judges; nor may its crash block.
      if (rollingOut && target.scope === 'workspace') continue;
      try {
        (check.advisory ? advisories : findings).push(...check.run(context).filter(judged));
      } catch (error) {
        const stack = error instanceof Error ? error.stack ?? error.message : String(error);
        if (rollingOut) advisories.push({ check: check.id, path: '(crashed)', line: 1, key: 'crash', message: stack });
        else crashed.push(`${check.id}: ${stack}`);
      }
    }
  } finally {
    context.dispose();
  }
  const baselineFile = target.scope === 'workspace' ? `${STUDIO_WORKSPACE_MOUNT}/arch-baseline.json` : 'lint/arch-baseline.json';
  // A workspace with no baseline staged has no finding excused.
  const baselineText = target.scope === 'public'
    ? readFileSync(join(root, baselineFile), 'utf8')
    : context.tree.paths.has(baselineFile) ? context.tree.readTexts([baselineFile])[0] : '{}';
  const baseline = JSON.parse(baselineText) as Baseline;
  return { context, baselineFile, findings, advisories, crashed, ...compareToBaseline(findings, baseline) };
}
