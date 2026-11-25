// subject-overrides.ts: the two ways an author steers automatic painting. An intent says what a target should be
// (its colour, emphasis, edge, or a painter control tuned for it); a replacement takes a target over in one slot or in
// all of them and paints it by hand. Both resolve before the painter plans, so ownership is known when it lays a
// shared wash.
//
// Intents cascade: a feature inherits its owner part's resolved intent, then its own apply; within each, overrides
// apply in order and a later value wins per field. Replacements whose targets meet in a slot are an error.

import type { LayerNode } from '#lib/paint/document/models/painting-document.ts';
import type { SubjectResult } from '#lib/paint/subject/models/subject-diagnostic.ts';
import type { SubjectFrameBasis } from '#lib/paint/subject/models/subject-frame.ts';
import type { SubjectIds } from '#lib/paint/subject/models/subject-id.ts';
import {
  isSubjectSelectionHidden, resolveSubjectSelector, subjectSelectorText,
  type PaintableSelector, type SubjectSelection, type SubjectSelector, type SubjectTarget,
} from '#lib/paint/subject/models/subject-selector.ts';
import { findSubjectFrame, subjectMaterialOf, subjectRefKey, type PaintableRef, type Subject } from '#lib/paint/subject/models/subject.ts';
import type { ResolvedSubjectIntent, SubjectIntent, SubjectIntentField, SubjectKeySegment, SubjectPainter, SubjectPaintKey } from './subject-painter.ts';
import type { SubjectAppliedIntent, SubjectOverrideMatch, SubjectPaintingDiagnostic, SubjectPaintingDiagnosticCode } from './subject-painting-report.ts';

/** What a replacement paints with: the targets it took over, its frame when it asked for one, keys and intents. */
export type SubjectReplacementContext<F extends SubjectFrameBasis | undefined = SubjectFrameBasis | undefined> = {
  readonly subject: Subject;
  /** Everything the replacement took over, hidden ones included. */
  readonly targets: readonly SubjectTarget[];
  readonly frame: F;
  /** subjectPaintKey under `replace.<selector>.<slot>`, so its keys never meet the painter's. */
  readonly paintKey: (...segments: readonly SubjectKeySegment[]) => SubjectPaintKey;
  readonly intent: (target: PaintableRef) => ResolvedSubjectIntent;
};

export type SubjectIntentOverride<I extends SubjectIds = SubjectIds, O = object, Control extends keyof O = keyof O> = {
  readonly kind: 'intent';
  readonly select: SubjectSelector<I>;
  readonly intent: SubjectIntent;
  readonly painterOptions?: Partial<Pick<O, Control>>;
};

/**
 * `slot: 'all'` takes every automatic contribution the selection owns, its lines and details included, and sits at
 * the painter's `replaceAllAt`; a named slot takes that slot alone and sits in it. With `frame`, it paints only once
 * the frame is available, and an unavailable one is a `missing-frame` error while its targets show.
 */
export type SubjectReplaceOverride<I extends SubjectIds = SubjectIds, Slot extends string = string> =
  | { readonly kind: 'replace'; readonly select: PaintableSelector<I>; readonly slot: Slot | 'all'; readonly frame?: undefined; readonly paint: (context: SubjectReplacementContext<undefined>) => readonly LayerNode[] }
  | { readonly kind: 'replace'; readonly select: PaintableSelector<I>; readonly slot: Slot | 'all'; readonly frame: I['frame']; readonly paint: (context: SubjectReplacementContext<SubjectFrameBasis>) => readonly LayerNode[] };

export type SubjectOverride<I extends SubjectIds = SubjectIds, O = object, Slot extends string = string, Control extends keyof O = keyof O> =
  | SubjectIntentOverride<I, O, Control>
  | SubjectReplaceOverride<I, Slot>;

/** An intent for whatever `select` reaches. */
export const subjectIntent = <const S extends SubjectSelector>(select: S, intent: SubjectIntent) => ({ kind: 'intent', select, intent }) as const;

