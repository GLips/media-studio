// brush-fidelity-report.ts: a pack's fidelity/report.json, which `npm run brushes:sheet` writes and the fit's
// baselines and the guard's report diff read, typed, versioned and parsed here alone. A report names what it scored:
// the pack's source, the app's reading its brushes were read by, and the scorer, so a reader can tell a score measured
// the same way from one that wasn't.

import type { StampPaintPack } from '#lib/picture/stamp-styles/models/stamp-paint-pack.ts';
import { BRUSH_FIDELITY_NOTHING_PAINTED, BRUSH_FIDELITY_TARGET_LABELS, type BrushFidelityTargetLabel } from './brush-fidelity-target.ts';
import type { BrushReading } from './brush-reading-search.ts';
import { BRUSH_READINGS } from './brush-readings.ts';
import { STROKE_SCORE_GRADES, STROKE_SCORE_WEIGHTS, type StrokeProfileComparison } from './stroke-measure.ts';

/** report.json's shape. Bump it when the shape changes: a report of another version is refused, never read around. */
export const BRUSH_FIDELITY_REPORT_VERSION = 1;

/**
 * How a brush is scored: stroke-measure.ts's measures, weights and comparison, BRUSH_FIDELITY_NOTHING_PAINTED, the
 * diameter fitting in brush-fidelity-score.ts, how a target's stroke is painted and what of its frame is measured
 * (brush-fidelity-target.ts). Bump it when any of them changes, so a score from before isn't held against one from
 * after as if measured alike.
 */
export const BRUSH_FIDELITY_SCORER_VERSION = 3;

/**
 * How a brush fared against its target. `emptyRender`: its target measured, it painted nothing that counts as stroke.
 * `unmeasurableTarget`: its target has nothing that counts as stroke, so there's nothing to hold it to. `unscored`: it
 * has no target.
 */
export type BrushFidelityOutcome =
  | { kind: 'scored'; comparison: StrokeProfileComparison; score: number }
  | { kind: 'emptyRender'; score: typeof BRUSH_FIDELITY_NOTHING_PAINTED }
  | { kind: 'unmeasurableTarget' }
  | { kind: 'unscored' };

/** What a report scored: the pack's source and asset version, the reading its brushes were read by, the scorer. */
export type BrushFidelityReportIdentity = {
  source: { archive: string; sha256: string; assetsVersion: number };
  reading: { app: StampPaintPack['app']; values: BrushReading };
  scorer: number;
};

export type BrushFidelityReportEntry = {
  brush: string;
  /** Its row's file in rows/. */
  row: string;
  diameter: number;
  target: BrushFidelityTargetLabel;
  /** The style's fidelity.ts note on why it differs. */
  note?: string;
  outcome: BrushFidelityOutcome;
};

export type BrushFidelityReport = {
  version: typeof BRUSH_FIDELITY_REPORT_VERSION;
  style: string;
  pack: string;
  identity: BrushFidelityReportIdentity;
  grades: typeof STROKE_SCORE_GRADES;
  /** The scores of every scored and empty render summed. */
  total: number;
  entries: readonly BrushFidelityReportEntry[];
};

/** What a sheet drawn now of `manifest`'s pack scores: its source, its app's checked-in reading, today's scorer. */
export const currentBrushFidelityIdentity = (manifest: StampPaintPack): BrushFidelityReportIdentity => ({
  source: { ...manifest.source, assetsVersion: manifest.version },
  reading: { app: manifest.app, values: { ...BRUSH_READINGS[manifest.app].reading } },
  scorer: BRUSH_FIDELITY_SCORER_VERSION,
});

/** Where two identities differ, a line each; none when a score under one is measured as under the other. */
export function brushFidelityIdentityDifferences(before: BrushFidelityReportIdentity, after: BrushFidelityReportIdentity): string[] {
  const lines: string[] = [];
  const { source: a, reading: r } = before, { source: b, reading: s } = after;
  if (a.archive !== b.archive || a.sha256 !== b.sha256) lines.push(`source ${a.archive} (${a.sha256.slice(0, 12)}) → ${b.archive} (${b.sha256.slice(0, 12)})`);
  if (a.assetsVersion !== b.assetsVersion) lines.push(`assets version ${a.assetsVersion} → ${b.assetsVersion}`);
  if (r.app !== s.app) lines.push(`reading app ${r.app} → ${s.app}`);
  else for (const key of new Set([...Object.keys(r.values), ...Object.keys(s.values)])) {
    if (r.values[key] !== s.values[key]) lines.push(`reading ${key} ${r.values[key]} → ${s.values[key]}`);
  }
  if (before.scorer !== after.scorer) lines.push(`scorer version ${before.scorer} → ${after.scorer}`);
  return lines;
}

/** The score an outcome adds to its pack's total, and the fit holds a brush to: none for a brush with nothing to score. */
export function brushFidelityOutcomeScore(outcome: BrushFidelityOutcome): number | undefined {
  switch (outcome.kind) {
    case 'scored': case 'emptyRender': return outcome.score;
    case 'unmeasurableTarget': case 'unscored': return undefined;
  }
}

class BrushFidelityReportError extends Error {}
const fail = (problem: string): never => {
  throw new BrushFidelityReportError(problem);
};
const record = (value: unknown, at: string) => (value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : fail(`${at} isn't an object`));
const text = (value: unknown, at: string) => (typeof value === 'string' ? value : fail(`${at} isn't a string`));
const num = (value: unknown, at: string) => (typeof value === 'number' && Number.isFinite(value) ? value : fail(`${at} isn't a number`));
const numbers = <K extends string>(value: unknown, keys: readonly K[], at: string) => {
  const r = record(value, at);
  return Object.fromEntries(keys.map((key) => [key, num(r[key], `${at}.${key}`)])) as Record<K, number>;
};
const pair = (value: unknown, at: string) => numbers(value, ['preview', 'ours'], at);

