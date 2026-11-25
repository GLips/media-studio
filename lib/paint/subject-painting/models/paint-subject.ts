// paint-subject.ts: a subject painted by a painter, with the author's overrides. It narrows the subject to the
// painter's evidence, resolves overrides (ownership first), runs the painter, checks its contributions keep to what it
// owns, draws the replacements, and assembles every layer slot by slot in the painter's order, each slot's
// replacements after its own contributions. Extra paint needs no override: put ordinary layers after `layers`.

import type { LayerNode } from '#lib/paint/document/models/painting-document.ts';
import { recordPaintingLayerOrigin } from '#lib/paint/document/models/painting-layer-origin.ts';
import { requireSubjectEvidence } from '#lib/paint/subject/models/subject-check.ts';
import { SubjectDiagnosticError, type SubjectResult } from '#lib/paint/subject/models/subject-diagnostic.ts';
import type { SubjectEvidenceKind } from '#lib/paint/subject/models/subject-evidence.ts';
import type { SubjectIds } from '#lib/paint/subject/models/subject-id.ts';
import { subjectRefKey, type PaintableRef, type Subject, type SubjectFeature, type SubjectPart } from '#lib/paint/subject/models/subject.ts';
import { resolveSubjectOverrides, type SubjectOverride } from './subject-overrides.ts';
import {
  subjectPaintKey, type SubjectContribution, type SubjectKeySegment, type SubjectPainter, type SubjectPainterContext,
  type VisibleSubjectFeature, type VisibleSubjectPart,
} from './subject-painter.ts';
import {
  subjectLayerDocumentKeys,
  type SubjectAppliedReplacement, type SubjectContributionEntry, type SubjectKeyProvenance, type SubjectPaintingDiagnostic, type SubjectPaintingReport,
} from './subject-painting-report.ts';

/** The overrides `paintSubject(subject, painter, …)` takes, for typing a list built apart from the call. */
export type SubjectOverridesFor<S, P> = S extends Subject<infer I>
  ? P extends { readonly defaults: infer O; readonly slots: readonly (infer Slot extends string)[]; readonly controls: readonly (infer Control)[] }
    ? readonly SubjectOverride<I, O, Slot, Control & keyof O>[]
    : never
  : never;

/** A subject painted: its layers, back to front, to put in a document (finishing layers go after), and its report. */
export type SubjectPainting = { readonly layers: readonly LayerNode[]; readonly report: SubjectPaintingReport };

const isVisiblePart = (part: SubjectPart): part is VisibleSubjectPart => part.visibility.kind === 'visible';
const isVisibleFeature = (feature: SubjectFeature): feature is VisibleSubjectFeature => feature.visibility.kind === 'visible';

const targetKeys = (targets: readonly { readonly ref: PaintableRef }[] | readonly PaintableRef[]) =>
  targets.map((target) => subjectRefKey('ref' in target ? target.ref : target));

const problem = (severity: 'error' | 'warning', code: SubjectPaintingDiagnostic['code'], address: string, message: string, fix: string): SubjectPaintingDiagnostic =>
  ({ code, severity, address, message, fix });

/**
 * `subject` painted by `painter` with `options` over its defaults and `overrides` applied in order: the layers back
 * to front and a report, or every error found (unknown ids, overlapping replacements, missing evidence, a painter
 * breaking its contract, duplicate keys), each with its address and fix.
 */