/** Painter options for whatever `select` reaches: the painter's declared controls only. */
export const subjectTune = <const S extends SubjectSelector, const T extends object>(select: S, painterOptions: T) =>
  ({ kind: 'intent', select, intent: {}, painterOptions }) as const;

type ReplaceSpec<Slot extends string> = { readonly slot: Slot; readonly paint: (context: SubjectReplacementContext<undefined>) => readonly LayerNode[] };
type FramedReplaceSpec<Slot extends string, R extends string> = {
  readonly slot: Slot; readonly frame: R; readonly paint: (context: SubjectReplacementContext<SubjectFrameBasis>) => readonly LayerNode[];
};

/** A hand-painted replacement for what `select` owns, in `slot` (or `all`), optionally drawn in a frame. */
// The framed form comes first: TS fixes a callback's parameter type on the first overload it tries.
export function subjectReplace<const S extends PaintableSelector, const Slot extends string, const R extends string>(select: S, spec: FramedReplaceSpec<Slot, R>):
  { readonly kind: 'replace'; readonly select: S } & FramedReplaceSpec<Slot, R>;
export function subjectReplace<const S extends PaintableSelector, const Slot extends string>(select: S, spec: ReplaceSpec<Slot>):
  { readonly kind: 'replace'; readonly select: S } & ReplaceSpec<Slot>;
export function subjectReplace(select: PaintableSelector, spec: ReplaceSpec<string> | FramedReplaceSpec<string, string>) {
  return { kind: 'replace', select, ...spec };
}

/** The slice of a painter overrides are resolved against. */
type OverridePainter<O extends object> = Pick<SubjectPainter<O>, 'id' | 'slots' | 'replaceAllAt' | 'controls' | 'intents' | 'checkOptions'>;

export type ResolvedSubjectReplacement = {
  readonly override: number;
  readonly selector: string;
  readonly slot: string;
  /** The painter slot it sits in. */
  readonly at: string;
  readonly owned: readonly SubjectTarget[];
  /** Every target it owns is hidden: it matched, and draws nothing. */
  readonly hidden: boolean;
  readonly draw: (context: Omit<SubjectReplacementContext, 'frame'>) => readonly LayerNode[];
};

export type ResolvedSubjectOverrides<O> = {
  readonly intent: (target: PaintableRef) => ResolvedSubjectIntent;
  readonly optionsFor: (target: PaintableRef) => O;
  /** Whether a replacement took `target` over in `slot`. */
  readonly replaced: (target: PaintableRef, slot: string) => boolean;
  readonly replacements: readonly ResolvedSubjectReplacement[];
  readonly matched: readonly SubjectOverrideMatch[];
  readonly intents: readonly SubjectAppliedIntent[];
  readonly warnings: readonly SubjectPaintingDiagnostic[];
};

const INTENT_FIELDS: readonly SubjectIntentField[] = ['localColor', 'preserveLocalColor', 'emphasis', 'edge'];

const problem = (severity: 'error' | 'warning', code: SubjectPaintingDiagnosticCode, address: string, message: string, fix: string): SubjectPaintingDiagnostic =>
  ({ code, severity, address, message, fix });

/** `base` with each field `over` sets, a field left undefined keeping base's. */
function withSetFields<T extends object, K extends keyof T>(base: T, over: Partial<Pick<T, K>>): T {
  const set = Object.fromEntries(Object.entries(over).filter(([, value]) => value !== undefined));
  return { ...base, ...set };
}

const keysOf = (targets: readonly SubjectTarget[]) => targets.map(({ ref }) => subjectRefKey(ref));

type IntentEntry<O, Control extends keyof O> = { readonly intent: SubjectIntent; readonly painterOptions: Partial<Pick<O, Control>> };

/**
 * Every override checked against `subject` and the painter, with ownership, the intent cascade and per-target options
 * resolved; or every error found. `options` are the painter's defaults with the call's over them.
 */
