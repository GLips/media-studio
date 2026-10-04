// ─── The baseline: today's violations, counted, so they report without blocking ──
//
// Findings are counted per check, file and key (never line), so an edit above a
// baselined violation leaves it baselined. A count above the baseline is a new
// violation and blocks. A count below it is stale and blocks too, until the
// baseline is rewritten: the list only shrinks on purpose, and each shrink is a
// reviewable diff. A new file or project has no entries, so it blocks from its
// first commit.
//
// Both tiers keep one baseline per scope. An oxlint rule is filed under the id
// oxlint prints (`arch(no-long-comments)`), a structural check under its bare
// id, so each tier judges and rewrites only its own entries (baselineTier).

import type { Finding } from './structural/check-context.ts';

/** check → path → key → count. */
export type Baseline = Record<string, Record<string, Record<string, number>>>;

/** A baseline file's text, or `{}` (nothing excused) for a snapshot that holds none. */
export function parseBaseline(text: string | undefined): Baseline {
  // SAFETY: a baseline file is the JSON rebaselineTier writes, in this shape; nothing else writes it.
  return text === undefined ? {} : (JSON.parse(text) as Baseline);
}

export type BaselineComparison = {
  /** Findings past what the baseline allows, the latest in each file first to be called new. */
  fresh: Finding[];
  /** Baselined findings that no longer occur. */
  stale: { check: string; path: string; key: string; count: number }[];
  baselined: Finding[];
};

export type BaselineTier = 'structural' | 'oxlint';

export const baselineTierOf = (check: string): BaselineTier => (/^[a-z-]+\(.+\)$/.test(check) ? 'oxlint' : 'structural');

/** The baseline's entries for one tier's checks. */
export function baselineTier(baseline: Baseline, tier: BaselineTier): Baseline {
  return Object.fromEntries(Object.entries(baseline).filter(([check]) => baselineTierOf(check) === tier));
}

/** The baseline with one tier's entries rewritten to `findings`, the other tier's kept, checks in order. */
export function rebaselineTier(baseline: Baseline, tier: BaselineTier, findings: readonly Finding[]): Baseline {
  const merged = { ...baselineTier(baseline, tier === 'oxlint' ? 'structural' : 'oxlint'), ...baselineOf(findings) };
  return Object.fromEntries(Object.entries(merged).toSorted(([a], [b]) => a.localeCompare(b)));
}

export function baselineOf(findings: readonly Finding[]): Baseline {
  const baseline: Baseline = {};
  for (const finding of findings.toSorted(byPlace)) {
    const keys = ((baseline[finding.check] ??= {})[finding.path] ??= {});
    keys[finding.key] = (keys[finding.key] ?? 0) + 1;
  }
  return baseline;
}

export function compareToBaseline(findings: readonly Finding[], baseline: Baseline): BaselineComparison {
  const groups = new Map<string, Finding[]>();
  for (const finding of findings.toSorted(byPlace)) {
    const id = JSON.stringify([finding.check, finding.path, finding.key]);
    groups.set(id, [...(groups.get(id) ?? []), finding]);
  }
  const fresh: Finding[] = [], baselined: Finding[] = [];
  const stale: BaselineComparison['stale'] = [];
  for (const [id, group] of groups) {
    const [check, path, key] = JSON.parse(id) as [string, string, string];
    const allowed = baseline[check]?.[path]?.[key] ?? 0;
    baselined.push(...group.slice(0, allowed));
    fresh.push(...group.slice(allowed));
  }
  for (const [check, files] of Object.entries(baseline)) {
    for (const [path, keys] of Object.entries(files)) {
      for (const [key, allowed] of Object.entries(keys)) {
        const count = groups.get(JSON.stringify([check, path, key]))?.length ?? 0;
        if (count < allowed) stale.push({ check, path, key, count: allowed - count });
      }
    }
  }
  return { fresh: fresh.toSorted(byPlace), stale, baselined };
}

const byPlace = (a: Finding, b: Finding) =>
  a.check.localeCompare(b.check) || a.path.localeCompare(b.path) || a.line - b.line || a.key.localeCompare(b.key);