export function paintSubject<I extends SubjectIds, O extends object, Slot extends string, Control extends keyof O & string, E extends SubjectEvidenceKind>(
  subject: Subject<I>, painter: SubjectPainter<O, Slot, Control, E>, options: Partial<O> = {}, overrides: readonly SubjectOverride<I, O, NoInfer<Slot>, NoInfer<Control>>[] = [],
): SubjectResult<SubjectPainting, SubjectPaintingDiagnostic> {
  const narrowed = requireSubjectEvidence(subject, painter.evidence, `painter '${painter.id}'`);
  if (!narrowed.ok) return narrowed;
  const merged: O = { ...painter.defaults, ...options };
  const optionProblems = (painter.checkOptions?.(merged) ?? []).map((report) => problem('error', 'invalid-options', `options${report.address ? `.${report.address}` : ''}`, report.message, report.fix));
  if (optionProblems.length) return { ok: false, diagnostics: optionProblems };
  const resolved = resolveSubjectOverrides(subject, painter, merged, overrides);
  if (!resolved.ok) return resolved;
  const owned = resolved.value;
  const diagnostics: SubjectPaintingDiagnostic[] = [...owned.warnings];

  const paints = (target: PaintableRef, slot: string) => {
    const found = target.kind === 'part' ? subject.parts.get(target.id) : subject.features.get(target.id);
    return found?.visibility.kind === 'visible' && !owned.replaced(target, slot);
  };
  const context: SubjectPainterContext<typeof narrowed.value, O, Slot> = {
    subject: narrowed.value,
    options: merged,
    paintKey: (...segments: readonly SubjectKeySegment[]) => subjectPaintKey(subject.id, segments),
    paints,
    paintedParts: (slot) => [...subject.parts.values()].filter(isVisiblePart).filter((part) => !owned.replaced(part.ref, slot)),
    paintedFeatures: (slot) => [...subject.features.values()].filter(isVisibleFeature).filter((feature) => !owned.replaced(feature.ref, slot)),
    keepsGround: owned.keepsGround,
    reservedGrounds: owned.reservedGrounds,
    intent: owned.intent,
    optionsFor: owned.optionsFor,
    treatedBy: owned.treatedBy,
    report: ({ severity, address, message, fix }) => diagnostics.push(problem(severity, 'painter-report', address, message, fix)),
  };
  const contributions: readonly SubjectContribution[] = painter.paint(context);

  const contributionKeys = new Set<string>();
  for (const contribution of contributions) {
    const address = `contribution:${contribution.key}`;
    if (contributionKeys.has(contribution.key)) diagnostics.push(problem('error', 'duplicate-key', address, 'two contributions share this key', 'build each key from its own operation name and targets'));
    contributionKeys.add(contribution.key);
    if (!painter.slots.some((slot) => slot === contribution.slot)) {
      diagnostics.push(problem('error', 'unsupported-slot', `${address}.slot`, `painter '${painter.id}' contributed to undeclared slot '${contribution.slot}'`, 'declare the slot, or contribute to one of its slots'));
    }
    for (const target of contribution.targets) {
      const found = target.kind === 'part' ? subject.parts.get(target.id) : subject.features.get(target.id);
      if (!found) diagnostics.push(problem('error', 'unknown-ref', `${address}.targets`, `${subjectRefKey(target)} isn't in subject '${subject.id}'`, 'target the subject\'s own parts and features'));
      else if (found.visibility.kind === 'hidden') diagnostics.push(problem('error', 'hidden-target-painted', `${address}.targets`, `${subjectRefKey(target)} is hidden, so it paints nothing`, 'plan from paintedParts and paintedFeatures, which leave hidden targets out'));
      else if (owned.replaced(target, contribution.slot)) diagnostics.push(problem('error', 'replaced-target-painted', `${address}.targets`, `${subjectRefKey(target)} is replaced in slot ${contribution.slot}`, 'plan from paintedParts and paintedFeatures, or ask paints() before planning a shared wash'));
    }
  }

  const drawn = owned.replacements.map((replacement) => {
    const scope = ['replace', replacement.selector.replace(':', '-'), replacement.slot];
    const layers = replacement.hidden ? [] : replacement.draw({
      subject, targets: replacement.owned, intent: owned.intent,
      paintKey: (...segments: readonly SubjectKeySegment[]) => subjectPaintKey(subject.id, [...scope, ...segments]),
    });
    return { replacement, layers };
  });

  const layers = painter.slots.flatMap((slot) => [
    ...contributions.filter((contribution) => contribution.slot === slot).flatMap((contribution) => contribution.layers),
    ...drawn.filter(({ replacement }) => replacement.at === slot).flatMap((entry) => entry.layers),
  ]);
  const contributionEntries: SubjectContributionEntry[] = contributions.map((contribution) => ({
    key: contribution.key, slot: contribution.slot, targets: targetKeys(contribution.targets), documentKeys: subjectLayerDocumentKeys(contribution.layers),
  }));
  const replacementEntries: SubjectAppliedReplacement[] = drawn.map(({ replacement, layers: replacementLayers }) => ({
    override: replacement.override, selector: replacement.selector, slot: replacement.slot, at: replacement.at,
    targets: targetKeys(replacement.owned), documentKeys: subjectLayerDocumentKeys(replacementLayers),
  }));
  const provenance: SubjectKeyProvenance[] = [
    ...contributionEntries.flatMap((entry) => entry.documentKeys.map((documentKey): SubjectKeyProvenance => ({ documentKey, source: { kind: 'painter', contribution: entry.key }, targets: entry.targets }))),
    ...replacementEntries.flatMap((entry) => entry.documentKeys.map((documentKey): SubjectKeyProvenance => ({ documentKey, source: { kind: 'replacement', override: entry.override }, targets: entry.targets }))),
  ];
  const seen = new Set<string>();
  for (const { documentKey, source } of provenance) {
    if (seen.has(documentKey)) {
      const address = source.kind === 'painter' ? `contribution:${source.contribution}` : `override[${source.override}]`;
      diagnostics.push(problem('error', 'duplicate-key', address, `document key '${documentKey}' is generated twice`, 'build every key with paintKey from distinct operation names'));
    }
    seen.add(documentKey);
  }

  if (diagnostics.some(({ severity }) => severity === 'error')) return { ok: false, diagnostics };
  // Recorded on the layers themselves, so `studio paint check` names the part behind a problem in any factory using them.
  const by = `subject '${subject.id}', painter '${painter.id}'`;
  contributions.forEach((contribution, i) => recordPaintingLayerOrigin(contribution.layers, {
    maker: `${by}, contribution ${contribution.key}`, targets: contributionEntries[i].targets,
    fix: `retune or replace these targets, or change the painter's options`,
  }));
  drawn.forEach(({ replacement, layers: replacementLayers }, i) => recordPaintingLayerOrigin(replacementLayers, {
    maker: `${by}, override[${replacement.override}] replacing ${replacement.selector} in ${replacement.slot}`, targets: replacementEntries[i].targets,
    fix: 'fix the replacement\'s paint function',
  }));
  const hidden = [...new Set(owned.matched.flatMap((match) => match.hidden))];
  return {
    ok: true,
    value: {
      layers,
      report: {
        subject: subject.id, painter: painter.id, matched: owned.matched, hidden, intents: owned.intents,
        replacements: replacementEntries, contributions: contributionEntries, provenance, warnings: diagnostics,
      },
    },
  };
}

/** A painting's value, or a SubjectDiagnosticError listing every diagnostic: for a painting source's factory, which `studio paint check` runs. */
export function requireSubjectPainting(result: SubjectResult<SubjectPainting, SubjectPaintingDiagnostic>): SubjectPainting {
  if (!result.ok) throw new SubjectDiagnosticError('the subject painting failed', result.diagnostics);
  return result.value;
}