function parseComparison(value: unknown, at: string): StrokeProfileComparison {
  const c = record(value, at), mottle = record(c.mottle, `${at}.mottle`);
  return {
    ...numbers(c, ['length', 'peak', 'profileError', 'density', 'mapError', 'score'], at),
    start: pair(c.start, `${at}.start`), end: pair(c.end, `${at}.end`), rim: pair(c.rim, `${at}.rim`), grain: pair(c.grain, `${at}.grain`),
    edgeWidth: pair(c.edgeWidth, `${at}.edgeWidth`), fill: pair(c.fill, `${at}.fill`),
    mottle: { preview: numbers(mottle.preview, ['fine', 'coarse'], `${at}.mottle.preview`), ours: numbers(mottle.ours, ['fine', 'coarse'], `${at}.mottle.ours`) },
    terms: numbers(c.terms, Object.keys(STROKE_SCORE_WEIGHTS) as (keyof typeof STROKE_SCORE_WEIGHTS)[], `${at}.terms`),
  };
}

function parseOutcome(value: unknown, at: string): BrushFidelityOutcome {
  const o = record(value, at);
  switch (o.kind) {
    case 'scored': return { kind: 'scored', comparison: parseComparison(o.comparison, `${at}.comparison`), score: num(o.score, `${at}.score`) };
    case 'emptyRender': return o.score === BRUSH_FIDELITY_NOTHING_PAINTED ? { kind: 'emptyRender', score: BRUSH_FIDELITY_NOTHING_PAINTED } : fail(`${at}.score isn't ${BRUSH_FIDELITY_NOTHING_PAINTED}`);
    case 'unmeasurableTarget': case 'unscored': return { kind: o.kind };
    default: return fail(`${at}.kind is ${JSON.stringify(o.kind)}`);
  }
}

function parseIdentity(value: unknown): BrushFidelityReportIdentity {
  const i = record(value, 'identity'), source = record(i.source, 'identity.source'), reading = record(i.reading, 'identity.reading');
  const app = reading.app === 'procreate' || reading.app === 'photoshop' ? reading.app : fail(`identity.reading.app is ${JSON.stringify(reading.app)}`);
  const values = record(reading.values, 'identity.reading.values');
  return {
    source: { archive: text(source.archive, 'identity.source.archive'), sha256: text(source.sha256, 'identity.source.sha256'), assetsVersion: num(source.assetsVersion, 'identity.source.assetsVersion') },
    reading: { app, values: Object.fromEntries(Object.entries(values).map(([key, v]) => [key, num(v, `identity.reading.values.${key}`)])) },
    scorer: num(i.scorer, 'identity.scorer'),
  };
}

const TARGET_LABELS: readonly unknown[] = Object.values(BRUSH_FIDELITY_TARGET_LABELS);

/**
 * `value`, a report.json as JSON parsed it, checked whole and typed. A report of another version, or of none (drawn
 * before reports were versioned), is refused with how to draw it again; so is one whose shape isn't a report's.
 */
export function parseBrushFidelityReport(value: unknown, file: string): BrushFidelityReport {
  try {
    const r = record(value, 'the report');
    if (r.version !== BRUSH_FIDELITY_REPORT_VERSION) fail(`it's report version ${String(r.version ?? 'none')}, and the studio reads version ${BRUSH_FIDELITY_REPORT_VERSION}`);
    const entries = Array.isArray(r.entries) ? r.entries : fail('entries isn\'t a list');
    const grades = numbers(r.grades, ['close', 'rough'], 'grades');
    if (grades.close !== STROKE_SCORE_GRADES.close || grades.rough !== STROKE_SCORE_GRADES.rough) fail(`its grades ${JSON.stringify(grades)} aren't today's ${JSON.stringify(STROKE_SCORE_GRADES)}`);
    return {
      version: BRUSH_FIDELITY_REPORT_VERSION, style: text(r.style, 'style'), pack: text(r.pack, 'pack'), identity: parseIdentity(r.identity),
      grades: STROKE_SCORE_GRADES, total: num(r.total, 'total'),
      entries: entries.map((rawEntry, i): BrushFidelityReportEntry => {
        const e = record(rawEntry, `entries[${i}]`);
        const target = TARGET_LABELS.includes(e.target) ? e.target as BrushFidelityTargetLabel : fail(`entries[${i}].target is ${JSON.stringify(e.target)}`);
        return {
          brush: text(e.brush, `entries[${i}].brush`), row: text(e.row, `entries[${i}].row`), diameter: num(e.diameter, `entries[${i}].diameter`), target,
          ...(e.note !== undefined && { note: text(e.note, `entries[${i}].note`) }), outcome: parseOutcome(e.outcome, `entries[${i}].outcome`),
        };
      }),
    };
  } catch (error) {
    if (!(error instanceof BrushFidelityReportError)) throw error;
    const at = typeof value === 'object' && value && 'style' in value && 'pack' in value ? `--style ${String(value.style)} --pack ${String(value.pack)}` : '--style <style> --pack <pack>';
    throw new Error(`${file}: ${error.message}; draw it again: npm run brushes:sheet -- ${at}`, { cause: error });
  }
}