export function resolveSubjectOverrides<I extends SubjectIds, O extends object, Slot extends string, Control extends keyof O & string>(
  subject: Subject<I>, painter: OverridePainter<O>, options: O, overrides: readonly SubjectOverride<I, O, Slot, Control>[],
): SubjectResult<ResolvedSubjectOverrides<O>, SubjectPaintingDiagnostic> {
  const diagnostics: SubjectPaintingDiagnostic[] = [];
  const entries = new Map<string, IntentEntry<O, Control>[]>();
  const matched: SubjectOverrideMatch[] = [], intents: SubjectAppliedIntent[] = [], replacements: ResolvedSubjectReplacement[] = [];

  // Widened to plain ids: a frame id typed by I keeps TS from narrowing the replace union on `frame`.
  overrides.forEach((override: SubjectOverride<SubjectIds, O, Slot, Control>, i) => {
    const address = `override[${i}]`;
    const resolved = resolveSubjectSelector(subject, override.select, `${address}.select`);
    if (!resolved.ok) {
      diagnostics.push(...resolved.diagnostics);
      return;
    }
    const selection: SubjectSelection = resolved.value;
    const reached = override.kind === 'intent' ? selection.direct : selection.owned;
    matched.push({
      override: i, kind: override.kind, selector: subjectSelectorText(override.select), targets: keysOf(reached),
      hidden: keysOf(reached.filter(({ visibility }) => visibility.kind === 'hidden')),
    });
    if (override.kind === 'intent') {
      const { localColor } = override.intent;
      if (localColor !== undefined && !/^#[0-9a-f]{6}$/i.test(localColor)) {
        diagnostics.push(problem('error', 'invalid-override', `${address}.intent.localColor`, `'${localColor}' isn't a #rrggbb colour`, 'write it as #rrggbb'));
      }
      const fields = INTENT_FIELDS.filter((field) => override.intent[field] !== undefined);
      for (const field of fields.filter((name) => !painter.intents.includes(name))) {
        diagnostics.push(problem('warning', 'unsupported-intent', `${address}.intent.${field}`, `painter '${painter.id}' doesn't interpret ${field}`, `use a painter that does, or one of its controls: ${painter.controls.join(', ') || 'none'}`));
      }
      const painterOptions: Partial<Pick<O, Control>> = override.painterOptions ?? {};
      const controls = Object.keys(painterOptions);
      for (const control of controls.filter((name) => !painter.controls.some((declared) => declared === name))) {
        diagnostics.push(problem('error', 'unsupported-control', `${address}.painterOptions.${control}`, `painter '${painter.id}' can't tune ${control} per target`, `tune one of: ${painter.controls.join(', ') || 'none'}`));
      }
      for (const report of painter.checkOptions?.(withSetFields(options, painterOptions)) ?? []) {
        diagnostics.push(problem('error', 'invalid-options', `${address}.painterOptions${report.address ? `.${report.address}` : ''}`, report.message, report.fix));
      }
      for (const target of selection.direct) {
        const key = subjectRefKey(target.ref);
        entries.set(key, [...(entries.get(key) ?? []), { intent: override.intent, painterOptions }]);
      }
      intents.push({ override: i, intents: fields, controls, targets: keysOf(selection.direct) });
      return;
    }
    if (override.slot !== 'all' && !painter.slots.includes(override.slot)) {
      diagnostics.push(problem('error', 'unsupported-slot', `${address}.slot`, `painter '${painter.id}' has no slot '${override.slot}'`, `replace in 'all' or one of: ${painter.slots.join(', ')}`));
      return;
    }
    const hidden = isSubjectSelectionHidden(selection);
    const base = { override: i, selector: subjectSelectorText(override.select), slot: override.slot, at: override.slot === 'all' ? painter.replaceAllAt : override.slot, owned: selection.owned, hidden };
    if (override.frame === undefined) {
      const { paint } = override;
      replacements.push({ ...base, draw: (context) => paint({ ...context, frame: undefined }) });
      return;
    }
    const frame = findSubjectFrame(subject, override.frame);
    if (!frame) {
      diagnostics.push(problem('error', 'unknown-ref', `${address}.frame`, `subject '${subject.id}' has no frame '${override.frame}'`, `name one of: ${[...subject.frames.keys()].join(', ') || 'none'}`));
      return;
    }
    if (frame.status.kind === 'unavailable') {
      if (!hidden) diagnostics.push(problem('error', 'missing-frame', `${address}.frame`, `frame '${frame.id}' is unavailable: ${frame.status.reason}`, 'replace without a frame in this view, or show the landmarks it is built from'));
      replacements.push({ ...base, hidden: true, draw: () => [] });
      return;
    }
    const { basis } = frame.status, { paint } = override;
    replacements.push({ ...base, draw: (context) => paint({ ...context, frame: basis }) });
  });

  replacements.forEach((later, j) => replacements.slice(0, j).forEach((earlier) => {
    if (later.slot !== 'all' && earlier.slot !== 'all' && later.slot !== earlier.slot) return;
    const earlierKeys = new Set(keysOf(earlier.owned));
    const shared = keysOf(later.owned).filter((key) => earlierKeys.has(key));
    if (!shared.length) return;
    diagnostics.push(problem('error', 'overlapping-replacements', `override[${later.override}]`,
      `it and override[${earlier.override}] both replace ${shared.join(', ')} in slot ${later.slot === 'all' ? earlier.slot : later.slot}`,
      'replace each target once: narrow one selection, or replace them in different slots'));
  }));

  const errors = diagnostics.filter(({ severity }) => severity === 'error');
  if (errors.length) return { ok: false, diagnostics };

  const intentMemo = new Map<string, ResolvedSubjectIntent>(), optionsMemo = new Map<string, O>();
  const targetOf = (ref: PaintableRef): SubjectTarget => {
    const found = ref.kind === 'part' ? subject.parts.get(ref.id) : subject.features.get(ref.id);
    if (!found) throw new Error(`subject painting: ${subjectRefKey(ref)} isn't in subject '${subject.id}'`);
    return found;
  };
  const intentOf = (ref: PaintableRef): ResolvedSubjectIntent => {
    const key = subjectRefKey(ref), memo = intentMemo.get(key);
    if (memo) return memo;
    const target = targetOf(ref), material = subjectMaterialOf(subject, target);
    const ownColour = { localColor: material.localColor, preserveLocalColor: material.preserveLocalColor };
    const base: ResolvedSubjectIntent = 'owner' in target
      ? { ...intentOf({ kind: 'part', id: target.owner }), ...(target.kind === 'region' && target.material !== undefined ? ownColour : {}) }
      : { ...ownColour, emphasis: 'normal' };
    const resolved = (entries.get(key) ?? []).reduce<ResolvedSubjectIntent>((acc, entry) => withSetFields(acc, entry.intent), base);
    intentMemo.set(key, resolved);
    return resolved;
  };
  const optionsOf = (ref: PaintableRef): O => {
    const key = subjectRefKey(ref), memo = optionsMemo.get(key);
    if (memo) return memo;
    const target = targetOf(ref);
    const base = 'owner' in target ? optionsOf({ kind: 'part', id: target.owner }) : options;
    const resolved = (entries.get(key) ?? []).reduce((acc, entry) => withSetFields(acc, entry.painterOptions), base);
    optionsMemo.set(key, resolved);
    return resolved;
  };
  const replacedSlots = new Map<string, Set<string>>();
  for (const replacement of replacements) {
    for (const key of keysOf(replacement.owned)) replacedSlots.set(key, (replacedSlots.get(key) ?? new Set()).add(replacement.slot));
  }
  const replaced = (target: PaintableRef, slot: string) => {
    const slots = replacedSlots.get(subjectRefKey(target));
    return slots !== undefined && (slots.has('all') || slots.has(slot));
  };
  return { ok: true, value: { intent: intentOf, optionsFor: optionsOf, replaced, replacements, matched, intents, warnings: diagnostics } };
}
