// ─── check:arch's verdict over one scope ──────────────────────────────
//
// Every check run over the scope's tree, and what it finds judged against the
// scope's baseline (lint/gate-scope.ts). The workspace scope reads the studio's
// files too (your projects import them) but judges only work/'s.

import { STUDIO_WORKSPACE_MOUNT } from '../policy/studio-tree.ts';
import { baselineTier, compareToBaseline, type BaselineComparison } from '../baseline.ts';
import { gateBaselineFile, gateRepository, readGateBaseline, type GateRepository } from '../gate-scope.ts';
import { createCheckContext, type CheckContext, type CheckTarget, type Finding } from './check-context.ts';
import { STRUCTURAL_CHECKS } from './registry.ts';

export type ArchVerdict = BaselineComparison & {
  context: CheckContext;
  /** The repository whose files are judged: the studio's, or work/'s. */
  repository: GateRepository;
  /** The scope's baseline, relative to the studio's root. */
  baselineFile: string;
  /** The scope's blocking findings, before the baseline excuses any. */
  findings: Finding[];
  advisories: Finding[];
  crashed: string[];
};

export function judgeArchitecture(root: string, target: CheckTarget): ArchVerdict {
  const context = createCheckContext(root, target);
  const judged = (finding: Finding) => finding.path.startsWith(`${STUDIO_WORKSPACE_MOUNT}/`) === (target.scope === 'workspace');
  const findings: Finding[] = [];
  const advisories: Finding[] = [];
  const crashed: string[] = [];
  try {
    for (const check of STRUCTURAL_CHECKS) {
      try {
        (check.advisory ? advisories : findings).push(...check.run(context).filter(judged));
      } catch (error) {
        crashed.push(`${check.id}: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
      }
    }
  } finally {
    context.dispose();
  }
  const repository = gateRepository(root, target.scope, target.snapshot);
  const baseline = baselineTier(readGateBaseline(repository), 'structural');
  return { context, repository, baselineFile: gateBaselineFile(target.scope), findings, advisories, crashed, ...compareToBaseline(findings, baseline) };
}
